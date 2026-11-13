import { Module } from '@nestjs/common';
import { AttendeesController } from './attendees.controller.js';
import { AttendeesService } from './attendees.service.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { AttendeeImportService } from './attendee-import.service.js';

@Module({
  imports: [AuthModule, EventsModule, EmailModule],
  controllers: [AttendeesController],
  providers: [AttendeesService, AttendeeImportService],
  exports: [AttendeesService],
})
export class AttendeesModule {}
