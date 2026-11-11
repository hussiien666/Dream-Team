import hashlib
import streamlit as st
from sqlalchemy import select
from app.backend.authentication import AppError
from app.backend.database import SessionLocal
from app.backend.models import Attendee, Category, EmailDelivery, Ticket
from app.backend.services.email_delivery import gmail_settings, send_ticket_email
from app.backend.services.attendees import cancel_attendee, save_attendee
from app.backend.services.imports import FIELD_LABELS, FIELDS, auto_mapping, import_rows, import_template, map_rows, read_upload, validate_rows
from app.backend.services.reports import attendee_table, csv_bytes, effective_status, excel_bytes
from app.backend.services.tickets import delivery_zip, issue_many, regenerate_ticket, revoke_ticket
from app.dashboard.common import perform, table, token


def render(event_id):
    st.header("Attendees & Tickets")
    with SessionLocal() as s:
        categories = s.scalars(select(Category).where(Category.event_id == event_id).order_by(Category.name)).all()
        people = s.scalars(select(Attendee).where(Attendee.event_id == event_id).order_by(Attendee.full_name)).all()
    if not categories:
        st.info("Add a ticket category in Entrances & Categories first.")
        return
    mode = st.radio("Action", ["Manage attendees", "Import file", "Generate tickets"], horizontal=True)
    if mode == "Manage attendees":
        manage(event_id, categories, people)
    elif mode == "Import file":
        imports(event_id, categories)
    else:
        tickets(event_id, categories, people)


def manage(event_id, categories, people):
    st.caption("Step 3 · Register attendees and assign a category.")
    with SessionLocal() as s:
        frame = attendee_table(s, token(), event_id)
    search = st.text_input("Search attendees", placeholder="Name, email, ID or ticket number")
    cat = st.selectbox("Filter by category", ["All categories"] + [c.name for c in categories])
    shown = frame
    if cat != "All categories":
        shown = shown[shown["Category"] == cat]
    if search:
        shown = shown[shown.astype(str).apply(lambda row: row.str.contains(search, case=False, regex=False).any(), axis=1)]
    table(shown.drop(columns=["Notes", "Organization", "Registered (UTC)"], errors="ignore"))
    c1, c2 = st.columns(2)
    c1.download_button("Export CSV", csv_bytes(shown), "attendees.csv", "text/csv")
    c2.download_button("Export Excel", excel_bytes({"Attendees": shown}), "attendees.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if st.button("Add attendee", type="primary"):
        st.session_state.attendee_editor = (event_id, "new")
    visible_ids = set(shown["ID"])
    options = [a for a in people if a.id in visible_ids]
    selected = st.selectbox("Select attendee", [a.id for a in options],
                            format_func=lambda i: next(f"{a.full_name} · {a.email or a.identity_number} (#{i})" for a in options if a.id == i)) if options else None
    if selected and st.button("Edit attendee"):
        st.session_state.attendee_editor = (event_id, selected)
    state = st.session_state.get("attendee_editor")
    if state and state[0] == event_id:
        obj = next((a for a in people if a.id == state[1]), None)
        get = lambda field, default="": getattr(obj, field) or default if obj else default
        st.subheader("Edit attendee" if obj else "Add attendee")
        with st.form(f"person_{event_id}_{state[1]}"):
            data = {"full_name": st.text_input("Full name *", value=get("full_name"), max_chars=200),
                    "email": st.text_input("Email address", value=get("email"), max_chars=254),
                    "phone": st.text_input("Phone number", value=get("phone"), max_chars=40),
                    "identity_number": st.text_input("Student / National ID", value=get("identity_number"), max_chars=100),
                    "organization": st.text_input("Organization", value=get("organization"), max_chars=200),
                    "notes": st.text_area("Notes", value=get("notes"), max_chars=3000)}
            st.caption("Provide an email address or ID. IDs and phone numbers are treated as text.")
            category_ids = [c.id for c in categories]
            category = st.selectbox("Ticket category *", category_ids,
                                    index=category_ids.index(obj.category_id) if obj else 0,
                                    format_func=lambda i: next(c.name + (" (inactive)" if not c.active else "") for c in categories if c.id == i))
            c1, c2 = st.columns([1, 5])
            save = c1.form_submit_button("Save", type="primary")
            cancel = c2.form_submit_button("Cancel")
        if cancel:
            st.session_state.pop("attendee_editor", None)
            st.rerun()
        if save:
            ok, _ = perform(lambda s: save_attendee(s, token(), event_id, category, data, obj.id if obj else None), rerun=False)
            if ok:
                st.session_state.pop("attendee_editor", None)
                st.session_state.flash = "Attendee saved."
                st.rerun()
    if selected:
        with st.expander("Cancel registration or delete attendee"):
            operation = st.selectbox("Operation", ["Cancel registration and revoke unused tickets", "Delete attendee without ticket history"])
            confirmed = st.checkbox("I confirm this operation for the selected attendee", key=f"person_delete_{event_id}_{selected}_{operation}")
            if st.button("Cancel registration" if operation.startswith("Cancel") else "Delete", disabled=not confirmed):
                perform(lambda s: cancel_attendee(s, token(), event_id, selected, delete_record=operation.startswith("Delete")), "Registration cancelled." if operation.startswith("Cancel") else "Attendee deleted.")


@st.cache_data
def template_bytes(categories=()):
    return import_template(categories)


def imports(event_id, categories):
    st.caption("Step 3 · Download the template, fill in attendees, upload it, and confirm the preview.")
    active_categories = [c for c in categories if c.active]
    st.download_button("Download Excel template", template_bytes(tuple((c.name, c.code) for c in active_categories)), "attendee_template.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    st.caption("The template uses the same fields as Add attendee and includes this event's category dropdown. Enter an email address for each attendee who should receive a ticket by email.")
    sequence = st.session_state.get(f"import_sequence_{event_id}", 0)
    upload = st.file_uploader("Attendee spreadsheet", type=["csv", "xlsx"], key=f"import_file_{event_id}_{sequence}")
    if not upload:
        return
    try:
        content = upload.getvalue()
        digest = hashlib.sha256(content).hexdigest()
        completed = st.session_state.get(f"import_complete_{event_id}")
        if completed and completed[0] == digest:
            st.success(f"This file has been imported successfully: {completed[1]} attendees. No need to import it again.")
            if st.button("Upload another file", type="primary"):
                st.session_state[f"import_sequence_{event_id}"] = sequence + 1
                st.session_state.pop(f"import_complete_{event_id}", None)
                st.rerun()
            return
        frame = read_upload(content, upload.name)
        mapping = auto_mapping(frame.columns)
        options = [""] + list(frame.columns)
        matched = bool(mapping["full_name"] and (mapping["email"] or mapping["identity_number"]))
        if matched:
            st.success("Columns matched automatically. Review the attendees below.")
        with st.expander("Change column matching" if matched else "Match your spreadsheet columns", expanded=not matched):
            columns = st.columns(2)
            for index, field in enumerate(FIELDS):
                mapping[field] = columns[index % 2].selectbox(FIELD_LABELS[field], options,
                    index=options.index(mapping[field]), format_func=lambda v: v or "Not in this sheet", key=f"map_{event_id}_{field}_{hashlib.sha256(content).hexdigest()[:8]}")
        if not active_categories:
            st.info("Activate a category before importing.")
            return
        default_code = st.selectbox("Category for attendees with a blank category", [c.code for c in active_categories],
                                   format_func=lambda code: next(c.name for c in active_categories if c.code == code))
        records = map_rows(frame, mapping, default_code)
        fingerprint = hashlib.sha256(repr((event_id, content, mapping, default_code)).encode()).hexdigest()
        with SessionLocal() as s:
            clean, errors = validate_rows(s, token(), event_id, records)
        st.subheader("Import review")
        st.write(f"{len(records)} rows · {len(clean)} valid · {len(errors)} with errors")
        import pandas as pd
        table(pd.DataFrame([{FIELD_LABELS[field]: row[field] for field in FIELDS} for row in records]))
        if errors:
            st.error("Correct these rows in your file, upload it again, and review. No rows have been imported.")
            table(errors)
            return
        confirmed = st.checkbox("I have reviewed the information and confirm this import", key=f"confirm_import_{fingerprint}")
        if st.button("Import attendees", disabled=not confirmed):
            ok, count = perform(lambda s: import_rows(s, token(), event_id, records), rerun=False)
            if ok:
                st.session_state[f"import_complete_{event_id}"] = (digest, count)
                st.rerun()
    except AppError as exc:
        st.error(str(exc))


def tickets(event_id, categories, people):
    st.caption("Step 4 · Generate PDF and mobile HTML tickets. QR codes contain only a random credential.")
    names = {a.id: a.full_name for a in people}
    cat_names = {c.id: c.name for c in categories}
    with SessionLocal() as s:
        issued = s.scalars(select(Ticket).where(Ticket.event_id == event_id).order_by(Ticket.created_at.desc())).all()
        emails = s.scalars(select(EmailDelivery).where(EmailDelivery.event_id == event_id).order_by(EmailDelivery.updated_at.desc())).all()
    addresses = {a.id: a.email or "" for a in people}
    def email_status(ticket):
        return next((e.status for e in emails if e.ticket_id == ticket.id and e.token_hash == ticket.token_hash and e.recipient == addresses[ticket.attendee_id]), "Not sent" if addresses[ticket.attendee_id] else "No email address")
    table([{"Ticket": t.number, "Attendee": names[t.attendee_id], "Category": cat_names[t.category_id],
            "Status": effective_status(t), "Email delivery": email_status(t), "Issued (UTC)": t.created_at} for t in issued])
    import pandas as pd
    export = pd.DataFrame([{"Ticket": t.number, "Attendee": names[t.attendee_id], "Category": cat_names[t.category_id], "Status": effective_status(t)} for t in issued], columns=["Ticket", "Attendee", "Category", "Status"])
    st.download_button("Export ticket list", csv_bytes(export), "ticket_list.csv", "text/csv")
    committed_people = {t.attendee_id for t in issued if t.status in ("Active", "Used")}
    eligible = [a for a in people if a.status == "Registered"]
    scope = st.radio("Generate for", ["Selected attendees", "All attendees without an active or used ticket"], horizontal=True)
    if scope == "Selected attendees":
        selected = st.multiselect("Attendees", [a.id for a in eligible], format_func=lambda i: f"{names[i]} (#{i})")
    else:
        selected = [a.id for a in eligible if a.id not in committed_people][:500]
        st.caption(f"{len(selected)} attendees selected (maximum 500 per batch).")
    email_ready = gmail_settings().ready
    email_after = st.checkbox("Email tickets to attendees after generation", disabled=not email_ready,
                              help="Uses the email address entered by the administrator for each attendee. Up to 50 emails per batch.")
    if not email_ready:
        st.info("To send tickets by email, configure your Gmail account in Settings → Ticket email delivery.")
    if st.button("Generate tickets", disabled=not selected, type="primary"):
        if email_after and len(selected) > 50:
            st.error("Select at most 50 attendees when emailing after generation. Larger batches can be generated for download.")
            return
        with st.spinner("Generating tickets…"):
            ok, result = perform(lambda s: issue_many(s, token(), event_id, selected), rerun=False)
        if ok:
            st.session_state.delivery = (event_id, result)
            if email_after:
                send_emails(event_id, result)
            st.session_state.flash = f"Generated {len(result)} ticket(s). Download them below."
            st.rerun()
    if issued:
        ticket_id = st.selectbox("Select issued ticket", [t.id for t in issued], format_func=lambda i: next(t.number + " · " + names[t.attendee_id] for t in issued if t.id == i))
        with st.expander("Replace or revoke a ticket"):
            op = st.radio("Ticket operation", ["Regenerate and invalidate previous QR", "Revoke"], horizontal=True)
            st.caption("Replacement downloads are available only in this signed-in session. Regenerating replaces the old QR immediately.")
            confirm = st.checkbox("I confirm this change to the selected ticket", key=f"ticket_confirm_{ticket_id}_{op}")
            if st.button("Regenerate" if op.startswith("Regenerate") else "Revoke", disabled=not confirm):
                if op.startswith("Regenerate"):
                    ok, result = perform(lambda s: regenerate_ticket(s, token(), event_id, ticket_id), rerun=False)
                    if ok:
                        st.session_state.delivery = (event_id, [result])
                        st.session_state.flash = "Replacement generated. The previous QR no longer works."
                        st.rerun()
                else:
                    perform(lambda s: revoke_ticket(s, token(), event_id, ticket_id), "Ticket revoked.")
    delivery = st.session_state.get("delivery")
    if delivery and delivery[0] == event_id:
        st.subheader("Download generated tickets")
        st.caption("Download now and distribute privately. Files are held in this session only. If lost, regenerate an active ticket to get a new QR.")
        artifacts = delivery[1]
        st.download_button("Download all tickets (ZIP)", delivery_zip(artifacts), "tickets.zip", "application/zip")
        item = st.selectbox("Individual ticket", range(len(artifacts)), format_func=lambda i: artifacts[i]["number"])
        c1, c2 = st.columns(2)
        c1.download_button("Download PDF", artifacts[item]["pdf"], artifacts[item]["number"] + ".pdf", "application/pdf")
        c2.download_button("Download mobile web ticket", artifacts[item]["html"], artifacts[item]["number"] + ".html", "text/html")
        st.subheader("Send tickets by email")
        person = next((a for a in people if a.id == artifacts[item]["attendee_id"]), None)
        st.caption("Selected ticket recipient: " + (person.email if person and person.email else "No email address. Edit this attendee before sending."))
        another = st.checkbox("Send another copy if already sent", key=f"resend_{artifacts[item]['number']}_{artifacts[item].get('token_hash', 'legacy')}")
        if st.button("Send selected ticket by email", disabled=not email_ready or not person or not person.email, type="primary"):
            send_emails(event_id, [artifacts[item]], another)
            st.rerun()
        if len(artifacts) > 1:
            confirmed = st.checkbox(f"Send these {len(artifacts)} tickets to their attendees' email addresses", key=f"bulk_email_confirm_{event_id}_{','.join(d['number'] for d in artifacts)}")
            if st.button("Send all generated tickets by email", disabled=not email_ready or not confirmed or len(artifacts) > 50):
                send_emails(event_id, artifacts, another)
                st.rerun()
            if len(artifacts) > 50:
                st.caption("Email delivery is limited to 50 tickets per batch. Individual email delivery remains available above.")
        results = st.session_state.get("email_results")
        if results and results[0] == event_id:
            table(results[1])
        with SessionLocal() as s:
            history = s.scalars(select(EmailDelivery).where(EmailDelivery.event_id == event_id).order_by(EmailDelivery.updated_at.desc()).limit(50)).all()
        if history:
            with st.expander("Recent email delivery history"):
                table([{"Recipient": h.recipient, "Status": h.status, "Attempts": h.attempts,
                        "Sent (UTC)": h.sent_at, "Details": h.last_error} for h in history])
        st.caption("Sent means Gmail accepted the message for delivery. Delivery failures and bounces can be checked in your Gmail account. Email contains a PDF ticket; no public attendee link is created.")
        if st.button("Clear downloads from this session"):
            st.session_state.pop("delivery", None)
            st.rerun()


def send_emails(event_id, deliveries, resend=False):
    results = []
    progress = st.progress(0, text="Sending ticket emails…")
    for index, delivery in enumerate(deliveries):
        try:
            result = send_ticket_email(token(), event_id, delivery, resend=resend)
            results.append({"Ticket": result["number"], "Recipient": result["recipient"],
                            "Status": result["status"], "Details": result.get("error", "")})
            if result.get("error", "").startswith(("Gmail rejected sign-in", "Could not connect securely")):
                for remaining in deliveries[index+1:]:
                    results.append({"Ticket": remaining["number"], "Recipient": "", "Status": "Not sent", "Details": "Stopped after a Gmail connection/sign-in failure. Fix Settings and retry."})
                break
        except AppError as exc:
            results.append({"Ticket": delivery["number"], "Recipient": "", "Status": "Not sent", "Details": str(exc)})
        progress.progress((index + 1) / len(deliveries), text=f"Processed {index + 1} of {len(deliveries)} ticket emails")
    progress.empty()
    st.session_state.email_results = (event_id, results)
