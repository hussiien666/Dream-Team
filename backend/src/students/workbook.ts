import ExcelJS from 'exceljs';
import { inflateRawSync } from 'node:zlib';
import { BadRequestException } from '@nestjs/common';
import type { Field } from './validation.js';
export type SheetRow = {
  sheet: string;
  row: number;
  data: Record<string, unknown>;
};
export type RowError = { sheet: string; row: number; message: string };
const studentHeaders = ['Student ID', 'Student name', 'Email', 'Phone'];
const guestHeaders = [
  'Student ID',
  'Guest name',
  'Guest email',
  'Guest phone',
  'Category',
  'Invitation group',
];
function headers(target: string, fields: Field[]) {
  return [
    ...(target === 'student' ? studentHeaders : guestHeaders),
    ...fields
      .filter((f) => f.target === target && f.active)
      .map((f) => 'Field: ' + f.key),
  ];
}
// Bound compressed and expanded sizes before ExcelJS inflates any ZIP member.
export function boundWorkbook(buffer: Buffer) {
  if (buffer.length > 10 * 1024 * 1024)
    throw new BadRequestException('The workbook exceeds 10 MB.');
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0)
    throw new BadRequestException('Upload a readable .xlsx workbook.');
  const count = buffer.readUInt16LE(eocd + 10),
    size = buffer.readUInt32LE(eocd + 12);
  let pos = buffer.readUInt32LE(eocd + 16),
    total = 0;
  if (
    count > 3000 ||
    size === 0xffffffff ||
    pos + size > eocd ||
    buffer.readUInt16LE(eocd + 4) !== 0 ||
    buffer.readUInt16LE(eocd + 6) !== 0
  )
    throw new BadRequestException('Unsupported or oversized workbook.');
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || buffer.readUInt32LE(pos) !== 0x02014b50)
      throw new BadRequestException('Invalid workbook archive.');
    const compressed = buffer.readUInt32LE(pos + 20),
      expanded = buffer.readUInt32LE(pos + 24);
    total += expanded;
    if (
      total > 30 * 1024 * 1024 ||
      compressed === 0xffffffff ||
      expanded === 0xffffffff ||
      buffer.readUInt16LE(pos + 8) & 1
    )
      throw new BadRequestException(
        'Expanded workbook exceeds 30 MB or is encrypted.',
      );
    const len = buffer.readUInt16LE(pos + 28),
      extra = buffer.readUInt16LE(pos + 30),
      comment = buffer.readUInt16LE(pos + 32);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + len);
    if (name.includes('externalLinks/') || name.includes('vbaProject'))
      throw new BadRequestException(
        'External references and macros are not allowed.',
      );
    const offset = buffer.readUInt32LE(pos + 42);
    if (
      offset + 30 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x04034b50
    )
      throw new BadRequestException('Invalid workbook member.');
    const start =
      offset +
      30 +
      buffer.readUInt16LE(offset + 26) +
      buffer.readUInt16LE(offset + 28);
    if (start + compressed > buffer.length)
      throw new BadRequestException('Truncated workbook member.');
    try {
      const method = buffer.readUInt16LE(pos + 10);
      const content =
        method === 0
          ? buffer.subarray(start, start + compressed)
          : method === 8
            ? inflateRawSync(buffer.subarray(start, start + compressed), {
                maxOutputLength: Math.max(
                  1,
                  Math.min(expanded, 30 * 1024 * 1024),
                ),
              })
            : null;
      if (!content || content.length !== expanded) throw new Error('size');
      if (name.endsWith('.rels')) {
        const relationships = content.toString('utf8').match(/<Relationship\b[^>]*>/gi) ?? [];
        for (const relation of relationships) {
          const attribute = (key: string) =>
            relation.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? '';
          if (attribute('TargetMode').toLowerCase() !== 'external') continue;
          // Excel automatically turns email addresses into mailto links. The
          // corresponding cell is checked below before its text is accepted.
          if (
            attribute('Type').endsWith('/hyperlink') &&
            /^mailto:[^?#]+$/i.test(attribute('Target'))
          ) continue;
          throw new BadRequestException('External workbook references are not allowed.');
        }
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        'Invalid or oversized compressed workbook member.',
      );
    }
    pos += 46 + len + extra + comment;
  }
}
export async function readWorkbook(buffer: Buffer, fields: Field[]) {
  boundWorkbook(buffer);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as never);
  } catch {
    throw new BadRequestException('The Excel workbook could not be read.');
  }
  if (
    book.worksheets.length !== 2 ||
    !book.getWorksheet('Students') ||
    !book.getWorksheet('Guests')
  )
    throw new BadRequestException(
      'Use exactly the Students and Guests sheets from the template.',
    );
  const rows: SheetRow[] = [],
    errors: RowError[] = [];
  let total = 0;
  for (const target of ['student', 'guest']) {
    const name = target === 'student' ? 'Students' : 'Guests',
      sheet = book.getWorksheet(name)!;
    if (sheet.columnCount > 50 || sheet.rowCount > 5001)
      throw new BadRequestException(
        'Use at most 5,000 data rows and 50 columns.',
      );
    const allowed = headers(target, fields);
    const actual: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (c) => {
      actual.push(typeof c.value === 'string' ? c.value.trim() : '');
    });
    const required =
      target === 'student'
        ? studentHeaders.slice(0, 3)
        : ['Student ID', 'Guest name'];
    if (
      actual.some((h) => !allowed.includes(h)) ||
      new Set(actual).size !== actual.length ||
      required.some((h) => !actual.includes(h))
    )
      throw new BadRequestException(
        `${name}: headings do not match the event template.`,
      );
    sheet.eachRow((row, num) => {
      if (num === 1) return;
      const data: Record<string, unknown> = {};
      let hasValue = false;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v = cell.value;
        if (v !== null && v !== undefined && v !== '') hasValue = true;
        if (col > actual.length && v !== null) {
          errors.push({
            sheet: name,
            row: num,
            message: 'Value without a heading.',
          });
          return;
        }
        const heading = actual[col - 1];
        const mailLink =
          v && typeof v === 'object' && !(v instanceof Date) &&
          ('hyperlink' in v) && ('text' in v) &&
          typeof v.hyperlink === 'string' && typeof v.text === 'string' &&
          (heading === 'Email' || heading === 'Guest email') &&
          v.hyperlink.toLowerCase() === `mailto:${v.text.trim().toLowerCase()}`;
        if (v && typeof v === 'object' && !(v instanceof Date) && !mailLink) {
          errors.push({
            sheet: name,
            row: num,
            message:
              'Formulas, hyperlinks and rich-text cells are not allowed. Paste plain values.',
          });
          return;
        }
        data[heading] = mailLink
          ? v.text.trim()
          : v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? '');
      });
      if (!hasValue) return;
      total++;
      for (const key of [
        'Student ID',
        ...(target === 'student' ? ['Phone'] : ['Guest phone']),
      ])
        if (typeof data[key] === 'number')
          errors.push({
            sheet: name,
            row: num,
            message: `${key} must be stored as Text to preserve leading zeros.`,
          });
      for (const f of fields.filter((f) => f.target === target && f.active)) {
        const key = 'Field: ' + f.key,
          v = data[key];
        if (
          f.type === 'checkbox' &&
          typeof v === 'string' &&
          /^(true|false)$/i.test(v)
        )
          data[key] = v.toLowerCase() === 'true';
      }
      rows.push({ sheet: name, row: num, data });
    });
  }
  if (total > 5000)
    throw new BadRequestException(
      'Use at most 5,000 combined student and guest rows.',
    );
  return { rows, errors };
}
export async function makeTemplate(
  fields: Field[],
  categories: { name: string; code: string }[],
) {
  const book = new ExcelJS.Workbook();
  book.creator = 'Dream Events';
  for (const target of ['student', 'guest']) {
    const sheet = book.addWorksheet(
      target === 'student' ? 'Students' : 'Guests',
    );
    sheet.columns = headers(target, fields).map((header) => ({
      header,
      key: header,
      width: header.startsWith('Field:') ? 24 : 28,
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF142D4E' },
    };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const notes =
      target === 'student'
        ? 'One sender per Student ID. Email is required. Cancelled records cannot be reactivated by import.'
        : 'Student ID links to the Students sheet or an existing student. Blank Category uses the event default. Matching uses email, otherwise name and phone.';
    sheet.getCell('A1').note = notes;
    for (const c of sheet.columns) c.numFmt = '@';
    for (const f of fields.filter((f) => f.target === target && f.active)) {
      const col = headers(target, fields).indexOf('Field: ' + f.key) + 1;
      sheet.getCell(1, col).note =
        `${f.label} (${f.type}${f.required ? ', required' : ''})`;
      if (f.type === 'number') sheet.getColumn(col).numFmt = '0.########';
      if (f.type === 'checkbox')
        (
          sheet as ExcelJS.Worksheet & {
            dataValidations: {
              add: (
                range: string,
                validation: Partial<ExcelJS.DataValidation>,
              ) => void;
            };
          }
        ).dataValidations.add(
          `${sheet.getColumn(col).letter}2:${sheet.getColumn(col).letter}5001`,
          { type: 'list', allowBlank: !f.required, formulae: ['"TRUE,FALSE"'] },
        );
      if (
        f.type === 'dropdown' &&
        f.options.join(',').length < 250 &&
        !f.options.some((o) => /[,"]/.test(o))
      )
        (
          sheet as ExcelJS.Worksheet & {
            dataValidations: {
              add: (
                range: string,
                validation: Partial<ExcelJS.DataValidation>,
              ) => void;
            };
          }
        ).dataValidations.add(
          `${sheet.getColumn(col).letter}2:${sheet.getColumn(col).letter}5001`,
          {
            type: 'list',
            allowBlank: !f.required,
            formulae: ['"' + f.options.join(',') + '"'],
          },
        );
    }
    if (target === 'guest') {
      sheet.getCell('E1').note =
        'Category names or codes: ' +
        categories.map((c) => `${c.name} (${c.code})`).join(', ');
      const list = categories.map((c) => c.code).join(',');
      if (list.length && list.length < 250 && !/["\r\n]/.test(list))
        (
          sheet as ExcelJS.Worksheet & {
            dataValidations: {
              add: (
                range: string,
                validation: Partial<ExcelJS.DataValidation>,
              ) => void;
            };
          }
        ).dataValidations.add('E2:E5001', {
          type: 'list',
          allowBlank: true,
          formulae: ['"' + list + '"'],
        });
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
