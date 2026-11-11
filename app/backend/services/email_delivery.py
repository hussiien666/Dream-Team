"""Gmail SMTP delivery. No network call holds a database write transaction."""
from dataclasses import dataclass, field
from datetime import timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path
import os
import smtplib
import ssl
import tempfile
import threading
from dotenv import dotenv_values, set_key
from email_validator import validate_email, EmailNotValidError
from sqlalchemy import select
from app.backend.authentication import AppError, audit, require_user
from app.backend.permissions import require_permission
from app.backend.config import ROOT
from app.backend.database import SessionLocal, transaction
from app.backend.models import Attendee, EmailDelivery, Event, Ticket, User, utcnow
from app.ticket_engine.pdf_generator import event_time

_settings_lock = threading.Lock()


@dataclass
class GmailSettings:
    username: str = ""
    password: str = field(default="", repr=False)
    sender_name: str = "Dream Events"
    enabled: bool = False

    @property
    def ready(self):
        return self.enabled and bool(self.username and self.password)


def gmail_settings(env_path=None):
    values = dotenv_values(env_path or ROOT / ".env")
    get = lambda name, default="": values.get(name, os.getenv(name, default)) or default
    return GmailSettings(get("GMAIL_USERNAME"), get("GMAIL_APP_PASSWORD"),
                         get("GMAIL_SENDER_NAME", "Dream Events"), get("GMAIL_ENABLED", "false").lower() == "true")


def _email(value):
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.lower()
    except (EmailNotValidError, AttributeError):
        raise AppError("Enter a valid email address.") from None


def save_gmail_settings(token, username, password, sender_name, enabled=True, factory=None, env_path=None):
    factory = factory or SessionLocal
    target = Path(env_path or ROOT / ".env")
    with _settings_lock:
        current = gmail_settings(target)
        username = _email(username) if username.strip() else ""
        sender_name = sender_name.strip() or "Dream Events"
        if len(sender_name) > 160 or any(c in sender_name for c in "\r\n"):
            raise AppError("Enter a sender name up to 160 characters, on one line.")
        password = "".join(password.split()) if password else (current.password if username == current.username else "")
        if enabled and (not username or not password):
            raise AppError("Enter your Gmail address and Google app password to enable delivery.")
        if password and (len(password) != 16 or not password.isascii() or not password.isalnum()):
            raise AppError("Use the 16-character Google app password, not your normal Gmail password.")
        old = target.read_bytes() if target.exists() else None
        temporary = None
        replaced = False
        try:
            with transaction(factory) as session:
                actor = require_permission(session, token, "system.manage")
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".gmail-", suffix=".tmp", delete=False) as file:
                    temporary = Path(file.name)
                    file.write(old or b"")
                os.chmod(temporary, 0o600)
                for key, value in {"GMAIL_USERNAME": username, "GMAIL_APP_PASSWORD": password,
                                   "GMAIL_SENDER_NAME": sender_name, "GMAIL_ENABLED": str(bool(enabled)).lower()}.items():
                    set_key(temporary, key, value)
                temporary.replace(target)
                replaced = True
                audit(session, actor, "email.settings_changed", details="Gmail delivery enabled" if enabled else "Gmail delivery disabled")
        except Exception:
            if replaced:
                if old is None:
                    target.unlink(missing_ok=True)
                else:
                    target.write_bytes(old)
            raise
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)


def _connect(settings, smtp_factory=None):
    connection = (smtp_factory or smtplib.SMTP)("smtp.gmail.com", 587, timeout=20)
    try:
        connection.ehlo()
        connection.starttls(context=ssl.create_default_context())
        connection.ehlo()
        connection.login(settings.username, settings.password)
        return connection
    except Exception:
        _close(connection)
        raise


def _close(connection):
    try:
        connection.close()
    except (OSError, smtplib.SMTPException):
        pass


def _failure(exc, delivery_started=False):
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "Failed", "Gmail rejected sign-in. Check your Gmail address and Google app password in Settings."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "Failed", "Gmail rejected this attendee email address. Check the address in attendee details."
    if isinstance(exc, (smtplib.SMTPDataError, smtplib.SMTPSenderRefused)):
        return "Failed", "Gmail rejected the message. Check the account's sending restrictions or try again later."
    if delivery_started:
        return "Unknown", "Connection interrupted after sending started. Check Gmail Sent before sending another copy."
    return "Failed", "Could not connect securely to Gmail. Check your connection and Gmail settings."


def test_gmail_connection(token, factory=None, env_path=None, smtp_factory=None):
    with (factory or SessionLocal)() as session:
        require_permission(session, token, "system.manage")
    settings = gmail_settings(env_path)
    if not settings.ready:
        raise AppError("Save and enable your Gmail settings first.")
    try:
        connection = _connect(settings, smtp_factory)
        _close(connection)
    except (smtplib.SMTPException, OSError) as exc:
        raise AppError(_failure(exc)[1]) from None
    return "Connected to Gmail successfully. No email was sent."


def send_ticket_email(token, event_id, delivery, resend=False, factory=None, env_path=None, smtp_factory=None):
    factory = factory or SessionLocal
    settings = gmail_settings(env_path)
    if not settings.ready:
        raise AppError("Configure Gmail delivery in Settings before sending tickets.")
    with transaction(factory) as session:
        actor = require_permission(session, token, "tickets.manage", event_id)
        actor_id = actor.id
        ticket = session.scalar(select(Ticket).where(Ticket.number == delivery.get("number"), Ticket.event_id == event_id).with_for_update())
        if not ticket or ticket.attendee_id != delivery.get("attendee_id") or ticket.token_hash != delivery.get("token_hash"):
            raise AppError("This download is no longer the current ticket. Generate or regenerate it before emailing.")
        attendee = session.get(Attendee, ticket.attendee_id)
        event = session.get(Event, event_id)
        if ticket.status != "Active" or ticket.expires_at <= utcnow() or attendee.status != "Registered" or event.archived or event.status not in ("Published", "Ongoing") or event.ends_at <= utcnow():
            raise AppError("Only current, active tickets for a published or ongoing event can be emailed.")
        if not attendee.email:
            raise AppError(f"{attendee.full_name} has no email address. Edit the attendee first.")
        recipient = _email(attendee.email)
        record = session.scalar(select(EmailDelivery).where(EmailDelivery.ticket_id == ticket.id,
            EmailDelivery.token_hash == ticket.token_hash, EmailDelivery.recipient == recipient).with_for_update())
        if record:
            if record.status == "Sent" and not resend:
                return {"status": "Already sent", "recipient": recipient, "number": ticket.number}
            if record.status == "Unknown" and not resend:
                raise AppError("The previous send has an uncertain result. Check Gmail Sent, then explicitly choose Send another copy if needed.")
            if record.status == "Pending" and (not resend or record.updated_at > utcnow() - timedelta(minutes=2)):
                raise AppError("This ticket is being sent. Wait before trying again. For an interrupted attempt, wait two minutes and explicitly choose Send another copy.")
            record.attempts += 1
            record.status, record.last_error = "Pending", ""
            record.message_id = make_msgid(domain="aast-event-manager.local")
        else:
            record = EmailDelivery(event_id=event_id, ticket_id=ticket.id, token_hash=ticket.token_hash,
                recipient=recipient, status="Pending", message_id=make_msgid(domain="aast-event-manager.local"))
            session.add(record)
        session.flush()
        record_id = record.id
        message = EmailMessage()
        message["From"] = formataddr((settings.sender_name, settings.username))
        message["To"] = recipient
        message["Subject"] = "Your ticket: " + event.name.replace("\r", " ").replace("\n", " ")
        message["Message-ID"] = record.message_id
        message.set_content(f"Hello {attendee.full_name},\n\nYour ticket for {event.name} is attached.\n{event_time(event)}\nVenue: {event.venue}\nTicket: {ticket.number}\n\nOpen the PDF and show its QR code at the entrance. Keep it private; it allows one entry.\n\n{settings.sender_name}")
        pdf = delivery.get("pdf")
        if not isinstance(pdf, bytes) or not pdf.startswith(b"%PDF-") or len(pdf) > 10 * 1024 * 1024:
            raise AppError("The ticket PDF is missing or too large. Regenerate it before emailing.")
        message.add_attachment(pdf, maintype="application", subtype="pdf", filename=ticket.number + ".pdf")
        audit(session, actor, "ticket.email_started", event_id, f"Ticket {ticket.number}; delivery {record_id}")
    # SMTP is intentionally outside the transaction: scanning remains available.
    connection, started, error = None, False, ""
    try:
        connection = _connect(settings, smtp_factory)
        started = True
        refused = connection.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
        status = "Sent"
    except (smtplib.SMTPException, OSError) as exc:
        status, error = _failure(exc, started)
    finally:
        if connection:
            _close(connection)
    with transaction(factory) as session:
        record = session.get(EmailDelivery, record_id)
        record.status, record.last_error = status, error
        if status == "Sent":
            record.sent_at = utcnow()
        audit(session, session.get(User, actor_id), "ticket.email_" + status.lower(), event_id,
              f"Ticket {delivery['number']}; delivery {record_id}; {error}".strip())
    return {"status": status, "recipient": recipient, "number": delivery["number"], "error": error}
