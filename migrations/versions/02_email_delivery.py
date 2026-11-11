"""Track real ticket email delivery attempts without storing attachment tokens."""
from alembic import op
import sqlalchemy as sa

revision = "02_email_delivery"
down_revision = "01_immutable_history"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("email_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("recipient", sa.String(254), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.String(255), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id", "event_id"], ["tickets.id", "tickets.event_id"]),
        sa.UniqueConstraint("ticket_id", "token_hash", "recipient"),
        sa.CheckConstraint("status IN ('Pending','Sent','Failed','Unknown')", name="ck_email_delivery_status"))
    op.create_index("ix_email_deliveries_event_id", "email_deliveries", ["event_id"])


def downgrade():
    op.drop_index("ix_email_deliveries_event_id", "email_deliveries")
    op.drop_table("email_deliveries")
