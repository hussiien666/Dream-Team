from datetime import date, time
import pytest
from sqlalchemy import select
from app.backend.database import transaction
from app.backend.authentication import AppError
from app.backend.models import Event
from app.backend.services.events import save_event, archive_event, delete_event


def event_data(**kw):
    return dict(name="Graduation", venue="Main Hall", event_date=date(2030, 6, 1),
                start_time=time(9), end_time=time(17), capacity=100, status="Published", **kw)


def test_event_create_edit_archive_delete(factory, admin):
    with transaction(factory) as s:
        e = save_event(s, admin, event_data())
        event_id = e.id
        assert e.starts_at.hour == 6  # Cairo daylight-saving time
    with transaction(factory) as s:
        save_event(s, admin, {**event_data(), "name": "Updated"}, event_id)
        archive_event(s, admin, event_id)
    with transaction(factory) as s:
        assert s.get(Event, event_id).archived
        delete_event(s, admin, event_id)
    with factory() as s:
        assert s.scalar(select(Event)) is None


def test_event_validation(factory, admin):
    with transaction(factory) as s:
        for bad in ({"end_time": time(8)}, {"capacity": 0}, {"timezone": "Invalid/Zone"}, {"name": ""}):
            with pytest.raises(AppError):
                save_event(s, admin, {**event_data(), **bad})
