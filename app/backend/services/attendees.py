"""Attendee validation and registration. Import reuses these same checks."""
import re
from sqlalchemy import func, select
from email_validator import validate_email, EmailNotValidError
from app.backend.authentication import AppError, audit, require_user
from app.backend.permissions import require_permission
from app.backend.models import Attendee, Category, Ticket, utcnow
from app.backend.services.events import active_event, scoped, text


def validate_attendee(data):
    values = {"full_name": text(data.get("full_name"), "Full name", 200, True),
              "phone": text(data.get("phone"), "Phone", 40),
              "identity_number": text(data.get("identity_number"), "Student / National ID", 100) or None,
              "organization": text(data.get("organization"), "Organization", 200),
              "notes": text(data.get("notes"), "Notes", 3000)}
    email = text(data.get("email"), "Email", 254).lower()
    if email:
        try:
            email = validate_email(email, check_deliverability=False).normalized.lower()
        except EmailNotValidError:
            raise AppError("Enter a valid email address.") from None
    values["email"] = email or None
    if not email and not values["identity_number"]:
        raise AppError("Provide an email address or Student / National ID to identify duplicate registrations.")
    if values["phone"] and not re.fullmatch(r"[+\d\s().-]{5,40}", values["phone"]):
        raise AppError("Enter a valid phone number.")
    return values


def duplicate(session, event_id, values, exclude_id=0):
    conditions = []
    if values.get("email"):
        conditions.append(Attendee.email == values["email"])
    if values.get("identity_number"):
        conditions.append(Attendee.identity_number == values["identity_number"])
    from sqlalchemy import or_
    return session.scalar(select(Attendee).where(Attendee.event_id == event_id, Attendee.id != exclude_id, or_(*conditions))) if conditions else None


def save_attendee(session, token, event_id, category_id, data, attendee_id=None, log=True):
    actor = require_permission(session, token, "attendees.manage", event_id)
    event = active_event(session, event_id)
    if not attendee_id and event.registration_deadline and utcnow() > event.registration_deadline:
        raise AppError("The registration deadline has passed.")
    category = scoped(session, Category, category_id, event_id)
    if not category.active:
        raise AppError("Choose an active ticket category.")
    obj = scoped(session, Attendee, attendee_id, event_id) if attendee_id else Attendee(event_id=event_id)
    values = validate_attendee(data)
    if duplicate(session, event_id, values, attendee_id or 0):
        raise AppError("An attendee with this email address or ID is already registered for this event.")
    if attendee_id and obj.category_id != category_id:
        if session.scalar(select(func.count()).select_from(Ticket).where(Ticket.attendee_id == attendee_id)):
            raise AppError("An attendee with ticket history cannot change category. Cancel the registration and create a new one with a different identifier.")
    for field, value in values.items():
        setattr(obj, field, value)
    obj.category_id = category_id
    if not attendee_id:
        obj.status = "Registered"
    session.add(obj)
    session.flush()
    if log:
        audit(session, actor, "attendee.updated" if attendee_id else "attendee.created", event_id, f"Attendee {obj.id}")
    return obj


def cancel_attendee(session, token, event_id, attendee_id, delete_record=False):
    actor = require_permission(session, token, "attendees.manage", event_id)
    active_event(session, event_id)
    obj = scoped(session, Attendee, attendee_id, event_id)
    tickets = session.scalars(select(Ticket).where(Ticket.attendee_id == attendee_id)).all()
    if delete_record:
        if tickets:
            raise AppError("This attendee has ticket history. Cancel registration instead of deleting it.")
        session.delete(obj)
    else:
        obj.status = "Cancelled"
        for ticket in tickets:
            if ticket.status == "Active":
                ticket.status = "Revoked"
    audit(session, actor, "attendee.deleted" if delete_record else "attendee.cancelled", event_id, f"Attendee {attendee_id}")
