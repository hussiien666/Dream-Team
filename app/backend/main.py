"""Local administrative CLI. Never ships a default password."""
import argparse
import getpass
from app.backend.authentication import create_user, login, AppError
from app.backend.database import transaction


def main():
    parser = argparse.ArgumentParser(description="Dream Events administration")
    parser.add_argument("command", choices=["create-admin"])
    args = parser.parse_args()
    if args.command == "create-admin":
        username = input("New administrator username: ")
        name = input("Display name: ")
        password = getpass.getpass("New password (12+ characters): ")
        if password != getpass.getpass("Confirm password: "):
            raise SystemExit("Passwords do not match.")
        try:
            from sqlalchemy import select, func
            from app.backend.models import User
            with transaction() as session:
                exists = session.scalar(select(func.count()).select_from(User)) > 0
            token = None
            if exists:
                existing = input("Existing administrator username: ")
                old_password = getpass.getpass("Existing administrator password: ")
                with transaction() as session:
                    token = login(session, existing, old_password)
                if not token:
                    raise AppError("Sign-in failed.")
                from app.backend.authentication import _primary_user
                from app.backend.security import profile, verify_factor
                with transaction() as session:
                    method = profile(session, _primary_user(session, token).id).factor_method
                if method:
                    code = getpass.getpass("Authenticator or recovery code: ")
                    with transaction() as session:
                        verified = verify_factor(session, token, code)
                    if not verified:
                        raise AppError("Verification failed.")
                else:
                    raise AppError("Sign in through the app and enroll an authenticator before using an existing Super Admin account in the CLI.")
            with transaction() as session:
                create_user(session, username, password, name, session_token=token, bootstrap=not exists)
            print("Administrator created. Start Streamlit to sign in.")
        except AppError as exc:
            raise SystemExit(str(exc)) from None


if __name__ == "__main__":
    main()
