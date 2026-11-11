import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  ParseIntPipe,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { TransfersService } from './transfers.service.js';

@Controller('events/:eventId')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly service: TransfersService) {}

  @Get('transfers')
  list(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Query('status') status: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.list(eventId, r.user.id, r.orgRole, r.orgId, status);
  }

  @Get('transfers/:transferId')
  getOne(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('transferId', ParseIntPipe) transferId: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.getOne(eventId, transferId, r.user.id, r.orgRole, r.orgId);
  }

  @Post('tickets/:ticketId/transfers')
  initiate(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.initiateAdmin(eventId, ticketId, body, r.user.id, r.orgRole, r.orgId);
  }

  @Post('transfers/:transferId/approve')
  @HttpCode(200)
  approve(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('transferId', ParseIntPipe) transferId: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.approve(eventId, transferId, body, r.user.id, r.orgRole, r.orgId);
  }

  @Post('transfers/:transferId/reject')
  @HttpCode(200)
  reject(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('transferId', ParseIntPipe) transferId: number,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.reject(eventId, transferId, body, r.user.id, r.orgRole, r.orgId);
  }
}
