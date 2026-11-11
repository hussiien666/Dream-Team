"""Small tabular reports, calculated exclusively from database records."""
from datetime import timezone
from io import BytesIO
from zoneinfo import ZoneInfo
import pandas as pd
from sqlalchemy import func, select
from app.backend.authentication import require_user
from app.backend.permissions import require_permission
from app.backend.models import (Attendee, AuditLog, Category, CheckIn, Entrance, Event, Ticket, User, utcnow)
from app.backend.services.events import event_lock


def effective_status(ticket, now=None):
    if ticket.status == "Active" and ticket.expires_at <= (now or utcnow()):
        return "Expired"
    return ticket.status


def event_report(session, token, event_id):
    require_permission(session, token, "reports.view", event_id)
    event = session.get(Event, event_id)
    if not event:
        from app.backend.authentication import AppError
        raise AppError("Event not found.")
    categories = session.scalars(select(Category).where(Category.event_id == event_id).order_by(Category.name)).all()
    entrances = session.scalars(select(Entrance).where(Entrance.event_id == event_id).order_by(Entrance.name)).all()
    attendees = session.scalars(select(Attendee).where(Attendee.event_id == event_id)).all()
    tickets = session.scalars(select(Ticket).where(Ticket.event_id == event_id)).all()
    checkins = session.scalars(select(CheckIn).where(CheckIn.event_id == event_id).order_by(CheckIn.checked_at)).all()
    tickets_by_id = {t.id: t for t in tickets}
    people = {a.id: a for a in attendees}
    gates = {e.id: e for e in entrances}
    cat_names = {c.id: c.name for c in categories}
    staff = {u.id: u.display_name for u in session.scalars(select(User))}
    now = utcnow()
    statuses = {t.id: effective_status(t, now) for t in tickets}
    checked_people = {tickets_by_id[c.ticket_id].attendee_id for c in checkins}
    registered = {a.id for a in attendees if a.status == "Registered"} | checked_people
    live = sum(t.status in ("Active", "Used") for t in tickets)
    summary = {
        "Registered attendees": len(registered),
        "Category allocations (combined)": sum(c.allocation for c in categories),
        "Event ticket limit": event.max_tickets,
        "Tickets issued (all time)": len(tickets),
        "Active tickets": sum(v == "Active" for v in statuses.values()),
        "Expired tickets": sum(v == "Expired" for v in statuses.values()),
        "Revoked tickets": sum(v == "Revoked" for v in statuses.values()),
        "Accepted entries": len(checkins),
        "Attendees checked in": len(checked_people),
        "Remaining attendees": len(registered - checked_people),
        "Attendance (%)": round(100 * len(checked_people) / len(registered), 1) if registered else 0,
        "Remaining ticket capacity": max(0, min(event.capacity, event.max_tickets) - live),
    }
    zone = ZoneInfo(event.timezone)
    local = lambda dt: dt.replace(tzinfo=timezone.utc).astimezone(zone).strftime("%Y-%m-%d %H:%M:%S %Z")
    by_category = []
    for category in categories:
        ids = {a.id for a in attendees if a.category_id == category.id and a.id in registered}
        by_category.append({"Category": category.name, "Allocation": category.allocation,
            "Tickets issued": sum(t.category_id == category.id for t in tickets),
            "Attendees": len(ids), "Checked in": len(ids & checked_people), "Remaining": len(ids - checked_people)})
    by_entrance = [{"Entrance": e.name, "Accepted entries": sum(c.entrance_id == e.id for c in checkins)} for e in entrances]
    timeline = [{"Time": local(c.checked_at), "Ticket": tickets_by_id[c.ticket_id].number,
                 "Attendee": people[tickets_by_id[c.ticket_id].attendee_id].full_name,
                 "Category": cat_names[tickets_by_id[c.ticket_id].category_id],
                 "Entrance": gates[c.entrance_id].name, "Staff": staff[c.staff_id]} for c in checkins]
    remaining = [{"Name": a.full_name, "Email": a.email or "", "Category": cat_names[a.category_id]} for a in attendees if a.id in registered - checked_people]
    return {"Summary": pd.DataFrame(summary.items(), columns=["Measure", "Value"]),
            "By category": pd.DataFrame(by_category, columns=["Category", "Allocation", "Tickets issued", "Attendees", "Checked in", "Remaining"]),
            "By entrance": pd.DataFrame(by_entrance, columns=["Entrance", "Accepted entries"]),
            "Check-in timeline": pd.DataFrame(timeline, columns=["Time", "Ticket", "Attendee", "Category", "Entrance", "Staff"]),
            "No-shows" if event.ends_at <= now else "Not yet checked in": pd.DataFrame(remaining, columns=["Name", "Email", "Category"])}


def attendee_table(session, token, event_id):
    require_permission(session, token, "attendees.manage", event_id)
    categories = {c.id: c.name for c in session.scalars(select(Category).where(Category.event_id == event_id))}
    tickets = session.scalars(select(Ticket).where(Ticket.event_id == event_id)).all()
    rows = []
    for a in session.scalars(select(Attendee).where(Attendee.event_id == event_id).order_by(Attendee.full_name)):
        rows.append({"ID": a.id, "Full name": a.full_name, "Email": a.email or "", "Phone": a.phone,
                     "Student / National ID": a.identity_number or "", "Organization": a.organization,
                     "Category": categories[a.category_id], "Status": a.status,
                     "Tickets": ", ".join(t.number for t in tickets if t.attendee_id == a.id),
                     "Registered (UTC)": a.created_at.isoformat(sep=" ", timespec="seconds"), "Notes": a.notes})
    return pd.DataFrame(rows, columns=["ID", "Full name", "Email", "Phone", "Student / National ID", "Organization", "Category", "Status", "Tickets", "Registered (UTC)", "Notes"])


def safe_frame(frame):
    def safe(value):
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
            return "'" + value
        return value
    return frame.map(safe)


def csv_bytes(frame):
    return safe_frame(frame).to_csv(index=False).encode("utf-8-sig")


def excel_bytes(sheets):
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            safe_frame(frame).to_excel(writer, index=False, sheet_name=name[:31])
            sheet = writer.sheets[name[:31]]
            sheet.freeze_panes = "A2"
            sheet.auto_filter.ref = sheet.dimensions
            for column in sheet.columns:
                sheet.column_dimensions[column[0].column_letter].width = min(45, max(15, max(len(str(c.value or "")) for c in column) + 2))
    return output.getvalue()
