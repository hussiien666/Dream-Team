"""Transactional issuance and rotation. Raw tokens exist only in delivery bytes."""
import secrets
import zipfile
from io import BytesIO
from sqlalchemy import func, select
from app.backend.authentication import AppError, audit, require_user
from app.backend.permissions import require_permission
from app.backend.models import Attendee, Category, Entrance, EntrancePermission, Ticket, utcnow
from app.backend.services.events import active_event, scoped
from app.ticket_engine.qr_generator import new_token
from app.ticket_engine.pdf_generator import mobile_ticket, pdf_ticket


def live_count(session, **filters):
    query = select(func.count()).select_from(Ticket).where(Ticket.status.in_(["Active", "Used"]))
    for field, value in filters.items():
        query = query.where(getattr(Ticket, field) == value)
    return session.scalar(query)


def _issuable(session, event_id, attendee_id):
    event = active_event(session, event_id)
    now = utcnow()
    if event.status not in ("Published", "Ongoing"):
        raise AppError("Publish the event before issuing tickets.")
    if event.ends_at <= now:
        raise AppError("This event has ended. Tickets cannot be issued.")
    if event.distribution_start and now < event.distribution_start:
        raise AppError("Ticket distribution has not started.")
    if event.distribution_end and now > event.distribution_end:
        raise AppError("Ticket distribution has ended.")
    attendee = scoped(session, Attendee, attendee_id, event_id)
    if attendee.status != "Registered":
        raise AppError("This attendee's registration is cancelled.")
    category = scoped(session, Category, attendee.category_id, event_id)
    if not category.active:
        raise AppError("This ticket category is inactive.")
    entrances = session.scalars(select(Entrance).join(EntrancePermission,
        EntrancePermission.entrance_id == Entrance.id).where(Entrance.event_id == event_id,
        Entrance.active.is_(True), EntrancePermission.category_id == category.id)).all()
    if not entrances:
        raise AppError(f"Configure an active entrance for category {category.name} before generating tickets.")
    return event, attendee, category, entrances


def _delivery(event, attendee, category, ticket, token, entrances):
    return {"number": ticket.number, "attendee_id": attendee.id, "token_hash": ticket.token_hash,
            "pdf": pdf_ticket(event, attendee, category, ticket, token, entrances),
            "html": mobile_ticket(event, attendee, category, ticket, token, entrances)}


def issue_ticket(session, session_token, event_id, attendee_id):
    actor = require_permission(session, session_token, "tickets.manage", event_id)
    event, attendee, category, entrances = _issuable(session, event_id, attendee_id)
    if live_count(session, event_id=event_id) >= min(event.capacity, event.max_tickets):
        raise AppError("The event ticket limit has been reached.")
    if live_count(session, event_id=event_id, category_id=category.id) >= category.allocation:
        raise AppError("This category's ticket allocation has been reached.")
    if live_count(session, attendee_id=attendee_id) >= category.max_per_attendee:
        raise AppError("This attendee already has the maximum allowed tickets. Regenerate an unused ticket if a replacement is needed.")
    raw, hashed = new_token()
    ticket = Ticket(number="AAST-" + secrets.token_hex(8).upper(), event_id=event_id,
                    attendee_id=attendee_id, category_id=category.id, token_hash=hashed,
                    status="Active", expires_at=event.ends_at)
    session.add(ticket)
    session.flush()
    delivery = _delivery(event, attendee, category, ticket, raw, entrances)
    audit(session, actor, "ticket.issued", event_id, f"Ticket {ticket.number}")
    return delivery


def issue_many(session, token, event_id, attendee_ids):
    require_permission(session, token, "tickets.manage", event_id)
    ids = list(dict.fromkeys(attendee_ids))
    if not ids or len(ids) > 500:
        raise AppError("Select between 1 and 500 attendees per batch.")
    return [issue_ticket(session, token, event_id, attendee_id) for attendee_id in ids]


def regenerate_ticket(session, token, event_id, ticket_id):
    actor = require_permission(session, token, "tickets.manage", event_id)
    ticket = scoped(session, Ticket, ticket_id, event_id)
    event, attendee, category, entrances = _issuable(session, event_id, ticket.attendee_id)
    # Event lock above serializes issuance, regeneration and check-in.
    session.refresh(ticket)
    if ticket.status != "Active":
        raise AppError("Only active, unused tickets can be regenerated. Used tickets retain their check-in history.")
    raw, hashed = new_token()
    ticket.token_hash = hashed
    ticket.expires_at = event.ends_at
    delivery = _delivery(event, attendee, category, ticket, raw, entrances)
    audit(session, actor, "ticket.regenerated", event_id, f"Ticket {ticket.number}; previous QR invalidated")
    return delivery


def revoke_ticket(session, token, event_id, ticket_id):
    actor = require_permission(session, token, "tickets.manage", event_id)
    active_event(session, event_id)
    ticket = scoped(session, Ticket, ticket_id, event_id)
    if ticket.status != "Active":
        raise AppError("Only active tickets can be revoked. Used tickets retain their check-in history.")
    ticket.status = "Revoked"
    audit(session, actor, "ticket.revoked", event_id, f"Ticket {ticket.number}")


def delivery_zip(deliveries):
    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in deliveries:
            archive.writestr(item["number"] + ".pdf", item["pdf"])
            archive.writestr(item["number"] + ".html", item["html"])
    return output.getvalue()
