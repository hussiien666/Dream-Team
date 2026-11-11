"""Environment configuration; paths do not depend on the launching directory."""
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///data/aast.db")
if DATABASE_URL.startswith("sqlite:///") and DATABASE_URL != "sqlite:///:memory:":
    database_path = Path(DATABASE_URL.removeprefix("sqlite:///"))
    if not database_path.is_absolute():
        database_path = ROOT / database_path
    database_path.parent.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = "sqlite:///" + database_path.as_posix()
SESSION_HOURS = max(1, min(24, int(os.getenv("SESSION_HOURS", "8"))))
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Africa/Cairo")
