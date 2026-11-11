"""Generate a disposable example PDF for layout QA; writes no database records."""
from datetime import date, datetime
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.backend.models import Event, Attendee, Category, Entrance, Ticket
from app.ticket_engine.pdf_generator import pdf_ticket
from app.ticket_engine.qr_generator import new_token

event = Event(name="AAST Graduation Ceremony", subtitle="Class of 2030", organization="AAST",
              venue="Main Auditorium, Abu Qir Campus", event_date=date(2030, 6, 1),
              starts_at=datetime(2030, 6, 1, 6), ends_at=datetime(2030, 6, 1, 14),
              timezone="Africa/Cairo", instructions="Please arrive 20 minutes before the event.")
person = Attendee(full_name="Ahmed Mohamed Hassan")
category = Category(name="Graduate")
ticket = Ticket(number="AAST-EXAMPLE-PREVIEW", status="Active")
gate = Entrance(name="Main Entrance", location="Building A", instructions="Show your ticket to the entrance staff.")
raw, _ = new_token()
output = ROOT / "tmp/pdfs/ticket-preview.pdf"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(pdf_ticket(event, person, category, ticket, raw, [gate]))
print(output)
