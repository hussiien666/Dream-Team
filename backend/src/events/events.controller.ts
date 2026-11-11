import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedRequest as Request } from '../common/request.js';
import { EventsService } from './events.service.js';
import {
  CreateEventDto,
  UpdateEventDto,
  UpdateEventSettingsDto,
} from './dto/create-event.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'List all accessible events' })
  findAll(@Req() req: Request) {
    return this.eventsService.findAll(
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.findOne(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a new event' })
  create(@Body() dto: CreateEventDto, @Req() req: Request) {
    return this.eventsService.create(
      dto,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update event' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEventDto,
    @Req() req: Request,
  ) {
    return this.eventsService.update(
      id,
      dto,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete event (only if no tickets)' })
  delete(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.delete(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive event' })
  archive(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.archive(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
      true,
    );
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore archived event' })
  restore(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.archive(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
      false,
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel event and cancel unused tickets' })
  cancel(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.cancel(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reopen a cancelled event (Super Admin only)' })
  reopen(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.reopen(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate event configuration' })
  duplicate(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.duplicate(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Get(':id/settings')
  settings(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.settings(id, req.user.id, req.orgRole, req.orgId);
  }
  @Patch(':id/settings')
  updateSettings(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEventSettingsDto,
    @Req() req: Request,
  ) {
    return this.eventsService.updateSettings(
      id,
      dto.settings,
      req.user.id,
      req.orgRole,
      req.orgId,
    );
  }

  @Get(':id/dashboard')
  @ApiOperation({ summary: 'Get event dashboard stats' })
  dashboard(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.eventsService.getDashboard(
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }
}
