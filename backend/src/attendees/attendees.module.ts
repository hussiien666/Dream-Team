import { Module } from '@nestjs/common';
import { AttendeesController } from './attendees.controller.js';
import { AttendeesService } from './attendees.service.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [AttendeesController],
  providers: [AttendeesService],
  exports: [AttendeesService],
})
export class AttendeesModule {}
