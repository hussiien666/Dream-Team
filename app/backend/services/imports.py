"""Bounded CSV/XLSX imports: map columns, preview validation, atomic commit."""
from io import BytesIO
import re
import zipfile
import pandas as pd
from sqlalchemy import select
from app.backend.authentication import AppError, audit, require_user
from app.backend.permissions import require_permission
from app.backend.models import Category, utcnow
from app.backend.services.events import active_event
from app.backend.services.attendees import duplicate, save_attendee, validate_attendee

FIELDS = ["full_name", "email", "phone", "identity_number", "organization", "notes", "category_code"]
FIELD_LABELS = {"full_name": "Full name", "email": "Email address", "phone": "Phone number",
                "identity_number": "Student / National ID", "organization": "Organization",
                "notes": "Notes", "category_code": "Ticket category"}
ALIASES = {
    "full_name": ["full_name", "full name", "name", "attendee name", "student name"],
    "email": ["email", "email address", "e-mail", "attendee email"],
    "phone": ["phone", "phone number", "mobile", "mobile number", "telephone"],
    "identity_number": ["identity_number", "student id", "national id", "student / national id", "id number", "id"],
    "organization": ["organization", "organisation", "university", "company"],
    "notes": ["notes", "note", "comments"],
    "category_code": ["category_code", "category code", "category", "ticket category", "ticket type", "category name"],
}
MAX_ROWS = 5000


def normalize_header(value):
    return re.sub(r"[^\w]", "", str(value).casefold()).replace("_", "")


def auto_mapping(columns):
    """Recognize both the current human-readable template and older files."""
    mapping = {}
    used = set()
    for field in FIELDS:
        aliases = {normalize_header(value) for value in ALIASES[field]}
        match = next((c for c in columns if normalize_header(c) in aliases and c not in used), "")
        mapping[field] = match
        if match:
            used.add(match)
    return mapping


def read_upload(content, filename):
    if len(content) > 10 * 1024 * 1024:
        raise AppError("The file exceeds 10 MB. Split it into smaller imports.")
    try:
        if filename.lower().endswith(".csv"):
            frame = pd.read_csv(BytesIO(content), dtype=str, keep_default_na=False, nrows=MAX_ROWS + 1)
        elif filename.lower().endswith(".xlsx"):
            with zipfile.ZipFile(BytesIO(content)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 30 * 1024 * 1024 or len(archive.infolist()) > 3000:
                    raise AppError("This workbook is too large after decompression.")
            from openpyxl import load_workbook
            workbook = load_workbook(BytesIO(content), read_only=True, data_only=False)
            try:
                sheet = workbook["Attendees"] if "Attendees" in workbook.sheetnames else workbook.active
                # Bound sparse or malicious worksheet dimensions before building rows.
                if sheet.max_column and sheet.max_column > 50:
                    raise AppError("Import at most 50 columns at a time.")
                if sheet.max_row and sheet.max_row > MAX_ROWS + 1:
                    raise AppError("The sheet extends beyond 5,000 attendee rows. Remove extra rows or split it into smaller files.")
                rows = sheet.iter_rows(max_row=MAX_ROWS + 2, max_col=min(sheet.max_column or 50, 50))
                header = next(rows, None)
                if not header:
                    raise AppError("The file is empty.")
                columns = [str(cell.value or "").strip() for cell in header]
                records, source_rows = [], []
                for row_number, row in enumerate(rows, start=2):
                    if any(cell.data_type == "f" for cell in row):
                        raise AppError("Replace spreadsheet formulas with plain values before importing.")
                    values = [str(cell.value) if cell.value is not None else "" for cell in row]
                    if any(values):
                        records.append(values)
                        source_rows.append(row_number)
                    if len(records) > MAX_ROWS:
                        break
                frame = pd.DataFrame(records, columns=columns)
                frame.attrs["source_rows"] = source_rows
            finally:
                workbook.close()
        else:
            raise AppError("Upload a CSV or .xlsx file.")
    except AppError:
        raise
    except Exception:
        raise AppError("The file could not be read. Use the template and save as UTF-8 CSV or .xlsx.") from None
    frame.columns = [str(c).strip() for c in frame.columns]
    if frame.empty:
        raise AppError("The file contains no attendee rows.")
    if len(frame) > MAX_ROWS or len(frame.columns) > 50:
        raise AppError("Import at most 5,000 rows and 50 columns at a time.")
    if any(not c for c in frame.columns) or len(set(frame.columns)) != len(frame.columns):
        raise AppError("Give every spreadsheet column a unique, non-empty heading.")
    return frame


def map_rows(frame, mapping, default_category_code=""):
    mapped = [v for v in mapping.values() if v]
    if len(mapped) != len(set(mapped)) or any(v not in frame.columns for v in mapped):
        raise AppError("Map each spreadsheet column to only one field.")
    if not mapping.get("full_name"):
        raise AppError("Map a column to Full name.")
    records = []
    source_rows = frame.attrs.get("source_rows", list(range(2, len(frame) + 2)))
    for index, row in enumerate(frame.to_dict("records")):
        record = {field: str(row.get(mapping.get(field), "") or "").strip() for field in FIELDS}
        record["category_code"] = record["category_code"] or default_category_code
        record["_source_row"] = source_rows[index]
        records.append(record)
    return records


def validate_rows(session, token, event_id, records):
    require_permission(session, token, "attendees.manage", event_id)
    if not records or len(records) > MAX_ROWS:
        raise AppError("Import between 1 and 5,000 rows.")
    event = active_event(session, event_id)
    if event.registration_deadline and utcnow() > event.registration_deadline:
        raise AppError("The registration deadline has passed.")
    categories = session.scalars(select(Category).where(Category.event_id == event_id, Category.active.is_(True))).all()
    errors, clean, emails, identities = [], [], set(), set()
    for index, record in enumerate(records, start=2):
        try:
            values = validate_attendee(record)
            supplied = str(record.get("category_code", "")).strip().casefold()
            matches = [c for c in categories if supplied in (c.code.casefold(), c.name.casefold())]
            if len(matches) != 1:
                raise AppError("Ticket category must match an active category name or code in this event. Use its code if the name is ambiguous.")
            category = matches[0]
            if duplicate(session, event_id, values):
                raise AppError("This email or ID is already registered for this event.")
            if (values["email"] and values["email"] in emails) or (values["identity_number"] and values["identity_number"] in identities):
                raise AppError("Duplicate email or ID within this file.")
            if values["email"]:
                emails.add(values["email"])
            if values["identity_number"]:
                identities.add(values["identity_number"])
            clean.append({**values, "category_id": category.id})
        except AppError as exc:
            errors.append({"Spreadsheet row": record.get("_source_row", index), "Error": str(exc)})
    return clean, errors


def import_rows(session, token, event_id, records):
    actor = require_permission(session, token, "attendees.manage", event_id)
    clean, errors = validate_rows(session, token, event_id, records)
    if errors:
        raise AppError(f"Import blocked: {len(errors)} row(s) have errors. Review the preview.")
    for row in clean:
        save_attendee(session, token, event_id, row["category_id"], row, log=False)
    audit(session, actor, "attendees.imported", event_id, f"Imported {len(clean)} attendees")
    return len(clean)


def import_template(categories=()):
    """Use the exact same field labels as the manual attendee form."""
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.workbook.defined_name import DefinedName
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Attendees"
    order = ["full_name", "email", "phone", "identity_number", "organization", "category_code", "notes"]
    sheet.append([FIELD_LABELS[field] for field in order])
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = "A1:G5001"
    for cell in sheet[1]:
        cell.fill = PatternFill("solid", fgColor="142D4E")
        cell.font = Font(color="FFFFFF", bold=True)
    for column, width in zip("ABCDEFG", [30, 34, 22, 28, 28, 25, 45]):
        sheet.column_dimensions[column].width = width
    # Excel must preserve leading zeros, plus signs and literal text.
    for row in sheet.iter_rows(min_row=2, max_row=MAX_ROWS + 1, max_col=7):
        for cell in row:
            cell.number_format = "@"
    sheet["A1"].comment = Comment("Required. Enter the attendee's full name.", "Dream Events")
    sheet["B1"].comment = Comment("Required for emailing a ticket. Otherwise provide an ID in column D.", "Dream Events")
    sheet["F1"].comment = Comment("Choose a category from this event, enter its name/code, or leave blank to use the category selected during upload.", "Dream Events")
    choices = workbook.create_sheet("Ticket categories")
    choices.append(["Ticket category", "Category code"])
    for name, code in categories:
        # Explicit string cells prevent category names becoming formulas.
        choices.append([name, code])
        for cell in choices[choices.max_row]:
            cell.data_type = "s"
    choices.column_dimensions["A"].width = 32
    choices.column_dimensions["B"].width = 24
    if categories:
        workbook.defined_names.add(DefinedName("EventCategories", attr_text=f"'Ticket categories'!$A$2:$A${len(categories)+1}"))
        validation = DataValidation(type="list", formula1="EventCategories", allow_blank=True)
        validation.errorTitle = "Choose an event category"
        validation.error = "Choose a category from the dropdown, or leave blank and select one during upload."
        validation.showErrorMessage = True
        sheet.add_data_validation(validation)
        validation.add(f"F2:F{MAX_ROWS+1}")
    instructions = workbook.create_sheet("Instructions")
    for line in ["Fill the Attendees sheet. One person per row; keep the headings unchanged.",
                 "Full name is required. Provide an email address or Student / National ID.",
                 "To email a ticket, enter the attendee's email address in Email address.",
                 "Ticket category uses the same names as the application. Choose from the dropdown.",
                 "A blank category uses the default you select when uploading.",
                 "Keep IDs and phone numbers as Text to preserve leading zeros.",
                 "Upload the completed workbook, review the preview, and click Import attendees.",
                 "Do not enter spreadsheet formulas. Maximum 5,000 attendees per import."]:
        instructions.append([line])
    instructions.column_dimensions["A"].width = 115
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
