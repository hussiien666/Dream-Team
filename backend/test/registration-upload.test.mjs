import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistrationUpload } from '../dist/students/registration-upload.js';
async function encoded(form) {
  const request = new Request('http://127.0.0.1/', { method: 'POST', body: form });
  return [Buffer.from(await request.arrayBuffer()), { 'content-type': request.headers.get('content-type') }];
}
test('Firebase raw uploads preserve file bytes and confirmed import fields', async () => {
  const form = new FormData(); form.set('file', new Blob(['synthetic-workbook']), 'students.xlsx');
  form.set('requestKey', 'synthetic-request'); form.set('previewHash', 'a'.repeat(64)); form.set('confirmed', 'true'); form.set('overrideReason', 'Manager-approved override');
  const result = await parseRegistrationUpload(...await encoded(form));
  assert.equal(result.file.buffer.toString(), 'synthetic-workbook'); assert.equal(result.file.originalname, 'students.xlsx');
  assert.equal(result.body.confirmed, 'true'); assert.equal(result.body.overrideReason, 'Manager-approved override');
});
test('Firebase raw uploads reject duplicate fields, extra files, truncation and oversize', async () => {
  const duplicate = new FormData(); duplicate.append('confirmed', 'true'); duplicate.append('confirmed', 'false');
  await assert.rejects(parseRegistrationUpload(...await encoded(duplicate)));
  const files = new FormData(); files.append('file', new Blob(['one']), 'one.xlsx'); files.append('file', new Blob(['two']), 'two.xlsx');
  await assert.rejects(parseRegistrationUpload(...await encoded(files)));
  await assert.rejects(parseRegistrationUpload(Buffer.from('incomplete'), { 'content-type': 'multipart/form-data; boundary=missing' }));
  await assert.rejects(parseRegistrationUpload(Buffer.alloc(10 * 1024 * 1024 + 65537), { 'content-type': 'multipart/form-data; boundary=large' }));
});
