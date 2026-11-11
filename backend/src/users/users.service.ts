import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { hasPermission } from '../common/guards/jwt-auth.guard.js';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: number, orgRole: string) {
    if (!hasPermission(orgRole, 'users.manage')) throw new ForbiddenException();
    const users = await this.prisma.user.findMany({
      where: { organizationUser: { organizationId: orgId } },
      include: {
        organizationUser: true,
        eventAssignments: { select: { eventId: true } },
        securityProfile: {
          select: { email: true, emailVerified: true, factorMethod: true },
        },
      },
      orderBy: { displayName: 'asc' },
    });
    return users.map(({ passwordHash: _hash, ...user }) => user);
  }

  async create(dto: any, actorId: number, orgId: number, orgRole: string) {
    if (!hasPermission(orgRole, 'users.manage')) throw new ForbiddenException();
    const username = dto.username?.trim().toLowerCase();
    if (!username || username.length > 80 || !/^[a-z0-9._-]+$/.test(username)) {
      throw new BadRequestException(
        'Use a username of up to 80 alphanumeric characters, dots, underscores or hyphens.',
      );
    }
    if (
      typeof dto.password !== 'string' ||
      dto.password.length < 12 ||
      dto.password.length > 256
    )
      throw new BadRequestException(
        'Use a password between 12 and 256 characters.',
      );
    if (
      ![
        'super_admin',
        'event_manager',
        'ticket_manager',
        'checkin_supervisor',
        'scanner',
      ].includes(dto.orgRole)
    )
      throw new BadRequestException('Choose a supported role.');
    if (
      typeof dto.displayName !== 'string' ||
      !dto.displayName.trim() ||
      dto.displayName.length > 160
    )
      throw new BadRequestException(
        'Enter a display name of up to 160 characters.',
      );
    if (await this.prisma.user.findUnique({ where: { username } })) {
      throw new BadRequestException('That username is already in use.');
    }
    const passwordHash = await argon2.hash(dto.password);
    if (dto.eventId === null)
      throw new BadRequestException('Choose a valid event.');
    const user = await this.prisma.$transaction(
      async (tx) => {
        if (dto.eventId !== undefined) {
          await tx.$queryRaw`SELECT id FROM events WHERE id=${dto.eventId} FOR UPDATE`;
          const event = await tx.event.findFirst({
            where: {
              id: dto.eventId,
              organizationEvent: { organizationId: orgId },
            },
          });
          if (!event)
            throw new ForbiddenException('Event not in your organization.');
          if (
            event.archived ||
            ['Cancelled', 'Completed'].includes(event.status)
          )
            throw new BadRequestException('This event is read-only.');
        }
        const created = await tx.user.create({
          data: {
            username,
            displayName: dto.displayName.trim(),
            passwordHash,
            role: dto.orgRole === 'scanner' ? 'staff' : 'admin',
            organizationUser: {
              create: { organizationId: orgId, role: dto.orgRole },
            },
            ...(dto.eventId
              ? {
                  eventAssignments: {
                    create: { eventId: dto.eventId, organizationId: orgId },
                  },
                }
              : {}),
          },
          include: { organizationUser: true },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            eventId: dto.eventId,
            action: 'user.created',
            details: `User ${created.id}`,
          },
        });
        if (dto.eventId)
          await tx.auditLog.create({
            data: {
              actorId,
              eventId: dto.eventId,
              action: 'user.event_assigned',
              details: `User ${created.id}`,
            },
          });
        return created;
      },
      { timeout: 20000 },
    );
    const { passwordHash: _hash, ...safe } = user;
    return safe;
  }

  async update(
    id: number,
    dto: any,
    actorId: number,
    orgId: number,
    orgRole: string,
  ) {
    if (!hasPermission(orgRole, 'users.manage')) throw new ForbiddenException();
    if (dto.displayName === null || dto.orgRole === null)
      throw new BadRequestException('Account fields cannot be empty.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${id} FOR UPDATE`;
      const member = await tx.organizationUser.findFirst({
        where: { userId: id, organizationId: orgId },
      });
      if (!member)
        throw new NotFoundException('User not found in your organization.');
      const changed = dto.orgRole && dto.orgRole !== member.role;
      if (changed && id === actorId)
        throw new BadRequestException(
          'You cannot remove your own Super Admin access.',
        );
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.displayName !== undefined
            ? { displayName: dto.displayName.trim() }
            : {}),
          ...(changed
            ? { role: dto.orgRole === 'scanner' ? 'staff' : 'admin' }
            : {}),
        },
      });
      if (changed) {
        await tx.organizationUser.update({
          where: { userId: id },
          data: { role: dto.orgRole },
        });
        await tx.authSession.deleteMany({ where: { userId: id } });
        await tx.scannerSession.deleteMany({ where: { userId: id } });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: changed ? 'user.role_changed' : 'user.updated',
          details: `User ${id}; fields ${Object.keys(dto).join(',')}`,
        },
      });
    });
  }

  async setActive(
    id: number,
    active: boolean,
    actorId: number,
    orgId: number,
    orgRole: string,
  ) {
    if (!hasPermission(orgRole, 'users.manage')) throw new ForbiddenException();
    if (id === actorId && !active)
      throw new BadRequestException('You cannot disable your own account.');
    const member = await this.prisma.organizationUser.findFirst({
      where: { userId: id, organizationId: orgId },
    });
    if (!member) throw new NotFoundException('User not found.');
    await this.prisma.user.update({ where: { id }, data: { active } });
    if (!active)
      await this.prisma.authSession.deleteMany({ where: { userId: id } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: active ? 'user.enabled' : 'user.disabled',
        details: `User ${id}`,
      },
    });
  }

  async setRole(
    id: number,
    role: string,
    actorId: number,
    orgId: number,
    orgRole: string,
  ) {
    if (orgRole !== 'super_admin')
      throw new ForbiddenException('Only Super Admin can change roles.');
    if (id === actorId && role !== 'super_admin')
      throw new BadRequestException(
        'You cannot remove your own Super Admin access.',
      );
    if (
      ![
        'super_admin',
        'event_manager',
        'ticket_manager',
        'checkin_supervisor',
        'scanner',
      ].includes(role)
    )
      throw new BadRequestException('Choose a supported role.');
    return this.update(id, { orgRole: role }, actorId, orgId, orgRole);
  }

  async temporaryPassword(
    id: number,
    actorId: number,
    orgId: number,
    orgRole: string,
  ) {
    if (!hasPermission(orgRole, 'users.manage')) throw new ForbiddenException();
    if (id === actorId)
      throw new BadRequestException('Use your own password settings.');
    const member = await this.prisma.organizationUser.findFirst({
      where: { userId: id, organizationId: orgId },
    });
    if (!member) throw new NotFoundException('User not found.');
    const password = crypto.randomBytes(12).toString('base64url').slice(0, 16);
    const passwordHash = await argon2.hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash } }),
      this.prisma.securityProfile.upsert({
        where: { userId: id },
        update: { forcePassword: true },
        create: { userId: id, forcePassword: true },
      }),
      this.prisma.authSession.deleteMany({ where: { userId: id } }),
    ]);
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'security.temporary_password',
        details: `User ${id}`,
      },
    });
    return { password };
  }

  async assignEvent(
    userId: number,
    eventId: number,
    assigned: boolean,
    actorId: number,
    orgId: number,
    orgRole: string,
  ) {
    if (!hasPermission(orgRole, 'users.manage')) throw new ForbiddenException();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id=${eventId} FOR UPDATE`;
      const member = await tx.organizationUser.findFirst({
        where: { userId, organizationId: orgId },
      });
      if (!member) throw new NotFoundException('User not found.');
      const owner = await tx.organizationEvent.findUnique({
        where: { eventId },
      });
      if (!owner || owner.organizationId !== orgId)
        throw new ForbiddenException('Event not in your organization.');
      const event = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
      });
      if (event.archived || ['Completed', 'Cancelled'].includes(event.status))
        throw new BadRequestException('This event is read-only.');
      if (assigned)
        await tx.eventAssignment.upsert({
          where: { userId_eventId: { userId, eventId } },
          update: {},
          create: { userId, eventId, organizationId: orgId },
        });
      else {
        await tx.eventAssignment.deleteMany({ where: { userId, eventId } });
        await tx.scannerSession.deleteMany({ where: { userId, eventId } });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          eventId,
          action: assigned ? 'user.event_assigned' : 'user.event_unassigned',
          details: `User ${userId}`,
        },
      });
    });
  }
}
