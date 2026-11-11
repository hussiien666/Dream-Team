"""Check-in is one transaction: lock event, validate, consume ticket, audit."""
from dataclasses import dataclass
from sqlalchemy import select, update
from app.backend.authentication import AppError, audit, digest, require_user
from app.backend.permissions import require_permission
from app.backend.models import Attendee, Category, CheckIn, Entrance, EntrancePermission, Ticket, utcnow
from app.backend.services.events import event_lock, scoped
from app.ticket_engine.qr_generator import PREFIX


@dataclass
class ScanResult:
    accepted: bool
    message: str
    attendee_name: str = ""
    ticket_number: str = ""


def check_in(session, token, event_id, entrance_id, qr_value=None, ticket_number=None):
    staff = require_permission(session, token, "checkin.perform", event_id)
    event = event_lock(session, event_id)
    entrance = scoped(session, Entrance, entrance_id, event_id)
    def reject(message, ticket=None):
        audit(session, staff, "checkin.rejected", event_id,
              f"Entrance {entrance_id}; {message}; ticket {ticket.number if ticket else 'unknown'}")
        return ScanResult(False, message, ticket_number=ticket.number if ticket else "")
    if not entrance.active:
        return reject("This entrance is inactive.")
    if event.archived or event.status not in ("Published", "Ongoing"):
        return reject("This event is not open for check-in.")
    if qr_value and ticket_number:
        return reject("Choose either a QR scan or a manual ticket number.")
    manual = bool(ticket_number)
    if manual:
        query = select(Ticket).where(Ticket.number == ticket_number.strip().upper())
    else:
        value = (qr_value or "").strip()
        if not value.startswith(PREFIX) or len(value) != len(PREFIX) + 43:
            return reject("Invalid QR code. Scan an AAST event ticket.")
        query = select(Ticket).where(Ticket.token_hash == digest(value[len(PREFIX):]))
    ticket = session.scalar(query.with_for_update())
    if not ticket:
        return reject("Ticket not found or the QR code has been replaced.")
    if ticket.event_id != event_id:
        return reject("This ticket belongs to a different event.", ticket)
    if ticket.status == "Used":
        return reject("Already used. Duplicate entry rejected.", ticket)
    if ticket.status == "Revoked":
        return reject("This ticket has been revoked.", ticket)
    now = utcnow()
    if ticket.status == "Expired" or ticket.expires_at <= now or event.ends_at <= now:
        if ticket.status == "Active":
            ticket.status = "Expired"
        return reject("This ticket has expired.", ticket)
    attendee = scoped(session, Attendee, ticket.attendee_id, event_id)
    category = scoped(session, Category, ticket.category_id, event_id)
    if attendee.status != "Registered" or not category.active:
        return reject("The registration or ticket category is inactive.", ticket)
    permission = session.get(EntrancePermission, (entrance_id, category.id))
    if not permission or permission.event_id != event_id:
        return reject("Wrong entrance. This ticket category is not allowed here.", ticket)
    changed = session.execute(update(Ticket).where(Ticket.id == ticket.id, Ticket.status == "Active")
                              .values(status="Used", updated_at=now)).rowcount
    if changed != 1:
        return reject("The ticket is no longer active. Entry rejected.", ticket)
    session.add(CheckIn(event_id=event_id, ticket_id=ticket.id, entrance_id=entrance_id, staff_id=staff.id, checked_at=now))
    session.flush()
    audit(session, staff, "checkin.accepted.manual" if manual else "checkin.accepted", event_id,
          f"Ticket {ticket.number}; entrance {entrance_id}")
    return ScanResult(True, "Entry approved.", attendee.full_name, ticket.number)
