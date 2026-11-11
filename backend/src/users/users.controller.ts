import { CreateUserDto, UpdateUserDto, RoleDto } from './users.dto.js';
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
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get() findAll(@Req() req: Request) {
    return this.usersService.findAll(req['orgId'], req['orgRole']);
  }

  @Post() create(@Body() dto: CreateUserDto, @Req() req: Request) {
    return this.usersService.create(
      dto,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }

  @Patch(':id') @HttpCode(HttpStatus.NO_CONTENT) update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.usersService.update(
      id,
      dto,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }

  @Post(':id/enable') @HttpCode(HttpStatus.NO_CONTENT) enable(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.usersService.setActive(
      id,
      true,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }

  @Post(':id/disable') @HttpCode(HttpStatus.NO_CONTENT) disable(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.usersService.setActive(
      id,
      false,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }

  @Post(':id/role') @HttpCode(HttpStatus.NO_CONTENT) setRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RoleDto,
    @Req() req: Request,
  ) {
    return this.usersService.setRole(
      id,
      dto.role,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }

  @Post(':id/temp-password') tempPassword(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.usersService.temporaryPassword(
      id,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }

  @Post(':id/events/:eventId/assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  assignEvent(
    @Param('id', ParseIntPipe) id: number,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Req() req: Request,
  ) {
    return this.usersService.assignEvent(
      id,
      eventId,
      true,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }

  @Delete(':id/events/:eventId/assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  unassignEvent(
    @Param('id', ParseIntPipe) id: number,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Req() req: Request,
  ) {
    return this.usersService.assignEvent(
      id,
      eventId,
      false,
      req['user'].id,
      req['orgId'],
      req['orgRole'],
    );
  }
}
