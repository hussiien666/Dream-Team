import {StudentsModule} from './students/students.module.js';
import {EmailModule} from './email/email.module.js';
import {validateEnvironment} from './config/runtime.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './database/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { EventsModule } from './events/events.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { EntrancesModule } from './entrances/entrances.module.js';
import { AttendeesModule } from './attendees/attendees.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import {ScannerModule} from './scanner/scanner.module.js';
import {ReportsModule} from './reports/reports.module.js';
import {CommunicationsModule} from './communications/communications.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate:validateEnvironment }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL ?? '60000'),
        limit: parseInt(process.env.THROTTLE_LIMIT ?? '100'),
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    EventsModule,
    CategoriesModule,
    EntrancesModule,
    AttendeesModule,
    StudentsModule,
    TicketsModule,
    ScannerModule,
    EmailModule,
    ReportsModule,
    CommunicationsModule,
  ],
  controllers: [AppController],
  providers: [AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
