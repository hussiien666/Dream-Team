from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo
import streamlit as st
from sqlalchemy import select
from app.backend.config import APP_TIMEZONE
from app.backend.database import SessionLocal
from app.backend.models import Event
from app.backend.permissions import ROLE_PERMISSIONS, membership, require_user, visible_events
from app.backend.services.events import archive_event, delete_event, save_event
from app.dashboard.common import perform, table, token


def render():
    st.header("Events")
    st.caption("Step 1 · Create an event, then configure its categories and entrances.")
    with SessionLocal() as s:
        events = visible_events(s, token())
        role = membership(s, require_user(s, token())).role
    include_archived = st.checkbox("Show archived events")
    search = st.text_input("Search events", placeholder="Event name or venue")
    visible = [e for e in events if (include_archived or not e.archived) and search.lower() in (e.name + " " + e.venue).lower()]
    table([{"ID": e.id, "Event": e.name, "Date": e.event_date, "Venue": e.venue,
            "Capacity": e.capacity, "Status": "Archived" if e.archived else e.status} for e in visible])
    if "events.create" in ROLE_PERMISSIONS[role] and st.button("Add event", type="primary"):
        st.session_state.event_editor = "new"
    selected = st.selectbox("Select event to manage", [e.id for e in visible],
                            format_func=lambda i: next(e.name + f" (#{i})" for e in visible if e.id == i)) if visible else None
    if selected:
        chosen = next(e for e in visible if e.id == selected)
        c1, c2 = st.columns([1, 5])
        if c1.button("Edit", key="edit_event"):
            st.session_state.event_editor = selected
        if c2.button("Restore event" if chosen.archived else "Archive event", disabled=chosen.archived and role != "super_admin"):
            perform(lambda s: archive_event(s, token(), selected, not chosen.archived), "Event restored." if chosen.archived else "Event archived.")
        with st.expander("Delete event"):
            st.caption("Only events without ticket history can be deleted. Their attendees and access configuration will also be deleted.")
            confirm = st.checkbox("I confirm deletion of this event and its registrations", key=f"delete_event_{selected}")
            if st.button("Delete", disabled=not confirm, key="delete_event_button"):
                perform(lambda s: delete_event(s, token(), selected), "Event deleted.")
    mode = st.session_state.get("event_editor")
    if mode is None:
        return
    obj = next((e for e in events if e.id == mode), None)
    if mode != "new" and obj is None:
        st.session_state.pop("event_editor", None)
        return
    st.subheader("Add event" if obj is None else "Edit event")
    zone = ZoneInfo(obj.timezone if obj else APP_TIMEZONE)
    local = lambda value: value.replace(tzinfo=timezone.utc).astimezone(zone).replace(tzinfo=None) if value else None
    get = lambda field, default="": getattr(obj, field) if obj else default
    with st.form(f"event_form_{mode}"):
        data = {"name": st.text_input("Event name *", value=get("name"), max_chars=200)}
        c1, c2, c3 = st.columns(3)
        data["event_date"] = c1.date_input("Event date *", value=get("event_date", datetime.now(ZoneInfo(APP_TIMEZONE)).date()))
        data["start_time"] = c2.time_input("Start time *", value=local(obj.starts_at).time() if obj else time(9))
        data["end_time"] = c3.time_input("End time *", value=local(obj.ends_at).time() if obj else time(17))
        data["venue"] = st.text_input("Venue *", value=get("venue"), max_chars=200)
        data["description"] = st.text_area("Description", value=get("description"), max_chars=10000)
        c1, c2 = st.columns(2)
        data["capacity"] = c1.number_input("Capacity *", min_value=1, value=get("capacity", 100), step=1)
        statuses = ["Draft", "Published", "Ongoing", "Completed", "Cancelled"]
        data["status"] = c2.selectbox("Status", statuses, index=statuses.index(get("status", "Draft")))
        with st.expander("Optional details and branding"):
            data["subtitle"] = st.text_input("Subtitle", value=get("subtitle"), max_chars=200)
            data["organization"] = st.text_input("Organization", value=get("organization", "AAST"), max_chars=200)
            data["event_type"] = st.text_input("Event type", value=get("event_type", "University event"), max_chars=100)
            data["timezone"] = st.text_input("Time zone", value=get("timezone", APP_TIMEZONE))
            st.caption("Optional dates below use the event time zone. Leave blank for no restriction.")
            data["max_tickets"] = st.number_input("Maximum tickets (optional)", min_value=1,
                value=obj.max_tickets if obj and obj.max_tickets != obj.capacity else None, step=1,
                placeholder="Defaults to capacity", help="Leave blank to use capacity. Category allocations share this overall limit.")
            for field, label in (("distribution_start", "Ticket distribution starts"), ("distribution_end", "Ticket distribution ends"), ("registration_deadline", "Registration deadline")):
                value = get(field, None)
                data[field] = st.datetime_input(label, value=local(value))
            for field, label, default in (("country", "Country", "Egypt"), ("city", "City", ""), ("building", "Building", ""), ("address", "Address", "")):
                data[field] = st.text_input(label, value=get(field, default), max_chars=500 if field == "address" else 200)
            data["instructions"] = st.text_area("Location / access instructions", value=get("instructions"), max_chars=3000)
            for field, label in (("logo", "Event logo"), ("banner", "Event banner")):
                image = st.file_uploader(label, type=["png", "jpg", "jpeg"], key=f"{field}_{mode}")
                if image:
                    data[field] = image.getvalue()
                if obj and getattr(obj, field) and st.checkbox(f"Remove {label.lower()}"):
                    data[field] = None
        c1, c2 = st.columns([1, 5])
        save = c1.form_submit_button("Save", type="primary")
        cancel = c2.form_submit_button("Cancel")
    if data.get("max_tickets") is None:
        data.pop("max_tickets", None)
    if cancel:
        st.session_state.pop("event_editor", None)
        st.rerun()
    if save:
        ok, _ = perform(lambda s: save_event(s, token(), data, obj.id if obj else None), rerun=False)
        if ok:
            st.session_state.pop("event_editor", None)
            st.session_state.flash = "Event saved. Select it in the sidebar to configure access."
            st.rerun()
