import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import re
import zipfile
from io import BytesIO
import pytest
from sqlalchemy import func, select
from app.backend.authentication import AppError, create_user, login
from app.backend.database import transaction
from app.backend.models import CheckIn, Event, Ticket, utcnow
from app.backend.services.access import save_category, save_entrance
from app.backend.services.attendees import cancel_attendee, save_attendee
from app.backend.services.events import delete_event, save_event
from app.backend.services.reports import event_report, csv_bytes
from app.backend.services.tickets import delivery_zip, issue_many, issue_ticket, regenerate_ticket, revoke_ticket
from app.scanner.decoder import decode_qr
from app.ticket_engine.qr_generator import new_token
from app.ticket_engine.ticket_validator import check_in
from app.wallet.wallet_generator import generate_wallet_pass
from tests.test_access_attendees import configured  # shared fixture
from tests.test_events import event_data


def qr_value(delivery):
    encoded = re.findall(rb'src="data:image/png;base64,([^"\s]+)"', delivery["html"])[-1]
    return decode_qr(base64.b64decode(encoded))


def issue(factory, admin, configured):
    with transaction(factory) as s:
        return issue_ticket(s, admin, configured[0], configured[4])


def test_real_qr_pdf_html_and_hash_only_storage(factory, admin, configured):
    delivery = issue(factory, admin, configured)
    qr = qr_value(delivery)
    assert qr.startswith("AAST1.") and "student" not in qr.lower()
    assert delivery["pdf"].startswith(b"%PDF-")
    assert b"viewport" in delivery["html"]
    with factory() as s:
        ticket = s.scalar(select(Ticket))
        assert len(ticket.token_hash) == 64 and qr[6:] != ticket.token_hash
        assert not hasattr(ticket, "raw_token")
    with zipfile.ZipFile(BytesIO(delivery_zip([delivery]))) as archive:
        assert sorted(archive.namelist()) == [delivery["number"] + ".html", delivery["number"] + ".pdf"]


def test_unique_random_tokens():
    pairs = [new_token() for _ in range(1000)]
    assert len({t for t, _ in pairs}) == len({h for _, h in pairs}) == 1000
    assert all(len(t) == 43 and len(h) == 64 for t, h in pairs)


def test_decode_varied_qr_patterns():
    """Opaque tokens produce varied QR masks; every generated code must scan."""
    import hashlib
    from app.ticket_engine.qr_generator import payload, qr_png
    for index in range(64):
        raw = base64.urlsafe_b64encode(hashlib.sha256(f"scanner-pattern-{index}".encode()).digest()).decode().rstrip("=")
        assert decode_qr(qr_png(raw)) == payload(raw)


def test_wrong_gate_does_not_consume_and_duplicate_rejected(factory, admin, configured):
    event, _, gate, wrong, _ = configured
    qr = qr_value(issue(factory, admin, configured))
    with transaction(factory) as s:
        result = check_in(s, admin, event, wrong, qr)
        assert not result.accepted and "Wrong entrance" in result.message
    with transaction(factory) as s:
        assert check_in(s, admin, event, gate, qr).accepted
    with transaction(factory) as s:
        result = check_in(s, admin, event, gate, qr)
        assert not result.accepted and "Already used" in result.message
        assert s.scalar(select(func.count()).select_from(CheckIn)) == 1


def test_simultaneous_scanners_accept_once(factory, admin, configured):
    event, _, gate, _, _ = configured
    qr = qr_value(issue(factory, admin, configured))
    def scan():
        with transaction(factory) as s:
            return check_in(s, admin, event, gate, qr).accepted
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: scan(), range(2)))
    assert sorted(results) == [False, True]


def test_regeneration_invalidates_old_qr_and_revoke(factory, admin, configured):
    event, _, gate, _, _ = configured
    old = qr_value(issue(factory, admin, configured))
    with transaction(factory) as s:
        ticket = s.scalar(select(Ticket))
        tid = ticket.id
        replacement = regenerate_ticket(s, admin, event, tid)
    with transaction(factory) as s:
        assert not check_in(s, admin, event, gate, old).accepted
        revoke_ticket(s, admin, event, tid)
    with transaction(factory) as s:
        result = check_in(s, admin, event, gate, qr_value(replacement))
        assert not result.accepted and "revoked" in result.message


def test_expiry_invalid_qr_and_manual_lookup(factory, admin, configured):
    event, _, gate, _, _ = configured
    delivery = issue(factory, admin, configured)
    with transaction(factory) as s:
        assert not check_in(s, admin, event, gate, "untrusted input").accepted
        s.scalar(select(Ticket)).expires_at = utcnow() - timedelta(seconds=1)
    with transaction(factory) as s:
        result = check_in(s, admin, event, gate, ticket_number=delivery["number"])
        assert not result.accepted and "expired" in result.message


def test_capacity_allocation_and_attendee_limit(factory, admin, configured):
    event, category, _, _, person = configured
    issue(factory, admin, configured)
    with transaction(factory) as s:
        with pytest.raises(AppError, match="maximum allowed"):
            issue_ticket(s, admin, event, person)
        extra = save_attendee(s, admin, event, category, {"full_name": "Extra", "email": "extra@example.com"})
        extra_id = extra.id
        from app.backend.models import Category
        s.get(Category, category).allocation = 1
    with transaction(factory) as s:
        with pytest.raises(AppError, match="allocation"):
            issue_ticket(s, admin, event, extra_id)
        s.get(Event, event).max_tickets = 1
    with transaction(factory) as s:
        with pytest.raises(AppError, match="event ticket limit"):
            issue_ticket(s, admin, event, extra_id)


def test_bulk_capacity_failure_rolls_back_all(factory, admin, configured):
    event, category, _, _, person = configured
    with transaction(factory) as s:
        s.get(Event, event).max_tickets = 1
        other = save_attendee(s, admin, event, category, {"full_name": "Other", "email": "other@example.com"})
        other_id = other.id
    with pytest.raises(AppError, match="limit"):
        with transaction(factory) as s:
            issue_many(s, admin, event, [person, other_id])
    with factory() as s:
        assert s.scalar(select(func.count()).select_from(Ticket)) == 0


def test_event_isolation_and_safe_deletion(factory, admin, configured):
    first = issue(factory, admin, configured)
    with transaction(factory) as s:
        second_event = save_event(s, admin, event_data())
        cat = save_category(s, admin, second_event.id, {"name": "Guest", "code": "G", "allocation": 5})
        gate = save_entrance(s, admin, second_event.id, {"name": "Gate", "code": "G"}, [cat.id])
        assert not check_in(s, admin, second_event.id, gate.id, qr_value(first)).accepted
        with pytest.raises(AppError, match="ticket history"):
            delete_event(s, admin, configured[0])


def test_staff_can_scan_but_cannot_issue(factory, admin, configured):
    delivery = issue(factory, admin, configured)
    with transaction(factory) as s:
        from app.backend.permissions import set_event_assignment
        user = create_user(s, "gate", "a-long-staff-password", "Gate operator", role="staff", session_token=admin)
        set_event_assignment(s, admin, user.id, configured[0], True)
    with transaction(factory) as s:
        staff = login(s, "gate", "a-long-staff-password")
        with pytest.raises(AppError, match="Administrator"):
            issue_ticket(s, staff, configured[0], configured[4])
        assert check_in(s, staff, configured[0], configured[2], ticket_number=delivery["number"]).accepted


def test_reports_and_cancellation(factory, admin, configured):
    delivery = issue(factory, admin, configured)
    with transaction(factory) as s:
        check_in(s, admin, configured[0], configured[2], qr_value(delivery))
    with transaction(factory) as s:
        report = event_report(s, admin, configured[0])
        summary = dict(report["Summary"].values)
        assert summary["Attendees checked in"] == 1
        assert summary["Remaining attendees"] == 0
        assert summary["Attendance (%)"] == 100
        assert report["By entrance"]["Accepted entries"].sum() == 1
        cancel_attendee(s, admin, configured[0], configured[4])
        assert s.scalar(select(Ticket)).status == "Used"


def test_safe_exports_and_disabled_wallet():
    import pandas as pd
    data = csv_bytes(pd.DataFrame({"Name": ["=HYPERLINK(1)"]})).decode("utf-8-sig")
    assert "'=HYPERLINK" in data
    with pytest.raises(AppError, match="disabled"):
        generate_wallet_pass({})
