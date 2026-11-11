import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import type {
  AuthenticatedRequest as Request,
  Response,
} from '../common/request.js';
import { TemplatesService } from './templates.service.js';
@UseGuards(JwtAuthGuard)
@Controller('events/:eventId/ticket-templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}
  @Get() list(@Param('eventId', ParseIntPipe) e: number, @Req() r: Request) {
    return this.service.list(e, r);
  }
  @Post() create(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.save(e, undefined, b, r);
  }
  @Patch(':id') update(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.save(e, id, b, r);
  }
  @Delete(':id') remove(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.remove(e, id, b, r);
  }
  @Post(':id/duplicate') duplicate(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.duplicate(e, id, b, r);
  }
  @Post('apply') apply(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.apply(e, b, r);
  }
  @Post('preview/:format') async preview(
    @Param('eventId', ParseIntPipe) e: number,
    @Param('format') format: string,
    @Body() b: unknown,
    @Req() r: Request,
    @Res() s: Response,
  ) {
    const bytes = await this.service.preview(
      e,
      { ...(b as object), format },
      r,
    );
    s.set({
      'Content-Type':
        format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="ticket-preview.${format === 'pdf' ? 'pdf' : 'html'}"`,
    });
    s.send(bytes);
  }
}
