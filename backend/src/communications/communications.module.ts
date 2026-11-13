import { Module, Controller, Get, Post, Body, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { EmailModule } from '../email/email.module.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { CommunicationsService } from './communications.service.js';
@Controller('events/:eventId/announcements')
@UseGuards(JwtAuthGuard)
class CommunicationsController {
  constructor(private readonly service: CommunicationsService) {}
  @Get() history(@Param('eventId', ParseIntPipe) event: number, @Req() r: AuthenticatedRequest) { return this.service.history(event, r); }
  @Post('preview') preview(@Param('eventId', ParseIntPipe) event: number, @Body() body: unknown, @Req() r: AuthenticatedRequest) { return this.service.preview(event, body, r); }
  @Post() send(@Param('eventId', ParseIntPipe) event: number, @Body() body: unknown, @Req() r: AuthenticatedRequest) { return this.service.send(event, body, r); }
}
@Module({ imports: [AuthModule, EventsModule, EmailModule], providers: [CommunicationsService], controllers: [CommunicationsController] })
export class CommunicationsModule {}
