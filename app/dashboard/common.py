"""Shared UI helpers keep mutation/error handling consistent."""
import logging
import streamlit as st
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.backend.authentication import AppError
from app.backend.database import transaction

log = logging.getLogger(__name__)


def token():
    return st.session_state.auth_token


def perform(operation, message=None, rerun=True):
    try:
        with transaction() as session:
            result = operation(session)
    except AppError as exc:
        st.error(str(exc))
        return False, None
    except IntegrityError:
        st.error("The change conflicts with an existing record or event history. Refresh the page and check for duplicates.")
        return False, None
    except SQLAlchemyError:
        log.exception("Database operation failed")
        st.error("The database could not save this change. Nothing was committed. Try again or contact your administrator.")
        return False, None
    except Exception:
        log.exception("Application operation failed")
        st.error("The operation could not be completed. Nothing was committed. Check the application log for details.")
        return False, None
    if message:
        st.session_state.flash = message
    if rerun:
        st.rerun()
    return True, result


def flash():
    if message := st.session_state.pop("flash", None):
        st.success(message)


def table(rows):
    if len(rows):
        st.dataframe(rows, hide_index=True, width="stretch")
    else:
        st.info("No records to display.")
