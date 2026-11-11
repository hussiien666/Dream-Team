import {Controller,Get,ServiceUnavailableException} from '@nestjs/common';
import {PrismaService} from './prisma.service.js';
@Controller('health')
export class HealthController {
  constructor(private readonly prisma:PrismaService) {}
  @Get() async health() {
    try {await this.prisma.$queryRaw`SELECT 1`;return {status:'ok',database:'connected'};}
    catch {throw new ServiceUnavailableException('Database is unavailable.');}
  }
}
