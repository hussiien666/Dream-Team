import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export function registerAttendeeTests({test,adminRequest:api,verifiedLogin,getOrigin,getDb,eventInput}) {
  test('independent attendees serialize duplicates, preserve identifiers and atomically import/export legacy spreadsheets',async()=>{
    const e=await api('events',{body:{...eventInput,name:'Independent attendee test'}});assert.equal(e.status,201);
    const base=`events/${e.body.id}`,c=await api(base+'/categories',{body:{name:'Independent',code:'IND',allocation:30}});assert.equal(c.status,201);
    for(const body of [{fullName:' ',categoryId:c.body.id,email:'x@example.test'},{fullName:'Valid name',categoryId:c.body.id,email:'bad'},{fullName:'Valid name',categoryId:3,email:'x@example.test'},{fullName:'Valid name',categoryId:c.body.id,email:'x@example.test',organizationId:2}])
      assert.equal((await api(base+'/attendees',{body})).status,400);
    const body={fullName:'Original attendee',categoryId:c.body.id,email:'Original@Example.test',identityNumber:'0001'};
    const concurrent=await Promise.all([api(base+'/attendees',{body}),api(base+'/attendees',{body})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,400]);
    const attendee=concurrent.find(r=>r.status===201).body;
    assert.equal(attendee.identityNumber,'0001');assert.equal(attendee.email,'original@example.test');
    assert.equal((await api(base+'/attendees/'+attendee.id,{method:'PATCH',body:{categoryId:3}})).status,400);
    assert.equal((await api(base+'/attendees/'+attendee.id,{method:'PATCH',body:{email:null}})).status,200);
    await getDb().ticketCategory.update({where:{id:c.body.id},data:{active:false}});
    assert.equal((await api(base+'/attendees/'+attendee.id,{method:'PATCH',body:{fullName:'Updated retained attendee'}})).status,200);
    assert.equal((await api(base+'/attendees',{body:{...body,email:'new-inactive@example.test',identityNumber:'new'}})).status,400);
    await getDb().ticketCategory.update({where:{id:c.body.id},data:{active:true}});
    const token=await verifiedLogin(),headers={Authorization:'Bearer '+token};
    const csv='Full name,Email address,Phone number,Student / National ID,Ticket category,Notes\r\nImported person,imported@example.test,+0100,00042,IND,Safe text\r\nSecond person,second-import@example.test,+0200,00043,IND,Other';
    const upload=async(file,commit,extra={})=>{const data=new FormData();data.set('file',new Blob([file],{type:'text/csv'}),'legacy.csv');for(const[k,v]of Object.entries(extra))data.set(k,v);const r=await fetch(`${getOrigin()}/api/v1/${base}/attendees/import/${commit?'commit':'preview'}`,{method:'POST',headers,body:data});return{status:r.status,body:await r.json()};};
    const preview=await upload(csv,false);assert.equal(preview.status,201);assert.equal(preview.body.errorCount,0);assert.equal(preview.body.count,2);
    const confirmation={requestKey:randomUUID(),previewHash:preview.body.previewHash,confirmed:'true'};
    assert.equal((await upload(csv,true,confirmation)).body.created,2);assert.equal((await upload(csv,true,confirmation)).body.created,2);
    assert.equal(await getDb().attendee.count({where:{eventId:e.body.id}}),3);
    const duplicate=await upload(csv,false);assert.equal(duplicate.body.errorCount,2);
    assert.equal((await upload(csv,true,{...confirmation,requestKey:randomUUID()})).status,400);
    const exported=await fetch(`${getOrigin()}/api/v1/${base}/attendees/export/csv?search=Imported&status=Registered`,{headers});assert.equal(exported.status,200);assert.match(await exported.text(),/00042/);
    const xlsx=await fetch(`${getOrigin()}/api/v1/${base}/attendees/export/xlsx`,{headers});assert.equal(xlsx.status,200);assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0,2).toString(),'PK');
    const custom='Person,Private ID,Contact\nExplicitly mapped person,00099,mapped-api@example.test',options=JSON.stringify({mapping:{fullName:0,identityNumber:1,email:2},defaultCategoryId:c.body.id});
    const mapped=await upload(custom,false,{options});assert.equal(mapped.status,201);assert.equal(mapped.body.errorCount,0);assert.equal(mapped.body.count,1);
    const mappedKey=randomUUID();assert.equal((await upload(custom,true,{options,requestKey:mappedKey,confirmed:'true',previewHash:mapped.body.previewHash})).body.created,1);
    assert.equal((await upload(custom,true,{options,requestKey:mappedKey,confirmed:'true',previewHash:mapped.body.previewHash})).body.created,1);
    assert.equal((await dbRow()).identityNumber,'00099');
    async function dbRow(){return getDb().attendee.findFirstOrThrow({where:{eventId:e.body.id,email:'mapped-api@example.test'}});}
    assert.equal((await api(base+'/attendees/'+attendee.id+'/cancel',{method:'POST'})).status,204);
    assert.equal((await getDb().attendee.findUnique({where:{id:attendee.id}})).status,'Cancelled');
  });
}
