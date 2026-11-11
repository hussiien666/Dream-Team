import os
from pathlib import Path
import subprocess
import sys
import pytest
from sqlalchemy import inspect, select
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session
from app.backend.database import make_engine
from app.backend.models import AuditLog


def test_fresh_migration_and_immutable_audit(tmp_path):
    url = "sqlite:///" + (tmp_path / "migrated.db").as_posix()
    env = {**os.environ, "DATABASE_URL": url}
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    engine = make_engine(url)
    tables = inspect(engine).get_table_names()
    assert all(table in tables for table in ("users", "events", "entrances", "ticket_categories", "attendees", "tickets", "check_ins", "audit_logs", "event_settings", "email_deliveries"))
    with Session(engine) as s:
        s.add(AuditLog(action="test.audit"))
        s.commit()
    for sql in ("DELETE FROM audit_logs", "UPDATE audit_logs SET action='changed'"):
        with pytest.raises(DatabaseError, match="immutable"):
            with engine.begin() as connection:
                connection.exec_driver_sql(sql)
    with Session(engine) as s:
        assert s.scalar(select(AuditLog.action)) == "test.audit"
    triggers = []
    with engine.connect() as connection:
        triggers = connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'").scalars().all()
    assert "check_ins_no_update" in triggers and "check_ins_no_delete" in triggers
    engine.dispose()


def test_organization_upgrade_preserves_legacy_records_and_qr(tmp_path):
    """Upgrade a populated revision-02 database; compare all old tables exactly."""
    from datetime import date, datetime
    from app.backend.authentication import digest, hasher, require_user
    from app.backend.models import (Attendee, Category, CheckIn, Entrance,
        EntrancePermission, Event, Ticket, User, AuthSession, OrganizationUser,
        OrganizationEvent, EventAssignment)
    from app.backend.permissions import visible_events
    from app.ticket_engine.ticket_validator import check_in
    from app.backend.database import transaction
    from sqlalchemy.orm import sessionmaker
    url = "sqlite:///" + (tmp_path / "legacy.db").as_posix()
    env = {**os.environ, "DATABASE_URL": url}
    root = Path(__file__).resolve().parents[1]
    def migrate(revision):
        result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", revision],
            cwd=root, env=env, capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, result.stderr
    migrate("02_email_delivery")
    engine = make_engine(url)
    factory = sessionmaker(engine, expire_on_commit=False)
    raw = "x" * 43
    with transaction(factory) as s:
        admin = User(id=1, username="legacy", display_name="Legacy admin", role="admin", password_hash=hasher.hash("a-long-legacy-password"))
        staff = User(id=2, username="gate", display_name="Legacy scanner", role="staff", password_hash=hasher.hash("a-long-legacy-password"))
        event = Event(id=7, name="Legacy graduation", venue="Hall", event_date=date(2030, 6, 1),
            starts_at=datetime(2030, 6, 1, 6), ends_at=datetime(2030, 6, 1, 14), capacity=100, max_tickets=100, status="Published")
        s.add_all([admin, staff, event]); s.flush()
        s.add_all([Category(id=3, event_id=7, name="Guest", code="G", allocation=100),
            Entrance(id=4, event_id=7, name="Main", code="M")]); s.flush()
        s.add(Attendee(id=9, event_id=7, category_id=3, full_name="Existing guest", email="guest@example.com")); s.flush()
        s.add_all([EntrancePermission(entrance_id=4, category_id=3, event_id=7),
            Ticket(id=11, number="AAST-LEGACY", event_id=7, attendee_id=9, category_id=3,
                token_hash=digest(raw), status="Active", expires_at=event.ends_at),
            AuthSession(token_hash=digest("old-session"), user_id=1, expires_at=datetime(2030, 6, 1)),
            AuditLog(actor_id=1, event_id=7, action="legacy.preserved")])
    old_tables = [name for name in inspect(engine).get_table_names() if name != "alembic_version"]
    def snapshot():
        with engine.connect() as connection:
            return {name: connection.exec_driver_sql(f'SELECT * FROM "{name}" ORDER BY 1').all() for name in old_tables}
    before = snapshot()
    migrate("head")
    assert snapshot() == before
    with transaction(factory) as s:
        from app.backend.security import begin_totp, finish_totp, totp
        secret, _ = begin_totp(s, "old-session")
        assert finish_totp(s, "old-session", totp(secret))
        assert require_user(s, "old-session").username == "legacy"
        assert s.get(OrganizationUser, 1).role == "super_admin"
        assert s.get(OrganizationUser, 2).role == "scanner"
        assert s.get(OrganizationEvent, 7).organization_id == 1
        assert s.get(EventAssignment, (2, 7))
        assert [e.id for e in visible_events(s, "old-session")] == [7]
        assert check_in(s, "old-session", 7, 4, "AAST1." + raw).accepted
    with engine.connect() as connection:
        assert not connection.exec_driver_sql("PRAGMA foreign_key_check").all()
        assert connection.exec_driver_sql("PRAGMA integrity_check").scalar() == "ok"
        assert "audit_logs_no_delete" in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'").scalars().all()
    engine.dispose()
