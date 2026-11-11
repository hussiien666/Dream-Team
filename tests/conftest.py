import pytest
from sqlalchemy.orm import sessionmaker
from app.backend.database import Base, make_engine, transaction
from app.backend.authentication import create_user, login


@pytest.fixture(autouse=True)
def isolated_encryption_key(monkeypatch):
    from cryptography.fernet import Fernet
    monkeypatch.setenv("APP_ENCRYPTION_KEY", Fernet.generate_key().decode())


@pytest.fixture
def factory(tmp_path):
    engine = make_engine("sqlite:///" + (tmp_path / "test.db").as_posix())
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def admin(factory):
    with transaction(factory) as session:
        create_user(session, "admin", "a-long-test-password", "Administrator", bootstrap=True)
    with transaction(factory) as session:
        token = login(session, "admin", "a-long-test-password")
        from app.backend.security import begin_totp, finish_totp, totp
        secret, _ = begin_totp(session, token)
        assert finish_totp(session, token, totp(secret))
        return token
