import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { digest, newToken } from '../common/crypto.util.js';
import { seal, unseal } from '../common/encryption.util.js';
import { matchedCounter, newSecret } from './totp.js';

type Tx = Prisma.TransactionClient;
export type Identity = { user: {id: number; username: string; displayName: string}; orgRole: string; orgId: number; sessionHash: string; requiresFactor: boolean; requiresPasswordChange: boolean; enrolled: boolean };

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  private dummy = argon2.hash(randomBytes(32), { type: argon2.argon2id });

  validatePassword(password: string) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new BadRequestException('Use a password between 12 and 256 characters.');
  }

  async login(username: string, password: string) {
    const result = await this.prisma.$transaction(async tx => {
      const normalized = username.trim().toLowerCase();
      await tx.$queryRaw`SELECT id FROM users WHERE username = ${normalized} FOR UPDATE`;
      const user = await tx.user.findUnique({where: {username: normalized}});
      let valid = false;
      try { valid = await argon2.verify(user?.passwordHash ?? await this.dummy, password); } catch { /* generic failure */ }
      const now = new Date();
      if (!user || !user.active || (user.lockedUntil && user.lockedUntil > now) || !valid) {
        if (user && user.active && (!user.lockedUntil || user.lockedUntil <= now) && !valid) {
          const failed = user.failedAttempts+1;
          await tx.user.update({where: {id: user.id}, data: {failedAttempts: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? new Date(+now+900000) : null}});
        }
        await tx.auditLog.create({data: {actorId: user?.id, action: 'auth.failed'}});
        return null;
      }
      const member = await tx.organizationUser.findUnique({where: {userId: user.id}});
      if (!member || member.role === 'scanner') return null; // scanner has its own account + event-code login
      await tx.user.update({where: {id: user.id}, data: {failedAttempts: 0, lockedUntil: null}});
      const token = newToken();
      const hours = Math.max(1, Math.min(24, Number(process.env.SESSION_HOURS ?? 8)));
      await tx.authSession.create({data: {tokenHash: token.hash, userId: user.id, expiresAt: new Date(+now+hours*3600000), securitySession: {create: {lastSeen: now, verified: member.role !== 'super_admin'}}}});
      await tx.auditLog.create({data: {actorId: user.id, action: 'auth.login'}});
      return {accessToken: token.raw, identity: await this.load(tx, token.hash, true)};
    }, {timeout: 20000});
    // Failure counters/audit commit before returning the generic error.
    if (!result) throw new UnauthorizedException('Invalid credentials or account locked.');
    return result;
  }

  private async load(tx: Tx, hash: string, pending = false): Promise<Identity> {
    const auth = await tx.authSession.findUnique({where: {tokenHash: hash}, include: {securitySession: true, user: {include: {organizationUser: true, securityProfile: true}}}});
    const now = new Date();
    if (!auth || auth.expiresAt <= now || !auth.user.active) throw new UnauthorizedException('Your session has expired. Please sign in again.');
    const member = auth.user.organizationUser;
    if (!member || member.role === 'scanner') throw new ForbiddenException('No administration access.');
    const state = auth.securitySession;
    const idle = Math.max(5, Math.min(240, Number(process.env.ADMIN_IDLE_MINUTES ?? 30)))*60000;
    if (+(state?.lastSeen ?? auth.createdAt)+idle <= +now) throw new UnauthorizedException('Session expired after inactivity.');
    const factor = member.role === 'super_admin' && !state?.verified;
    if (factor && +auth.createdAt+600000 <= +now) throw new UnauthorizedException('Verification expired. Sign in again.');
    if (!pending && (factor || auth.user.securityProfile?.forcePassword)) throw new ForbiddenException({message: factor ? 'Super Admin verification required.' : 'Change your temporary password.', code: factor ? 'FACTOR_REQUIRED' : 'PASSWORD_CHANGE_REQUIRED'});
    await tx.securitySession.upsert({where: {tokenHash: hash}, update: {lastSeen: now}, create: {tokenHash: hash, lastSeen: now, verified: false}});
    return {user: {id: auth.user.id, username: auth.user.username, displayName: auth.user.displayName}, orgRole: member.role, orgId: member.organizationId, sessionHash: hash, requiresFactor: factor, requiresPasswordChange: auth.user.securityProfile?.forcePassword ?? false, enrolled: !!auth.user.securityProfile?.factorMethod};
  }

  async authenticate(raw: string, pending = false) {
    if (typeof raw !== 'string' || raw.length !== 43) throw new UnauthorizedException('Authentication required.');
    return this.prisma.$transaction(tx => this.load(tx, digest(raw), pending));
  }

  private async locked(tx: Tx, hash: string, pending: boolean) {
    const record = await tx.authSession.findUnique({where: {tokenHash: hash}});
    if (!record) throw new UnauthorizedException('Session expired.');
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${record.userId} FOR UPDATE`;
    const identity = await this.load(tx, hash, pending);
    const profile = await tx.securityProfile.upsert({where: {userId: record.userId}, update: {}, create: {userId: record.userId}});
    return {identity, profile, userId: record.userId};
  }

  async refreshToken(raw: string) {
    const hash = digest(raw);
    return this.prisma.$transaction(async tx => {
      const {identity} = await this.locked(tx, hash, true);
      const old = await tx.authSession.findUniqueOrThrow({where: {tokenHash: hash}, include: {securitySession: true}});
      const token = newToken();
      await tx.authSession.create({data: {tokenHash: token.hash, userId: identity.user.id, createdAt: old.createdAt, expiresAt: old.expiresAt,
        securitySession: {create: {lastSeen: new Date(), verified: old.securitySession?.verified ?? false, attempts: old.securitySession?.attempts ?? 0, enrollmentSecret: old.securitySession?.enrollmentSecret ?? ''}}}});
      await tx.authSession.delete({where: {tokenHash: hash}});
      return {accessToken: token.raw};
    });
  }

  async logout(hash: string) {
    await this.prisma.$transaction(async tx => {
      const record = await tx.authSession.findUnique({where: {tokenHash: hash}});
      if (record) {
        await tx.authSession.delete({where: {tokenHash: hash}});
        await tx.auditLog.create({data: {actorId: record.userId, action: 'auth.logout'}});
      }
    });
  }

  async beginTotp(hash: string) {
    return this.prisma.$transaction(async tx => {
      const {identity, profile} = await this.locked(tx, hash, true);
      if (identity.orgRole !== 'super_admin' || identity.requiresPasswordChange) throw new ForbiddenException();
      if (profile.factorMethod) throw new BadRequestException('A verification method is already enrolled.');
      const state = await tx.securitySession.findUniqueOrThrow({where: {tokenHash: hash}});
      const secret = state.enrollmentSecret ? unseal(state.enrollmentSecret) : newSecret();
      if (!state.enrollmentSecret) await tx.securitySession.update({where: {tokenHash: hash}, data: {enrollmentSecret: seal(secret)}});
      return {secret, uri: `otpauth://totp/Dream%20Events:${encodeURIComponent(identity.user.username)}?secret=${secret}&issuer=Dream%20Events&algorithm=SHA1&digits=6&period=30`};
    });
  }

  private async factorAttempt(tx: Tx, userId: number, hash: string, valid: boolean) {
    const user = await tx.user.findUniqueOrThrow({where: {id: userId}});
    const state = await tx.securitySession.findUniqueOrThrow({where: {tokenHash: hash}});
    if (state.attempts >= 5 || (user.lockedUntil && user.lockedUntil > new Date())) return false;
    if (!valid) {
      await tx.securitySession.update({where: {tokenHash: hash}, data: {attempts: {increment: 1}}});
      if (state.attempts >= 4) await tx.user.update({where: {id: userId}, data: {lockedUntil: new Date(Date.now()+900000)}});
      await tx.auditLog.create({data: {actorId: userId, action: 'security.factor_failed'}});
      return false;
    }
    await tx.securitySession.update({where: {tokenHash: hash}, data: {attempts: 0, verified: true}});
    return true;
  }

  private async recovery(tx: Tx, userId: number) {
    const codes = Array.from({length: 10}, () => randomBytes(8).toString('hex').toUpperCase());
    await tx.recoveryCode.deleteMany({where: {userId}});
    await tx.recoveryCode.createMany({data: codes.map(code => ({userId, tokenHash: digest(code)}))});
    await tx.auditLog.create({data: {actorId: userId, action: 'security.recovery_regenerated'}});
    return codes;
  }

  async finishTotp(hash: string, code: string) {
    const result = await this.prisma.$transaction(async tx => {
      const {identity, profile, userId} = await this.locked(tx, hash, true);
      if (identity.orgRole !== 'super_admin' || identity.requiresPasswordChange || profile.factorMethod) throw new BadRequestException('Authenticator enrollment is unavailable.');
      const state = await tx.securitySession.findUniqueOrThrow({where: {tokenHash: hash}});
      if (!state.enrollmentSecret) throw new BadRequestException('Start enrollment first.');
      const counter = matchedCounter(unseal(state.enrollmentSecret), code.trim(), -1);
      if (!await this.factorAttempt(tx, userId, hash, counter !== null)) return null;
      await tx.securityProfile.update({where: {userId}, data: {totpSecret: state.enrollmentSecret, totpCounter: counter!, factorMethod: 'totp'}});
      await tx.securitySession.update({where: {tokenHash: hash}, data: {enrollmentSecret: ''}});
      await tx.auditLog.create({data: {actorId: userId, action: 'security.totp_enrolled'}});
      return this.recovery(tx, userId);
    });
    if (!result) throw new BadRequestException('Invalid or expired verification code.');
    return {recoveryCodes: result};
  }

  async verifyFactor(hash: string, code: string) {
    const ok = await this.prisma.$transaction(async tx => {
      const {profile, userId, identity} = await this.locked(tx, hash, true);
      if (identity.orgRole !== 'super_admin' || identity.requiresPasswordChange) throw new ForbiddenException();
      const recovery = await tx.recoveryCode.findUnique({where: {tokenHash: digest(code.trim().toUpperCase())}});
      const counter = profile.factorMethod === 'totp' ? matchedCounter(unseal(profile.totpSecret), code.trim(), profile.totpCounter) : null;
      if (!await this.factorAttempt(tx, userId, hash, recovery?.userId === userId || counter !== null)) return false;
      if (recovery?.userId === userId) {
        await tx.recoveryCode.delete({where: {tokenHash: recovery.tokenHash}});
        await tx.auditLog.create({data: {actorId: userId, action: 'security.recovery_used'}});
      } else await tx.securityProfile.update({where: {userId}, data: {totpCounter: counter!}});
      await tx.auditLog.create({data: {actorId: userId, action: 'security.factor_verified'}});
      return true;
    });
    if (!ok) throw new BadRequestException('Invalid or expired verification code.');
    return {verified: true};
  }

  async regenerateRecovery(hash: string) {
    return this.prisma.$transaction(async tx => {
      const {identity, userId} = await this.locked(tx, hash, false);
      if (identity.orgRole !== 'super_admin') throw new ForbiddenException();
      return {recoveryCodes: await this.recovery(tx, userId)};
    });
  }

  async changePassword(hash: string, currentPassword: string, newPassword: string) {
    this.validatePassword(newPassword);
    await this.prisma.$transaction(async tx => {
      const {identity, profile, userId} = await this.locked(tx, hash, true);
      if (identity.requiresFactor && !profile.forcePassword) throw new ForbiddenException('Verify your second factor first.');
      const user = await tx.user.findUniqueOrThrow({where: {id: userId}});
      if (!await argon2.verify(user.passwordHash, currentPassword)) throw new BadRequestException('The current password is incorrect.');
      await tx.user.update({where: {id: userId}, data: {passwordHash: await argon2.hash(newPassword, {type: argon2.argon2id})}});
      await tx.securityProfile.update({where: {userId}, data: {forcePassword: false}});
      await tx.authSession.deleteMany({where: {userId}});
      await tx.auditLog.create({data: {actorId: userId, action: 'user.password_changed'}});
    });
  }
}
