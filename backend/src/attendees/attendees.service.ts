import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { NotificationsService } from '../email/notifications.service.js';
import { parse } from '../students/validation.js';
import { listPage,pageResult } from '../common/list-page.js';
const optionalText = (max: number) => z.string().trim().max(max).nullable().transform(v => v || null);
export const attendeeInput = z.object({
  fullName:z.string().trim().min(2).max(200), categoryId:z.number().int().positive(),
  email:optionalText(254).refine(v=>!v || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v),'Enter a valid email.').transform(v=>v?.toLowerCase()??null).optional(),
  identityNumber:optionalText(100).optional(), phone:z.string().trim().max(40).regex(/^[+\d\s().-]*$/).default(''),
  organization:z.string().trim().max(200).default(''),notes:z.string().trim().max(2000).default(''),
}).strict();
type Input = z.infer<typeof attendeeInput>;
@Injectable()
export class AttendeesService {
  constructor(private readonly db:PrismaService,private readonly events:EventsService,private readonly notifications:NotificationsService) {}
  async page(eventId:number,userId:number,role:string,orgId:number,query:unknown){
    await this.events.assertAccess(eventId,userId,role,orgId,'attendees.manage');const q=listPage(query);
    return pageResult(await this.db.attendee.findMany({where:{eventId,guestInvitation:{is:null},...(q.after?{id:{gt:q.after}}:{}),
      ...(q.status==='all'?{}:{status:q.status==='Registered'||q.status==='active'?'Registered':'Cancelled'}),...(q.search?{OR:[{fullName:{contains:q.search,mode:'insensitive'}},{email:{contains:q.search,mode:'insensitive'}},{identityNumber:{contains:q.search}},{phone:{contains:q.search}},{tickets:{some:{number:{contains:q.search,mode:'insensitive'}}}}]}:{})},
      orderBy:{id:'asc'},take:51,include:{category:{select:{id:true,name:true}},tickets:{select:{id:true,number:true,status:true}}}}));
  }
  async findAll(eventId:number,userId:number,role:string,orgId:number,independent=false) {
    await this.events.assertAccess(eventId,userId,role,orgId,'attendees.manage');
    return this.db.attendee.findMany({where:{eventId,...(independent?{guestInvitation:{is:null}}:{})},orderBy:[{fullName:'asc'},{id:'asc'}],
      include:{category:{select:{id:true,name:true}},tickets:{select:{id:true,number:true,status:true}}}});
  }
  async findOne(eventId:number,id:number,userId:number,role:string,orgId:number) {
    await this.events.assertAccess(eventId,userId,role,orgId,'attendees.manage');
    const row=await this.db.attendee.findFirst({where:{eventId,id},include:{category:true,tickets:{select:{id:true,number:true,status:true,expiresAt:true}}}});
    if(!row)throw new NotFoundException('Independent attendee not found. Manage linked guests through Students & Invitations.');
    return row;
  }
  async validate(tx:Prisma.TransactionClient,eventId:number,data:Input,id?:number,existingCategoryId?:number) {
    if(!data.email&&!data.identityNumber)throw new BadRequestException('Provide an email or identity number.');
    if(!await tx.ticketCategory.findFirst({where:{id:data.categoryId,eventId,...(data.categoryId===existingCategoryId?{}:{active:true})}}))throw new BadRequestException('Choose an active category from this event.');
    const duplicate=await tx.attendee.findFirst({where:{eventId,...(id?{id:{not:id}}:{}),OR:[...(data.email?[{email:{equals:data.email,mode:'insensitive' as const}}]:[]),...(data.identityNumber?[{identityNumber:data.identityNumber}]:[])]}});
    if(duplicate)throw new BadRequestException('An attendee with this email or ID is already registered.');
  }
  create(eventId:number,body:unknown,userId:number,role:string,orgId:number) {
    const dto=parse(attendeeInput,body);
    return this.events.mutate(eventId,userId,role,orgId,'attendees.manage',async(tx,event)=>{
      if(event.registrationDeadline&&event.registrationDeadline<new Date())throw new BadRequestException('The registration deadline has passed.');
      await this.validate(tx,eventId,dto);
      const row=await tx.attendee.create({data:{...dto,eventId,status:'Registered'}});
      await tx.auditLog.create({data:{eventId,actorId:userId,action:'attendee.created',details:`Attendee ${row.id}`}});
      return row;
    });
  }
  update(eventId:number,id:number,body:unknown,userId:number,role:string,orgId:number) {
    const patch=parse(attendeeInput.partial(),body);
    return this.events.mutate(eventId,userId,role,orgId,'attendees.manage',async tx=>{
      if(await tx.guestInvitation.findFirst({where:{attendeeId:id,eventId}}))throw new BadRequestException('Manage linked guests through Students & Invitations.');
      const old=await tx.attendee.findFirst({where:{id,eventId,guestInvitation:{is:null}}});
      if(!old)throw new NotFoundException('Independent attendee not found.');
      if(patch.categoryId&&patch.categoryId!==old.categoryId&&await tx.ticket.count({where:{attendeeId:id}}))throw new BadRequestException('Category cannot change after ticket history exists.');
      const changes=Object.fromEntries(Object.keys(body as object).map(k=>[k,patch[k as keyof typeof patch]]));
      const next={...old,...changes} as Input;
      await this.validate(tx,eventId,next,id,old.categoryId);
      const row=await tx.attendee.update({where:{id},data:changes});
      await tx.auditLog.create({data:{eventId,actorId:userId,action:'attendee.updated',details:`Attendee ${id}`}});
      return row;
    });
  }
  cancel(eventId:number,id:number,userId:number,role:string,orgId:number) { return this.remove(eventId,id,userId,role,orgId,false); }
  delete(eventId:number,id:number,userId:number,role:string,orgId:number) { return this.remove(eventId,id,userId,role,orgId,true); }
  private remove(eventId:number,id:number,userId:number,role:string,orgId:number,deleting:boolean) {
    return this.events.mutate(eventId,userId,role,orgId,'attendees.manage',async tx=>{
      if(await tx.guestInvitation.findFirst({where:{attendeeId:id,eventId}}))throw new BadRequestException('Manage linked guests through Students & Invitations.');
      const old=await tx.attendee.findFirst({where:{id,eventId,guestInvitation:{is:null}}});
      if(!old)throw new NotFoundException('Independent attendee not found.');
      if(deleting&&await tx.ticket.count({where:{attendeeId:id}}))throw new BadRequestException('This attendee has ticket history. Cancel registration instead.');
      if(old.status==='Cancelled')return;
      await tx.attendee.update({where:{id},data:{status:'Cancelled'}});
      await tx.ticket.updateMany({where:{attendeeId:id,eventId,status:{in:['Active','Expired']},checkIn:{is:null}},data:{status:'Revoked'}});
      await tx.auditLog.create({data:{eventId,actorId:userId,action:deleting?'attendee.deleted':'attendee.cancelled',details:`Attendee ${id}; retained historical admissions`}});
      await this.notifications.event(tx,eventId,userId,[old.email],'Dream Events registration cancelled','Your registration is cancelled. Its unused tickets are invalid.',`attendee-cancelled:${id}`);
    });
  }
}
