"""Memory-only ticket delivery. Downloaded artifacts contain bearer credentials."""
import base64
import html
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo
from datetime import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, KeepTogether
from app.ticket_engine.qr_generator import qr_png


def _font():
    for file in (Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")):
        if file.exists():
            if "TicketFont" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("TicketFont", str(file)))
            return "TicketFont"
    return "Helvetica"


def event_time(event):
    zone = ZoneInfo(event.timezone)
    start = event.starts_at.replace(tzinfo=timezone.utc).astimezone(zone)
    end = event.ends_at.replace(tzinfo=timezone.utc).astimezone(zone)
    return f"{start:%d %B %Y} · {start:%H:%M}–{end:%H:%M} ({event.timezone})"


def pdf_ticket(event, attendee, category, ticket, token, entrances):
    output = BytesIO()
    font = _font()
    normal = ParagraphStyle("Ticket", fontName=font, fontSize=10, leading=15, textColor=colors.HexColor("#142D4E"))
    title = ParagraphStyle("Title", parent=normal, fontSize=18, leading=23)
    small = ParagraphStyle("Small", parent=normal, fontSize=8, leading=12)
    center = ParagraphStyle("Center", parent=normal, alignment=TA_CENTER)
    def p(value, style=normal):
        # Shape Arabic on PDF canvases; HTML uses native browser shaping.
        value = str(value)
        if any("\u0600" <= c <= "\u06ff" for c in value):
            import arabic_reshaper
            from bidi.algorithm import get_display
            value = get_display(arabic_reshaper.reshape(value))
        return Paragraph(html.escape(value).replace("\n", "<br/>"), style)
    story = []
    if event.logo:
        logo = Image(BytesIO(event.logo), width=26 * mm, height=16 * mm, kind="proportional")
        logo.hAlign = "LEFT"
        story += [logo, Spacer(1, 4 * mm)]
    story += [p(event.organization or "AAST", small), p(event.name, title)]
    if event.subtitle:
        story += [p(event.subtitle)]
    story += [Spacer(1, 5 * mm), p(event_time(event)), p(event.venue), Spacer(1, 5 * mm)]
    table = Table([[p(attendee.full_name, title)], [p(category.name + " · " + ticket.number)],
                   [p("Status at generation: " + ticket.status, small)]], colWidths=[118 * mm])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F5F7")),
                               ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor("#B5974E")),
                               ("LEFTPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story += [table, Spacer(1, 4 * mm)]
    qr = Image(BytesIO(qr_png(token)), width=55 * mm, height=55 * mm)
    story += [KeepTogether([qr, p("Present this QR at your entrance. Valid for one entry.", center)]), Spacer(1, 4 * mm)]
    access = "; ".join(f"{e.name}" + (f" ({e.location})" if e.location else "") + (f": {e.instructions}" if e.instructions else "") for e in entrances)
    story += [p("Allowed entrances: " + (access or "No entrance configured; contact the organizer."), small)]
    if event.instructions:
        story += [p(event.instructions, small)]
    story += [Spacer(1, 3 * mm), p("Keep this ticket private. The first accepted scan uses the ticket.", small)]
    document = SimpleDocTemplate(output, pagesize=A5, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
                                 title=f"Ticket {ticket.number}", author="Dream Events")
    document.build(story)
    return output.getvalue()


def mobile_ticket(event, attendee, category, ticket, token, entrances):
    esc = lambda value: html.escape(str(value), quote=True)
    qr = base64.b64encode(qr_png(token)).decode()
    logo = f'<img class="logo" alt="Event logo" src="data:image/png;base64,{base64.b64encode(event.logo).decode()}">' if event.logo else ""
    banner = f'<img class="banner" alt="Event banner" src="data:image/png;base64,{base64.b64encode(event.banner).decode()}">' if event.banner else ""
    access = "; ".join(e.name + (f": {e.instructions}" if e.instructions else "") for e in entrances)
    return f'''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Ticket {esc(ticket.number)}</title>
<style>body{{margin:0;background:#f3f5f7;font:16px/1.5 Arial,sans-serif;color:#142d4e}}main{{max-width:460px;margin:24px auto;padding:24px;background:white;border-top:4px solid #b5974e}}h1{{font-size:25px}}.qr{{display:block;width:280px;max-width:100%;margin:auto}}.logo{{max-width:120px;max-height:70px}}.banner{{width:100%}}.name{{font-size:23px;font-weight:bold}}small{{color:#43546a}}@media print{{body{{background:white}}main{{margin:0}}}}</style>
<main>{banner}{logo}<small>{esc(event.organization)}</small><h1>{esc(event.name)}</h1>
<p>{esc(event_time(event))}<br>{esc(event.venue)}</p><p class="name" dir="auto">{esc(attendee.full_name)}</p>
<p>{esc(category.name)}<br>{esc(ticket.number)}<br><small>Status at generation: {esc(ticket.status)}</small></p><img class="qr" alt="Entry QR code" src="data:image/png;base64,{qr}">
<p>Allowed entrances: {esc(access or "Contact the organizer")}</p><p>{esc(event.instructions)}</p>
<small>Valid for one entry. Keep this file private. Print using your browser's Print command. Status is verified at check-in.</small></main></html>'''.encode("utf-8")
