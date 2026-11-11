"""Additive operational models; legacy tables and identifiers remain intact."""
from datetime import datetime
from sqlalchemy import (Boolean, CheckConstraint, DateTime, ForeignKey,
    ForeignKeyConstraint, Integer, LargeBinary, String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column
from app.backend.database import Base
from app.backend.models import Timestamps, utcnow


class SecurityProfile(Base):
    __tablename__ = "security_profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    email_verified: Mapped[bool] = mapped_column(default=False)
    factor_method: Mapped[str] = mapped_column(String(12), default="")
    totp_secret: Mapped[str] = mapped_column(Text, default="")
    totp_counter: Mapped[int] = mapped_column(default=-1)
    force_password: Mapped[bool] = mapped_column(default=False)
    photo: Mapped[bytes | None] = mapped_column(LargeBinary)
    __table_args__ = (CheckConstraint("factor_method IN ('','totp','email')", name="ck_factor_method"),)


class SecuritySession(Base):
    __tablename__ = "security_sessions"
    token_hash: Mapped[str] = mapped_column(ForeignKey("auth_sessions.token_hash", ondelete="CASCADE"), primary_key=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    verified: Mapped[bool] = mapped_column(default=False)
    attempts: Mapped[int] = mapped_column(default=0)
    enrollment_secret: Mapped[str] = mapped_column(Text, default="")


class RecoveryCode(Base):
    __tablename__ = "recovery_codes"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)


class ActionToken(Base):
    __tablename__ = "action_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(100))
    payload: Mapped[str] = mapped_column(Text, default="")
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(default=0)


class PermissionOverride(Base):
    __tablename__ = "permission_overrides"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    permission: Mapped[str] = mapped_column(String(60), primary_key=True)
    allowed: Mapped[bool] = mapped_column(Boolean)


class AccessCode(Timestamps, Base):
    __tablename__ = "access_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    active: Mapped[bool] = mapped_column(default=True)
    __table_args__ = (UniqueConstraint("id", "event_id"),)


class CodeEntrance(Base):
    __tablename__ = "code_entrances"
    code_id: Mapped[int] = mapped_column(primary_key=True)
    entrance_id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        ForeignKeyConstraint(["code_id", "event_id"], ["access_codes.id", "access_codes.event_id"]),
        ForeignKeyConstraint(["entrance_id", "event_id"], ["entrances.id", "entrances.event_id"]),)


class CodeStaff(Base):
    __tablename__ = "code_staff"
    code_id: Mapped[int] = mapped_column(ForeignKey("access_codes.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)


class ScannerSession(Base):
    __tablename__ = "scanner_sessions"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    event_id: Mapped[int] = mapped_column(Integer)
    code_id: Mapped[int] = mapped_column(Integer)
    entrance_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (
        ForeignKeyConstraint(["code_id", "event_id"], ["access_codes.id", "access_codes.event_id"]),
        ForeignKeyConstraint(["entrance_id", "event_id"], ["entrances.id", "entrances.event_id"]),)


class ScannerPreference(Base):
    __tablename__ = "scanner_preferences"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    success_sound: Mapped[bool] = mapped_column(default=True)
    rejection_sound: Mapped[bool] = mapped_column(default=True)
    success_vibration: Mapped[bool] = mapped_column(default=True)
    rejection_vibration: Mapped[bool] = mapped_column(default=True)


class ScanAttempt(Base):
    __tablename__ = "scan_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_hash: Mapped[str] = mapped_column(String(64))
    ticket_number: Mapped[str] = mapped_column(String(40), default="")
    guest_name: Mapped[str] = mapped_column(String(200), default="")
    accepted: Mapped[bool] = mapped_column(Boolean)
    message: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class BackgroundJob(Timestamps, Base):
    __tablename__ = "background_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    payload: Mapped[str] = mapped_column(Text)
    dedupe_key: Mapped[str] = mapped_column(String(255), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="Pending", index=True)
    attempts: Mapped[int] = mapped_column(default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime)
    lease_token: Mapped[str] = mapped_column(String(64), default="")
    last_error: Mapped[str] = mapped_column(String(500), default="")
    __table_args__ = (CheckConstraint("status IN ('Pending','Running','Sent','Failed','Unknown')", name="ck_job_status"),)
