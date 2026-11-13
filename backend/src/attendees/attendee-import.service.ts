import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { attendeeInput } from './attendees.service.js';
import { readAttendees, attendeeTemplate, attendeeColumns } from './attendee-workbook.js';
import { parse, hash } from '../students/validation.js';
import type { AuthenticatedRequest } from '../common/request.js';
import ExcelJS from 'exceljs';
@Injectable()
export class AttendeeImportService {
  constructor(private readonly db:PrismaService,private readonly events:EventsService) {}
  async columns(eventId:number,file:{buffer:Buffer;originalname:string}|undefined,r:AuthenticatedRequest) {
    await this.events.assertAccess(eventId,r.user.id,r.orgRole,r.orgId,'attendees.manage');
    if(!file)throw new BadRequestException('Choose an attendee file.');
    return attendeeColumns(file.buffer,file.originalname);
  }
  async exportFile(eventId:number,format:string,query:unknown,r:AuthenticatedRequest) {
    await this.events.assertAccess(eventId,r.user.id,r.orgRole,r.orgId,'attendees.manage');
    await this.events.assertAccess(eventId,r.user.id,r.orgRole,r.orgId,'exports.create');
    if(!['csv','xlsx'].includes(format))throw new BadRequestException('Choose CSV or Excel.');
    const q=parse(z.object({search:z.string().max(200).default(''),status:z.enum(['all','Registered','Cancelled']).default('all')}).strict(),query);
    const records=await this.db.attendee.findMany({where:{eventId,guestInvitation:{is:null},...(q.status==='all'?{}:{status:q.status}),...(q.search?{OR:[{fullName:{contains:q.search,mode:'insensitive'}},{email:{contains:q.search,mode:'insensitive'}},{identityNumber:{contains:q.search}},{phone:{contains:q.search}},{tickets:{some:{number:{contains:q.search,mode:'insensitive'}}}}]}:{})},include:{category:{select:{name:true}}},orderBy:{id:'asc'},take:10001});
    if(records.length>10000)throw new BadRequestException('Narrow the export to 10,000 attendees or fewer.');
    const clean=(v:unknown)=>{const s=String(v??'');return /^[\s]*[=+@-]/.test(s)?"'"+s:s;};
    const rows=[['Full name','Email address','Phone number','Student / National ID','Organization','Ticket category','Notes','Status'],...records.map(a=>[a.fullName,a.email,a.phone,a.identityNumber,a.organization,a.category.name,a.notes,a.status])].map(row=>row.map(clean));
    if(format==='csv')return Buffer.from('\uFEFF'+rows.map(row=>row.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n'));
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Attendees');sheet.addRows(rows);sheet.getColumn(3).numFmt='@';sheet.getColumn(4).numFmt='@';
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  async template(eventId:number,r:AuthenticatedRequest) {
    await this.events.assertAccess(eventId,r.user.id,r.orgRole,r.orgId,'attendees.manage');
    return attendeeTemplate(await this.db.ticketCategory.findMany({where:{eventId,active:true},select:{name:true,code:true},orderBy:{id:'asc'}}));
  }
  async importFile(eventId:number,file:{buffer:Buffer;originalname:string}|undefined,body:unknown,commit:boolean,r:AuthenticatedRequest) {
    await this.events.assertAccess(eventId,r.user.id,r.orgRole,r.orgId,'attendees.manage');
    if(!file)throw new BadRequestException('Choose an attendee file.');
    const dto=parse(z.object({requestKey:z.string().uuid().optional(),previewHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),confirmed:z.literal('true').optional(),options:z.string().max(1500).optional()}).strict(),body);
    let rawOptions:unknown={};try{rawOptions=JSON.parse(dto.options??'{}');}catch{throw new BadRequestException('Invalid column matching.');}
    const options=parse(z.object({mapping:z.record(z.string().regex(/^(fullName|email|phone|identityNumber|organization|category|notes)$/),z.number().int().min(0).max(49)).optional(),defaultCategoryId:z.number().int().positive().optional()}).strict(),rawOptions);
    const rows=await readAttendees(file.buffer,file.originalname,options.mapping);
    if(commit&&(!dto.requestKey||!dto.previewHash||dto.confirmed!=='true'))throw new BadRequestException('Review and confirm the import first.');
    return this.events.mutate(eventId,r.user.id,r.orgRole,r.orgId,'attendees.manage',async(tx,event)=>{
      if(event.registrationDeadline&&event.registrationDeadline<new Date())throw new BadRequestException('The registration deadline has passed.');
      const requestKey='legacy_'+(dto.requestKey??'');const contentHash=hash({kind:'independent-attendees',file:file.buffer.toString('base64'),previewHash:dto.previewHash,options});
      if(commit){const prior=await tx.registrationImport.findUnique({where:{eventId_requestKey:{eventId,requestKey}}});if(prior){if(prior.actorId!==r.user.id||prior.contentHash!==contentHash)throw new ConflictException('Request key already used for another import.');return prior.result;}}
      const categories=await tx.ticketCategory.findMany({where:{eventId,active:true}});
      const existing=await tx.attendee.findMany({where:{eventId},select:{email:true,identityNumber:true}});
      const emails=new Set(existing.map(v=>v.email?.toLowerCase()).filter(Boolean)),ids=new Set(existing.map(v=>v.identityNumber).filter(Boolean));
      const setting=await tx.eventSetting.findUnique({where:{eventId_key:{eventId,key:'product.v1'}}});const defaultId=options.defaultCategoryId??JSON.parse(setting?.value??'{}').defaultCategoryId;
      const records:Prisma.AttendeeCreateManyInput[]=[],errors:{row:number;message:string}[]=[];
      for(const row of rows){try{
        const category=row.data.category?categories.filter(c=>[c.code.toLowerCase(),c.name.toLowerCase()].includes(row.data.category.toLowerCase())):categories.filter(c=>c.id===defaultId);
        if(category.length!==1)throw new Error('Choose an unambiguous active category or set the event default.');
        const {category:_category,...raw}=row.data;const result=attendeeInput.safeParse({...raw,categoryId:category[0].id});
        if(!result.success)throw new Error(result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
        const v=result.data;if(!v.email&&!v.identityNumber)throw new Error('Provide an email or ID.');
        if((v.email&&emails.has(v.email))||(v.identityNumber&&ids.has(v.identityNumber)))throw new Error('Duplicate email or ID in this event/file.');
        if(v.email)emails.add(v.email);if(v.identityNumber)ids.add(v.identityNumber);records.push({...v,eventId,status:'Registered'});
      }catch(e){errors.push({row:row.row,message:(e as Error).message});}}
      const previewHash=hash({eventId,records});
      if(!commit)return {count:records.length,errors:errors.slice(0,100),errorCount:errors.length,previewHash,rows:records.slice(0,100).map(({fullName,email,identityNumber})=>({fullName,email,identityNumber}))};
      if(errors.length||!records.length)throw new BadRequestException('The file has errors. Review a fresh preview; nothing was imported.');
      if(previewHash!==dto.previewHash)throw new ConflictException('The import changed. Review it again.');
      const result=await tx.attendee.createMany({data:records});
      await tx.registrationImport.create({data:{eventId,actorId:r.user.id,requestKey,contentHash,result:{created:result.count}}});
      await tx.auditLog.create({data:{eventId,actorId:r.user.id,action:'attendee.imported',details:`Rows: ${result.count}`}});
      return {created:result.count};
    },false,120000);
  }
}
