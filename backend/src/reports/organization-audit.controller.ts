import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest, Response } from '../common/request.js';
import { PrismaService } from '../database/prisma.service.js';

@Controller('organization/audit')
@UseGuards(JwtAuthGuard)
export class OrganizationAuditController {
  constructor(private readonly db: PrismaService) {}
  private async access(r: AuthenticatedRequest) {
    const membership = await this.db.organizationUser.findUnique({ where: { userId:r.user.id } });
    if(r.orgRole!=='super_admin'||membership?.role!=='super_admin'||membership.organizationId!==r.orgId)
      throw new ForbiddenException('Organization audit requires a current Super Admin.');
  }
  private filter(r: AuthenticatedRequest, before?:string) {
    if(before!==undefined&&!/^[1-9]\d{0,9}$/.test(before))throw new BadRequestException('Invalid audit cursor.');
    const cursor=before===undefined?undefined:Number(before);
    if(cursor!==undefined&&cursor>2147483647)throw new BadRequestException('Invalid audit cursor.');
    return { organizationScope:{is:{organizationId:r.orgId}},...(cursor?{id:{lt:cursor}}:{}) };
  }
  @Get()
  async list(@Req() r: AuthenticatedRequest,@Query('before') before?:string) {
    await this.access(r);
    const rows=await this.db.auditLog.findMany({where:this.filter(r,before),take:201,orderBy:{id:'desc'},
      select:{id:true,eventId:true,action:true,details:true,createdAt:true,actor:{select:{displayName:true}}}});
    const page=rows.slice(0,200);
    return {rows:page.map(row=>({...row,actor:row.actor?.displayName??'System or removed account'})),
      nextBefore:rows.length>200?page.at(-1)?.id:null,
      notice:'Only entries with recorded organization ownership appear. Older unscoped entries remain preserved.'};
  }
  @Get('export')
  async export(@Req() r:AuthenticatedRequest,@Res() response:Response) {
    await this.access(r);
    const rows=await this.db.auditLog.findMany({where:this.filter(r),take:5001,orderBy:{id:'desc'},
      select:{id:true,eventId:true,action:true,details:true,createdAt:true,actor:{select:{displayName:true}}}});
    if(rows.length>5000)throw new BadRequestException('Organization audit export exceeds 5,000 entries. Use event audit exports.');
    const cell=(v:unknown)=>{let s=v==null?'':String(v);if(/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
    const text='\uFEFF'+[['ID','Time UTC','Event ID','Action','Actor','Details'],...rows.map(row=>[
      row.id,row.createdAt.toISOString(),row.eventId,row.action,row.actor?.displayName??'System or removed account',row.details])]
      .map(row=>row.map(cell).join(',')).join('\r\n');
    response.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="organization-audit.csv"','Cache-Control':'no-store'});
    response.send(Buffer.from(text,'utf8'));
  }
}
