import pytest
from sqlalchemy import select
from app.backend.database import transaction
from app.backend.authentication import AppError, create_user, login, logout, require_user
from app.backend.models import User


def test_bootstrap_password_and_session(factory, admin):
    with transaction(factory) as s:
        user = require_user(s, admin, "admin")
        assert user.password_hash.startswith("$argon2id$")
        assert "a-long-test-password" not in user.password_hash
        with pytest.raises(AppError, match="already exists"):
            create_user(s, "other", "another-long-password", "Other", bootstrap=True)
        logout(s, admin)
        s.flush()
        with pytest.raises(AppError, match="expired"):
            require_user(s, admin)


def test_staff_permissions(factory, admin):
    with transaction(factory) as s:
        create_user(s, "staff", "a-long-staff-password", "Gate staff", role="staff", session_token=admin)
    with transaction(factory) as s:
        token = login(s, "staff", "a-long-staff-password")
        assert require_user(s, token).role == "staff"
        with pytest.raises(AppError, match="Administrator"):
            create_user(s, "no", "a-long-staff-password", "No", session_token=token)


def test_failed_login_lockout(factory, admin):
    for _ in range(5):
        with transaction(factory) as s:
            assert login(s, "admin", "wrong") is None
    with transaction(factory) as s:
        assert login(s, "admin", "a-long-test-password") is None
        assert s.scalar(select(User)).locked_until is not None
