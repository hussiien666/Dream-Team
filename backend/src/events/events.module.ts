import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
