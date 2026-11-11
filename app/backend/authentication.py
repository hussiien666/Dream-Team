"""Password authentication, persistent revocable sessions and service-level roles."""
import hashlib
import secrets
from datetime import timedelta
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from sqlalchemy import func, select
from app.backend.config import SESSION_HOURS
from app.backend.models import AuditLog, AuthSession, User, utcnow

hasher = PasswordHasher()


class AppError(ValueError):
    """A message safe to show to an administrator."""


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def audit(session, actor, action, event_id=None, details=""):
    session.add(AuditLog(actor_id=actor.id if actor else None, action=action, event_id=event_id, details=details))


def _primary_user(session, session_token, role=None):
    auth = session.get(AuthSession, digest(session_token or ""))
    if not auth or auth.expires_at <= utcnow():
        raise AppError("Your session has expired. Please sign in again.")
    user = session.get(User, auth.user_id)
    if not user or not user.active:
        raise AppError("This account is disabled.")
    if role and user.role != role:
        raise AppError("Administrator permission is required for this action.")
    return user


def require_user(session, session_token, role=None):
    user = _primary_user(session, session_token, role)
    from app.backend.security import enforce_session
    enforce_session(session, session_token, user)
    return user


def create_user(session, username, password, display_name, role="admin", session_token=None, bootstrap=False):
    from app.backend.models import Organization, OrganizationUser
    from app.backend.permissions import ROLE_LABELS, membership, require_permission
    if bootstrap:
        # PostgreSQL lock serializes simultaneous bootstrap attempts.
        if session.bind.dialect.name == "postgresql":
            session.connection().exec_driver_sql("SELECT pg_advisory_xact_lock(70514321)")
        if session.scalar(select(func.count()).select_from(User)):
            raise AppError("An account already exists. Sign in to manage users.")
        actor = None
        role = "admin"
    else:
        actor = require_permission(session, session_token, "users.manage")
    username = username.strip().lower()
    if not username or len(username) > 80 or not all(c.isalnum() or c in "._-" for c in username):
        raise AppError("Use a username of up to 80 letters, numbers, dots, underscores or hyphens.")
    validate_password(password)
    operational_role = {"admin": "super_admin", "staff": "scanner"}.get(role, role)
    if operational_role not in ROLE_LABELS:
        raise AppError("Choose a supported administrator or scanner role.")
    if not display_name.strip() or len(display_name.strip()) > 160:
        raise AppError("Enter a display name of up to 160 characters.")
    if session.scalar(select(User).where(User.username == username)):
        raise AppError("That username is already in use.")
    user = User(username=username, display_name=display_name.strip(), password_hash=hasher.hash(password),
                role="staff" if operational_role == "scanner" else "admin")
    session.add(user)
    session.flush()
    if bootstrap:
        organization = session.get(Organization, 1)
        if not organization:
            organization = Organization(id=1, name="AAST")
            session.add(organization)
            session.flush()
        organization_id = organization.id
    else:
        organization_id = membership(session, actor).organization_id
    session.add(OrganizationUser(user_id=user.id, organization_id=organization_id, role=operational_role))
    session.flush()
    audit(session, actor or user, "user.created", details=f"User {user.id}; role {operational_role}")
    return user


def validate_password(password):
    if len(password) < 12 or len(password) > 256:
        raise AppError("Use a password between 12 and 256 characters.")


def login(session, username, password):
    """Returns None on failure so callers COMMIT the failed-attempt counter."""
    user = session.scalar(select(User).where(User.username == username.strip().lower()).with_for_update())
    now = utcnow()
    if not user:
        # Match the password work factor for unknown accounts.
        _dummy_verify(password)
        audit(session, None, "auth.failed")
        return None
    if not user.active or (user.locked_until and user.locked_until > now):
        return None
    try:
        valid = hasher.verify(user.password_hash, password)
    except (VerificationError, InvalidHashError):
        valid = False
    if not valid:
        user.failed_attempts += 1
        if user.failed_attempts >= 5:
            user.locked_until = now + timedelta(minutes=15)
            user.failed_attempts = 0
        audit(session, user, "auth.failed")
        return None
    user.failed_attempts = 0
    user.locked_until = None
    if hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hasher.hash(password)
    token = secrets.token_urlsafe(32)
    session.add(AuthSession(token_hash=digest(token), user_id=user.id, expires_at=now + timedelta(hours=SESSION_HOURS)))
    audit(session, user, "auth.login")
    return token


_DUMMY_PASSWORD = secrets.token_urlsafe(24)
_DUMMY_HASH = hasher.hash(_DUMMY_PASSWORD)


def _dummy_verify(password):
    try:
        hasher.verify(_DUMMY_HASH, password)
    except VerificationError:
        pass


def logout(session, token):
    auth = session.get(AuthSession, digest(token))
    if auth:
        audit(session, session.get(User, auth.user_id), "auth.logout")
        session.delete(auth)


def change_password(session, token, old_password, new_password):
    from app.backend.security import profile
    user = _primary_user(session, token)
    if not profile(session, user.id).force_password:
        user = require_user(session, token)
    try:
        hasher.verify(user.password_hash, old_password)
    except VerificationError:
        raise AppError("The current password is incorrect.") from None
    validate_password(new_password)
    user.password_hash = hasher.hash(new_password)
    profile(session, user.id).force_password = False
    from sqlalchemy import delete
    session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    audit(session, user, "user.password_changed")


def set_user_active(session, token, user_id, active):
    from app.backend.permissions import membership, require_permission
    from app.backend.models import OrganizationUser
    actor = require_permission(session, token, "users.manage")
    user = session.get(User, user_id)
    target = session.get(OrganizationUser, user_id)
    if not user or not target or target.organization_id != membership(session, actor).organization_id:
        raise AppError("User not found in your organization.")
    if user.id == actor.id and not active:
        raise AppError("You cannot disable your own account.")
    user.active = active
    if not active:
        from sqlalchemy import delete
        session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    audit(session, actor, "user.enabled" if active else "user.disabled", details=f"User {user.id}")
