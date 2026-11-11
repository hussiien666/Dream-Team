"""Authorization tests call services directly, bypassing UI visibility."""
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.backend.authentication import AppError, create_user, login, set_user_active
from app.backend.database import transaction
from app.backend.models import (AuditLog, EventAssignment, Organization,
    OrganizationEvent, OrganizationUser)
from app.backend.permissions import (require_permission, set_event_assignment,
    set_role, visible_events)
from app.backend.services.events import save_event, archive_event
from app.backend.services.access import save_category
from app.backend.services.reports import attendee_table, event_report
from app.backend.services.tickets import issue_ticket
from tests.test_access_attendees import configured
from tests.test_events import event_data


def account(factory, admin, role, event_id=None):
    with transaction(factory) as s:
        user = create_user(s, role, "a-long-role-password", role, role, session_token=admin)
        if event_id:
            set_event_assignment(s, admin, user.id, event_id, True)
        user_id = user.id
    with transaction(factory) as s:
        return user_id, login(s, role, "a-long-role-password")


@pytest.mark.parametrize("role,allowed,denied", [
    ("event_manager", "events.manage", "users.manage"),
    ("ticket_manager", "tickets.manage", "events.manage"),
    ("checkin_supervisor", "reports.view", "attendees.manage"),
    ("scanner", "checkin.perform", "reports.view"),
])
def test_roles_require_assignment_and_recheck_each_operation(factory, admin, configured, role, allowed, denied):
    user_id, token = account(factory, admin, role)
    with transaction(factory) as s:
        assert not visible_events(s, token)
        with pytest.raises(AppError, match="not assigned"):
            require_permission(s, token, allowed, configured[0])
        set_event_assignment(s, admin, user_id, configured[0], True)
        s.flush()
        assert len(visible_events(s, token)) == 1
        require_permission(s, token, allowed, configured[0])
        with pytest.raises(AppError, match="Administrator"):
            require_permission(s, token, denied, configured[0])
        set_event_assignment(s, admin, user_id, configured[0], False)
        s.flush()
        with pytest.raises(AppError, match="not assigned"):
            require_permission(s, token, allowed, configured[0])


def test_assigned_managers_and_supervisor_service_boundaries(factory, admin, configured):
    _, manager = account(factory, admin, "event_manager", configured[0])
    _, tickets = account(factory, admin, "ticket_manager", configured[0])
    _, supervisor = account(factory, admin, "checkin_supervisor", configured[0])
    with transaction(factory) as s:
        save_event(s, manager, {**event_data(), "name": "Manager edit"}, configured[0])
        with pytest.raises(AppError):
            create_user(s, "unauthorized", "a-long-role-password", "No", session_token=manager)
        with pytest.raises(AppError):
            save_category(s, tickets, configured[0], {"name": "No", "code": "NO", "allocation": 1})
        assert len(attendee_table(s, tickets, configured[0])) == 1
        assert event_report(s, supervisor, configured[0])
        with pytest.raises(AppError):
            attendee_table(s, supervisor, configured[0])
        issue_ticket(s, tickets, configured[0], configured[4])
        archive_event(s, manager, configured[0])
        with pytest.raises(AppError):
            archive_event(s, manager, configured[0], False)
        archive_event(s, admin, configured[0], False)


def test_organization_boundary_even_for_super_admin_and_database_grants(factory, admin, configured):
    user_id, manager = account(factory, admin, "event_manager", configured[0])
    with transaction(factory) as s:
        foreign = save_event(s, admin, event_data())
        s.add(Organization(id=2, name="Other university"))
        s.flush()
        s.get(OrganizationEvent, foreign.id).organization_id = 2
        foreign_id = foreign.id
    with transaction(factory) as s:
        assert [e.id for e in visible_events(s, admin)] == [configured[0]]
        for token in (admin, manager):
            with pytest.raises(AppError, match="organization"):
                event_report(s, token, foreign_id)
            with pytest.raises(AppError, match="organization"):
                save_event(s, token, event_data(), foreign_id)
        with pytest.raises(AppError, match="organization"):
            set_event_assignment(s, admin, user_id, foreign_id, True)
    with pytest.raises(IntegrityError):
        with transaction(factory) as s:
            s.add(EventAssignment(user_id=user_id, event_id=foreign_id, organization_id=1))
            s.flush()


def test_role_changes_apply_to_existing_sessions_and_are_audited(factory, admin, configured):
    user_id, token = account(factory, admin, "event_manager", configured[0])
    with transaction(factory) as s:
        set_role(s, admin, user_id, "checkin_supervisor")
    with transaction(factory) as s:
        with pytest.raises(AppError):
            save_event(s, token, event_data(), configured[0])
        assert event_report(s, token, configured[0])
        assert s.scalar(select(AuditLog).where(AuditLog.action == "user.role_changed"))
        with pytest.raises(AppError, match="own Super Admin"):
            set_role(s, admin, 1, "event_manager")


def test_foreign_account_management_is_rejected(factory, admin, configured):
    user_id, _ = account(factory, admin, "event_manager")
    with transaction(factory) as s:
        s.add(Organization(id=2, name="Other"))
        s.flush()
        s.get(OrganizationUser, user_id).organization_id = 2
    with transaction(factory) as s:
        with pytest.raises(AppError, match="organization"):
            set_user_active(s, admin, user_id, False)
        with pytest.raises(AppError, match="organization"):
            set_role(s, admin, user_id, "super_admin")
