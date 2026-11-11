import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { makeTemplate, readWorkbook } from '../src/students/workbook.ts';

async function filledTemplate() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await makeTemplate([], [{ name: 'Guest', code: 'GUEST' }]));
  book.getWorksheet('Students').getRow(2).values = [
    '0001', 'Example Student',
    { text: 'student@example.com', hyperlink: 'mailto:student@example.com' },
    '001234',
  ];
  book.getWorksheet('Guests').getRow(2).values = [
    '0001', 'Example Guest',
    { text: 'guest@example.com', hyperlink: 'mailto:guest@example.com' },
    '009876', 'GUEST', '',
  ];
  return book;
}

test('Excel email autolinks in both template sheets import as plain text', async () => {
  const book = await filledTemplate();
  const result = await readWorkbook(Buffer.from(await book.xlsx.writeBuffer()), []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].data.Email, 'student@example.com');
  assert.equal(result.rows[1].data['Guest email'], 'guest@example.com');
  assert.equal(result.rows[0].data['Student ID'], '0001');
});

test('non-email external links and formulas stay blocked', async () => {
  const webLink = await filledTemplate();
  webLink.getWorksheet('Students').getCell('C2').value = {
    text: 'student@example.com', hyperlink: 'https://example.com/',
  };
  await assert.rejects(readWorkbook(Buffer.from(await webLink.xlsx.writeBuffer()), []),
    /External workbook references are not allowed/);

  const wrongColumn = await filledTemplate();
  wrongColumn.getWorksheet('Students').getCell('B2').value = {
    text: 'Example Student', hyperlink: 'mailto:student@example.com',
  };
  const invalid = await readWorkbook(Buffer.from(await wrongColumn.xlsx.writeBuffer()), []);
  assert.match(invalid.errors[0].message, /hyperlinks/);

  const formula = await filledTemplate();
  formula.getWorksheet('Students').getCell('C2').value = { formula: '1+1', result: '2' };
  const rejected = await readWorkbook(Buffer.from(await formula.xlsx.writeBuffer()), []);
  assert.match(rejected.errors[0].message, /Formulas/);
});
