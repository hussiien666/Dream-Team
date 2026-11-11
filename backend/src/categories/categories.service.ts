import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService, rejectNulls } from '../events/events.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './access.dto.js';
@Injectable()
export class CategoriesService {
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
    return this.prisma.ticketCategory.findMany({
      where: { eventId },
      orderBy: { name: 'asc' },
    });
  }
  private async conflict(
    tx: Prisma.TransactionClient,
    eventId: number,
    dto: UpdateCategoryDto,
    id?: number,
  ) {
    const choices: Prisma.TicketCategoryWhereInput[] = [];
    if (dto.name !== undefined)
      choices.push({ name: { equals: dto.name.trim(), mode: 'insensitive' } });
    if (dto.code !== undefined)
      choices.push({
        code: { equals: dto.code.toUpperCase(), mode: 'insensitive' },
      });
    if (
      choices.length &&
      (await tx.ticketCategory.findFirst({
        where: { eventId, id: { not: id }, OR: choices },
      }))
    )
      throw new BadRequestException(
        'A category with that name or code already exists.',
      );
  }
  async create(
    eventId: number,
    dto: CreateCategoryDto,
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
        await this.conflict(tx, eventId, dto);
        const category = await tx.ticketCategory.create({
          data: {
            ...dto,
            eventId,
            name: dto.name.trim(),
            code: dto.code.toUpperCase(),
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId,
            action: 'category.created',
            details: `Category ${category.id}`,
          },
        });
        return category;
      },
    );
  }
  async update(
    eventId: number,
    id: number,
    dto: UpdateCategoryDto,
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
        const category = await tx.ticketCategory.findFirst({
          where: { id, eventId },
        });
        if (!category) throw new NotFoundException('Category not found.');
        await this.conflict(tx, eventId, dto, id);
        const live = await tx.ticket.count({
          where: { categoryId: id, status: { in: ['Active', 'Used'] } },
        });
        if (dto.allocation !== undefined && dto.allocation < live)
          throw new BadRequestException(
            'Allocation cannot be below active/used tickets.',
          );
        if (dto.maxPerAttendee !== undefined) {
          const groups = await tx.ticket.groupBy({
            by: ['attendeeId'],
            where: { categoryId: id, status: { in: ['Active', 'Used'] } },
            _count: { id: true },
          });
          if (groups.some((g) => g._count.id > dto.maxPerAttendee!))
            throw new BadRequestException(
              'Per-attendee limit cannot be below tickets already issued.',
            );
        }
        if (dto.active === false && (await this.isDefault(tx, eventId, id)))
          throw new BadRequestException(
            'Choose another default category before deactivating this one.',
          );
        const updated = await tx.ticketCategory.update({
          where: { id },
          data: {
            ...dto,
            name: dto.name?.trim(),
            code: dto.code?.toUpperCase(),
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId,
            action: 'category.updated',
            details: `Category ${id}`,
          },
        });
        return updated;
      },
    );
  }
  private async isDefault(
    tx: Prisma.TransactionClient,
    eventId: number,
    id: number,
  ) {
    const setting = await tx.eventSetting.findUnique({
      where: { eventId_key: { eventId, key: 'product.v1' } },
    });
    return setting && JSON.parse(setting.value).defaultCategoryId === id;
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
        if (!(await tx.ticketCategory.findFirst({ where: { id, eventId } })))
          throw new NotFoundException('Category not found.');
        if (await tx.attendee.count({ where: { categoryId: id } }))
          throw new BadRequestException(
            'This category has attendees. Set it inactive instead.',
          );
        if (await this.isDefault(tx, eventId, id))
          throw new BadRequestException(
            'Choose another default category first.',
          );
        await tx.ticketCategory.update({
          where: { id },
          data: { active: false },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId,
            action: 'category.deactivated',
            details: `Category ${id}; record retained`,
          },
        });
      },
    );
  }
}
