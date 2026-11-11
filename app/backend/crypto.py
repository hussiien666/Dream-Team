"""Authenticated encryption for recoverable credentials; key stays outside DB."""
import os
import time
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken
from app.backend.config import ROOT


def cipher():
    key = os.getenv("APP_ENCRYPTION_KEY", "")
    if not key:
        path = Path(os.getenv("APP_KEY_FILE", str(ROOT / "data" / "secret.key")))
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, "wb") as output:
                output.write(Fernet.generate_key())
        for _ in range(100):
            key = path.read_bytes()
            if key:
                break
            time.sleep(0.01)  # Another process may be completing exclusive creation.
    return Fernet(key.encode() if isinstance(key, str) else key)


def seal(value):
    return cipher().encrypt(value.encode()).decode()


def unseal(value):
    try:
        return cipher().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        from app.backend.authentication import AppError
        raise AppError("The protected data cannot be opened. Restore the matching encryption key.") from None
