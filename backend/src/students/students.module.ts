import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StudentsService } from './students.service.js';
import { StudentsController } from './students.controller.js';
import {TicketsModule} from '../tickets/tickets.module.js';
import {InvitationLinksService} from './invitation-links.service.js';
import {InvitationLinksController, PublicInvitationsController} from './invitation-links.controller.js';
import { TurnstileService } from './turnstile.js';
import { EmailModule } from '../email/email.module.js';
@Module({
  imports: [EventsModule, AuthModule, TicketsModule, EmailModule],
  controllers: [StudentsController, InvitationLinksController, PublicInvitationsController],
  providers: [StudentsService, InvitationLinksService, TurnstileService],
})
export class StudentsModule {}
