import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client,ApiError,apiBase,SupersededRequest,freshness} from '../src/api.ts';
test('browser API configuration accepts HTTPS/loopback and rejects credential URLs',()=>{
  assert.equal(apiBase(''),'/api/v1');assert.equal(apiBase('https://api.example.test/api/v1/'),'https://api.example.test/api/v1');
  assert.equal(apiBase('https://europe-west1-demo-dream-events.cloudfunctions.net/api/api/v1'),'https://europe-west1-demo-dream-events.cloudfunctions.net/api/api/v1');
  for(const url of ['https://private:secret@api.example.test/api/v1','http://api.example.test/api/v1','https://api.example.test/wrong','https://api.example.test/api/v1?token=secret'])assert.throws(()=>apiBase(url));
});
test('API client uses bearer auth without cookies and supports errors and empty responses',async()=>{
  const original=globalThis.fetch;let expired=0;
  try{
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.example.test/api/v1/events');assert.equal(options.headers.Authorization,'Bearer synthetic');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response(JSON.stringify([{id:1}]),{status:200,headers:{'Content-Type':'application/json'}});};
    const client=new Client('https://api.example.test/api/v1','synthetic',()=>expired++);
    assert.deepEqual(await client.request('events'),[{id:1}]);
    globalThis.fetch=async()=>new Response(null,{status:204});assert.equal(await client.request('auth/logout','POST'),undefined);
    globalThis.fetch=async()=>new Response(JSON.stringify({message:'Expired'}),{status:401});await assert.rejects(client.request('events'),e=>e instanceof ApiError&&e.status===401);assert.equal(expired,1);
    await assert.rejects(client.request('https://other.example/api/v1'));await assert.rejects(client.request('../secrets'));
  }finally{globalThis.fetch=original;}
});
test('SPA routes reserve API and missing assets for real 404 responses',async()=>{
  const config=(await import('../vercel.json',{with:{type:'json'}})).default;
  assert.ok(!config.headers);assert.ok(config.routes.some(route=>route.handle==='filesystem'));
  const api=config.routes.find(r=>r.status===404&&new RegExp('^'+r.src+'$').test('/api/v1/events'));assert.ok(api);
  const assets=config.routes.find(r=>r.status===404&&new RegExp('^'+r.src+'$').test('/assets/missing.js'));assert.ok(assets);
  const spa=config.routes.find(r=>r.dest==='/index.html');assert.ok(new RegExp('^'+spa.src+'$').test('/events/7/settings'));assert.ok(!new RegExp('^'+spa.src+'$').test('/missing.png'));
});

test('both frontend hosts cache only versioned static assets and keep private/deep-link responses no-store',async()=>{
  const {readFile}=await import('node:fs/promises');
  for(const name of ['admin-web','scanner']){
    const config=JSON.parse(await readFile(new URL(`../../${name}/vercel.json`,import.meta.url),'utf8'));
    const headers=path=>Object.assign({},...config.routes.filter(r=>r.headers&&new RegExp('^'+r.src+'$').test(path)).map(r=>r.headers));
    assert.equal(headers('/assets/index-BRMfiWK0.js')['Cache-Control'],'public, max-age=31536000, immutable');
    for(const path of ['/assets/current.js','/events/7/tickets','/invitation','/api/v1/auth/me','/api/v1/events/7/attendees'])assert.equal(headers(path)['Cache-Control'],'no-store');
    assert.ok(config.routes.some(r=>r.status===404&&new RegExp('^'+r.src+'$').test('/api/v1/events')));
    assert.ok(config.routes.some(r=>r.status===404&&new RegExp('^'+r.src+'$').test('/assets/missing.js')));
  }
});

test('Excel transport keeps multipart boundaries and downloads binary responses',async()=>{
 const original=globalThis.fetch;const client=new Client('https://api.example.test/api/v1','synthetic');
 try{
  const form=new FormData();form.set('file',new Blob(['workbook']),'attendees.xlsx');
  globalThis.fetch=async(url,options)=>{assert.equal(options.body,form);assert.equal(options.headers['Content-Type'],undefined);assert.equal(options.credentials,'omit');return new Response(JSON.stringify({errors:[]}));};
  assert.deepEqual(await client.request('events/7/registration-import/preview','POST',form),{errors:[]});
  globalThis.fetch=async()=>new Response(new Uint8Array([80,75,3,4]));
  const file=await client.request('events/7/registration-template','GET',undefined,undefined,true);assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[80,75,3,4]);
 }finally{globalThis.fetch=original;}
});

test('private resource cache deduplicates, expires, invalidates and stays per session',async()=>{
 const original=globalThis.fetch, now=Date.now;let time=100000, calls=0, resolve;
 try{
  Date.now=()=>time;
  globalThis.fetch=()=>{calls++;return new Promise(r=>{resolve=r;});};
  const first=new Client('https://api.example.test/api/v1','user-a');
  const second=new Client('https://api.example.test/api/v1','user-b');
  const one=first.resource('events/7/registrations');
  const two=first.resource('events/7/registrations');
  assert.equal(calls,1);
  resolve(new Response(JSON.stringify([{id:7}])));
  assert.deepEqual(await one,await two);
  assert.equal(first.peekResource('events/7/registrations').fresh,true);
  assert.equal(second.peekResource('events/7/registrations'),undefined);
  await first.resource('events/7/registrations');assert.equal(calls,1);
  time+=11000;
  const stale=first.resource('events/7/registrations');assert.equal(calls,2);
  assert.equal(first.peekResource('events/7/registrations').fresh,false);
  resolve(new Response(JSON.stringify([{id:8}])));await stale;
  globalThis.fetch=async()=>new Response(null,{status:204});
  await first.request('events/7/guests','POST',{});
  assert.equal(first.peekResource('events/7/registrations'),undefined);
  assert.equal(second.peekResource('events/7/registrations'),undefined);
 }finally{globalThis.fetch=original;Date.now=now;}
});

test('auth and public responses are never cached and access denial clears private cache',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  const client=new Client('https://api.example.test/api/v1','synthetic');
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({ok:true}));};
  await client.resource('events');await client.resource('public/invitations');await client.resource('public/invitations');
  assert.equal(calls,3);assert.ok(client.peekResource('events'));
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'Denied'}),{status:403});
  await assert.rejects(client.request('events/7/private'));
  assert.equal(client.peekResource('events'),undefined);
 }finally{globalThis.fetch=original;}
});
test('late pre-mutation or signed-out responses cannot refill private cache or reach resource consumers',async()=>{
 const original=globalThis.fetch;
 try{
  const client=new Client('https://api.example.test/api/v1','private-user');let resolve;const notices=[];
  client.subscribe(reason=>notices.push(reason));
  globalThis.fetch=(_url,opts)=>opts.method==='GET'?new Promise(r=>resolve=r):Promise.resolve(new Response(null,{status:204}));
  const pending=client.resource('events/7/registrations');
  await client.request('events/7/guests','POST',{});
  resolve(Response.json({private:'old'}));await assert.rejects(pending,SupersededRequest);
  assert.equal(client.peekResource('events/7/registrations'),undefined);assert.deepEqual(notices,['mutation']);
  const logout=client.resource('events/8/registrations');client.clearResources('logout');resolve(Response.json({private:'signed out'}));
  await assert.rejects(logout,SupersededRequest);assert.equal(client.peekResource('events/8/registrations'),undefined);
 }finally{globalThis.fetch=original;}
});
test('freshness and bounded prefetch reduce repeated requests without sharing private event data',async()=>{
 const original=globalThis.fetch;let calls=0;const t=performance.now();
 try{
  globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,25));return Response.json({rows:[{id:1}]});};
  const client=new Client('https://api.example.test/api/v1','private-user');
  await Promise.all(Array.from({length:8},()=>client.resource('events/7/registrations/page')));
  assert.equal(calls,1);const coldMs=performance.now()-t,warmStart=performance.now();
  await Promise.all(Array.from({length:8},()=>client.resource('events/7/registrations/page')));
  const warmMs=performance.now()-warmStart;assert.equal(calls,1);assert.ok(warmMs<coldMs);
  client.prefetch('events/8/categories');await client.resource('events/8/categories');assert.equal(calls,2);
  assert.equal(client.peekResource('events/9/categories'),undefined);
  assert.ok(freshness('events/7/categories')>freshness('events/7/tickets/page'));
 }finally{globalThis.fetch=original;}
});
