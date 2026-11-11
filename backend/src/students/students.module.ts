import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StudentsService } from './students.service.js';
import { StudentsController } from './students.controller.js';
import {TicketsModule} from '../tickets/tickets.module.js';
import {InvitationLinksService} from './invitation-links.service.js';
import {InvitationLinksController, PublicInvitationsController} from './invitation-links.controller.js';
@Module({
  imports: [EventsModule, AuthModule, TicketsModule],
  controllers: [StudentsController, InvitationLinksController, PublicInvitationsController],
  providers: [StudentsService, InvitationLinksService],
})
export class StudentsModule {}
