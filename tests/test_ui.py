"""Exercise real Streamlit forms and navigation against an isolated database."""
from datetime import date
import importlib
from pathlib import Path
from streamlit.testing.v1 import AppTest
from app.backend import database
from app.backend.models import Category, Event, Entrance
from sqlalchemy import select
from tests.test_access_attendees import configured


def widget(elements, label):
    return next(element for element in elements if element.label == label)


def assert_clean(at):
    assert not at.exception, [e.message for e in at.exception]
    assert not at.error, [e.value for e in at.error]


def test_admin_workflow_and_seven_sections(factory, admin, monkeypatch):
    # The service fixture uses metadata; the migration itself has a separate test.
    from app.backend import schema
    monkeypatch.setattr(schema, "schema_ready", lambda engine: True)
    monkeypatch.setattr(database, "SessionLocal", factory)
    monkeypatch.setattr(database, "engine", factory.kw["bind"])
    for name in ("auth", "events", "access", "attendees", "checkin", "reports", "overview", "settings"):
        module = importlib.import_module("app.dashboard." + name)
        monkeypatch.setattr(module, "SessionLocal", factory)
    app_path = Path(__file__).resolve().parents[1] / "app/dashboard/main.py"
    at = AppTest.from_file(str(app_path), default_timeout=30).run()
    widget(at.text_input, "Username").set_value("admin")
    widget(at.text_input, "Password").set_value("a-long-test-password")
    widget(at.button, "Sign in").click().run()
    from app.backend.database import transaction
    from app.backend.security import regenerate_recovery
    with transaction(factory) as s:
        recovery = regenerate_recovery(s, admin)[0]
    widget(at.text_input, "Verification or recovery code").set_value(recovery)
    widget(at.button, "Verify").click().run()
    assert_clean(at)
    assert len(at.sidebar.radio[0].options) == 7
    widget(at.button, "Create event").click().run()
    assert at.sidebar.radio[0].value == "Events"
    widget(at.text_input, "Event name *").set_value("UI Conference")
    widget(at.text_input, "Venue *").set_value("Main Hall")
    widget(at.date_input, "Event date *").set_value(date(2030, 6, 1))
    widget(at.number_input, "Capacity *").set_value(2)
    widget(at.selectbox, "Status").set_value("Published")
    widget(at.button, "Save").click().run()
    assert_clean(at)
    with factory() as s:
        event = s.scalar(select(Event))
        assert event.name == "UI Conference" and event.max_tickets == 2
    at.sidebar.radio[0].set_value("Entrances & Categories").run()
    widget(at.button, "Add category").click().run()
    widget(at.text_input, "Name *").set_value("Student")
    widget(at.text_input, "Code *").set_value("STU")
    widget(at.number_input, "Maximum allocation").set_value(2)
    widget(at.button, "Save").click().run()
    assert_clean(at)
    widget(at.button, "Add entrance").click().run()
    widget(at.text_input, "Name *").set_value("Main Entrance")
    widget(at.text_input, "Code *").set_value("MAIN")
    with factory() as s:
        category_id = s.scalar(select(Category.id))
    widget(at.multiselect, "Allowed ticket categories").set_value([category_id])
    widget(at.button, "Save").click().run()
    assert_clean(at)
    at.sidebar.radio[0].set_value("Attendees & Tickets").run()
    widget(at.button, "Add attendee").click().run()
    widget(at.text_input, "Full name *").set_value("UI Student")
    widget(at.text_input, "Email address").set_value("ui@example.com")
    widget(at.button, "Save").click().run()
    assert_clean(at)
    widget(at.radio, "Action").set_value("Import file").run()
    assert_clean(at)
    widget(at.radio, "Action").set_value("Generate tickets").run()
    with factory() as s:
        from app.backend.models import Attendee
        attendee_id = s.scalar(select(Attendee.id))
    widget(at.multiselect, "Attendees").set_value([attendee_id]).run()
    widget(at.button, "Generate tickets").click().run()
    assert_clean(at)
    assert any(h.value == "Download generated tickets" for h in at.subheader)
    at.sidebar.radio[0].set_value("QR Check-in").run()
    widget(at.radio, "Input").set_value("Manual ticket number").run()
    with factory() as s:
        from app.backend.models import Ticket
        number = s.scalar(select(Ticket.number))
    widget(at.text_input, "Ticket number").set_value(number)
    widget(at.checkbox, "I have verified the attendee's identity and want to admit them").check()
    widget(at.button, "Find ticket and check in").click().run()
    assert_clean(at)
    assert any("ENTRY APPROVED" in message.value for message in at.success)
    widget(at.button, "Find ticket and check in").click().run()
    assert any("Already used" in message.value for message in at.error)
    assert not at.success
    for section in ("Reports", "Settings", "Dashboard", "Events"):
        at.sidebar.radio[0].set_value(section).run()
        assert_clean(at)


def test_import_preview_confirmation_and_success(factory, admin, configured, monkeypatch):
    from io import BytesIO
    from types import SimpleNamespace
    import streamlit as st
    from openpyxl import load_workbook
    from app.dashboard import attendees
    from app.backend.models import Attendee
    from app.backend.services.imports import import_template
    monkeypatch.setattr(database, "SessionLocal", factory)
    monkeypatch.setattr(attendees, "SessionLocal", factory)
    workbook = load_workbook(BytesIO(import_template((("Student", "STU"),))))
    workbook["Attendees"].cell(2, 1, "Imported student")
    workbook["Attendees"].cell(2, 2, "imported@example.com")
    workbook["Attendees"].cell(2, 6, "Student")
    output = BytesIO()
    workbook.save(output)
    monkeypatch.setattr(st, "file_uploader", lambda *args, **kwargs: SimpleNamespace(name="attendees.xlsx", getvalue=lambda: output.getvalue()))
    at = AppTest.from_string("import streamlit as st\nfrom app.dashboard.attendees import imports\nimports(st.session_state.event_id,st.session_state.categories)", default_timeout=30)
    at.session_state.auth_token = admin
    at.session_state.event_id = configured[0]
    with factory() as s:
        at.session_state.categories = s.scalars(select(Category).where(Category.event_id == configured[0])).all()
    at.run()
    assert_clean(at)
    assert any("matched automatically" in value.value for value in at.success)
    widget(at.checkbox, "I have reviewed the information and confirm this import").check().run()
    widget(at.button, "Import attendees").click().run()
    assert_clean(at)
    assert any("imported successfully: 1" in value.value for value in at.success)
    with factory() as s:
        assert s.scalar(select(Attendee).where(Attendee.email == "imported@example.com")) is not None


def test_manager_navigation_and_reads_are_limited_to_assigned_event(factory, admin, configured, monkeypatch):
    from app.backend.authentication import create_user
    from app.backend.database import transaction
    from app.backend.permissions import set_event_assignment
    from app.backend.services.events import save_event
    from tests.test_events import event_data
    from app.backend import schema
    with transaction(factory) as s:
        hidden = save_event(s, admin, {**event_data(), "name": "Unassigned private event"})
        manager = create_user(s, "manager", "a-long-manager-password", "Event manager", "event_manager", session_token=admin)
        set_event_assignment(s, admin, manager.id, configured[0], True)
    monkeypatch.setattr(schema, "schema_ready", lambda engine: True)
    monkeypatch.setattr(database, "SessionLocal", factory)
    monkeypatch.setattr(database, "engine", factory.kw["bind"])
    for name in ("auth", "events", "access", "attendees", "checkin", "reports", "overview", "settings"):
        monkeypatch.setattr(importlib.import_module("app.dashboard." + name), "SessionLocal", factory)
    app_path = Path(__file__).resolve().parents[1] / "app/dashboard/main.py"
    at = AppTest.from_file(str(app_path), default_timeout=30).run()
    widget(at.text_input, "Username").set_value("manager")
    widget(at.text_input, "Password").set_value("a-long-manager-password")
    widget(at.button, "Sign in").click().run()
    assert_clean(at)
    assert "QR Check-in" not in at.sidebar.radio[0].options
    assert "Unassigned private event" not in repr(at.dataframe[0].value)
    assert not any(b.label == "Create event" for b in at.button)
    at.sidebar.radio[0].set_value("Events").run()
    assert_clean(at)
    assert not any(b.label == "Add event" for b in at.button)
    assert "Unassigned private event" not in repr(at.dataframe[0].value)
    at.sidebar.radio[0].set_value("Settings").run()
    assert_clean(at)
    assert not any(b.label == "Add user" for b in at.button)
    assert not any(h.value == "Users" for h in at.subheader)
