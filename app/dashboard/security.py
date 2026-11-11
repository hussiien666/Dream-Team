"""Security enrollment is displayed before any protected admin navigation."""
from io import BytesIO
import qrcode
import streamlit as st
from app.backend.authentication import AppError, change_password, _primary_user
from app.backend.database import transaction
from app.backend.security import (begin_totp, finish_totp, profile, verify_factor,
    send_factor_email, request_email_verification, confirm_email, regenerate_recovery)


def show_recovery(codes):
    st.warning("Save these recovery codes privately. Each works once; they will not be displayed again.")
    st.code("\n".join(codes))


def gate(token, force_password=False):
    if force_password:
        st.header("Change temporary password")
        with st.form("forced_password"):
            old = st.text_input("Temporary password", type="password")
            new = st.text_input("New password (12+ characters)", type="password")
            confirm = st.text_input("Confirm new password", type="password")
            save = st.form_submit_button("Save password")
        if save:
            try:
                if new != confirm:
                    raise AppError("Passwords do not match.")
                with transaction() as session:
                    change_password(session, token, old, new)
                st.session_state.clear()
                st.rerun()
            except AppError as exc:
                st.error(str(exc))
        st.stop()
    st.header("Super Admin verification")
    if codes := st.session_state.pop("new_recovery_codes", None):
        show_recovery(codes)
        if st.button("I saved my recovery codes"):
            st.rerun()
        st.session_state.new_recovery_codes = codes
        st.stop()
    with transaction() as session:
        user = _primary_user(session, token)
        method = profile(session, user.id).factor_method
    try:
        if method:
            if method == "email" and st.button("Email a sign-in code"):
                with transaction() as session:
                    send_factor_email(session, token)
                st.info("Code queued for email. The background worker must be running.")
            with st.form("second_factor"):
                code = st.text_input("Verification or recovery code", max_chars=32)
                submitted = st.form_submit_button("Verify", type="primary")
            if submitted:
                with transaction() as session:
                    accepted = verify_factor(session, token, code)
                if accepted:
                    st.rerun()
                st.error("Verification failed. Check the code. After five failures, sign in again after 15 minutes.")
        else:
            st.write("Choose one verification method. Super Admin accounts require verification before administration.")
            # Email enrollment will be exposed once the durable mail worker is
            # implemented. Do not present a control that cannot deliver yet.
            method = "Authenticator app"
            if method == "Authenticator app":
                with transaction() as session:
                    secret, uri = begin_totp(session, token)
                output = BytesIO()
                qrcode.make(uri).save(output, format="PNG")
                st.image(output.getvalue(), width=220)
                st.code(secret)
                with st.form("totp_enrollment"):
                    code = st.text_input("Authenticator code", max_chars=6)
                    submitted = st.form_submit_button("Enable authenticator", type="primary")
                if submitted:
                    with transaction() as session:
                        codes = finish_totp(session, token, code)
                    if codes:
                        st.session_state.new_recovery_codes = codes
                        st.rerun()
                    st.error("Code not accepted. Check your device time and try again.")
            else:
                email_enrollment(token, True)
    except AppError as exc:
        st.error(str(exc))
    st.stop()


def email_enrollment(token, factor=False):
    with st.form("verify_account_email"):
        email = st.text_input("Account email address", max_chars=254)
        requested = st.form_submit_button("Send verification email")
    if requested:
        with transaction() as session:
            request_email_verification(session, token, email)
        st.info("Verification email queued. Start the background worker if it is not running.")
    with st.form("confirm_account_email"):
        code = st.text_input("Email verification code", max_chars=6)
        confirmed = st.form_submit_button("Verify account email")
    if confirmed:
        with transaction() as session:
            codes = confirm_email(session, token, code, use_as_factor=factor)
        if codes is None:
            st.error("Code not accepted or expired.")
        elif codes:
            st.session_state.new_recovery_codes = codes
            st.rerun()
        else:
            st.success("Account email verified.")


def settings(token):
    with st.expander("Recovery codes"):
        confirm = st.checkbox("Replace all existing recovery codes")
        if st.button("Generate new recovery codes", disabled=not confirm):
            with transaction() as session:
                codes = regenerate_recovery(session, token)
            show_recovery(codes)
