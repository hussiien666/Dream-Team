import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {TemplatesService} from './templates.service.js';
import {TemplatesController} from './templates.controller.js';
import {EmailModule} from '../email/email.module.js';
import {DeliveryController} from './delivery.controller.js';
import {DeliveryService} from './delivery.service.js';
import {TransfersController} from './transfers.controller.js';
import {TransfersService} from './transfers.service.js';
import {MobileTicketsController, PublicTicketsController} from './mobile-tickets.controller.js';
import {MobileTicketsService} from './mobile-tickets.service.js';

@Module({
  imports: [AuthModule, EventsModule, EmailModule],
  controllers: [
    TicketsController,
    TemplatesController,
    DeliveryController,
    TransfersController,
    MobileTicketsController,
    PublicTicketsController,
  ],
  providers: [
    TicketsService,
    TemplatesService,
    DeliveryService,
    TransfersService,
    MobileTicketsService,
  ],
  exports: [TicketsService, TransfersService, MobileTicketsService],
})
export class TicketsModule {}
