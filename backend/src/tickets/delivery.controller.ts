import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import type { AuthenticatedRequest as Request } from '../common/request.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { DeliveryService } from './delivery.service.js';
@UseGuards(JwtAuthGuard)
@Controller('events/:eventId/tickets')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}
  @Get('delivery-settings') settings(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: Request,
  ) {
    return this.service.settings(e, r);
  }
  @Patch('delivery-settings') save(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.saveSettings(e, b, r);
  }
  @Get('deliveries') history(
    @Param('eventId', ParseIntPipe) e: number,
    @Req() r: Request,
  ) {
    return this.service.history(e, r);
  }
  @Post('send-email') send(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.send(e, b, r);
  }
  @Post('delivery-preview') preview(
    @Param('eventId', ParseIntPipe) e: number,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.preview(e, b, r);
  }
}
