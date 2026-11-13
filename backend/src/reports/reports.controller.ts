import { Controller, Get, Param, ParseIntPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest, Response } from '../common/request.js';
import { ReportsService } from './reports.service.js';

@Controller('events/:eventId/reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  overview(@Param('eventId', ParseIntPipe) eventId: number, @Req() r: AuthenticatedRequest) {
    return this.reports.snapshot(eventId, r.user.id, r.orgRole, r.orgId);
  }

  @Get('audit')
  audit(@Param('eventId', ParseIntPipe) eventId: number, @Req() r: AuthenticatedRequest) {
    return this.reports.audit(eventId, r.user.id, r.orgRole, r.orgId);
  }

  @Get('scanners')
  scanners(@Param('eventId', ParseIntPipe) eventId: number, @Req() r: AuthenticatedRequest) {
    return this.reports.scanners(eventId, r.user.id, r.orgRole, r.orgId);
  }

  @Get('audit/export')
  async auditExport(@Param('eventId', ParseIntPipe) eventId: number, @Req() r: AuthenticatedRequest, @Res() response: Response) {
    const bytes = await this.reports.exportAudit(eventId, r.user.id, r.orgRole, r.orgId);
    response.set({ 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${eventId}-audit.csv"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.send(bytes);
  }

  @Get('export')
  async export(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Query('format') format: string | undefined,
    @Req() r: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const file = await this.reports.export(eventId, r.user.id, r.orgRole, r.orgId, format ?? 'xlsx');
    response.set({
      'Content-Type': file.type,
      'Content-Disposition': `attachment; filename="event-${eventId}-report.${file.extension}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(file.bytes);
  }
}
