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
  Res,
  UseGuards,
  Header,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest, Response } from '../common/request.js';
import { MobileTicketsService } from './mobile-tickets.service.js';

@Controller('events/:eventId/tickets/:ticketId/mobile-link')
@UseGuards(JwtAuthGuard)
export class MobileTicketsController {
  constructor(private readonly service: MobileTicketsService) {}

  @Get()
  list(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('ticketId', ParseIntPipe) t: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.list(e, t, r);
  }

  @Post()
  create(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('ticketId', ParseIntPipe) t: number,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.rotate(e, t, b, r);
  }

  @Post('revoke')
  @HttpCode(200)
  revoke(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('ticketId', ParseIntPipe) t: number,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.revoke(e, t, b, r);
  }
}

// Public endpoints validate dedicated DEM1. bearer capabilities without admin sessions
@Controller('public/tickets')
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class PublicTicketsController {
  constructor(private readonly service: MobileTicketsService) {}

  private token(header: string | undefined) {
    return header?.startsWith('Bearer ') ? header.slice(7) : '';
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  view(@Headers('authorization') h: string | undefined) {
    return this.service.view(this.token(h));
  }

  @Get('pdf')
  async pdf(
    @Headers('authorization') h: string | undefined,
    @Res() s: Response,
  ) {
    const file = await this.service.pdf(this.token(h));
    s.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.number}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    s.send(file.bytes);
  }

  @Post('transfer')
  @HttpCode(200)
  transfer(
    @Headers('authorization') h: string | undefined,
    @Body() b: unknown,
  ) {
    return this.service.transfer(this.token(h), b);
  }

  @Post('cancel-transfer')
  @HttpCode(200)
  cancelTransfer(@Headers('authorization') h: string | undefined) {
    return this.service.cancelTransfer(this.token(h));
  }

  @Post('cancel')
  @HttpCode(200)
  cancelTicket(
    @Headers('authorization') h: string | undefined,
    @Body() b: unknown,
  ) {
    return this.service.cancelTicket(this.token(h), b);
  }
}
