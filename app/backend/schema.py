"""Refuse to run against a stale schema, including missing history protections."""
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from app.backend.config import ROOT


def schema_ready(engine):
    config = Config(str(ROOT / "alembic.ini"))
    expected = ScriptDirectory.from_config(config).get_current_head()
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    return current == expected
