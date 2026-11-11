"""Backend permission and organization boundary shared by all administration UIs.

Legacy users.role stays admin/staff for file/database compatibility. It is not
an authority: explicit organization membership and role are required.
"""
from sqlalchemy import select
from app.backend.authentication import AppError, audit, require_user
from app.backend.models import (Event, EventAssignment, OrganizationEvent,
                                OrganizationUser, User)

ROLE_LABELS = {
    "super_admin": "Super Admin", "event_manager": "Event Manager",
    "ticket_manager": "Ticket Manager", "checkin_supervisor": "Check-in Supervisor",
    "scanner": "Check-in Staff",
}
ROLE_PERMISSIONS = {
    "super_admin": frozenset({"events.create", "events.view", "events.manage", "events.restore",
        "access.manage", "attendees.manage", "tickets.manage", "reports.view", "exports.create",
        "checkin.perform", "users.manage", "system.manage"}),
    "event_manager": frozenset({"events.view", "events.manage", "access.manage", "attendees.manage",
        "tickets.manage", "reports.view", "exports.create"}),
    "ticket_manager": frozenset({"events.view", "attendees.manage", "tickets.manage", "exports.create"}),
    "checkin_supervisor": frozenset({"events.view", "reports.view"}),
    # Legacy staff check-in is retained until the dedicated code-based portal
    # replaces it. It is restricted to explicitly assigned events already.
    "scanner": frozenset({"events.view", "checkin.perform"}),
}


def membership(session, user):
    member = session.get(OrganizationUser, user.id)
    if not member:
        raise AppError("This account has no organization access. Ask a Super Admin to review it.")
    return member


def require_permission(session, token, permission, event_id=None):
    user = require_user(session, token)
    member = membership(session, user)
    if permission not in ROLE_PERMISSIONS.get(member.role, ()):
        raise AppError("Administrator permission is required for this action, or your role does not allow it.")
    if event_id is not None:
        owner = session.get(OrganizationEvent, event_id)
        if not owner or owner.organization_id != member.organization_id:
            raise AppError("This event is outside your authorized organization.")
        if member.role != "super_admin" and not session.get(EventAssignment, (user.id, event_id)):
            raise AppError("You are not assigned to this event.")
    return user


def visible_events(session, token):
    user = require_permission(session, token, "events.view")
    member = membership(session, user)
    query = select(Event).join(OrganizationEvent, OrganizationEvent.event_id == Event.id).where(
        OrganizationEvent.organization_id == member.organization_id)
    if member.role != "super_admin":
        query = query.join(EventAssignment, EventAssignment.event_id == Event.id).where(
            EventAssignment.user_id == user.id)
    return session.scalars(query.order_by(Event.event_date.desc(), Event.id.desc())).all()


def set_role(session, token, user_id, role):
    actor = require_permission(session, token, "users.manage")
    own = membership(session, actor)
    target = session.get(OrganizationUser, user_id)
    if not target or target.organization_id != own.organization_id:
        raise AppError("User not found in your organization.")
    if role not in ROLE_LABELS:
        raise AppError("Choose a supported role.")
    if user_id == actor.id and role != "super_admin":
        raise AppError("You cannot remove your own Super Admin access.")
    before = target.role
    target.role = role
    session.get(User, user_id).role = "staff" if role == "scanner" else "admin"
    # Role checks are evaluated on every operation, including existing sessions.
    audit(session, actor, "user.role_changed", details=f"User {user_id}; {before} -> {role}")


def set_event_assignment(session, token, user_id, event_id, assigned):
    actor = require_permission(session, token, "users.manage", event_id)
    own = membership(session, actor)
    target = session.get(OrganizationUser, user_id)
    if not target or target.organization_id != own.organization_id:
        raise AppError("User not found in your organization.")
    record = session.get(EventAssignment, (user_id, event_id))
    if assigned and not record:
        session.add(EventAssignment(user_id=user_id, event_id=event_id, organization_id=own.organization_id))
    elif not assigned and record:
        session.delete(record)
    audit(session, actor, "user.event_assigned" if assigned else "user.event_unassigned", event_id, f"User {user_id}")
