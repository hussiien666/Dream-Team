import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
export function registerRegistrationFormTests({test,adminRequest:api,request,getDb:db,eventInput}){
  const ok=(r,status=201)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
  async function setup(name,limit=3,capacity=20,allocation=capacity){
    const e=ok(await api('events',{body:{...eventInput,name,status:'Published',capacity,maxTickets:capacity}})),base=`events/${e.id}`;
    const c=ok(await api(base+'/categories',{body:{name:'Permitted guests',code:'FORM',allocation}}));
    ok(await api(base+'/settings',{method:'PATCH',body:{settings:{perStudentLimit:limit,defaultCategoryId:c.id,automaticTicketGeneration:false}}}),200);
    const s=ok(await api(base+'/students',{body:{studentId:'FORM-001',fullName:'Eligible student',email:'eligible@example.test'}}));
    const link=ok(await api(base+`/students/${s.id}/invitation-links`,{body:{confirmed:true,reason:'Private registration form'}}));
    return{e,c,s,base,token:link.path.split('#')[1]};
  }
  const body=(f,n,key=randomUUID())=>({action:'register',requestKey:key,confirmed:true,quantity:n,
    student:{fullName:'Updated eligible student',email:'eligible@example.test',phone:'+201000000',customValues:{}},
    guests:Array.from({length:n},(_,i)=>({fullName:'Form guest '+i,email:`guest${i}@example.test`,categoryId:f.c.id,phone:'',customValues:{}}))});
  const call=(f,b)=>request('public/invitations',{token:f.token,body:b});
  test('registration form uses configured guest allowances 1, 2 and 3, preserves eligibility and rejects excess atomically',async()=>{
    for(const limit of [1,2,3]){
      const f=await setup('Quantity limit '+limit,limit);
      const view=ok(await request('public/invitations',{token:f.token}),200);assert.equal(view.quantityIncludesStudent,false);assert.equal(view.guestLimit,limit);
      assert.equal((await request('public/invitations',{token:'FORM-001'})).status,401);
      assert.equal((await call(f,body(f,limit+1))).status,400);assert.equal(await db().guestInvitation.count({where:{eventId:f.e.id}}),0);
      const input=body(f,limit);const results=await Promise.all([call(f,input),call(f,input)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results[0].body,results[1].body);
      assert.equal(await db().guestInvitation.count({where:{eventId:f.e.id}}),limit);assert.equal(await db().ticket.count({where:{eventId:f.e.id}}),0);
      assert.equal((await db().student.findUniqueOrThrow({where:{id:f.s.id}})).studentId,'FORM-001');
      assert.equal((await call(f,{...body(f,1),guests:[{...body(f,1).guests[0],email:'one-too-many@example.test'}]})).status,400);
      assert.equal((await call(f,{...input,quantity:0})).status,409);
      assert.equal((await call(f,{...body(f,0),student:{...input.student,guestLimit:999}})).status,400);
    }
  });
  test('public batch profile/custom-field amendments are owned, deadline-bound and preserve existing QR identity',async()=>{
    const f=await setup('Own registration amendments'),other=await setup('Other registration');
    const studentField=ok(await api(f.base+'/registration-fields',{body:{target:'student',key:'course',label:'Course',type:'text',required:true}}));
    assert.ok(studentField.id);
    ok(await api(f.base+'/registration-fields',{body:{target:'guest',key:'meal',label:'Meal',type:'dropdown',options:['Normal','Vegetarian'],required:true}}));
    assert.equal((await call(f,body(f,1))).status,400);
    const input=body(f,2);input.student.customValues={course:'Engineering'};input.guests.forEach(g=>g.customValues={meal:'Normal'});
    const saved=ok(await call(f,input),200),guest=await db().guestInvitation.findUniqueOrThrow({where:{id:saved.guestIds[0]}});
    const cross={...body(other,1),guests:[{...input.guests[0],id:guest.id,categoryId:other.c.id}]};assert.equal((await call(other,cross)).status,404);
    const amend={...body(f,1),student:input.student,guests:[{...input.guests[0],id:guest.id,fullName:'Amended guest'}]};
    assert.equal((await call(f,amend)).status,200);assert.equal((await db().attendee.findUniqueOrThrow({where:{id:guest.attendeeId}})).fullName,'Amended guest');
    // Existing issue engine remains the authority, and amendments preserve the QR.
    ok(await api(f.base+'/entrances',{body:{name:'Form gate',code:'FORM',categoryIds:[f.c.id]}}));
    ok(await api(f.base+'/tickets/batch-issue',{body:{attendeeIds:[guest.attendeeId],requestKey:randomUUID()}}));
    const ticket=await db().ticket.findFirstOrThrow({where:{attendeeId:guest.attendeeId}});
    assert.equal((await call(f,{...amend,requestKey:randomUUID(),guests:[{...amend.guests[0],fullName:'Amended after issuance'}]})).status,200);
    assert.equal((await db().ticket.findUniqueOrThrow({where:{id:ticket.id}})).tokenHash,ticket.tokenHash);
    await db().event.update({where:{id:f.e.id},data:{registrationDeadline:new Date(Date.now()-1000)}});
    assert.equal((await call(f,{...amend,requestKey:randomUUID()})).status,400);
  });
  test('public registrations reserve event/category places without auto-issuance and serialize competing students',async()=>{
    const f=await setup('Capacity race',3,2,2);
    const s=ok(await api(f.base+'/students',{body:{studentId:'FORM-002',fullName:'Competing student',email:'competing@example.test'}}));
    const link=ok(await api(f.base+`/students/${s.id}/invitation-links`,{body:{confirmed:true,reason:'Competing private form'}}));
    const second={...f,token:link.path.split('#')[1]},one=body(f,2),two=body(second,2);two.guests.forEach((g,i)=>g.email=`competing${i}@example.test`);
    const results=await Promise.all([call(f,one),call(second,two)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
    assert.equal(await db().attendee.count({where:{eventId:f.e.id}}),2);assert.equal(await db().ticket.count({where:{eventId:f.e.id}}),0);
    const category=await setup('Category places',3,10,1);assert.equal((await call(category,body(category,2))).status,400);
    assert.equal(await db().attendee.count({where:{eventId:category.e.id}}),0);
    const bad=body(category,1);bad.quantity=2;assert.equal((await call(category,bad)).status,400);
  });
  test('pagination bounds private results, scopes cursors, and reduces registration response size',async()=>{
    const f=await setup('Pagination benchmark',3,1000,1000),count=220;
    const students=await db().student.createManyAndReturn({data:Array.from({length:count},(_,i)=>({eventId:f.e.id,studentId:'BENCH-'+i,fullName:'Benchmark student '+i,email:`bench-${i}@example.test`,phone:''})),select:{id:true}});
    const attendees=await db().attendee.createManyAndReturn({data:students.map((s,i)=>({eventId:f.e.id,categoryId:f.c.id,fullName:'Benchmark guest '+i,email:`bench-guest-${i}@example.test`,phone:''})),select:{id:true}});
    await db().guestInvitation.createMany({data:students.map((s,i)=>({eventId:f.e.id,studentId:s.id,attendeeId:attendees[i].id,matchKey:String(i).padStart(64,'0'),email:`bench-guest-${i}@example.test`,customValues:{}}))});
    const t0=performance.now(),old=ok(await api(f.base+'/registrations'),200),legacyMs=performance.now()-t0;
    const t1=performance.now(),page=ok(await api(f.base+'/registrations/page?kind=guests&status=active&search='),200),pagedMs=performance.now()-t1;
    assert.equal(page.guests.length,50);assert.equal(page.students.length,50);assert.ok(page.nextAfter);
    const next=ok(await api(f.base+`/registrations/page?kind=guests&status=active&after=${page.nextAfter}`),200);assert.ok(next.guests.every(g=>g.id>page.nextAfter));
    const bytes=Buffer.byteLength(JSON.stringify(old)),pagedBytes=Buffer.byteLength(JSON.stringify(page));assert.ok(pagedBytes<bytes*.35);
    assert.equal((await api(f.base+'/registrations/page?kind=guests&after=-1')).status,400);
    assert.equal((await api('events/2147483600/registrations/page?kind=guests')).status,403);
    const candidate=ok(await api(f.base+'/tickets/candidates/page'),200);assert.equal(candidate.rows.length,50);
    const independents=ok(await api(f.base+'/attendees/independent/page'),200);assert.equal(independents.rows.length,0);
    mkdirSync('../tmp',{recursive:true});writeFileSync('../tmp/registration-performance.json',JSON.stringify({fixtureStudents:count,fixtureGuests:count,legacyBytes:bytes,pagedBytes,legacyMs,pagedMs,retainedRatio:pagedBytes/bytes},null,2));
  });
}
