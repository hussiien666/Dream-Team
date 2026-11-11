from io import BytesIO
from openpyxl import load_workbook
from app.backend.database import transaction
from app.backend.services.imports import auto_mapping, import_rows, import_template, map_rows, read_upload, validate_rows
from tests.test_access_attendees import configured


def test_downloaded_template_imports_without_mapping(factory, admin, configured):
    workbook = load_workbook(BytesIO(import_template((("Student", "STU"),))))
    sheet = workbook["Attendees"]
    sheet.cell(2, 1, "New student")
    sheet.cell(2, 2, "new@example.com")
    sheet.cell(2, 3, "01001234567")
    sheet.cell(2, 4, "001234")
    sheet.cell(2, 6, "Student")
    output = BytesIO()
    workbook.save(output)
    frame = read_upload(output.getvalue(), "attendees.xlsx")
    mapping = auto_mapping(frame.columns)
    assert all(mapping.values())
    rows = map_rows(frame, mapping, "STU")
    assert rows[0]["phone"] == "01001234567" and rows[0]["identity_number"] == "001234"
    with transaction(factory) as s:
        assert not validate_rows(s, admin, configured[0], rows)[1]
        assert import_rows(s, admin, configured[0], rows) == 1


def test_blank_category_and_familiar_headers(factory, admin, configured):
    frame = read_upload(b"Name,E-mail,Mobile,StudentID,Category\nNew,new@example.com,01234567890,001,\n", "people.csv")
    rows = map_rows(frame, auto_mapping(frame.columns), "STU")
    with transaction(factory) as s:
        assert len(validate_rows(s, admin, configured[0], rows)[0]) == 1


def test_sheet_errors_use_actual_excel_row(factory, admin, configured):
    workbook = load_workbook(BytesIO(import_template((("Student", "STU"),))))
    sheet = workbook["Attendees"]
    sheet.cell(7, 1, "Invalid email")
    sheet.cell(7, 2, "not-an-email")
    output = BytesIO()
    workbook.save(output)
    frame = read_upload(output.getvalue(), "attendees.xlsx")
    with transaction(factory) as s:
        _, errors = validate_rows(s, admin, configured[0], map_rows(frame, auto_mapping(frame.columns), "STU"))
        assert errors[0]["Spreadsheet row"] == 7
