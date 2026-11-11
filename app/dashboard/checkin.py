import streamlit as st
from sqlalchemy import select
from app.backend.authentication import AppError
from app.backend.database import SessionLocal
from app.backend.models import Entrance
from app.dashboard.common import perform, token
from app.scanner.decoder import decode_qr
from app.ticket_engine.ticket_validator import check_in
from app.scanner.live import live_scanner


def render(event_id):
    st.header("QR Check-in")
    st.caption("Step 5 · Select the correct event and entrance before scanning.")
    with SessionLocal() as s:
        gates = s.scalars(select(Entrance).where(Entrance.event_id == event_id, Entrance.active.is_(True)).order_by(Entrance.name)).all()
    if not gates:
        st.info("No active entrances. Ask an administrator to configure access.")
        return
    entrance_id = st.selectbox("Entrance", [g.id for g in gates], format_func=lambda i: next(g.name for g in gates if g.id == i), key=f"scanner_entrance_{event_id}")
    st.write("**Current entrance:**", next(g.name for g in gates if g.id == entrance_id))
    mode = st.radio("Input", ["Camera", "QR image / scanner text", "Manual ticket number"], horizontal=True)
    result_key = (event_id, entrance_id)
    context = (event_id, entrance_id, mode)
    if st.session_state.get("scan_context") != context:
        st.session_state.pop("scan_result", None)
        st.session_state.scan_context = context

    def scan(value=None, number=None):
        st.session_state.pop("scan_result", None)
        ok, result = perform(lambda s: check_in(s, token(), event_id, entrance_id, qr_value=value, ticket_number=number), rerun=False)
        if ok:
            st.session_state.scan_result = (result_key, result)

    if mode == "Camera":
        previous = st.session_state.get("scan_result")
        feedback = None
        if previous and previous[0] == result_key:
            status = previous[1]
            feedback = {"accepted": status.accepted, "message":
                ("ENTRY APPROVED\n" + status.attendee_name + "\n" + status.ticket_number) if status.accepted else "ENTRY REJECTED\n" + status.message}
        value = live_scanner(event_id, entrance_id, feedback)
        if isinstance(value, dict) and value.get("id") != st.session_state.get("processed_live_scan"):
            st.session_state.processed_live_scan = value.get("id")
            scan(str(value.get("text", ""))[:200])
            st.rerun()
        st.caption("Camera frames stay on this device. Only the decoded QR text is sent for verification. If scanning is difficult, select QR image / scanner text and upload a clear image.")
    elif mode == "QR image / scanner text":
        st.caption("Upload a QR image or use a hardware scanner that types the QR text.")
        image = st.file_uploader("QR image", type=["png", "jpg", "jpeg"], key=f"qr_upload_{event_id}")
        if image and st.button("Check in from image", type="primary"):
            st.session_state.pop("scan_result", None)
            try:
                scan(decode_qr(image.getvalue()))
            except AppError as exc:
                st.error(str(exc))
        with st.form("qr_text"):
            value = st.text_input("QR scanner text", max_chars=200, placeholder="AAST1.…")
            submitted = st.form_submit_button("Verify QR and check in")
        if submitted:
            scan(value)
    else:
        st.caption("Use only when the QR cannot be read. Confirm the attendee's identity before admitting them. Manual entry is recorded in the audit trail.")
        with st.form("manual_number"):
            number = st.text_input("Ticket number", max_chars=40, placeholder="AAST-…")
            confirmed = st.checkbox("I have verified the attendee's identity and want to admit them")
            submitted = st.form_submit_button("Find ticket and check in", type="primary")
        if submitted:
            st.session_state.pop("scan_result", None)
            if not number.strip() or not confirmed:
                st.error("Enter the ticket number and confirm identity before check-in.")
            else:
                scan(number=number)
    result = st.session_state.get("scan_result")
    if mode != "Camera" and result and result[0] == result_key:
        status = result[1]
        if status.accepted:
            st.success(f"**ENTRY APPROVED**\n\n{status.attendee_name}\n\n{status.ticket_number}")
        else:
            st.error(f"**ENTRY REJECTED**\n\n{status.message}" + (f"\n\n{status.ticket_number}" if status.ticket_number else ""))
