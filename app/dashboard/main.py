"""Streamlit entry point. Run with streamlit run app/dashboard/main.py."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import streamlit as st
from app.backend.database import engine
from app.backend.schema import schema_ready
from app.dashboard.auth import sign_in
from app.backend.authentication import AppError, logout
from app.backend.database import SessionLocal, transaction
from app.backend.models import Event
from app.backend.permissions import ROLE_LABELS, ROLE_PERMISSIONS, membership, require_permission, visible_events
from app.dashboard import access, attendees, checkin, events, overview, reports, settings
from app.dashboard.common import flash
from sqlalchemy import select

st.set_page_config(page_title="Dream Events", page_icon="🎟", layout="wide")
if not schema_ready(engine):
    st.title("Dream Events")
    st.info("Initialize or upgrade the database from the project terminal before signing in.")
    st.code("py -3.10 -m alembic upgrade head", language="powershell")
    st.stop()

user = sign_in()
with SessionLocal() as s:
    member = membership(s, user)
    operational_role = member.role
permissions = ROLE_PERMISSIONS[operational_role]
SECTIONS = ["Dashboard", "Events", "Attendees & Tickets", "Entrances & Categories", "QR Check-in", "Reports", "Settings"]
st.markdown("""<style>
[data-testid="stSidebar"] {border-right:1px solid #dfe4e9;}
[data-testid="stSidebar"] h1 {border-bottom:2px solid #b5974e;padding-bottom:12px;font-size:1.35rem;}
.block-container {padding-top:2rem;max-width:1200px;}
h1,h2,h3 {color:#142d4e;}
@media(max-width:640px){.block-container{padding:1.2rem 1rem;}}
</style>""", unsafe_allow_html=True)
if pending := st.session_state.pop("pending_navigation", None):
    st.session_state.navigation = pending
with st.sidebar:
    st.title("Dream Events")
    st.caption(f"{user.display_name} · {ROLE_LABELS[operational_role]}")
    section_permissions = {"Dashboard": "events.view", "Events": "events.manage",
        "Attendees & Tickets": "attendees.manage", "Entrances & Categories": "access.manage",
        "QR Check-in": "checkin.perform", "Reports": "reports.view"}
    available = [section for section in SECTIONS if section == "Settings" or section_permissions[section] in permissions]
    if operational_role == "scanner":
        available = ["QR Check-in", "Settings"]
    if st.session_state.get("navigation") not in available:
        st.session_state.navigation = available[0]
    section = st.radio("Navigation", available, key="navigation", label_visibility="collapsed")
    if st.button("Sign out"):
        with transaction() as s:
            logout(s, st.session_state.auth_token)
        st.session_state.clear()
        st.rerun()

flash()
try:
    if section == "Dashboard":
        overview.render()
    elif section == "Events":
        events.render()
    elif section == "Settings":
        settings.render(user)
    else:
        with SessionLocal() as s:
            choices = visible_events(s, st.session_state.auth_token)
        if user.role == "staff":
            choices = [e for e in choices if not e.archived and e.status in ("Published", "Ongoing")]
        if not choices:
            st.header(section)
            st.info("No events available. " + ("Create an event in Events to begin." if user.role == "admin" else "Ask an administrator to publish an event."))
        else:
            with st.sidebar:
                selected = st.selectbox("Event", [e.id for e in choices], format_func=lambda i: next(e.name + (" (archived)" if e.archived else "") + f" · {e.event_date}" for e in choices if e.id == i), key="selected_event")
            current = next(e for e in choices if e.id == selected)
            with SessionLocal() as s:
                require_permission(s, st.session_state.auth_token, section_permissions[section], selected)
            st.caption(current.name + " · " + current.venue)
            if current.archived:
                st.info("This event is archived. Reports and history remain available.")
            {"Attendees & Tickets": attendees.render, "Entrances & Categories": access.render,
             "QR Check-in": checkin.render, "Reports": reports.render}[section](selected)
except AppError as exc:
    st.error(str(exc))
