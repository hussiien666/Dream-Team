import streamlit as st
from sqlalchemy import func, select
from app.backend.database import SessionLocal
from app.backend.models import CheckIn, Event, Ticket, utcnow
from app.dashboard.common import table
from app.dashboard.common import token
from app.backend.permissions import ROLE_PERMISSIONS, membership, require_user, visible_events


def render():
    st.header("Dashboard")
    st.write("Create an event, configure access, add attendees, generate tickets, then check in guests.")
    with SessionLocal() as s:
        upcoming = visible_events(s, token())
        role = membership(s, require_user(s, token())).role
    if "events.create" in ROLE_PERMISSIONS[role] and st.button("Create event", type="primary"):
        st.session_state.pending_navigation = "Events"
        st.session_state.event_editor = "new"
        st.rerun()
    st.subheader("Select an event")
    table([{"Event": e.name, "Date": e.event_date, "Venue": e.venue, "Status": e.status} for e in upcoming])
    if not upcoming:
        st.info("No assigned events are available.")
        return
    if role in ("scanner", "checkin_supervisor"):
        st.caption("Select an assigned event in QR Check-in or Reports for permitted operations.")
        return
    selected = st.selectbox("Dashboard event", [e.id for e in upcoming],
        format_func=lambda i: next(e.name for e in upcoming if e.id == i))
    with SessionLocal() as s:
        from app.backend.permissions import require_permission
        require_permission(s, token(), "events.view", selected)
        tickets = s.scalar(select(func.count()).select_from(Ticket).where(Ticket.event_id == selected))
        checked = s.scalar(select(func.count()).select_from(CheckIn).where(CheckIn.event_id == selected))
    c1, c2 = st.columns(2)
    c1.metric("Tickets issued", tickets)
    c2.metric("Accepted entries", checked)
    st.caption("Totals apply only to the selected event.")
