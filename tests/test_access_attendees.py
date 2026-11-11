from io import BytesIO
import pandas as pd
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.backend.authentication import AppError
from app.backend.database import transaction
from app.backend.models import Attendee, Category, EntrancePermission
from app.backend.services.access import save_category, save_entrance
from app.backend.services.attendees import save_attendee
from app.backend.services.events import save_event
from app.backend.services.imports import import_rows, map_rows, read_upload, validate_rows
from tests.test_events import event_data


@pytest.fixture
def configured(factory, admin):
    with transaction(factory) as s:
        event = save_event(s, admin, event_data())
        category = save_category(s, admin, event.id, {"name": "Student", "code": "STU", "allocation": 100})
        gate = save_entrance(s, admin, event.id, {"name": "Main", "code": "MAIN"}, [category.id])
        wrong = save_entrance(s, admin, event.id, {"name": "VIP", "code": "VIP"}, [])
        person = save_attendee(s, admin, event.id, category.id, {"full_name": "Example Student", "email": "student@example.com"})
        return event.id, category.id, gate.id, wrong.id, person.id


def test_config_and_registration(factory, admin, configured):
    event, category, gate, _, person = configured
    with transaction(factory) as s:
        assert s.get(EntrancePermission, (gate, category))
        assert s.get(Attendee, person).category_id == category
        with pytest.raises(AppError, match="already registered"):
            save_attendee(s, admin, event, category, {"full_name": "Duplicate", "email": "STUDENT@example.com"})


def test_cross_event_foreign_keys(factory, admin, configured):
    event, category, gate, _, _ = configured
    with transaction(factory) as s:
        other = save_event(s, admin, event_data())
        other_id = other.id
        with pytest.raises(AppError, match="does not belong"):
            save_attendee(s, admin, other.id, category, {"full_name": "Wrong", "email": "wrong@example.com"})
    with pytest.raises(IntegrityError):
        with transaction(factory) as s:
            s.add(Attendee(event_id=other_id, category_id=category, full_name="Bypass", email="bypass@example.com"))
            s.flush()


def test_excel_mapping_preview_and_atomic_import(factory, admin, configured):
    event, _, _, _, _ = configured
    frame = pd.DataFrame([{"Student": "Second Student", "Email Address": "second@example.com", "Type": "STU"}])
    output = BytesIO()
    frame.to_excel(output, index=False)
    parsed = read_upload(output.getvalue(), "attendees.xlsx")
    rows = map_rows(parsed, {"full_name": "Student", "email": "Email Address", "category_code": "Type"})
    with transaction(factory) as s:
        clean, errors = validate_rows(s, admin, event, rows)
        assert len(clean) == 1 and not errors
        assert import_rows(s, admin, event, rows) == 1
    with transaction(factory) as s:
        _, errors = validate_rows(s, admin, event, rows)
        assert "already registered" in errors[0]["Error"]
    invalid = [{"full_name": "Valid", "email": "valid@example.com", "category_code": "STU"},
               {"full_name": "Invalid", "email": "bad", "category_code": "STU"}]
    with pytest.raises(AppError, match="Import blocked"):
        with transaction(factory) as s:
            import_rows(s, admin, event, invalid)
    with factory() as s:
        assert s.scalar(select(Attendee).where(Attendee.email == "valid@example.com")) is None


def test_in_file_duplicates_and_csv(factory, admin, configured):
    event = configured[0]
    content = b"full_name,email,category_code\nOne,one@example.com,STU\nTwo,one@example.com,STU\n"
    rows = read_upload(content, "list.csv").to_dict("records")
    with transaction(factory) as s:
        _, errors = validate_rows(s, admin, event, rows)
        assert errors and "within this file" in errors[0]["Error"]
    with pytest.raises(AppError):
        read_upload(b"not excel", "file.xlsx")
