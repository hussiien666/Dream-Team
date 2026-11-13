import { Controller, Post, Get, Body, Req, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthenticatedRequest } from '../common/request.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { JwtAuthGuard, Public, AllowPending } from '../common/guards/jwt-auth.guard.js';
import {ROLE_PERMISSIONS} from '../common/guards/jwt-auth.guard.js';
import QRCode from 'qrcode';
import { Throttle } from '@nestjs/throttler';

class CodeDto { @IsString() @MinLength(1) @MaxLength(32) code!: string; }
class RefreshDto { @IsString() @MinLength(43) @MaxLength(43) token!: string; }
class FirebaseTokenDto { @IsString() @MinLength(10) @MaxLength(8192) idToken!: string; }
class FirebaseRegisterDto { @IsString() @MaxLength(254) email!: string; @IsString() @MinLength(12) @MaxLength(256) password!: string; }

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('login') @HttpCode(200)
  @Throttle({default: {limit: 10, ttl: 60000}})
  async login(@Body() dto: LoginDto) {
    const result = await this.auth.login(dto.username, dto.password);
    const {sessionHash: _privateHash, ...identity} = result.identity;
    return {accessToken: result.accessToken, ...identity};
  }

  @Public() @Post('refresh') @HttpCode(200)
  refresh(@Body() dto: RefreshDto) { return this.auth.refreshToken(dto.token); }

  @Public() @Post('firebase-login') @HttpCode(200)
  @Throttle({default: {limit: 10, ttl: 60000}})
  async firebaseLogin(@Body() dto: FirebaseTokenDto) {
    const result = await this.auth.loginFirebase(dto.idToken);
    const {sessionHash: _privateHash, ...identity} = result.identity;
    return {accessToken: result.accessToken, ...identity};
  }
  @Post('firebase-register') @HttpCode(200)
  @Throttle({default: {limit: 5, ttl: 60000}})
  firebaseRegister(@Req() req: AuthenticatedRequest, @Body() dto: FirebaseRegisterDto) { return this.auth.registerFirebase(req, dto.email, dto.password); }
  @Post('firebase-link') @HttpCode(200)
  @Throttle({default: {limit: 5, ttl: 60000}})
  firebaseLink(@Req() req: AuthenticatedRequest, @Body() dto: FirebaseTokenDto) { return this.auth.linkFirebase(req, dto.idToken); }

  @AllowPending() @Post('logout') @HttpCode(204)
  logout(@Req() req: AuthenticatedRequest) { return this.auth.logout(req.sessionHash); }

  @AllowPending() @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    // Request identity contains no hashes, passwords, private tokens or secrets.
    const sections=['Events','Event Dashboard'];
    if(req.orgRole==='super_admin')sections.push('Scanner Staff & Access','Account security');
    return {user: req.user, role: req.orgRole, organizationId: req.orgId, permissions:[...ROLE_PERMISSIONS[req.orgRole] ?? []],requiresFactor:req.requiresFactor,requiresPasswordChange:req.requiresPasswordChange,enrolled:req.enrolled,authProvider:req.authProvider,email:req.email,sections};
  }

  @Post('firebase-exchange') @HttpCode(200)
  @Throttle({default: {limit: 10, ttl: 60000}})
  firebaseExchange(@Req() req: AuthenticatedRequest) {
    return this.auth.firebaseExchange(req);
  }

  @AllowPending() @Post('change-password') @HttpCode(204)
  changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.sessionHash, dto.currentPassword, dto.newPassword);
  }

  @AllowPending() @Post('totp/begin') @HttpCode(200)
  async beginTotp(@Req() req: AuthenticatedRequest) {
    const result=await this.auth.beginTotp(req.sessionHash);
    return {...result,qrPng:(await QRCode.toBuffer(result.uri,{width:260,margin:4})).toString('base64')};
  }

  @AllowPending() @Post('totp/finish') @HttpCode(200)
  finishTotp(@Req() req: AuthenticatedRequest, @Body() dto: CodeDto) { return this.auth.finishTotp(req.sessionHash, dto.code); }

  @AllowPending() @Post('factor/verify') @HttpCode(200)
  verifyFactor(@Req() req: AuthenticatedRequest, @Body() dto: CodeDto) { return this.auth.verifyFactor(req.sessionHash, dto.code); }

  @Post('recovery/regenerate') @HttpCode(200)
  regenerate(@Req() req: AuthenticatedRequest) { return this.auth.regenerateRecovery(req.sessionHash); }
}
