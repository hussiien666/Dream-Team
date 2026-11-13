import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  ParseIntPipe,
  UseGuards,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';
import type {
  AuthenticatedRequest as Request,
  Response,
} from '../common/request.js';
import { TicketsService } from './tickets.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
const id = z.number().int().positive().max(2147483647);
const key = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const single = z.object({ attendeeId: id, requestKey: key }).strict();
const batch = z
  .object({ attendeeIds: z.array(id).min(1).max(500), requestKey: key })
  .strict();
const operation = z
  .object({
    confirmed: z.literal(true),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const value = schema.safeParse(body);
  if (!value.success)
    throw new BadRequestException(
      value.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  return value.data;
}
@ApiTags('tickets')
@ApiBearerAuth()
@Controller('events/:eventId/tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly service: TicketsService) {}
  @Get('page') page(@Param('eventId',ParseIntPipe) e:number,@Query() q:unknown,@Req() r:Request){return this.service.findAll(e,r.user.id,r.orgRole,r.orgId,q);}
  @Get('candidates/page') candidatePage(@Param('eventId',ParseIntPipe) e:number,@Query() q:unknown,@Req() r:Request){return this.service.candidates(e,r.user.id,r.orgRole,r.orgId,q);}
  @Get() list(@Param('eventId', ParseIntPipe) e: number, @Req() r: Request) {
    return this.service.findAll(e, r.user.id, r.orgRole, r.orgId);
  }
  @Get('candidates') candidates(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: Request,
  ) {
    return this.service.candidates(e, r.user.id, r.orgRole, r.orgId);
  }
  @Post('issue') issue(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() body: unknown,
    @Req() r: Request,
  ) {
    const d = parse(single, body);
    return this.service.issue(
      e,
      d.attendeeId,
      r.user.id,
      r.orgRole,
      r.orgId,
      d.requestKey,
    );
  }
  @Post('batch-issue') batch(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() body: unknown,
    @Req() r: Request,
  ) {
    const d = parse(batch, body);
    return this.service.issueBatch(
      e,
      d.attendeeIds,
      r.user.id,
      r.orgRole,
      r.orgId,
      d.requestKey,
    );
  }
  @Post('download-zip') async zip(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() body: unknown,
    @Req() r: Request,
    @Res() s: Response,
  ) {
    const { ticketIds } = parse(
      z
        .object({
          ticketIds: z
            .array(id)
            .min(1)
            .max(50)
            .refine((ids) => new Set(ids).size === ids.length),
        })
        .strict(),
      body,
    );
    const bytes = await this.service.zip(
      e,
      ticketIds,
      r.user.id,
      r.orgRole,
      r.orgId,
    );
    s.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="tickets.zip"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    s.send(bytes);
  }
  @Post('group-issue') group(@Param('eventId',ParseIntPipe)e:number,@Body()body:unknown,@Req()r:Request){
    const d=parse(z.object({studentId:id.optional(),invitationGroup:z.string().trim().min(1).max(200).optional(),requestKey:key,confirmed:z.literal(true)}).strict().refine(v=>!!v.studentId||!!v.invitationGroup),body);
    return this.service.issueGroup(e,{...(d.studentId?{studentId:d.studentId}:{}),...(d.invitationGroup?{invitationGroup:d.invitationGroup}:{})},r.user.id,r.orgRole,r.orgId,d.requestKey);
  }
  @Post(':id/regenerate') refresh(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) t: number,
    @Body() body: unknown,
    @Req() r: Request,
  ) {
    parse(z.object({}).strict(), body ?? {});
    return this.service.regenerate(e, t, r.user.id, r.orgRole, r.orgId);
  }
  @Post(':id/adopt') adopt(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) t: number,
    @Body() body: unknown,
    @Req() r: Request,
  ) {
    const d = parse(
      z
        .object({ qr: z.string().max(100), confirmed: z.literal(true) })
        .strict(),
      body,
    );
    return this.service.adopt(e, t, d.qr, r.user.id, r.orgRole, r.orgId);
  }
  @Post(':id/:action') lifecycle(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) t: number,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() r: Request,
  ) {
    const a = parse(
        z.enum(['cancel', 'reactivate', 'revoke', 'replace']),
        action,
      ),
      d = parse(operation, body);
    return this.service.lifecycle(
      e,
      t,
      a,
      d.reason,
      r.user.id,
      r.orgRole,
      r.orgId,
    );
  }
  @Get(':id/pdf') pdf(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) t: number,
    @Req() r: Request,
    @Res() s: Response,
  ) {
    return this.send(e, t, r, s, 'pdf');
  }
  @Get(':id/html') html(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) t: number,
    @Req() r: Request,
    @Res() s: Response,
  ) {
    return this.send(e, t, r, s, 'html');
  }
  private async send(
    e: number,
    t: number,
    r: Request,
    s: Response,
    format: 'pdf' | 'html',
  ) {
    const file = await this.service.artifact(
      e,
      t,
      r.user.id,
      r.orgRole,
      r.orgId,
      format,
    );
    s.set({
      'Content-Type':
        format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.number}.${format}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    s.send(file.bytes);
  }
}
