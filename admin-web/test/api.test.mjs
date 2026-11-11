import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client,ApiError,apiBase} from '../src/api.ts';
test('browser API configuration accepts HTTPS/loopback and rejects credential URLs',()=>{
  assert.equal(apiBase(''),'/api/v1');assert.equal(apiBase('https://api.example.test/api/v1/'),'https://api.example.test/api/v1');
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
