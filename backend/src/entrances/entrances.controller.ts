import {
  CreateEntranceDto,
  UpdateEntranceDto,
} from '../categories/access.dto.js';
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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { AuthenticatedRequest as Request } from '../common/request.js';
import { EntrancesService } from './entrances.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@ApiTags('entrances')
@ApiBearerAuth()
@Controller('events/:eventId/entrances')
@UseGuards(JwtAuthGuard)
export class EntrancesController {
  constructor(private readonly entrancesService: EntrancesService) {}

  @Get() findAll(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Req() req: Request,
  ) {
    return this.entrancesService.findAll(
      eventId,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Post() create(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: CreateEntranceDto,
    @Req() req: Request,
  ) {
    return this.entrancesService.create(
      eventId,
      dto,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Patch(':id') update(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEntranceDto,
    @Req() req: Request,
  ) {
    return this.entrancesService.update(
      eventId,
      id,
      dto,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) delete(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.entrancesService.delete(
      eventId,
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }
}
