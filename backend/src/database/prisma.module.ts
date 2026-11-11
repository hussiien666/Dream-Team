import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import {HealthController} from './health.controller.js';

@Global()
@Module({
  providers: [PrismaService],
  controllers:[HealthController],
  exports: [PrismaService],
})
export class PrismaModule {}
