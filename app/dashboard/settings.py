import streamlit as st
from sqlalchemy import select
from app.backend.authentication import change_password, create_user, set_user_active
from app.backend.database import SessionLocal
from app.backend.models import AuditLog, User
from app.backend.models import EventAssignment, OrganizationUser
from app.backend.permissions import (ROLE_LABELS, membership, require_permission,
    set_event_assignment, set_role, visible_events)
from app.backend.services.reports import csv_bytes
from app.dashboard.common import perform, table, token
from app.wallet.wallet_generator import wallet_status
from app.backend.authentication import AppError
from app.backend.services.email_delivery import gmail_settings, save_gmail_settings, test_gmail_connection


def render(user):
    st.header("Settings")
    from app.dashboard.security import settings as security_settings
    security_settings(token())
    st.subheader("Your password")
    with st.form("password"):
        old = st.text_input("Current password", type="password")
        new = st.text_input("New password (12+ characters)", type="password", max_chars=256)
        confirm = st.text_input("Confirm new password", type="password", max_chars=256)
        submit = st.form_submit_button("Save password")
    if submit:
        if new != confirm:
            st.error("The new passwords do not match.")
        else:
            ok, _ = perform(lambda s: change_password(s, token(), old, new), rerun=False)
            if ok:
                st.session_state.clear()
                st.rerun()
    with SessionLocal() as s:
        member = membership(s, user)
    if member.role != "super_admin":
        return
    gmail_options()
    st.subheader("Users")
    with SessionLocal() as s:
        require_permission(s, token(), "users.manage")
        members = s.scalars(select(OrganizationUser).where(OrganizationUser.organization_id == member.organization_id)).all()
        user_ids = [m.user_id for m in members]
        roles = {m.user_id: m.role for m in members}
        users = s.scalars(select(User).where(User.id.in_(user_ids)).order_by(User.username)).all()
        owned_events = visible_events(s, token())
        event_ids = [e.id for e in owned_events]
        history = s.scalars(select(AuditLog).where((AuditLog.actor_id.in_(user_ids)) | (AuditLog.event_id.in_(event_ids))).order_by(AuditLog.id.desc()).limit(200)).all()
    table([{"ID": u.id, "Username": u.username, "Name": u.display_name,
            "Role": ROLE_LABELS[roles[u.id]], "Status": "Active" if u.active else "Disabled"} for u in users])
    if st.button("Add user", type="primary"):
        st.session_state.show_user_form = True
    if st.session_state.get("show_user_form"):
        with st.form("new_user"):
            name = st.text_input("Display name", max_chars=160)
            username = st.text_input("New username", max_chars=80)
            password = st.text_input("Temporary password (12+ characters)", type="password", max_chars=256)
            role = st.selectbox("Role", list(ROLE_LABELS), format_func=ROLE_LABELS.get)
            save = st.form_submit_button("Save", type="primary")
            cancel = st.form_submit_button("Cancel")
        if cancel:
            st.session_state.pop("show_user_form", None)
            st.rerun()
        if save:
            ok, _ = perform(lambda s: create_user(s, username, password, name,
                role=role, session_token=token()), rerun=False)
            if ok:
                st.session_state.pop("show_user_form", None)
                st.session_state.flash = "User created."
                st.rerun()
    with st.expander("Enable or disable an account"):
        other_users = [u for u in users if u.id != user.id]
        if other_users:
            selected = st.selectbox("User", [u.id for u in other_users], format_func=lambda i: next(u.username for u in other_users if u.id == i))
            obj = next(u for u in other_users if u.id == selected)
            confirmed = st.checkbox("I confirm this account status change", key=f"user_active_{selected}_{obj.active}")
            if st.button("Disable account" if obj.active else "Enable account", disabled=not confirmed):
                perform(lambda s: set_user_active(s, token(), obj.id, not obj.active), "Account updated.")
        else:
            st.caption("There are no other accounts.")
    with st.expander("Roles and event assignments"):
        target_id = st.selectbox("Account to configure", user_ids,
            format_func=lambda i: next(u.username for u in users if u.id == i))
        selected_role = st.selectbox("Account role", list(ROLE_LABELS),
            index=list(ROLE_LABELS).index(roles[target_id]), format_func=ROLE_LABELS.get)
        confirm_role = st.checkbox("I confirm this role change", key=f"role_confirm_{target_id}_{selected_role}")
        if st.button("Save role", disabled=not confirm_role):
            perform(lambda s: set_role(s, token(), target_id, selected_role), "Role updated.")
        if owned_events:
            event_id = st.selectbox("Assigned event", event_ids,
                format_func=lambda i: next(e.name for e in owned_events if e.id == i))
            with SessionLocal() as s:
                assigned = s.get(EventAssignment, (target_id, event_id)) is not None
            st.caption("Super Admin can access all events in this organization. Other roles require an assignment.")
            confirm_assignment = st.checkbox("I confirm this event assignment change", key=f"assignment_{target_id}_{event_id}_{assigned}")
            if st.button("Remove event assignment" if assigned else "Assign event", disabled=not confirm_assignment):
                perform(lambda s: set_event_assignment(s, token(), target_id, event_id, not assigned), "Event assignment updated.")
    st.subheader("Wallet")
    st.caption(wallet_status())
    with st.expander("Recent audit history"):
        st.caption("Last 200 actions, newest first. Check-in and audit history cannot be edited or deleted through the application.")
        rows = [{"UTC time": h.created_at, "User ID": h.actor_id, "Event ID": h.event_id, "Action": h.action, "Details": h.details} for h in history]
        table(rows)
        import pandas as pd
        st.download_button("Export recent audit CSV", csv_bytes(pd.DataFrame(rows)), "recent_audit.csv", "text/csv")


def gmail_options():
    st.subheader("Ticket email delivery · Gmail")
    config = gmail_settings()
    st.caption("Use a Google app password with 2-Step Verification enabled. Your normal Gmail password will not work. Credentials are saved privately in the server's .env file.")
    st.markdown("[Create a Google app password](https://myaccount.google.com/apppasswords) · [Google setup help](https://support.google.com/accounts/answer/185833)")
    if config.ready:
        st.success("Gmail delivery is configured. Tickets go to the email address entered in each attendee's details.")
    with st.form("gmail_settings"):
        enabled = st.checkbox("Enable Gmail ticket delivery", value=config.enabled if config.username else True)
        username = st.text_input("Gmail address", value=config.username, max_chars=254)
        name = st.text_input("Sender name", value=config.sender_name, max_chars=160)
        password = st.text_input("Google app password", type="password", max_chars=32,
                                 help="Enter the 16-character app password. Leave blank to keep a previously saved password for the same address.")
        save = st.form_submit_button("Save Gmail settings", type="primary")
    if save:
        try:
            save_gmail_settings(token(), username, password, name, enabled)
            st.session_state.flash = "Gmail settings saved. Use Test Gmail connection, then send tickets from Attendees & Tickets."
            st.rerun()
        except AppError as exc:
            st.error(str(exc))
        except OSError:
            st.error("Could not save Gmail settings. Check that the application can write its .env file.")
    if st.button("Test Gmail connection", disabled=not config.ready):
        try:
            with st.spinner("Connecting to Gmail…"):
                message = test_gmail_connection(token())
            st.success(message)
        except AppError as exc:
            st.error(str(exc))
