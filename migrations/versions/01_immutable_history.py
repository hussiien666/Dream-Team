"""Protect check-in and audit history from UPDATE and DELETE."""
from alembic import op

revision = "01_immutable_history"
down_revision = "de85c4478630"
branch_labels = None
depends_on = None


def upgrade():
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        for table in ("check_ins", "audit_logs"):
            for operation in ("UPDATE", "DELETE"):
                op.execute(f"CREATE TRIGGER {table}_no_{operation.lower()} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'History is immutable'); END")
    elif dialect == "postgresql":
        op.execute("CREATE FUNCTION aast_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'History is immutable'; END; $$")
        for table in ("check_ins", "audit_logs"):
            op.execute(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION aast_history_immutable()")


def downgrade():
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        for table in ("check_ins", "audit_logs"):
            for operation in ("update", "delete"):
                op.execute(f"DROP TRIGGER IF EXISTS {table}_no_{operation}")
    elif dialect == "postgresql":
        for table in ("check_ins", "audit_logs"):
            op.execute(f"DROP TRIGGER IF EXISTS {table}_immutable ON {table}")
        op.execute("DROP FUNCTION aast_history_immutable()")
