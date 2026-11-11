import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService, rejectNulls } from '../events/events.service.js';
import {
  CreateEntranceDto,
  UpdateEntranceDto,
} from '../categories/access.dto.js';
@Injectable()
export class EntrancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}
  async findAll(eventId: number, userId: number, role: string, orgId: number) {
    await this.eventsService.assertAccess(
      eventId,
      userId,
      role,
      orgId,
      'events.view',
    );
    return this.prisma.entrance.findMany({
      where: { eventId },
      orderBy: { name: 'asc' },
      include: { entrancePermissions: { include: { category: true } } },
    });
  }
  private async validate(
    tx: Prisma.TransactionClient,
    eventId: number,
    dto: UpdateEntranceDto,
    id?: number,
  ) {
    const choices: Prisma.EntranceWhereInput[] = [];
    if (dto.name !== undefined)
      choices.push({ name: { equals: dto.name.trim(), mode: 'insensitive' } });
    if (dto.code !== undefined)
      choices.push({
        code: { equals: dto.code.toUpperCase(), mode: 'insensitive' },
      });
    if (
      choices.length &&
      (await tx.entrance.findFirst({
        where: { eventId, id: { not: id }, OR: choices },
      }))
    )
      throw new BadRequestException(
        'An entrance with that name or code already exists.',
      );
    if (
      dto.categoryIds !== undefined &&
      (await tx.ticketCategory.count({
        where: { id: { in: dto.categoryIds }, eventId, active: true },
      })) !== dto.categoryIds.length
    )
      throw new BadRequestException(
        'Choose active categories from this event.',
      );
  }
  async create(
    eventId: number,
    dto: CreateEntranceDto,
    userId: number,
    role: string,
    orgId: number,
  ) {
    rejectNulls(dto);
    return this.eventsService.mutate(
      eventId,
      userId,
      role,
      orgId,
      'access.manage',
      async (tx) => {
        await this.validate(tx, eventId, dto);
        const { categoryIds = [], ...fields } = dto;
        const entrance = await tx.entrance.create({
          data: {
            ...fields,
            eventId,
            name: dto.name.trim(),
            code: dto.code.toUpperCase(),
          },
        });
        await tx.entrancePermission.createMany({
          data: categoryIds.map((categoryId) => ({
            eventId,
            entranceId: entrance.id,
            categoryId,
          })),
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId,
            action: 'entrance.created',
            details: `Entrance ${entrance.id}`,
          },
        });
        return entrance;
      },
    );
  }
  async update(
    eventId: number,
    id: number,
    dto: UpdateEntranceDto,
    userId: number,
    role: string,
    orgId: number,
  ) {
    rejectNulls(dto);
    return this.eventsService.mutate(
      eventId,
      userId,
      role,
      orgId,
      'access.manage',
      async (tx) => {
        if (!(await tx.entrance.findFirst({ where: { id, eventId } })))
          throw new NotFoundException('Entrance not found.');
        await this.validate(tx, eventId, dto, id);
        const { categoryIds, ...fields } = dto;
        await tx.entrance.update({
          where: { id },
          data: {
            ...fields,
            name: dto.name?.trim(),
            code: dto.code?.toUpperCase(),
          },
        });
        if (categoryIds !== undefined) {
          await tx.entrancePermission.deleteMany({ where: { entranceId: id } });
          await tx.entrancePermission.createMany({
            data: categoryIds.map((categoryId) => ({
              eventId,
              entranceId: id,
              categoryId,
            })),
          });
        }
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId,
            action: 'entrance.updated',
            details: `Entrance ${id}`,
          },
        });
        return tx.entrance.findUnique({
          where: { id },
          include: { entrancePermissions: true },
        });
      },
    );
  }
  async delete(
    eventId: number,
    id: number,
    userId: number,
    role: string,
    orgId: number,
  ) {
    return this.eventsService.mutate(
      eventId,
      userId,
      role,
      orgId,
      'access.manage',
      async (tx) => {
        if (!(await tx.entrance.findFirst({ where: { id, eventId } })))
          throw new NotFoundException('Entrance not found.');
        if (await tx.checkIn.count({ where: { entranceId: id } }))
          throw new BadRequestException(
            'This entrance has check-in history. Set it inactive instead.',
          );
        await tx.entrance.update({ where: { id }, data: { active: false } });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId,
            action: 'entrance.deactivated',
            details: `Entrance ${id}; record retained`,
          },
        });
      },
    );
  }
}
