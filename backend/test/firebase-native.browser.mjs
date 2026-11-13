import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../../admin-web/node_modules/playwright-core/index.mjs';
export async function runFirebaseNativeBrowser(origin, email, password) {
  const probe=createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port; await new Promise(r=>probe.close(r)); const web=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[path.resolve('../admin-web/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port)],{
    cwd:path.resolve('../admin-web'),stdio:'ignore',env:{...process.env,VITE_API_URL:origin+'/api/v1',VITE_FIREBASE_AUTH_BRIDGE:'false',VITE_FIREBASE_AUTH_NATIVE:'true',
      VITE_FIREBASE_PROJECT_ID:'demo-dream-events',VITE_FIREBASE_API_KEY:'synthetic-emulator-key',VITE_FIREBASE_AUTH_DOMAIN:'demo-dream-events.firebaseapp.com',VITE_FIREBASE_AUTH_EMULATOR_URL:'http://127.0.0.1:9099'} });
  let browser;
  try {
    let ready=false;
    for(let i=0;i<100;i++){assert.equal(child.exitCode,null);try{if((await fetch(web)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
    assert.ok(ready); browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:430,height:932}});
    await page.goto(web+'/events'); await page.getByLabel('Email or legacy username',{exact:true}).fill(email);
    await page.getByRole('button',{name:'Forgot password',exact:true}).click();
    await page.getByText('If this email is registered, Firebase will send password reset instructions.',{exact:true}).waitFor();
    await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.getByRole('heading',{name:'Events',exact:true}).waitFor();
    await page.getByRole('link',{name:'Account security',exact:true}).click(); await page.getByRole('heading',{name:'Firebase account',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Current password',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Send password reset email',exact:true}).click();
    await page.getByText('Firebase will send password reset instructions. Existing sessions expire after reset.',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await mkdir('../tmp/browser-tests',{recursive:true}); await page.screenshot({path:'../tmp/browser-tests/firebase-native-account.png',fullPage:true});
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('dialog',{name:'Sign out',exact:true}).getByRole('button',{name:'Confirm'}).click();
    await page.getByRole('heading',{name:'Administrator sign in',exact:true}).waitFor();
  } finally {await browser?.close();child.kill('SIGTERM');}
}
