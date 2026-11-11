import { Module } from '@nestjs/common';
import { EntrancesController } from './entrances.controller.js';
import { EntrancesService } from './entrances.service.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [EntrancesController],
  providers: [EntrancesService],
  exports: [EntrancesService],
})
export class EntrancesModule {}
