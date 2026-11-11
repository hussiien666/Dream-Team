import { Controller, Get, Post, Patch, Delete, Param, Body, Req, ParseIntPipe, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { AuthenticatedRequest as Request } from '../common/request.js';
import { AttendeesService } from './attendees.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@ApiTags('attendees')
@ApiBearerAuth()
@Controller('events/:eventId/attendees')
@UseGuards(JwtAuthGuard)
export class AttendeesController {
  constructor(private readonly attendeesService: AttendeesService) {}

  @Get() findAll(@Param('eventId', ParseIntPipe) eventId: number, @Req() req: Request) {
    return this.attendeesService.findAll(eventId, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Get(':id') findOne(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.attendeesService.findOne(eventId, id, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Post() create(@Param('eventId', ParseIntPipe) eventId: number, @Body() dto: any, @Req() req: Request) {
    return this.attendeesService.create(eventId, dto, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Patch(':id') update(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any, @Req() req: Request) {
    return this.attendeesService.update(eventId, id, dto, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Post(':id/cancel') @HttpCode(HttpStatus.NO_CONTENT) cancel(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.attendeesService.cancel(eventId, id, req['user'].id, req['orgRole'], req['orgId']);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) delete(@Param('eventId', ParseIntPipe) eventId: number, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.attendeesService.delete(eventId, id, req['user'].id, req['orgRole'], req['orgId']);
  }
}
