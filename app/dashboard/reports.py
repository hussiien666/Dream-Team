import streamlit as st
from app.backend.database import SessionLocal
from app.backend.services.reports import csv_bytes, event_report, excel_bytes
from app.dashboard.common import table, token


def render(event_id):
    st.header("Reports")
    st.caption("Step 6 · Live database totals. Refresh to see scans from other devices.")
    st.button("Refresh reports")
    with SessionLocal() as session:
        report = event_report(session, token(), event_id)
    st.download_button("Download full report (Excel)", excel_bytes(report), "event_report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    section = st.selectbox("Report", list(report))
    table(report[section])
    st.download_button("Download selected report (CSV)", csv_bytes(report[section]), section.lower().replace(" ", "_") + ".csv", "text/csv")
    st.caption("Attendees are counted once even if their category permits multiple tickets. Accepted entries count tickets. No-shows are labeled only after the event ends. Category allocations share the event ticket limit.")
