import {Module} from '@nestjs/common';
import {ScannerService} from './scanner.service.js';
import {ScannerController,ScannerAdminController} from './scanner.controller.js';
import {AuthModule} from '../auth/auth.module.js';
import {EventsModule} from '../events/events.module.js';
@Module({imports:[AuthModule,EventsModule],providers:[ScannerService],controllers:[ScannerController,ScannerAdminController],exports:[ScannerService]})
export class ScannerModule {}
