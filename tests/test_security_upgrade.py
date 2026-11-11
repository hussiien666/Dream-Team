from datetime import timedelta
import json
import pytest
from sqlalchemy import select
from app.backend.authentication import AppError, create_user, login, require_user
from app.backend.database import transaction
from app.backend.crypto import unseal
from app.backend.models import AuthSession, AuditLog, utcnow
from app.backend.security import (SecondFactorRequired, begin_totp, finish_totp,
    totp, verify_factor, regenerate_recovery, request_password_reset,
    finish_password_reset, profile, temporary_password)
from app.backend.upgrade_models import BackgroundJob, RecoveryCode, SecuritySession


def test_super_requires_enrollment_and_factor_then_recovery_once(factory):
    with transaction(factory) as s:
        create_user(s, "first", "a-long-test-password", "Super", bootstrap=True)
        token = login(s, "first", "a-long-test-password")
        with pytest.raises(SecondFactorRequired):
            require_user(s, token)
        secret, uri = begin_totp(s, token)
        assert "otpauth://" in uri
        codes = finish_totp(s, token, totp(secret))
        assert len(codes) == 10
        assert require_user(s, token)
        assert secret not in profile(s, 1).totp_secret
    with transaction(factory) as s:
        next_token = login(s, "first", "a-long-test-password")
        assert not verify_factor(s, next_token, totp(secret))  # replay rejected
        assert verify_factor(s, next_token, codes[0])
    with transaction(factory) as s:
        third_token = login(s, "first", "a-long-test-password")
        assert not verify_factor(s, third_token, codes[0])
        replacements = regenerate_recovery(s, token)
        assert not verify_factor(s, third_token, codes[1])
        assert verify_factor(s, third_token, replacements[0])
        assert s.scalar(select(AuditLog).where(AuditLog.action == "security.recovery_used"))


def test_idle_timeout_is_checked_on_server(factory, admin):
    with transaction(factory) as s:
        state = s.scalar(select(SecuritySession))
        state.last_seen = utcnow() - timedelta(hours=1)
    with transaction(factory) as s:
        with pytest.raises(AppError, match="inactivity"):
            require_user(s, admin)


def test_email_reset_single_use_generic_response_and_session_revocation(factory, admin):
    with transaction(factory) as s:
        item = profile(s, 1)
        item.email, item.email_verified = "admin@example.com", True
        response = request_password_reset(s, "admin@example.com")
        assert request_password_reset(s, "unknown@example.com") == response
        job = s.scalar(select(BackgroundJob))
        message = json.loads(unseal(job.payload))
        raw = message["body"].split("#")[-1]
        assert raw not in job.payload
    with transaction(factory) as s:
        finish_password_reset(s, raw, "a-new-secure-password")
    with transaction(factory) as s:
        with pytest.raises(AppError, match="invalid or expired"):
            finish_password_reset(s, raw, "another-secure-password")
        with pytest.raises(AppError, match="expired"):
            require_user(s, admin)
        assert login(s, "admin", "a-new-secure-password")


def test_factor_lockout_commits_and_no_plaintext_recovery(factory):
    with transaction(factory) as s:
        create_user(s, "first", "a-long-test-password", "Super", bootstrap=True)
        token = login(s, "first", "a-long-test-password")
        begin_totp(s, token)
    for _ in range(5):
        with transaction(factory) as s:
            assert finish_totp(s, token, "invalid") is None
    with transaction(factory) as s:
        assert login(s, "first", "a-long-test-password") is None


def test_rfc6238_sha1_vectors():
    import base64
    secret = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
    assert totp(secret, 59 // 30) == "287082"
    assert totp(secret, 1111111109 // 30) == "081804"
