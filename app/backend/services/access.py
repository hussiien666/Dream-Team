"""Category allocations, entrances and deny-by-default gate permissions."""
import re
from decimal import Decimal, InvalidOperation
from sqlalchemy import delete, func, select
from app.backend.authentication import AppError, audit, require_user
from app.backend.permissions import require_permission
from app.backend.models import Attendee, Category, CheckIn, Entrance, EntrancePermission, Ticket
from app.backend.services.events import active_event, positive, scoped, text


def save_category(session, token, event_id, data, category_id=None):
    actor = require_permission(session, token, "access.manage", event_id)
    event = active_event(session, event_id)
    obj = scoped(session, Category, category_id, event_id) if category_id else Category(event_id=event_id)
    name = text(data.get("name"), "Category name", 120, True)
    code = text(data.get("code"), "Category code", 40, True).upper()
    duplicate = session.scalar(select(Category).where(Category.event_id == event_id,
        (Category.name == name) | (Category.code == code), Category.id != (category_id or 0)))
    if duplicate:
        raise AppError("A category with that name or code already exists in this event.")
    allocation = positive(data.get("allocation"), "Category allocation")
    issued = session.scalar(select(func.count()).select_from(Ticket).where(Ticket.category_id == category_id, Ticket.status.in_(["Active", "Used"]))) if category_id else 0
    if allocation < issued:
        raise AppError(f"The allocation cannot be lower than {issued} active or used tickets.")
    if allocation > event.max_tickets:
        raise AppError("Category allocation cannot exceed the event ticket limit.")
    color = data.get("color", "#142D4E")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise AppError("Choose a valid category color.")
    try:
        price = Decimal(str(data.get("price", 0)))
        if not price.is_finite() or price < 0 or price > 9999999999:
            raise InvalidOperation
    except (InvalidOperation, ValueError):
        raise AppError("Price must be a non-negative amount.") from None
    for key, value in dict(name=name, code=code, allocation=allocation, color=color,
            price=price, max_per_attendee=positive(data.get("max_per_attendee", 1), "Tickets per attendee"),
            description=text(data.get("description"), "Description", 3000), active=bool(data.get("active", True))).items():
        setattr(obj, key, value)
    session.add(obj)
    session.flush()
    audit(session, actor, "category.updated" if category_id else "category.created", event_id, f"Category {obj.id}")
    return obj


def save_entrance(session, token, event_id, data, category_ids, entrance_id=None):
    actor = require_permission(session, token, "access.manage", event_id)
    active_event(session, event_id)
    obj = scoped(session, Entrance, entrance_id, event_id) if entrance_id else Entrance(event_id=event_id)
    name = text(data.get("name"), "Entrance name", 120, True)
    code = text(data.get("code"), "Entrance code", 40, True).upper()
    if session.scalar(select(Entrance).where(Entrance.event_id == event_id,
            (Entrance.name == name) | (Entrance.code == code), Entrance.id != (entrance_id or 0))):
        raise AppError("An entrance with that name or code already exists in this event.")
    for category_id in set(category_ids):
        scoped(session, Category, category_id, event_id)
    obj.name, obj.code = name, code
    for field, limit in (("description", 3000), ("location", 200), ("instructions", 3000)):
        setattr(obj, field, text(data.get(field), field.title(), limit))
    obj.active = bool(data.get("active", True))
    session.add(obj)
    session.flush()
    session.execute(delete(EntrancePermission).where(EntrancePermission.entrance_id == obj.id))
    for category_id in set(category_ids):
        session.add(EntrancePermission(entrance_id=obj.id, category_id=category_id, event_id=event_id))
    audit(session, actor, "entrance.updated" if entrance_id else "entrance.created", event_id,
          f"Entrance {obj.id}; allowed categories {sorted(set(category_ids))}")
    return obj


def delete_access(session, token, event_id, object_id, kind):
    actor = require_permission(session, token, "access.manage", event_id)
    active_event(session, event_id)
    if kind == "category":
        obj = scoped(session, Category, object_id, event_id)
        if session.scalar(select(func.count()).select_from(Attendee).where(Attendee.category_id == object_id)):
            raise AppError("This category has attendees. Set it inactive instead.")
    elif kind == "entrance":
        obj = scoped(session, Entrance, object_id, event_id)
        if session.scalar(select(func.count()).select_from(CheckIn).where(CheckIn.entrance_id == object_id)):
            raise AppError("This entrance has check-in history. Set it inactive instead.")
    else:
        raise AppError("Choose a category or entrance.")
    session.delete(obj)
    audit(session, actor, f"{kind}.deleted", event_id, f"Record {object_id}")
