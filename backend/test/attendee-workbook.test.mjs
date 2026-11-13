import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {readAttendees,attendeeTemplate,attendeeColumns} from '../dist/attendees/attendee-workbook.js';
test('independent attendee template preserves Text IDs and mailto links while rejecting formulas/external links',async()=>{
  const bytes=await attendeeTemplate([{name:'Guest',code:'G'}]);const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  const sheet=book.getWorksheet('Attendees');sheet.getRow(2).values=['Example',{text:'example@example.test',hyperlink:'mailto:example@example.test'},'+010000','00042','','G',''];
  const imported=await readAttendees(Buffer.from(await book.xlsx.writeBuffer()),'attendees.xlsx');
  assert.equal(imported.length,1);assert.equal(imported[0].data.identityNumber,'00042');assert.equal(imported[0].data.phone,'+010000');
  sheet.getCell('D2').value=42;await assert.rejects(readAttendees(Buffer.from(await book.xlsx.writeBuffer()),'attendees.xlsx'),/Text/);
  sheet.getCell('D2').value='00042';sheet.getCell('G2').value={formula:'1+1',result:2};await assert.rejects(readAttendees(Buffer.from(await book.xlsx.writeBuffer()),'attendees.xlsx'),/formulas/);
  sheet.getCell('G2').value={text:'unsafe',hyperlink:'https://example.test/'};await assert.rejects(readAttendees(Buffer.from(await book.xlsx.writeBuffer()),'attendees.xlsx'),/External|external/);
});
test('CSV handles quoted names/newlines and familiar headings and rejects malformed, duplicate and oversized inputs',async()=>{
  const rows=await readAttendees(Buffer.from('Name,E-mail,Mobile,StudentID,Category,Notes\r\n"Example, Person",person@example.test,+0100,00042,G,"two\nlines"\r\n'),'attendees.csv');
  assert.equal(rows[0].data.fullName,'Example, Person');assert.equal(rows[0].data.identityNumber,'00042');assert.equal(rows[0].data.notes,'two\nlines');
  await assert.rejects(readAttendees(Buffer.from('Name,Full name\na,b'),'duplicate.csv'),/headings/);
  await assert.rejects(readAttendees(Buffer.from('Name,Email\n"broken,x'),'broken.csv'),/quote/);
  await assert.rejects(readAttendees(Buffer.from('Name,Email\n=HYPERLINK(1),x@example.test'),'formula.csv'),/formulas/);
  await assert.rejects(readAttendees(Buffer.alloc(10*1024*1024+1),'large.csv'),/10 MB/);
});
test('explicit column matching retains source rows and refuses ambiguous or out-of-range mappings',async()=>{
  const buffer=Buffer.from('Person,Private ID,Contact\nMapped person,00017,mapped@example.test');
  assert.deepEqual((await attendeeColumns(buffer,'mapped.csv')).headers,['Person','Private ID','Contact']);
  const rows=await readAttendees(buffer,'mapped.csv',{fullName:0,identityNumber:1,email:2});
  assert.equal(rows[0].row,2);assert.equal(rows[0].data.identityNumber,'00017');
  await assert.rejects(readAttendees(buffer,'mapped.csv',{fullName:0,email:0}),/different/);
  await assert.rejects(readAttendees(buffer,'mapped.csv',{fullName:5}),/different/);
});
