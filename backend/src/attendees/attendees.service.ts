import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { hasPermission } from '../common/guards/jwt-auth.guard.js';

@Injectable()
export class AttendeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  async findAll(eventId: number, userId: number, orgRole: string, orgId: number) {
    await this.eventsService.assertAccess(eventId, userId, orgRole, orgId, 'attendees.manage');
    return this.prisma.attendee.findMany({
      where: { eventId },
      orderBy: { fullName: 'asc' },
      include: { category: { select: { id: true, name: true } }, tickets: { select: { id: true, number: true, status: true } } },
    });
  }

  async findOne(eventId: number, id: number, userId: number, orgRole: string, orgId: number) {
    await this.eventsService.assertAccess(eventId, userId, orgRole, orgId, 'attendees.manage');
    const attendee = await this.prisma.attendee.findFirst({
      where: { id, eventId },
      include: { category: true, tickets: {select:{id:true,number:true,status:true,expiresAt:true}} },
    });
    if (!attendee) throw new NotFoundException('Attendee not found.');
    return attendee;
  }

  async create(eventId: number, dto: any, userId: number, orgRole: string, orgId: number) {
    if (!hasPermission(orgRole, 'attendees.manage')) throw new ForbiddenException('Permission denied.');
    await this.eventsService.assertAccess(eventId, userId, orgRole, orgId, 'attendees.manage');
    const event = await this.eventsService.getActiveEvent(eventId);
    if (event.registrationDeadline && new Date() > event.registrationDeadline) {
      throw new BadRequestException('The registration deadline has passed.');
    }
    const category = await this.prisma.ticketCategory.findFirst({ where: { id: dto.categoryId, eventId, active: true } });
    if (!category) throw new BadRequestException('Invalid or inactive category.');
    this.validateEmail(dto.email);
    if (dto.email || dto.identityNumber) {
      const dupe = await this.prisma.attendee.findFirst({
        where: { eventId, OR: [...(dto.email ? [{ email: dto.email.toLowerCase() }] : []), ...(dto.identityNumber ? [{ identityNumber: dto.identityNumber }] : [])] },
      });
      if (dupe) throw new BadRequestException('An attendee with this email or ID is already registered.');
    } else {
      throw new BadRequestException('Provide an email or identity number.');
    }
    const attendee = await this.prisma.attendee.create({
      data: {
        eventId, categoryId: dto.categoryId,
        fullName: dto.fullName?.trim(), email: dto.email?.toLowerCase() || null,
        phone: dto.phone?.trim() ?? '', identityNumber: dto.identityNumber?.trim() || null,
        organization: dto.organization?.trim() ?? '', notes: dto.notes?.trim() ?? '',
        status: 'Registered',
      },
    });
    await this.prisma.auditLog.create({ data: { actorId: userId, eventId, action: 'attendee.created', details: `Attendee ${attendee.id}` } });
    return attendee;
  }

  async update(eventId: number, id: number, dto: any, userId: number, orgRole: string, orgId: number) {
    await this.eventsService.assertAccess(eventId, userId, orgRole, orgId, 'attendees.manage');
    await this.eventsService.getActiveEvent(eventId);
    const attendee = await this.prisma.attendee.findFirst({ where: { id, eventId } });
    if (!attendee) throw new NotFoundException('Attendee not found.');
    if (await this.prisma.guestInvitation.findUnique({where:{attendeeId:id}})) throw new BadRequestException('Manage this registration through Students & Invitations.');
    if (dto.categoryId && dto.categoryId !== attendee.categoryId) {
      const ticketCount = await this.prisma.ticket.count({ where: { attendeeId: id } });
      if (ticketCount > 0) throw new BadRequestException('Cannot change category when tickets exist.');
    }
    if (dto.email) this.validateEmail(dto.email);
    const updated = await this.prisma.attendee.update({
      where: { id },
      data: {
        fullName: dto.fullName?.trim() ?? attendee.fullName,
        email: dto.email ? dto.email.toLowerCase() : attendee.email,
        phone: dto.phone?.trim() ?? attendee.phone,
        identityNumber: dto.identityNumber?.trim() || attendee.identityNumber,
        organization: dto.organization?.trim() ?? attendee.organization,
        notes: dto.notes?.trim() ?? attendee.notes,
        categoryId: dto.categoryId ?? attendee.categoryId,
      },
    });
    await this.prisma.auditLog.create({ data: { actorId: userId, eventId, action: 'attendee.updated', details: `Attendee ${id}` } });
    return updated;
  }

  async cancel(eventId: number, id: number, userId: number, orgRole: string, orgId: number) {
    await this.eventsService.assertAccess(eventId, userId, orgRole, orgId, 'attendees.manage');
    if (await this.prisma.guestInvitation.findFirst({where:{attendeeId:id,eventId}})) throw new BadRequestException('Manage this registration through Students & Invitations.');
    await this.eventsService.getActiveEvent(eventId);
    const attendee = await this.prisma.attendee.findFirst({ where: { id, eventId } });
    if (!attendee) throw new NotFoundException('Attendee not found.');
    await this.prisma.$transaction([
      this.prisma.attendee.update({ where: { id }, data: { status: 'Cancelled' } }),
      this.prisma.ticket.updateMany({ where: { attendeeId: id, status: 'Active' }, data: { status: 'Revoked' } }),
    ]);
    await this.prisma.auditLog.create({ data: { actorId: userId, eventId, action: 'attendee.cancelled', details: `Attendee ${id}` } });
  }

  async delete(eventId: number, id: number, userId: number, orgRole: string, orgId: number) {
    await this.eventsService.assertAccess(eventId, userId, orgRole, orgId, 'attendees.manage');
    if (await this.prisma.guestInvitation.findFirst({where:{attendeeId:id,eventId}})) throw new BadRequestException('Manage this registration through Students & Invitations.');
    if (!await this.prisma.attendee.findFirst({where:{id,eventId}})) throw new NotFoundException('Attendee not found.');
    await this.eventsService.getActiveEvent(eventId);
    const ticketCount = await this.prisma.ticket.count({ where: { attendeeId: id } });
    if (ticketCount > 0) throw new BadRequestException('This attendee has ticket history. Cancel registration instead.');
    await this.prisma.attendee.update({ where: { id }, data: {status: 'Cancelled'} });
    await this.prisma.auditLog.create({ data: { actorId: userId, eventId, action: 'attendee.deleted', details: `Attendee ${id}` } });
  }

  private validateEmail(email?: string) {
    if (!email) return;
    const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!re.test(email)) throw new BadRequestException('Enter a valid email address.');
  }
}
