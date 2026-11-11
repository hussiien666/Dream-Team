import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { digest, newToken, parseQrPayload } from '../common/crypto.util.js';
import { EventsService } from '../events/events.service.js';
type Tx = Prisma.TransactionClient;

@Injectable()
export class ScannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}
  private dummy = argon2.hash(randomBytes(32));

  async createCode(
    eventId: number,
    name: string,
    entranceIds: number[],
    staffIds: number[],
    actorId: number,
    role: string,
    orgId: number,
  ) {
    if (role !== 'super_admin')
      throw new ForbiddenException(
        'Only Super Admin can change scanner access.',
      );
    const raw = randomBytes(12).toString('hex').toUpperCase();
    return this.events.mutate(
      eventId,
      actorId,
      role,
      orgId,
      'users.manage',
      async (tx) => {
        await this.validateCodeGrants(
          tx,
          eventId,
          orgId,
          entranceIds,
          staffIds,
        );
        const code = await tx.accessCode.create({
          data: {
            eventId,
            name: name.trim(),
            codeHash: digest(raw),
            codeEntrances: {
              create: entranceIds.map((entranceId) => ({
                entranceId,
                eventId,
              })),
            },
            codeStaff: { create: staffIds.map((userId) => ({ userId })) },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            eventId,
            action: 'scanner.code_created',
            details: `Code ${code.id}; entrances ${entranceIds.join(',')}; staff ${staffIds.join(',')}`,
          },
        });
        return { id: code.id, name: code.name, code: raw };
      },
    );
  }
  private async validateCodeGrants(
    tx: Tx,
    eventId: number,
    orgId: number,
    entranceIds: number[],
    staffIds: number[],
  ) {
    const entrances = await tx.entrance.count({
      where: { id: { in: entranceIds }, eventId, active: true },
    });
    const staff = await tx.organizationUser.count({
      where: {
        userId: { in: staffIds },
        organizationId: orgId,
        role: 'scanner',
      },
    });
    const assignments = await tx.eventAssignment.count({
      where: { userId: { in: staffIds }, eventId, organizationId: orgId },
    });
    if (
      !entranceIds.length ||
      new Set(entranceIds).size !== entranceIds.length ||
      entrances !== entranceIds.length ||
      !staffIds.length ||
      new Set(staffIds).size !== staffIds.length ||
      staff !== staffIds.length ||
      assignments !== staffIds.length
    )
      throw new BadRequestException(
        'Choose active entrances and assigned scanner staff from this event.',
      );
  }
  async listCodes(
    eventId: number,
    actorId: number,
    role: string,
    orgId: number,
  ) {
    if (role !== 'super_admin') throw new ForbiddenException();
    await this.events.assertAccess(
      eventId,
      actorId,
      role,
      orgId,
      'users.manage',
    );
    return this.prisma.accessCode.findMany({
      where: { eventId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        active: true,
        createdAt: true,
        codeEntrances: { select: { entranceId: true } },
        codeStaff: { select: { userId: true } },
        _count: { select: { scannerSessions: true } },
      },
    });
  }
  async changeCode(
    eventId: number,
    codeId: number,
    actorId: number,
    role: string,
    orgId: number,
    operation: 'activate' | 'deactivate' | 'regenerate' | 'assign',
    dto?: { name: string; entranceIds: number[]; staffIds: number[] },
  ) {
    if (role !== 'super_admin')
      throw new ForbiddenException(
        'Only Super Admin can change scanner access.',
      );
    return this.events.mutate(
      eventId,
      actorId,
      role,
      orgId,
      'users.manage',
      async (tx, event) => {
        // Emergency deactivation remains available for closed/archived events.
        if (operation !== 'deactivate') this.events.assertEditable(event);
        const code = await tx.accessCode.findFirst({
          where: { id: codeId, eventId },
          include: { codeEntrances: true, codeStaff: true },
        });
        if (!code) throw new BadRequestException('Code not found.');
        if (operation !== 'deactivate')
          await this.validateCodeGrants(
            tx,
            eventId,
            orgId,
            dto?.entranceIds ?? code.codeEntrances.map((e) => e.entranceId),
            dto?.staffIds ?? code.codeStaff.map((u) => u.userId),
          );
        const raw =
          operation === 'regenerate'
            ? randomBytes(12).toString('hex').toUpperCase()
            : undefined;
        await tx.accessCode.update({
          where: { id: codeId },
          data: {
            ...(operation === 'activate'
              ? { active: true }
              : operation === 'deactivate'
                ? { active: false }
                : {}),
            ...(raw ? { codeHash: digest(raw) } : {}),
            ...(dto ? { name: dto.name.trim() } : {}),
          },
        });
        if (dto) {
          await tx.codeEntrance.deleteMany({ where: { codeId } });
          await tx.codeStaff.deleteMany({ where: { codeId } });
          await tx.codeEntrance.createMany({
            data: dto.entranceIds.map((entranceId) => ({
              codeId,
              entranceId,
              eventId,
            })),
          });
          await tx.codeStaff.createMany({
            data: dto.staffIds.map((userId) => ({ codeId, userId })),
          });
        }
        const sessions =
          operation === 'activate'
            ? { count: 0 }
            : await tx.scannerSession.deleteMany({
                where: { codeId, eventId },
              });
        await tx.auditLog.create({
          data: {
            actorId,
            eventId,
            action: `scanner.code_${operation}`,
            details: `Code ${codeId}; terminated sessions ${sessions.count}`,
          },
        });
        return {
          id: codeId,
          terminated: sessions.count,
          ...(raw ? { code: raw } : {}),
        };
      },
      true,
    );
  }
  async deactivateCode(
    eventId: number,
    codeId: number,
    actorId: number,
    role: string,
    orgId: number,
  ) {
    return this.changeCode(eventId, codeId, actorId, role, orgId, 'deactivate');
  }

  private async grant(tx: Tx, userId: number, eventId: number, codeId: number) {
    const [member, owner, assignment, code, allowed] = await Promise.all([
      tx.organizationUser.findUnique({ where: { userId } }),
      tx.organizationEvent.findUnique({ where: { eventId } }),
      tx.eventAssignment.findUnique({
        where: { userId_eventId: { userId, eventId } },
      }),
      tx.accessCode.findFirst({ where: { id: codeId, eventId, active: true } }),
      tx.codeStaff.findUnique({ where: { codeId_userId: { codeId, userId } } }),
    ]);
    if (
      !member ||
      member.role !== 'scanner' ||
      !owner ||
      owner.organizationId !== member.organizationId ||
      !assignment ||
      !code ||
      !allowed
    )
      throw new UnauthorizedException(
        'Scanner authorization is no longer valid. Sign in again with a valid event code.',
      );
    return tx.entrance.findMany({
      where: {
        eventId,
        active: true,
        codeEntrances: { some: { codeId, eventId } },
      },
      select: { id: true, name: true },
    });
  }

  async login(username: string, password: string, eventCode: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const normalized = username.trim().toLowerCase();
        await tx.$queryRaw`SELECT id FROM users WHERE username=${normalized} FOR UPDATE`;
        const user = await tx.user.findUnique({
          where: { username: normalized },
        });
        let valid = false;
        try {
          valid = await argon2.verify(
            user?.passwordHash ?? (await this.dummy),
            password,
          );
        } catch {}
        const now = new Date();
        const code = valid
          ? await tx.accessCode.findUnique({
              where: { codeHash: digest(eventCode.trim().toUpperCase()) },
            })
          : null;
        if (code)
          await tx.$queryRaw`SELECT id FROM events WHERE id=${code.eventId} FOR UPDATE`;
        let granted = false;
        if (
          user?.active &&
          valid &&
          (!user.lockedUntil || user.lockedUntil <= now) &&
          code?.active
        ) {
          try {
            granted =
              (await this.grant(tx, user.id, code.eventId, code.id)).length > 0;
          } catch {}
        }
        if (!user || !granted || (user.lockedUntil && user.lockedUntil > now)) {
          if (user?.active && (!user.lockedUntil || user.lockedUntil <= now)) {
            const failures = user.failedAttempts + 1;
            await tx.user.update({
              where: { id: user.id },
              data: {
                failedAttempts: failures >= 5 ? 0 : failures,
                lockedUntil: failures >= 5 ? new Date(+now + 900000) : null,
              },
            });
          }
          await tx.auditLog.create({
            data: { actorId: user?.id, action: 'scanner.login_failed' },
          });
          return null;
        }
        await tx.user.update({
          where: { id: user.id },
          data: { failedAttempts: 0, lockedUntil: null },
        });
        const profile = await tx.securityProfile.findUnique({
          where: { userId: user.id },
        });
        const token = newToken();
        if (profile?.forcePassword) {
          await tx.actionToken.deleteMany({
            where: { userId: user.id, purpose: 'scanner_password' },
          });
          await tx.actionToken.create({
            data: {
              tokenHash: token.hash,
              userId: user.id,
              purpose: 'scanner_password',
              payload: JSON.stringify({
                eventId: code!.eventId,
                codeId: code!.id,
              }),
              expiresAt: new Date(+now + 600000),
            },
          });
          return { requiresPasswordChange: true, challenge: token.raw };
        }
        await this.openSession(
          tx,
          user.id,
          code!.eventId,
          code!.id,
          token.hash,
        );
        return { requiresPasswordChange: false, token: token.raw };
      },
      { timeout: 20000 },
    );
    if (!result)
      throw new UnauthorizedException(
        'Invalid credentials, event code, or locked account.',
      );
    return result;
  }

  private async openSession(
    tx: Tx,
    userId: number,
    eventId: number,
    codeId: number,
    hash: string,
  ) {
    const state = {
      eventId,
      codeId,
      tokenHash: hash,
      entranceId: null,
      createdAt: new Date(),
      lastSeen: new Date(),
    };
    await tx.scannerSession.upsert({
      where: { userId },
      update: state,
      create: { userId, ...state },
    });
    await tx.auditLog.create({
      data: { actorId: userId, action: 'scanner.login' },
    }); // login-history view has no event/device context
  }

  async finishTemporaryPassword(challenge: string, newPassword: string) {
    if (newPassword.length < 12 || newPassword.length > 256)
      throw new BadRequestException(
        'Use a password between 12 and 256 characters.',
      );
    return this.prisma.$transaction(async (tx) => {
      const action = await tx.actionToken.findUnique({
        where: { tokenHash: digest(challenge) },
      });
      if (
        !action ||
        action.purpose !== 'scanner_password' ||
        action.expiresAt <= new Date()
      )
        throw new UnauthorizedException(
          'Password change expired. Sign in again.',
        );
      await tx.$queryRaw`SELECT id FROM users WHERE id=${action.userId} FOR UPDATE`;
      if (
        !(await tx.actionToken.findUnique({
          where: { tokenHash: action.tokenHash },
        }))
      )
        throw new UnauthorizedException('Challenge already used.');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: action.userId },
      });
      if (!user.active) throw new UnauthorizedException('Account disabled.');
      const { eventId, codeId } = JSON.parse(action.payload);
      await this.grant(tx, user.id, eventId, codeId);
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await argon2.hash(newPassword, {
            type: argon2.argon2id,
          }),
        },
      });
      await tx.securityProfile.update({
        where: { userId: user.id },
        data: { forcePassword: false },
      });
      await tx.actionToken.delete({ where: { tokenHash: action.tokenHash } });
      const token = newToken();
      await this.openSession(tx, user.id, eventId, codeId, token.hash);
      await tx.auditLog.create({
        data: { actorId: user.id, action: 'user.password_changed' },
      });
      return { token: token.raw };
    });
  }

  private async session(tx: Tx, raw: string, touch = true) {
    const record = await tx.scannerSession.findUnique({
      where: { tokenHash: digest(raw) },
    });
    if (!record) throw new UnauthorizedException('Sign in again.');
    // Code/session/assignment changes are checked live; account disablement
    // intentionally does not revoke an already established scanner session.
    const entrances = await this.grant(
      tx,
      record.userId,
      record.eventId,
      record.codeId,
    );
    if (touch)
      await tx.scannerSession.update({
        where: { userId: record.userId },
        data: { lastSeen: new Date() },
      });
    return { record, entrances };
  }

  async state(raw: string) {
    return this.prisma.$transaction(async (tx) => {
      const { record, entrances } = await this.session(tx, raw);
      const [
        event,
        user,
        preferences,
        accepted,
        rejected,
        recent,
        total,
        checked,
      ] = await Promise.all([
        tx.event.findUniqueOrThrow({
          where: { id: record.eventId },
          select: {
            id: true,
            name: true,
            eventDate: true,
            startsAt: true,
            endsAt: true,
            venue: true,
            status: true,
            archived: true,
          },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: record.userId },
          select: { displayName: true },
        }),
        tx.scannerPreference.upsert({
          where: { userId: record.userId },
          update: {},
          create: { userId: record.userId },
        }),
        tx.scanAttempt.count({
          where: { sessionHash: record.tokenHash, accepted: true },
        }),
        tx.scanAttempt.count({
          where: { sessionHash: record.tokenHash, accepted: false },
        }),
        tx.scanAttempt.findMany({
          where: { sessionHash: record.tokenHash },
          orderBy: { id: 'desc' },
          take: 10,
          select: {
            guestName: true,
            ticketNumber: true,
            accepted: true,
            message: true,
            createdAt: true,
          },
        }),
        tx.attendee.count({
          where: { eventId: record.eventId, status: 'Registered' },
        }),
        tx.attendee.count({
          where: {
            eventId: record.eventId,
            status: 'Registered',
            tickets: { some: { checkIn: { isNot: null } } },
          },
        }),
      ]);
      const { userId: _privateUserId, ...prefs } = preferences;
      return {
        event,
        staff: user.displayName,
        entrances,
        entranceId: record.entranceId,
        preferences: prefs,
        accepted,
        rejected,
        recent,
        total,
        checked,
        remaining: Math.max(0, total - checked),
      };
    });
  }

  async switchEntrance(raw: string, entranceId: number) {
    return this.prisma.$transaction(async (tx) => {
      const { record, entrances } = await this.session(tx, raw);
      if (!entrances.some((e) => e.id === entranceId))
        throw new ForbiddenException('Entrance is not permitted.');
      await tx.scannerSession.update({
        where: { userId: record.userId },
        data: { entranceId },
      });
      await tx.auditLog.create({
        data: {
          actorId: record.userId,
          eventId: record.eventId,
          action: 'scanner.entrance_changed',
          details: `Entrance ${entranceId}`,
        },
      });
      return { entranceId };
    });
  }

  async scan(raw: string, qr: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const initial = await this.session(tx, raw, false);
        await tx.$queryRaw`SELECT id FROM events WHERE id=${initial.record.eventId} FOR UPDATE`;
        const { record, entrances } = await this.session(tx, raw);
        // Revalidate after the event lock; deactivation uses the same lock.
        await this.grant(tx, record.userId, record.eventId, record.codeId);
        const live = await tx.scannerSession.findUnique({
          where: { userId: record.userId },
        });
        if (!live || live.tokenHash !== record.tokenHash)
          throw new UnauthorizedException('Sign in again.');
        const event = await tx.event.findUniqueOrThrow({
          where: { id: record.eventId },
        });
        const entrance = entrances.find((e) => e.id === record.entranceId);
        if (!entrance)
          throw new ForbiddenException('Select a permitted entrance.');
        const hash = parseQrPayload(qr);
        const ticket = hash
          ? await tx.ticket.findUnique({
              where: { tokenHash: hash },
              include: {
                attendee: true,
                category: true,
                checkIn: { include: { entrance: { select: { name: true } } } },
              },
            })
          : null;
        let reason = '';
        if (
          event.archived ||
          !['Published', 'Ongoing', 'Upcoming', 'Active'].includes(event.status)
        )
          reason = 'Event is not active.';
        else if (!ticket) reason = 'Invalid QR.';
        else if (ticket.eventId !== event.id) reason = 'Wrong event.';
        else if (ticket.status === 'Used' || ticket.checkIn)
          reason = 'Already checked in.';
        else if (ticket.status === 'Cancelled') reason = 'Ticket cancelled.';
        else if (ticket.status === 'Revoked') reason = 'Ticket revoked.';
        else if (
          await tx.ticketTransfer.count({
            where: { ticketId: ticket.id, status: 'Pending' },
          })
        )
          reason = 'Ticket transfer is pending approval.';
        else if (
          ticket.expiresAt <= new Date() ||
          event.endsAt <= new Date() ||
          ticket.status === 'Expired'
        )
          reason = 'Ticket expired.';
        else if (
          ticket.status !== 'Active' ||
          ticket.attendee.status !== 'Registered'
        )
          reason = 'Invitation is not active.';
        else if (!ticket.category.active)
          reason = 'Ticket category is inactive.';
        else if (
          !(await tx.entrancePermission.findUnique({
            where: {
              entranceId_categoryId: {
                entranceId: entrance.id,
                categoryId: ticket.categoryId,
              },
            },
          }))
        )
          reason = 'Wrong entrance for this category.';
        const accepted = !reason;
        if (accepted) {
          const changed = await tx.ticket.updateMany({
            where: { id: ticket!.id, status: 'Active' },
            data: { status: 'Used' },
          });
          if (changed.count !== 1)
            throw new BadRequestException('Ticket changed. Scan again.');
          await tx.checkIn.create({
            data: {
              eventId: event.id,
              ticketId: ticket!.id,
              entranceId: entrance.id,
              staffId: record.userId,
            },
          });
        }
        // Wrong-event rejections must not leak another event's guest identity.
        const own = ticket?.eventId === event.id;
        await tx.scanAttempt.create({
          data: {
            eventId: event.id,
            userId: record.userId,
            sessionHash: record.tokenHash,
            accepted,
            message: reason || 'Entry approved.',
            guestName: own ? ticket!.attendee.fullName : '',
            ticketNumber: own ? ticket!.number : '',
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: record.userId,
            eventId: event.id,
            action: accepted ? 'checkin.accepted' : 'checkin.rejected',
            details: `Entrance ${entrance.id}; ${reason || 'Entry approved'}; ticket ${own ? ticket!.number : 'unknown'}`,
          },
        });
        return {
          accepted,
          message: reason || 'Entry approved.',
          guestName: own ? ticket!.attendee.fullName : '',
          ticketNumber: own ? ticket!.number : '',
          eventName: event.name,
          eventDate: event.eventDate,
          category: own ? ticket!.category.name : '',
          entrance: entrance.name,
          ...(own && ticket!.checkIn
            ? {
                originalTime: ticket!.checkIn.checkedAt,
                originalEntrance: ticket!.checkIn.entrance.name,
              }
            : {}),
        };
      },
      { timeout: 15000 },
    );
  }

  async preferences(
    raw: string,
    values: {
      successSound: boolean;
      rejectionSound: boolean;
      successVibration: boolean;
      rejectionVibration: boolean;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { record } = await this.session(tx, raw);
      await tx.scannerPreference.upsert({
        where: { userId: record.userId },
        update: values,
        create: { userId: record.userId, ...values },
      });
      return { saved: true };
    });
  }

  async logout(raw: string) {
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.scannerSession.findUnique({
        where: { tokenHash: digest(raw) },
      });
      if (record) {
        await tx.scannerSession.delete({ where: { userId: record.userId } });
        await tx.auditLog.create({
          data: { actorId: record.userId, action: 'scanner.logout' },
        });
      }
    });
  }

  async remoteLogout(
    userId: number,
    actorId: number,
    role: string,
    orgId: number,
  ) {
    if (role !== 'super_admin') throw new ForbiddenException();
    const member = await this.prisma.organizationUser.findUnique({
      where: { userId },
    });
    if (!member || member.organizationId !== orgId)
      throw new ForbiddenException();
    await this.prisma.$transaction(async (tx) => {
      await tx.scannerSession.deleteMany({ where: { userId } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'scanner.remote_logout',
          details: `User ${userId}`,
        },
      });
    });
  }
}
