// Browser regression checks use synthetic API responses and never contact a database.
import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../admin-web/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('../../scanner/dist/', import.meta.url));
let server, browser, origin;
before(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, pathname.replace(/^\/scan\//, '') || 'index.html');
    if (!pathname.startsWith('/scan/') || !file.startsWith(resolve(root) + sep)) {res.writeHead(404).end(); return;}
    try {
      const data = await readFile(file);
      res.setHeader('Content-Type', {'.html':'text/html', '.js':'text/javascript', '.css':'text/css'}[extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath: process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
});
after(async () => {await browser?.close(); if (server) await new Promise(r => server.close(r));});

async function pageFor(t, handler) {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  t.after(() => context.close());
  const page = await context.newPage();
  await page.route('**/api/v1/scanner/**', handler);
  await page.goto(origin + '/scan/');
  return page;
}
async function fill(page) {
  await page.getByLabel('Username', {exact:true}).fill('synthetic_scanner');
  await page.getByLabel('Password', {exact:true}).fill('synthetic-password');
  await page.getByLabel('Event access code', {exact:true}).fill('SYNTHETIC');
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
}
const json = (route, status, value) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(value)});

test('scanner shows rejected sign-in instead of silently resetting the form', async t => {
  const page = await pageFor(t, route => json(route,401,{message:'Invalid credentials, event code, or locked account.'}));
  await fill(page);
  await page.getByRole('alert').filter({hasText:'Invalid credentials, event code, or locked account.'}).waitFor();
  assert.equal(await page.getByLabel('Username', {exact:true}).inputValue(), 'synthetic_scanner');
  assert.equal(await page.getByRole('button', {name:'Sign in', exact:true}).isEnabled(), true);
});
test('scanner expires a temporary-password challenge with visible feedback and a fresh sign-in form', async t => {
  const page = await pageFor(t, route => route.request().url().endsWith('/login')
    ? json(route,200,{requiresPasswordChange:true,challenge:'x'.repeat(43)})
    : json(route,401,{message:'Password challenge expired. Sign in again.'}));
  await fill(page);
  await page.getByLabel('New password', {exact:true}).fill('synthetic-new-password');
  await page.getByRole('button', {name:'Save and sign in', exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Password challenge expired.'}).waitFor();
  assert.equal(await page.getByLabel('Username', {exact:true}).isVisible(), true);
  assert.equal(await page.getByLabel('New password', {exact:true}).count(), 0);
});
test('scanner clears previous rejection and loads the event on successful retry', async t => {
  let attempts = 0;
  const page = await pageFor(t, route => {
    if (route.request().url().endsWith('/login')) return ++attempts === 1
      ? json(route,401,{message:'Rejected first attempt'})
      : json(route,200,{requiresPasswordChange:false,token:'t'.repeat(43)});
    return json(route,200,{staff:'Synthetic staff',event:{name:'Synthetic scanner event',eventDate:'2035-01-01',status:'Upcoming',venue:'Test hall'},entrances:[{id:1,name:'Gate'}],entranceId:null,preferences:{successSound:true,rejectionSound:true,successVibration:true,rejectionVibration:true},accepted:0,rejected:0,total:0,checked:0,remaining:0,recent:[]});
  });
  await fill(page); await page.getByRole('alert').waitFor();
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
  await page.getByRole('heading', {name:'Synthetic scanner event', exact:true}).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
});
test('scanner state rejection removes its saved session and explains why', async t => {
  const page = await pageFor(t, route => json(route,401,{message:'Scanner authorization is no longer valid. Sign in again with a valid event code.'}));
  await page.evaluate(() => sessionStorage.setItem('aast-scanner-token','s'.repeat(43)));
  await page.reload();
  await page.getByRole('alert').filter({hasText:'Scanner authorization is no longer valid.'}).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('aast-scanner-token')), null);
  assert.equal(await page.getByLabel('Username', {exact:true}).isVisible(), true);
});
