"""Add explicit organization ownership and event-scoped administrative roles.

Additive only: existing users, events, passwords, tickets and history unchanged.
Legacy administrators retain Super Admin privileges within AAST. Legacy staff
receive assignments to existing events, preserving their operational scope;
new staff require an explicit assignment.
"""
from alembic import op
import sqlalchemy as sa

revision = "03_organization_access"
down_revision = "02_email_delivery"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("organizations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.create_table("organization_users",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.UniqueConstraint("user_id", "organization_id"),
        sa.CheckConstraint("role IN ('super_admin','event_manager','ticket_manager','checkin_supervisor','scanner')", name="ck_organization_role"))
    op.create_index("ix_organization_users_organization_id", "organization_users", ["organization_id"])
    op.create_table("organization_events",
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False),
        sa.UniqueConstraint("event_id", "organization_id"))
    op.create_index("ix_organization_events_organization_id", "organization_events", ["organization_id"])
    op.create_table("event_assignments",
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id", "organization_id"], ["organization_users.user_id", "organization_users.organization_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id", "organization_id"], ["organization_events.event_id", "organization_events.organization_id"], ondelete="CASCADE"))
    connection = op.get_bind()
    connection.execute(sa.text("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (1, 'AAST', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
    connection.execute(sa.text("INSERT INTO organization_users (user_id, organization_id, role) SELECT id, 1, CASE WHEN role = 'admin' THEN 'super_admin' ELSE 'scanner' END FROM users"))
    connection.execute(sa.text("INSERT INTO organization_events (event_id, organization_id) SELECT id, 1 FROM events"))
    connection.execute(sa.text("INSERT INTO event_assignments (user_id, event_id, organization_id) SELECT users.id, events.id, 1 FROM users CROSS JOIN events WHERE users.role = 'staff'"))


def downgrade():
    raise RuntimeError("Organization ownership must not be discarded. Restore a verified pre-upgrade backup if rollback is required.")
