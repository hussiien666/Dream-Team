"""Event CRUD with safe deletion and capacity checks."""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy import delete, func, select
from PIL import Image, UnidentifiedImageError
from io import BytesIO
from app.backend.authentication import AppError, audit, require_user
from app.backend.permissions import membership, require_permission
from app.backend.models import OrganizationEvent
from app.backend.models import (Attendee, Category, CheckIn, Entrance, EntrancePermission,
                                Event, EventSetting, Ticket, utcnow)


def text(value, label, limit=200, required=False):
    value = str(value or "").strip()
    if (required and not value) or len(value) > limit:
        raise AppError(f"{label}: enter {'1 to ' if required else 'up to '}{limit} characters.")
    return value


def positive(value, label):
    if isinstance(value, bool):
        raise AppError(f"{label} must be a positive whole number.")
    try:
        number = int(value)
        if number != float(value) or number <= 0:
            raise ValueError
        return number
    except (ValueError, TypeError, OverflowError):
        raise AppError(f"{label} must be a positive whole number.") from None


def scoped(session, model, object_id, event_id):
    obj = session.get(model, object_id)
    if not obj or obj.event_id != event_id:
        raise AppError("The selected record does not belong to this event.")
    return obj


def event_lock(session, event_id):
    obj = session.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if not obj:
        raise AppError("Event not found. Select an existing event.")
    return obj


def active_event(session, event_id):
    event = event_lock(session, event_id)
    if event.archived or event.status in ("Cancelled", "Completed"):
        raise AppError("This event is archived, cancelled or completed. Reopen it before making changes.")
    return event


def normalized_image(content):
    if content is None:
        return None
    if len(content) > 5 * 1024 * 1024:
        raise AppError("Use a PNG or JPEG image smaller than 5 MB.")
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format not in ("PNG", "JPEG") or image.width * image.height > 16_000_000:
                raise AppError("Use a PNG or JPEG with no more than 16 million pixels.")
            image.load()
            image.thumbnail((1600, 900))
            output = BytesIO()
            image.convert("RGB").save(output, format="PNG")
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise AppError("The image could not be read. Upload a valid PNG or JPEG.") from None


def save_event(session, token, data, event_id=None):
    actor = require_permission(session, token, "events.manage" if event_id else "events.create", event_id)
    existing = event_lock(session, event_id) if event_id else None
    values = {}
    limits = {"name": 200, "subtitle": 200, "description": 10000, "organization": 200,
              "event_type": 100, "country": 100, "city": 100, "venue": 200,
              "building": 200, "address": 500, "instructions": 3000}
    for field, limit in limits.items():
        default = getattr(existing, field) if existing else ("AAST" if field == "organization" else "")
        values[field] = text(data.get(field, default), field.replace("_", " ").title(), limit, field in ("name", "venue"))
    tz = data.get("timezone", existing.timezone if existing else "Africa/Cairo")
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise AppError("Enter a valid IANA timezone, such as Africa/Cairo.") from None
    values["timezone"] = tz
    day = data.get("event_date", existing.event_date if existing else None)
    if not isinstance(day, date) or isinstance(day, datetime):
        raise AppError("Select the event date.")
    values["event_date"] = day
    for key, fallback in (("start_time", time(9)), ("end_time", time(17))):
        clock = data.get(key, fallback)
        if not isinstance(clock, time):
            raise AppError("Enter valid start and end times.")
        local = datetime.combine(day, clock).replace(tzinfo=zone)
        if local.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != local.replace(tzinfo=None):
            raise AppError("This time does not exist due to daylight-saving changes. Choose another time.")
        values["starts_at" if key == "start_time" else "ends_at"] = local.astimezone(timezone.utc).replace(tzinfo=None)
    if values["ends_at"] <= values["starts_at"]:
        raise AppError("End time must be later than start time on the same date.")
    values["capacity"] = positive(data.get("capacity", existing.capacity if existing else 100), "Capacity")
    values["max_tickets"] = positive(data.get("max_tickets", values["capacity"]), "Maximum tickets")
    if values["max_tickets"] > values["capacity"]:
        raise AppError("Maximum tickets cannot exceed event capacity.")
    values["status"] = data.get("status", existing.status if existing else "Draft")
    if values["status"] not in ("Draft", "Published", "Ongoing", "Completed", "Cancelled"):
        raise AppError("Choose a valid event status.")
    for field in ("distribution_start", "distribution_end", "registration_deadline"):
        value = data.get(field, getattr(existing, field) if existing else None)
        if value is not None:
            if not isinstance(value, datetime):
                raise AppError("Enter valid distribution and registration dates.")
            value = value.replace(tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo is None else value.astimezone(timezone.utc).replace(tzinfo=None)
        values[field] = value
    if values["distribution_start"] and values["distribution_end"] and values["distribution_end"] < values["distribution_start"]:
        raise AppError("Ticket distribution must end after it starts.")
    if existing:
        committed = session.scalar(select(func.count()).select_from(Ticket).where(Ticket.event_id == event_id, Ticket.status.in_(["Active", "Used"])))
        if values["max_tickets"] < committed:
            raise AppError(f"There are {committed} active or used tickets. The new limit is too small.")
    for field in ("logo", "banner"):
        if field in data:
            values[field] = normalized_image(data[field])
    obj = existing or Event()
    for key, value in values.items():
        setattr(obj, key, value)
    session.add(obj)
    session.flush()
    if not existing:
        session.add(OrganizationEvent(event_id=obj.id, organization_id=membership(session, actor).organization_id))
        session.flush()
    audit(session, actor, "event.updated" if existing else "event.created", obj.id)
    return obj


def archive_event(session, token, event_id, archived=True):
    actor = require_permission(session, token, "events.manage" if archived else "events.restore", event_id)
    obj = event_lock(session, event_id)
    obj.archived = archived
    audit(session, actor, "event.archived" if archived else "event.restored", event_id)


def delete_event(session, token, event_id):
    actor = require_permission(session, token, "events.manage", event_id)
    obj = event_lock(session, event_id)
    if session.scalar(select(func.count()).select_from(Ticket).where(Ticket.event_id == event_id)):
        raise AppError("This event has ticket history and cannot be deleted. Archive it instead.")
    for model in (EntrancePermission, Attendee, Entrance, Category, EventSetting):
        session.execute(delete(model).where(model.event_id == event_id))
    session.delete(obj)
    audit(session, actor, "event.deleted", event_id)
