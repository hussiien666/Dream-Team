import streamlit as st
from sqlalchemy import func, select
from app.backend.authentication import AppError, create_user, login, require_user
from app.backend.database import SessionLocal, transaction
from app.backend.models import User
from app.backend.security import SecondFactorRequired, PasswordChangeRequired
from app.dashboard.security import gate


def sign_in():
    """First admin is created from the local CLI, never by a public visitor."""
    token = st.session_state.get("auth_token")
    if token:
        if codes := st.session_state.get("new_recovery_codes"):
            from app.dashboard.security import show_recovery
            show_recovery(codes)
            if st.button("I saved my recovery codes"):
                st.session_state.pop("new_recovery_codes", None)
                st.rerun()
            st.stop()
        try:
            with transaction() as session:
                return require_user(session, token)
        except SecondFactorRequired:
            gate(token)
        except PasswordChangeRequired:
            gate(token, force_password=True)
        except AppError as exc:
            st.session_state.pop("auth_token", None)
            st.warning(str(exc))
    st.title("Dream Events")
    with SessionLocal() as session:
        has_users = session.scalar(select(func.count()).select_from(User)) > 0
    if not has_users:
        st.info("Create the first administrator from your project terminal, then refresh this page.")
        st.code("py -3.10 -m app.backend.main create-admin", language="powershell")
        st.stop()
    st.write("Sign in to manage events or check in attendees.")
    with st.form("login"):
        username = st.text_input("Username", max_chars=80)
        password = st.text_input("Password", type="password", max_chars=256)
        submitted = st.form_submit_button("Sign in", type="primary")
    if submitted:
        with transaction() as session:
            token = login(session, username, password)
        if token:
            st.session_state.auth_token = token
            st.rerun()
        st.error("Sign-in failed. Check your credentials. After five failed attempts, wait 15 minutes.")
    st.stop()
