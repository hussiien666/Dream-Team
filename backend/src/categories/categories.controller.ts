import {
  CreateCategoryDto,
  UpdateCategoryDto,
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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { AuthenticatedRequest as Request } from '../common/request.js';
import { CategoriesService } from './categories.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('events/:eventId/categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get() findAll(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Req() req: Request,
  ) {
    return this.categoriesService.findAll(
      eventId,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }

  @Post() create(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: CreateCategoryDto,
    @Req() req: Request,
  ) {
    return this.categoriesService.create(
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
    @Body() dto: UpdateCategoryDto,
    @Req() req: Request,
  ) {
    return this.categoriesService.update(
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
    return this.categoriesService.delete(
      eventId,
      id,
      req['user'].id,
      req['orgRole'],
      req['orgId'],
    );
  }
}
