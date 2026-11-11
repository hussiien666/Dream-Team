from io import BytesIO
import smtplib
from unittest.mock import MagicMock
import pytest
from sqlalchemy import select
from app.backend.authentication import AppError, create_user, login
from app.backend.database import transaction
from app.backend.models import Attendee, EmailDelivery, Event
from app.backend.services.email_delivery import gmail_settings, save_gmail_settings, send_ticket_email
from app.backend.services.tickets import issue_ticket, regenerate_ticket, revoke_ticket
from tests.test_access_attendees import configured


@pytest.fixture
def mail_env(tmp_path, factory, admin):
    path = tmp_path / ".env"
    path.write_text("DATABASE_URL=sqlite:///unchanged.db\n", encoding="utf-8")
    save_gmail_settings(admin, "sender@gmail.com", "abcd efgh ijkl mnop", "AAST Events", factory=factory, env_path=path)
    return path


def test_private_gmail_settings(factory, admin, mail_env):
    settings = gmail_settings(mail_env)
    assert settings.ready and settings.password == "abcdefghijklmnop"
    assert "abcdefghijklmnop" not in repr(settings)
    assert "DATABASE_URL=sqlite:///unchanged.db" in mail_env.read_text()
    save_gmail_settings(admin, "sender@gmail.com", "", "AAST Events", factory=factory, env_path=mail_env)
    assert gmail_settings(mail_env).ready
    with pytest.raises(AppError, match="app password"):
        save_gmail_settings(admin, "sender@gmail.com", "normal-password", "AAST", factory=factory, env_path=mail_env)


def test_send_real_message_and_deduplicate(factory, admin, configured, mail_env):
    with transaction(factory) as s:
        delivery = issue_ticket(s, admin, configured[0], configured[4])
    smtp = MagicMock()
    smtp.return_value.send_message.return_value = {}
    result = send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env, smtp_factory=smtp)
    assert result["status"] == "Sent" and result["recipient"] == "student@example.com"
    smtp.assert_called_once_with("smtp.gmail.com", 587, timeout=20)
    smtp.return_value.starttls.assert_called_once()
    message = smtp.return_value.send_message.call_args.args[0]
    assert message["To"] == "student@example.com"
    attachment = list(message.iter_attachments())[0]
    assert attachment.get_content_type() == "application/pdf"
    assert attachment.get_payload(decode=True) == delivery["pdf"]
    assert delivery["number"] in message.get_body(preferencelist=("plain",)).get_content()
    result = send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env, smtp_factory=smtp)
    assert result["status"] == "Already sent"
    assert smtp.return_value.send_message.call_count == 1
    with factory() as s:
        assert s.scalar(select(EmailDelivery)).sent_at is not None


def test_failed_login_can_retry_and_never_reports_sent(factory, admin, configured, mail_env):
    with transaction(factory) as s:
        delivery = issue_ticket(s, admin, configured[0], configured[4])
    smtp = MagicMock()
    smtp.return_value.login.side_effect = smtplib.SMTPAuthenticationError(535, b"failed")
    result = send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env, smtp_factory=smtp)
    assert result["status"] == "Failed" and "app password" in result["error"]
    smtp.return_value.send_message.assert_not_called()
    smtp.return_value.login.side_effect = None
    smtp.return_value.send_message.return_value = {}
    assert send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env, smtp_factory=smtp)["status"] == "Sent"
    with factory() as s:
        assert s.scalar(select(EmailDelivery)).attempts == 2


def test_uncertain_send_requires_explicit_resend(factory, admin, configured, mail_env):
    with transaction(factory) as s:
        delivery = issue_ticket(s, admin, configured[0], configured[4])
    smtp = MagicMock()
    smtp.return_value.send_message.side_effect = smtplib.SMTPServerDisconnected("lost after DATA")
    assert send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env, smtp_factory=smtp)["status"] == "Unknown"
    with pytest.raises(AppError, match="uncertain"):
        send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env, smtp_factory=smtp)
    assert smtp.return_value.send_message.call_count == 1


def test_stale_or_revoked_pdf_cannot_be_emailed(factory, admin, configured, mail_env):
    with transaction(factory) as s:
        delivery = issue_ticket(s, admin, configured[0], configured[4])
        from app.backend.models import Ticket
        ticket_id = s.scalar(select(Ticket.id))
    with transaction(factory) as s:
        replacement = regenerate_ticket(s, admin, configured[0], ticket_id)
    with pytest.raises(AppError, match="no longer the current"):
        send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env)
    with transaction(factory) as s:
        revoke_ticket(s, admin, configured[0], ticket_id)
    with pytest.raises(AppError, match="active tickets"):
        send_ticket_email(admin, configured[0], replacement, factory=factory, env_path=mail_env)


def test_missing_email_and_staff_permission(factory, admin, configured, mail_env):
    with transaction(factory) as s:
        delivery = issue_ticket(s, admin, configured[0], configured[4])
        attendee = s.get(Attendee, configured[4])
        attendee.email, attendee.identity_number = None, "ID-1"
        create_user(s, "staff", "staff-test-password", "Gate", role="staff", session_token=admin)
    with transaction(factory) as s:
        staff = login(s, "staff", "staff-test-password")
    with pytest.raises(AppError, match="Administrator"):
        send_ticket_email(staff, configured[0], delivery, factory=factory, env_path=mail_env)
    with pytest.raises(AppError, match="no email"):
        send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env)


def test_smtp_does_not_lock_out_checkin_or_allow_parallel_duplicate(factory, admin, configured, mail_env):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from app.ticket_engine.ticket_validator import check_in
    with transaction(factory) as s:
        delivery = issue_ticket(s, admin, configured[0], configured[4])
    sending, finish = threading.Event(), threading.Event()
    smtp = MagicMock()
    def held_send(message):
        sending.set()
        assert finish.wait(timeout=10)
        return {}
    smtp.return_value.send_message.side_effect = held_send
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(send_ticket_email, admin, configured[0], delivery,
            factory=factory, env_path=mail_env, smtp_factory=smtp)
        try:
            assert sending.wait(timeout=10)
            with pytest.raises(AppError, match="being sent"):
                send_ticket_email(admin, configured[0], delivery, factory=factory, env_path=mail_env, smtp_factory=smtp)
            with transaction(factory) as s:
                assert check_in(s, admin, configured[0], configured[2], ticket_number=delivery["number"]).accepted
        finally:
            finish.set()
        assert pending.result(timeout=10)["status"] == "Sent"
    assert smtp.return_value.send_message.call_count == 1
