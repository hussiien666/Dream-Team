import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
  Header,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { InvitationLinksService } from './invitation-links.service.js';

@Controller('events/:eventId/students/:studentId/invitation-links')
@UseGuards(JwtAuthGuard)
export class InvitationLinksController {
  constructor(private readonly service: InvitationLinksService) {}
  @Get() list(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('studentId', ParseIntPipe) s: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.list(e, s, r);
  }
  @Post() create(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('studentId', ParseIntPipe) s: number,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.rotate(e, s, b, r);
  }
  @Post('revoke') @HttpCode(200) revoke(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('studentId', ParseIntPipe) s: number,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.revoke(e, s, b, r);
  }
}

// This controller deliberately has no admin-session guard. Every operation validates
// a dedicated hashed, student-scoped capability; it cannot authenticate as a user.
@Controller('public/invitations')
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class PublicInvitationsController {
  constructor(private readonly service: InvitationLinksService) {}
  private token(header: string | undefined) {
    return header?.startsWith('Bearer ') ? header.slice(7) : '';
  }
  @Get() @Header('Cache-Control', 'no-store') view(
    @Headers('authorization') h: string | undefined,
  ) {
    return this.service.view(this.token(h));
  }
  @Post() @HttpCode(200) operate(
    @Headers('authorization') h: string | undefined,
    @Body() b: unknown,
  ) {
    return this.service.operate(this.token(h), b);
  }
}
