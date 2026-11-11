"""Event-scoped foreign keys enforce isolation even outside service code."""
from datetime import date, datetime, timezone
from sqlalchemy import (Boolean, CheckConstraint, Date, DateTime, ForeignKey,
                        ForeignKeyConstraint, Index, Integer, LargeBinary, Numeric,
                        String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.backend.database import Base


def utcnow():
    # Store UTC without tzinfo consistently on SQLite and PostgreSQL.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class User(Timestamps, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    display_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20), default="admin")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    __table_args__ = (CheckConstraint("role IN ('admin','staff')", name="ck_user_role"),)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class Event(Timestamps, Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    subtitle: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    organization: Mapped[str] = mapped_column(String(200), default="AAST")
    event_type: Mapped[str] = mapped_column(String(100), default="University event")
    status: Mapped[str] = mapped_column(String(20), default="Draft", index=True)
    archived: Mapped[bool] = mapped_column(default=False)
    event_date: Mapped[date] = mapped_column(Date)
    starts_at: Mapped[datetime] = mapped_column(DateTime)
    ends_at: Mapped[datetime] = mapped_column(DateTime)
    timezone: Mapped[str] = mapped_column(String(80), default="Africa/Cairo")
    distribution_start: Mapped[datetime | None] = mapped_column(DateTime)
    distribution_end: Mapped[datetime | None] = mapped_column(DateTime)
    registration_deadline: Mapped[datetime | None] = mapped_column(DateTime)
    country: Mapped[str] = mapped_column(String(100), default="Egypt")
    city: Mapped[str] = mapped_column(String(100), default="")
    venue: Mapped[str] = mapped_column(String(200))
    building: Mapped[str] = mapped_column(String(200), default="")
    address: Mapped[str] = mapped_column(String(500), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    capacity: Mapped[int] = mapped_column(Integer)
    max_tickets: Mapped[int] = mapped_column(Integer)
    logo: Mapped[bytes | None] = mapped_column(LargeBinary)
    banner: Mapped[bytes | None] = mapped_column(LargeBinary)
    categories: Mapped[list["Category"]] = relationship(back_populates="event")
    entrances: Mapped[list["Entrance"]] = relationship(back_populates="event")
    __table_args__ = (
        CheckConstraint("capacity > 0 AND max_tickets > 0 AND max_tickets <= capacity", name="ck_event_capacity"),
        CheckConstraint("ends_at > starts_at", name="ck_event_times"),
        CheckConstraint("status IN ('Draft','Published','Ongoing','Completed','Cancelled')", name="ck_event_status"),
    )


class Category(Timestamps, Base):
    __tablename__ = "ticket_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(7), default="#142D4E")
    allocation: Mapped[int] = mapped_column(Integer)
    max_per_attendee: Mapped[int] = mapped_column(Integer, default=1)
    price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    active: Mapped[bool] = mapped_column(default=True)
    event: Mapped[Event] = relationship(back_populates="categories")
    __table_args__ = (
        UniqueConstraint("event_id", "code"), UniqueConstraint("event_id", "name"),
        UniqueConstraint("id", "event_id"),
        CheckConstraint("allocation > 0 AND max_per_attendee > 0 AND price >= 0", name="ck_category_limits"),
    )


class Entrance(Timestamps, Base):
    __tablename__ = "entrances"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(default=True)
    event: Mapped[Event] = relationship(back_populates="entrances")
    __table_args__ = (UniqueConstraint("event_id", "code"), UniqueConstraint("event_id", "name"), UniqueConstraint("id", "event_id"))


class EntrancePermission(Base):
    __tablename__ = "entrance_category_permissions"
    entrance_id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        ForeignKeyConstraint(["entrance_id", "event_id"], ["entrances.id", "entrances.event_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["category_id", "event_id"], ["ticket_categories.id", "ticket_categories.event_id"], ondelete="CASCADE"),
    )


class Attendee(Timestamps, Base):
    __tablename__ = "attendees"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[int] = mapped_column(Integer)
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str] = mapped_column(String(40), default="")
    identity_number: Mapped[str | None] = mapped_column(String(100))
    organization: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="Registered")
    notes: Mapped[str] = mapped_column(Text, default="")
    __table_args__ = (
        ForeignKeyConstraint(["category_id", "event_id"], ["ticket_categories.id", "ticket_categories.event_id"]),
        UniqueConstraint("event_id", "email"), UniqueConstraint("event_id", "identity_number"),
        UniqueConstraint("id", "event_id", "category_id"),
        CheckConstraint("status IN ('Registered','Cancelled')", name="ck_attendee_status"),
        Index("ix_attendee_name", "event_id", "full_name"),
    )


class Ticket(Timestamps, Base):
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(40), unique=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    attendee_id: Mapped[int] = mapped_column(Integer)
    category_id: Mapped[int] = mapped_column(Integer)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="Active", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    __table_args__ = (
        ForeignKeyConstraint(["attendee_id", "event_id", "category_id"], ["attendees.id", "attendees.event_id", "attendees.category_id"]),
        UniqueConstraint("id", "event_id"),
        CheckConstraint("status IN ('Active','Used','Revoked','Expired')", name="ck_ticket_status"),
    )


class CheckIn(Base):
    __tablename__ = "check_ins"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="RESTRICT"), index=True)
    ticket_id: Mapped[int] = mapped_column(Integer, unique=True)
    entrance_id: Mapped[int] = mapped_column(Integer)
    staff_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    __table_args__ = (
        ForeignKeyConstraint(["ticket_id", "event_id"], ["tickets.id", "tickets.event_id"]),
        ForeignKeyConstraint(["entrance_id", "event_id"], ["entrances.id", "entrances.event_id"]),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    event_id: Mapped[int | None] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(100))
    details: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class EventSetting(Timestamps, Base):
    __tablename__ = "event_settings"
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class EmailDelivery(Timestamps, Base):
    __tablename__ = "email_deliveries"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer, index=True)
    ticket_id: Mapped[int] = mapped_column(Integer)
    token_hash: Mapped[str] = mapped_column(String(64))
    recipient: Mapped[str] = mapped_column(String(254))
    status: Mapped[str] = mapped_column(String(20), default="Pending")
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    message_id: Mapped[str] = mapped_column(String(255))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str] = mapped_column(String(500), default="")
    __table_args__ = (
        ForeignKeyConstraint(["ticket_id", "event_id"], ["tickets.id", "tickets.event_id"]),
        UniqueConstraint("ticket_id", "token_hash", "recipient"),
        CheckConstraint("status IN ('Pending','Sent','Failed','Unknown')", name="ck_email_delivery_status"),
    )


class Organization(Timestamps, Base):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))


class OrganizationUser(Base):
    """One home organization and an explicit operational role per account."""
    __tablename__ = "organization_users"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), index=True)
    role: Mapped[str] = mapped_column(String(30))
    __table_args__ = (
        UniqueConstraint("user_id", "organization_id"),
        CheckConstraint("role IN ('super_admin','event_manager','ticket_manager','checkin_supervisor','scanner')", name="ck_organization_role"),
    )


class OrganizationEvent(Base):
    """Ownership is distinct from the legacy event branding text."""
    __tablename__ = "organization_events"
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), index=True)
    __table_args__ = (UniqueConstraint("event_id", "organization_id"),)


class EventAssignment(Base):
    __tablename__ = "event_assignments"
    user_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "organization_id"], ["organization_users.user_id", "organization_users.organization_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["event_id", "organization_id"], ["organization_events.event_id", "organization_events.organization_id"], ondelete="CASCADE"),
    )


# Register additive models with the same metadata used by tests and Alembic.
from app.backend import upgrade_models  # noqa: E402,F401
