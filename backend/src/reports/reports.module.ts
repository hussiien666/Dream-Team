import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { OrganizationAuditController } from './organization-audit.controller.js';

@Module({ imports: [AuthModule, EventsModule], controllers: [ReportsController, OrganizationAuditController], providers: [ReportsService] })
export class ReportsModule {}
