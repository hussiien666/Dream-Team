import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Req,
  UseGuards,
  Param,
  ParseIntPipe,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../common/request.js';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Matches,
  Min,
  IsInt,
  IsString,
  MaxLength,
  MinLength,
  IsBoolean,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ScannerService } from './scanner.service.js';

class ScannerLoginDto {
  @IsString() @MinLength(1) @MaxLength(80) username!: string;
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsString() @MinLength(1) @MaxLength(100) eventCode!: string;
}
class CodeDto {
  @IsString() @MinLength(1) @MaxLength(120) @Matches(/\S/) name!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  entranceIds!: number[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  staffIds!: number[];
}
class EntranceDto {
  @IsInt() entranceId!: number;
}
class ScanDto {
  @IsString() @MaxLength(200) qr!: string;
}
class TempDto {
  @IsString() @MinLength(43) @MaxLength(43) challenge!: string;
  @IsString() @MinLength(12) @MaxLength(256) newPassword!: string;
}
class PreferencesDto {
  @IsBoolean() successSound!: boolean;
  @IsBoolean() rejectionSound!: boolean;
  @IsBoolean() successVibration!: boolean;
  @IsBoolean() rejectionVibration!: boolean;
}
function scannerToken(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length !== 50)
    throw new UnauthorizedException('Sign in again.');
  return header.slice(7);
}

@ApiTags('scanner')
@Controller('scanner')
export class ScannerController {
  constructor(private readonly scanner: ScannerService) {}
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  login(@Body() dto: ScannerLoginDto) {
    return this.scanner.login(dto.username, dto.password, dto.eventCode);
  }
  @Post('temporary-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  temporary(@Body() dto: TempDto) {
    return this.scanner.finishTemporaryPassword(dto.challenge, dto.newPassword);
  }
  @Get('state') state(@Req() req: Request) {
    return this.scanner.state(scannerToken(req));
  }
  @Post('entrance') @HttpCode(200) entrance(
    @Req() req: Request,
    @Body() dto: EntranceDto,
  ) {
    return this.scanner.switchEntrance(scannerToken(req), dto.entranceId);
  }
  @Post('checkin') @HttpCode(200) scan(
    @Req() req: Request,
    @Body() dto: ScanDto,
  ) {
    return this.scanner.scan(scannerToken(req), dto.qr);
  }
  @Post('preferences') @HttpCode(200) preferences(
    @Req() req: Request,
    @Body() dto: PreferencesDto,
  ) {
    return this.scanner.preferences(scannerToken(req), dto);
  }
  @Post('logout') @HttpCode(204) logout(@Req() req: Request) {
    return this.scanner.logout(scannerToken(req));
  }
}

@ApiTags('scanner administration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ScannerAdminController {
  constructor(private readonly scanner: ScannerService) {}
  @Get('events/:eventId/access-codes') codes(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scanner.listCodes(eventId, req.user.id, req.orgRole, req.orgId);
  }
  @Post('events/:eventId/access-codes') create(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: CodeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scanner.createCode(
      eventId,
      dto.name,
      dto.entranceIds,
      dto.staffIds,
      req.user.id,
      req.orgRole,
      req.orgId,
    );
  }
  @Post('events/:eventId/access-codes/:id/deactivate') deactivate(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) codeId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scanner.deactivateCode(
      eventId,
      codeId,
      req.user.id,
      req.orgRole,
      req.orgId,
    );
  }
  @Post('events/:eventId/access-codes/:id/activate')
  activate(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scanner.changeCode(
      eventId,
      id,
      req.user.id,
      req.orgRole,
      req.orgId,
      'activate',
    );
  }
  @Post('events/:eventId/access-codes/:id/regenerate')
  regenerate(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scanner.changeCode(
      eventId,
      id,
      req.user.id,
      req.orgRole,
      req.orgId,
      'regenerate',
    );
  }
  @Patch('events/:eventId/access-codes/:id')
  assign(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CodeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scanner.changeCode(
      eventId,
      id,
      req.user.id,
      req.orgRole,
      req.orgId,
      'assign',
      dto,
    );
  }
  @Post('scanner/users/:id/remote-logout') @HttpCode(204) remote(
    @Param('id', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scanner.remoteLogout(
      userId,
      req.user.id,
      req.orgRole,
      req.orgId,
    );
  }
}
