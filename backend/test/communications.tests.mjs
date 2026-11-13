import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EmailService } from '../dist/email/email.service.js';
import { GmailProvider } from '../dist/email/gmail.provider.js';
import { unseal } from '../dist/common/encryption.util.js';
import { DeliveryService } from '../dist/tickets/delivery.service.js';
import { NotificationsService } from '../dist/email/notifications.service.js';
import { MobileTicketsService } from '../dist/tickets/mobile-tickets.service.js';
export function registerCommunicationsTests({ test, adminRequest: api, getDb, getApp, eventInput }) {
  test('Gmail notification producers preserve private recipients, transfer outcomes and optional PDF rollback',async()=>{
    const env={...process.env},db=getDb();
    try{
      Object.assign(process.env,{EMAIL_ENABLED:'true',EMAIL_PROVIDER:'gmail',EMAIL_FROM:'Dream Events <tickets@example.test>',GMAIL_MAILBOX:'tickets@example.test',
        GMAIL_CLIENT_ID:'synthetic',GMAIL_CLIENT_SECRET:'synthetic',GMAIL_REFRESH_TOKEN:'synthetic',GMAIL_MAX_PER_MINUTE:'60',PUBLIC_BASE_URL:'https://admin.example.test'});
      const ok=(r,status=201)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
      const event=ok(await api('events',{body:{...eventInput,name:'Gmail flow matrix',status:'Published'}})),base=`events/${event.id}`;
      const cat=ok(await api(base+'/categories',{body:{name:'Mail guests',code:'MAIL',allocation:30}}));
      ok(await api(base+'/entrances',{body:{name:'Mail gate',code:'MAIL',categoryIds:[cat.id]}}));
      ok(await api(base+'/settings',{method:'PATCH',body:{settings:{defaultCategoryId:cat.id,automaticTicketGeneration:true,perStudentLimit:10,transferApproval:'admin'}}}),200);
      const student=ok(await api(base+'/students',{body:{studentId:'MAIL-001',fullName:'Mail flow student',email:'mail-student@example.test'}}));
      const guest=ok(await api(base+'/guests',{body:{studentId:student.id,fullName:'Mail flow guest',email:'mail-guest@example.test',categoryId:cat.id}}));
      const attendee=await db.guestInvitation.findUniqueOrThrow({where:{id:guest.id}}),ticket=await db.ticket.findFirstOrThrow({where:{attendeeId:attendee.attendeeId}});
      const transferBody={recipientName:'New Mail Recipient',recipientEmail:'mail-new@example.test',reason:'Synthetic mail transfer'};
      let transfer=ok(await api(base+`/tickets/${ticket.id}/transfers`,{body:transferBody}));
      ok(await api(base+`/transfers/${transfer.transferId}/reject`,{body:{reason:'Synthetic rejection reason'}}),200);
      transfer=ok(await api(base+`/tickets/${ticket.id}/transfers`,{body:transferBody}));
      const mobile=ok(await api(base+`/tickets/${ticket.id}/mobile-link`,{body:{confirmed:true,reason:'Synthetic cancellation link'}}));
      await getApp().get(MobileTicketsService).cancelTransfer(mobile.path.split('#')[1]);
      transfer=ok(await api(base+`/tickets/${ticket.id}/transfers`,{body:transferBody}));
      const delivery=getApp().get(DeliveryService),queue=delivery.queue;
      try{
        delivery.queue=async(tx)=>{
          await tx.auditLog.create({data:{eventId:event.id,action:'synthetic.optional_mail_write'}});
          // A real PostgreSQL error aborts the subtransaction, not only a JS exception.
          await tx.$executeRawUnsafe('SELECT 1/0');
        };
        ok(await api(base+`/transfers/${transfer.transferId}/approve`,{body:{confirmed:true}}),200);
      }finally{delivery.queue=queue;}
      assert.equal(await db.auditLog.count({where:{eventId:event.id,action:'synthetic.optional_mail_write'}}),0);
      assert.equal(await db.auditLog.count({where:{eventId:event.id,action:'ticket.transfer_pdf_email_not_queued'}}),1);
      const approved=await db.ticketTransfer.findUniqueOrThrow({where:{id:transfer.transferId}});
      assert.equal(approved.status,'Approved');assert.equal((await db.ticket.findUniqueOrThrow({where:{id:ticket.id}})).status,'Cancelled');
      const jobs=await db.backgroundJob.findMany({where:{eventId:event.id,kind:'gmail.email'}}),payloads=jobs.map(j=>JSON.parse(unseal(j.payload)));
      assert.ok(payloads.every(p=>p.to.length===1));assert.ok(payloads.some(p=>p.subject.includes('guest registration saved')));
      assert.ok(payloads.some(p=>p.subject.includes('awaiting approval')));assert.ok(payloads.some(p=>p.subject.includes('transfer rejected')));
      assert.ok(payloads.some(p=>p.subject.includes('transfer request cancelled')));
      assert.ok(payloads.some(p=>p.subject.includes('ticket transferred')));
      const privateLink=payloads.find(p=>p.subject.includes('your transferred ticket'));
      assert.deepEqual(privateLink.to,['mail-new@example.test']);assert.match(privateLink.text,/\/ticket#DEM1\./);
      assert.equal(privateLink.capability.kind,'ticket');assert.ok(payloads.some(p=>p.attachments?.[0]?.filename.endsWith('.pdf')));
      assert.ok(jobs.every(j=>!j.payload.includes('DEM1.')&&!j.payload.includes('mail-new@example.test')));
      const guest2=ok(await api(base+'/guests',{body:{studentId:student.id,fullName:'Cancelled mail guest',email:'mail-cancel@example.test',categoryId:cat.id}}));
      ok(await api(base+`/guests/${guest2.id}/cancel`,{body:{confirmed:true,reason:'Synthetic guest cancellation'}}),200);
      assert.ok((await db.backgroundJob.findMany({where:{eventId:event.id}})).map(j=>JSON.parse(unseal(j.payload))).some(p=>p.subject?.includes('registration cancelled')));
      const profile=await db.securityProfile.findUniqueOrThrow({where:{userId:1}});
      await db.securityProfile.update({where:{userId:1},data:{email:'security-only@example.test',emailVerified:true}});
      try{await db.$transaction(tx=>getApp().get(NotificationsService).account(tx,1,'Synthetic account security notice','matrix-security'));}
      finally{await db.securityProfile.update({where:{userId:1},data:{email:profile.email,emailVerified:profile.emailVerified}});}
      const security=await db.backgroundJob.findFirstOrThrow({where:{eventId:null,kind:'gmail.email'},orderBy:{id:'desc'}});
      assert.deepEqual(JSON.parse(unseal(security.payload)).to,['security-only@example.test']);
      await getApp().get(MobileTicketsService).cancelTicket(privateLink.text.split('#')[1].split('\n')[0],{action:'cancel',confirmed:true,requestKey:randomUUID(),reason:'Synthetic transferred ticket cancellation'});
      assert.ok((await db.backgroundJob.findMany({where:{eventId:event.id}})).map(j=>JSON.parse(unseal(j.payload))).some(p=>p.subject?.includes('ticket cancelled')));
      const provider=getApp().get(GmailProvider),send=provider.send;let accepted=0;
      try{provider.send=async()=>`gmail:matrix-${++accepted}`;for(let i=0;i<100&&await getApp().get(EmailService).tick();i++);}
      finally{provider.send=send;}
      assert.ok(accepted>0);assert.equal(await db.backgroundJob.count({where:{eventId:event.id,status:{in:['Pending','Running']}}}),0);
    }finally{process.env=env;}
  });
  test('communications review detects stale recipients, deduplicates retries and protects announcement history', async () => {
    const db = getDb(), env = { ...process.env };
    try {
      Object.assign(process.env, { EMAIL_ENABLED:'true',EMAIL_PROVIDER:'gmail',EMAIL_FROM:'Dream Events <tickets@example.test>',GMAIL_MAILBOX:'tickets@example.test',
        GMAIL_CLIENT_ID:'synthetic',GMAIL_CLIENT_SECRET:'synthetic',GMAIL_REFRESH_TOKEN:'synthetic',GMAIL_MAX_PER_MINUTE:'60',PUBLIC_BASE_URL:'https://admin.example.test' });
      const created = await api('events',{body:{...eventInput,name:'Communications test'}}); assert.equal(created.status,201);
      const eventId = created.body.id, base = `events/${eventId}`;
      const student = await db.student.create({data:{eventId,studentId:'001',fullName:'Communication student',email:'first@example.test',phone:''}});
      const message = {subject:'Event notice',text:'Plain text <script> cannot become executable HTML.',audience:'students'};
      const review = await api(base+'/announcements/preview',{body:message}); assert.equal(review.status,201);
      assert.deepEqual(review.body.recipients,['first@example.test']);
      await db.student.create({data:{eventId,studentId:'002',fullName:'Second student',email:'second@example.test',phone:''}});
      const stale = await api(base+'/announcements',{body:{...message,confirmed:true,digest:review.body.digest,requestKey:randomUUID()}});
      assert.equal(stale.status,409);
      const fresh = await api(base+'/announcements/preview',{body:message});
      const body = {...message,confirmed:true,digest:fresh.body.digest,requestKey:randomUUID()};
      const queued = await api(base+'/announcements',{body}); assert.equal(queued.status,201,JSON.stringify(queued.body)); assert.equal(queued.body.queued,2);
      assert.deepEqual((await api(base+'/announcements',{body})).body,queued.body);
      assert.equal((await api(base+'/announcements',{body:{...body,text:'Changed message'}})).status,409);
      const history = await api(base+'/announcements'); assert.equal(history.body[0].recipients,2); assert.equal(history.body[0].states.Pending,2);
      await assert.rejects(db.$executeRaw`UPDATE event_communications SET recipient_count=0 WHERE event_id=${eventId}`);
      const job = await db.backgroundJob.findUniqueOrThrow({where:{id:queued.body.jobIds[0]}});
      assert.ok(!job.payload.includes('<script>')); assert.match(JSON.parse(unseal(job.payload)).html,/&lt;script&gt;/);
      assert.equal((await api('events/999999/announcements/preview',{body:message})).status,403);
      process.env.EMAIL_ENABLED='false';
      assert.equal((await api(base+'/announcements',{body:{...body,requestKey:randomUUID()}})).status,400);
      // An operator must explicitly review link email recipients before rotating and queuing.
      process.env.EMAIL_ENABLED='true';
      const linkBody = {confirmed:true,reason:'Review synthetic recipient',email:true,requestKey:randomUUID()};
      const linkBase = base+`/students/${student.id}/invitation-links`;
      const link = await api(linkBase,{body:linkBody}); assert.equal(link.status,201,JSON.stringify(link.body));
      assert.deepEqual((await api(linkBase,{body:linkBody})).body,link.body);
      assert.equal(await db.publicInvitationLink.count({where:{eventId}}),1);
      const invitationJob = await db.backgroundJob.findFirstOrThrow({where:{eventId,kind:'gmail.email',id:{notIn:queued.body.jobIds}}});
      assert.match(JSON.parse(unseal(invitationJob.payload)).text,/https:\/\/admin\.example\.test\/invitation#DEI1\./);
      await api(linkBase,{body:{confirmed:true,reason:'Rotate private test link'}});
      const provider = getApp().get(GmailProvider), send = provider.send; let sends=0;
      try {
        provider.send=async()=> 'gmail:communication-'+(++sends);
        const mail = getApp().get(EmailService);
        for(let i=0;i<10 && await mail.tick();i++);
        assert.equal((await db.backgroundJob.findUniqueOrThrow({where:{id:invitationJob.id}})).lastError,'private_link_expired_or_revoked');
        assert.equal(sends,2);
        assert.equal((await api(base+'/cancel',{method:'POST'})).status,204);
        for(let i=0;i<15 && await mail.tick();i++);
        const expanded = await db.backgroundJob.findFirstOrThrow({where:{eventId,kind:'gmail.expand'}});
        assert.equal(expanded.status,'Sent');
        const notices = await db.backgroundJob.findMany({where:{eventId,kind:'gmail.email',id:{notIn:[...queued.body.jobIds,invitationJob.id]}}});
        assert.equal(notices.length,2); assert.ok(notices.every(j=>j.status==='Sent'));
      } finally {provider.send=send;}
    } finally {process.env=env;}
  });
}
