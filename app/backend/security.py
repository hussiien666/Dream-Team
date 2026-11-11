"""Second-factor enrollment/verification, recovery and server-side session policy."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
from datetime import timedelta
from urllib.parse import quote
from sqlalchemy import delete, select
from app.backend.authentication import AppError, audit, digest, _primary_user, validate_password, hasher
from app.backend.crypto import seal, unseal
from app.backend.models import AuthSession, OrganizationUser, User, utcnow
from app.backend.upgrade_models import (ActionToken, BackgroundJob, RecoveryCode,
    SecurityProfile, SecuritySession)


class SecondFactorRequired(AppError):
    pass


class PasswordChangeRequired(AppError):
    pass


def profile(session, user_id):
    result = session.get(SecurityProfile, user_id)
    if not result:
        result = SecurityProfile(user_id=user_id)
        session.add(result)
        session.flush()
    return result


def session_security(session, token):
    key = digest(token or "")
    state = session.get(SecuritySession, key)
    if not state:
        auth = session.get(AuthSession, key)
        if not auth:
            raise AppError("Your session has expired. Please sign in again.")
        state = SecuritySession(token_hash=key, last_seen=auth.created_at)
        session.add(state)
        session.flush()
    return state


def enforce_session(session, token, user):
    state = session_security(session, token)
    idle_minutes = max(5, min(240, int(os.getenv("ADMIN_IDLE_MINUTES", "30"))))
    if state.last_seen + timedelta(minutes=idle_minutes) <= utcnow():
        raise AppError("Your session expired after inactivity. Please sign in again.")
    member = session.get(OrganizationUser, user.id)
    if profile(session, user.id).force_password:
        raise PasswordChangeRequired("Change your temporary password before continuing.")
    if member and member.role == "super_admin" and not state.verified:
        if session.get(AuthSession, digest(token)).created_at + timedelta(minutes=10) <= utcnow():
            raise AppError("Verification expired. Please sign in again.")
        raise SecondFactorRequired("Super Admin verification is required.")
    state.last_seen = utcnow()


def totp(secret, counter=None):
    counter = int(time.time() // 30) if counter is None else counter
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    value = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = value[-1] & 15
    return str((struct.unpack(">I", value[offset:offset+4])[0] & 0x7fffffff) % 1000000).zfill(6)


def _factor_user(session, token):
    user = _primary_user(session, token)
    state = session_security(session, token)
    if not state.verified and session.get(AuthSession, digest(token)).created_at + timedelta(minutes=10) <= utcnow():
        raise AppError("Verification expired. Please sign in again.")
    return user


def _counter(secret, code, after=-1):
    current = int(time.time() // 30)
    return next((c for c in range(current-1, current+2) if c > after and hmac.compare_digest(totp(secret, c), str(code).strip())), None)


def begin_totp(session, token):
    user = _factor_user(session, token)
    item = profile(session, user.id)
    if item.factor_method:
        raise AppError("A verification method is already enrolled. Use security settings to change it.")
    state = session_security(session, token)
    if not state.enrollment_secret:
        state.enrollment_secret = seal(base64.b32encode(secrets.token_bytes(20)).decode().rstrip("="))
    secret = unseal(state.enrollment_secret)
    return secret, f"otpauth://totp/AAST:{quote(user.username)}?secret={secret}&issuer=AAST&algorithm=SHA1&digits=6&period=30"


def regenerate_recovery(session, token):
    from app.backend.authentication import require_user
    user = require_user(session, token)
    session.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = [secrets.token_hex(8).upper() for _ in range(10)]
    for code in codes:
        session.add(RecoveryCode(user_id=user.id, token_hash=digest(code)))
    audit(session, user, "security.recovery_regenerated")
    return codes


def finish_totp(session, token, code):
    user = _factor_user(session, token)
    state = session_security(session, token)
    item = profile(session, user.id)
    if item.factor_method or not state.enrollment_secret:
        raise AppError("Start authenticator enrollment first.")
    counter = _counter(unseal(state.enrollment_secret), code)
    if not _factor_attempt(session, user, state, counter is not None):
        return None
    item.totp_secret, item.factor_method, item.totp_counter = state.enrollment_secret, "totp", counter
    state.enrollment_secret, state.verified = "", True
    audit(session, user, "security.totp_enrolled")
    return regenerate_recovery(session, token)


def _factor_attempt(session, user, state, valid):
    if state.attempts >= 5 or (user.locked_until and user.locked_until > utcnow()):
        return False
    if not valid:
        state.attempts += 1
        if state.attempts >= 5:
            user.locked_until = utcnow() + timedelta(minutes=15)
        audit(session, user, "security.factor_failed")
        return False
    state.attempts = 0
    return True


def verify_factor(session, token, code):
    user = _factor_user(session, token)
    state, item = session_security(session, token), profile(session, user.id)
    recovery = session.get(RecoveryCode, digest(str(code).strip().upper()))
    counter = None
    valid = bool(recovery and recovery.user_id == user.id)
    if not valid and item.factor_method == "totp":
        counter = _counter(unseal(item.totp_secret), code, item.totp_counter)
        valid = counter is not None
    if not valid and item.factor_method == "email":
        action = session.get(ActionToken, digest("factor:" + digest(token) + ":" + str(code).strip()))
        valid = bool(action and action.user_id == user.id and action.expires_at > utcnow())
        if valid:
            session.delete(action)
    if not _factor_attempt(session, user, state, valid):
        return False
    if recovery and recovery.user_id == user.id:
        session.delete(recovery)
        audit(session, user, "security.recovery_used")
    elif counter is not None:
        item.totp_counter = counter
    state.verified, state.last_seen = True, utcnow()
    audit(session, user, "security.factor_verified")
    return True


def queue_security_email(session, user, recipient, subject, body, dedupe=None):
    member = session.get(OrganizationUser, user.id)
    session.add(BackgroundJob(organization_id=member.organization_id, kind="mail",
        payload=seal(json.dumps({"to": recipient, "subject": subject, "body": body})),
        dedupe_key=dedupe or "security:" + secrets.token_hex(16)))


def request_email_verification(session, token, email):
    from app.backend.services.email_delivery import _email
    user = _primary_user(session, token)
    email = _email(email)
    if session.scalar(select(SecurityProfile).where(SecurityProfile.email == email, SecurityProfile.user_id != user.id)):
        raise AppError("This address cannot be used for this account.")
    existing = session.scalar(select(ActionToken).where(ActionToken.user_id == user.id, ActionToken.purpose == "email_verify"))
    if existing and existing.expires_at > utcnow() + timedelta(minutes=9):
        raise AppError("Wait one minute before requesting another verification email.")
    session.execute(delete(ActionToken).where(ActionToken.user_id == user.id, ActionToken.purpose == "email_verify"))
    code = str(secrets.randbelow(1000000)).zfill(6)
    session.add(ActionToken(user_id=user.id, token_hash=digest("email:" + str(user.id) + ":" + code),
        purpose="email_verify", payload=email, expires_at=utcnow()+timedelta(minutes=10)))
    queue_security_email(session, user, email, "Verify your AAST account email", "Your verification code: " + code + "\nExpires in 10 minutes.")
    audit(session, user, "security.email_verification_requested")


def confirm_email(session, token, code, use_as_factor=False):
    user = _primary_user(session, token)
    state = session_security(session, token)
    action = session.get(ActionToken, digest("email:" + str(user.id) + ":" + str(code).strip()))
    valid = bool(action and action.user_id == user.id and action.purpose == "email_verify" and action.expires_at > utcnow())
    if not _factor_attempt(session, user, state, valid):
        return None
    item = profile(session, user.id)
    # Changing an enrolled factor requires an already verified session.
    if item.factor_method and not state.verified:
        raise AppError("Verify your existing factor before changing security settings.")
    item.email, item.email_verified = action.payload, True
    session.delete(action)
    if use_as_factor:
        item.factor_method, item.totp_secret, state.verified = "email", "", True
    audit(session, user, "security.email_verified")
    return regenerate_recovery(session, token) if use_as_factor else []


def send_factor_email(session, token):
    user = _factor_user(session, token)
    item = profile(session, user.id)
    if item.factor_method != "email" or not item.email_verified:
        raise AppError("Email verification is not configured.")
    prefix = "factor:" + digest(token)
    previous = session.scalar(select(ActionToken).where(ActionToken.user_id == user.id, ActionToken.purpose == prefix))
    if previous and previous.expires_at > utcnow() + timedelta(minutes=9):
        raise AppError("Wait one minute before requesting another code.")
    session.execute(delete(ActionToken).where(ActionToken.user_id == user.id, ActionToken.purpose == prefix))
    code = str(secrets.randbelow(1000000)).zfill(6)
    session.add(ActionToken(user_id=user.id, token_hash=digest(prefix+":"+code), purpose=prefix,
        expires_at=utcnow()+timedelta(minutes=10)))
    queue_security_email(session, user, item.email, "AAST sign-in code", "Your sign-in code: " + code + "\nExpires in 10 minutes.")


def request_password_reset(session, identifier):
    """Same public response whether the account exists, is disabled or has no email."""
    item = session.scalar(select(SecurityProfile).join(User, User.id == SecurityProfile.user_id).where(
        (SecurityProfile.email == identifier.strip().lower()) | (User.username == identifier.strip().lower()),
        SecurityProfile.email_verified.is_(True), User.active.is_(True)))
    if item:
        prior = session.scalar(select(ActionToken).where(ActionToken.user_id == item.user_id, ActionToken.purpose == "password_reset"))
        if not prior or prior.expires_at <= utcnow()+timedelta(minutes=19):
            session.execute(delete(ActionToken).where(ActionToken.user_id == item.user_id, ActionToken.purpose == "password_reset"))
            raw = secrets.token_urlsafe(32)
            session.add(ActionToken(user_id=item.user_id, token_hash=digest(raw), purpose="password_reset", expires_at=utcnow()+timedelta(minutes=20)))
            origin = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
            queue_security_email(session, session.get(User, item.user_id), item.email,
                "Reset your AAST password", "Use this single-use link within 20 minutes:\n" + origin + "/reset#" + raw)
            audit(session, session.get(User, item.user_id), "security.reset_requested")
    return "If an eligible account exists, a password reset email will be sent."


def finish_password_reset(session, raw, password):
    action = session.scalar(select(ActionToken).where(ActionToken.token_hash == digest(raw), ActionToken.purpose == "password_reset").with_for_update())
    if not action or action.expires_at <= utcnow():
        raise AppError("This reset link is invalid or expired.")
    validate_password(password)
    user = session.get(User, action.user_id)
    user.password_hash, user.failed_attempts, user.locked_until = hasher.hash(password), 0, None
    profile(session, user.id).force_password = False
    session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    session.execute(delete(ActionToken).where(ActionToken.user_id == user.id, ActionToken.purpose == "password_reset"))
    # Scanner sessions deliberately survive resets (authoritative scanner rule).
    audit(session, user, "security.password_reset")


def temporary_password(session, token, user_id):
    from app.backend.permissions import membership, require_permission
    actor = require_permission(session, token, "users.manage")
    member = session.get(OrganizationUser, user_id)
    if not member or member.organization_id != membership(session, actor).organization_id:
        raise AppError("User not found in your organization.")
    if user_id == actor.id:
        raise AppError("Use your own password settings.")
    password = secrets.token_urlsafe(18)
    session.get(User, user_id).password_hash = hasher.hash(password)
    profile(session, user_id).force_password = True
    session.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    audit(session, actor, "security.temporary_password", details=f"User {user_id}; active scanner session retained")
    return password
