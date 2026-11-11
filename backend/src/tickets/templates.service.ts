import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import {
  defaultDesign,
  parseDesign,
  validateImages,
  eventDesign,
  type TicketDesign,
} from './ticket-engine/design.js';
import { generatePdfTicket } from './ticket-engine/pdf.util.js';
import { generateMobileTicket } from './ticket-engine/mobile.util.js';
import type { AuthenticatedRequest as Request } from '../common/request.js';
const name = z.string().trim().min(1).max(100);
export function payload<T>(schema: z.ZodType<T>, value: unknown): T {
  const v = schema.safeParse(value);
  if (!v.success)
    throw new BadRequestException(
      'Invalid template request: ' +
        v.error.issues.map((i) => i.message).join('; '),
    );
  return v.data;
}
@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: EventsService,
  ) {}
  async list(e: number, r: Request) {
    await this.events.assertAccess(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
    );
    return {
      templates: await this.db.ticketTemplate.findMany({
        where: { organizationId: r.orgId },
        orderBy: { name: 'asc' },
      }),
      applied: await eventDesign(this.db, e),
      defaults: defaultDesign,
    };
  }
  async save(e: number, id: number | undefined, body: unknown, r: Request) {
    const input = payload(
        z.object({ name, config: z.unknown() }).strict(),
        body,
      ),
      config = parseDesign(input.config);
    await validateImages(config);
    return this.events.mutate(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${-r.orgId})`;
        if (
          id &&
          !(await tx.ticketTemplate.findFirst({
            where: { id, organizationId: r.orgId },
          }))
        )
          throw new NotFoundException(
            'Template not found in this organization.',
          );
        if (
          await tx.ticketTemplate.count({
            where: {
              organizationId: r.orgId,
              name: input.name,
              ...(id ? { id: { not: id } } : {}),
            },
          })
        )
          throw new BadRequestException(
            'A template with that name already exists.',
          );
        const value = id
          ? await tx.ticketTemplate.update({
              where: { id },
              data: { name: input.name, config },
            })
          : await tx.ticketTemplate.create({
              data: { organizationId: r.orgId, name: input.name, config },
            });
        await tx.auditLog.create({
          data: {
            actorId: r.user.id,
            eventId: e,
            action: id ? 'template.updated' : 'template.created',
            details: `Template ${value.id}`,
          },
        });
        return value;
      },
      true,
    );
  }
  async duplicate(e: number, id: number, body: unknown, r: Request) {
    await this.events.assertAccess(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
    );
    const input = payload(z.object({ name }).strict(), body),
      original = await this.db.ticketTemplate.findFirst({
        where: { id, organizationId: r.orgId },
      });
    if (!original) throw new NotFoundException('Template not found.');
    return this.save(
      e,
      undefined,
      { name: input.name, config: original.config },
      r,
    );
  }
  async remove(e: number, id: number, body: unknown, r: Request) {
    payload(z.object({ confirmed: z.literal(true) }).strict(), body);
    return this.events.mutate(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        if (
          !(await tx.ticketTemplate.findFirst({
            where: { id, organizationId: r.orgId },
          }))
        )
          throw new NotFoundException('Template not found.');
        await tx.ticketTemplate.delete({ where: { id } });
        await tx.auditLog.create({
          data: {
            actorId: r.user.id,
            eventId: e,
            action: 'template.deleted',
            details: `Template ${id}; applied event snapshots retained`,
          },
        });
        return { deleted: true };
      },
      true,
    );
  }
  async apply(e: number, body: unknown, r: Request) {
    const { templateId } = payload(
      z.object({ templateId: z.number().int().positive().nullable() }).strict(),
      body,
    );
    return this.events.mutate(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        let config: TicketDesign = defaultDesign;
        if (templateId) {
          const template = await tx.ticketTemplate.findFirst({
            where: { id: templateId, organizationId: r.orgId },
          });
          if (!template)
            throw new NotFoundException(
              'Template not found in this organization.',
            );
          config = parseDesign(template.config);
        }
        const value = JSON.stringify({ templateId, config });
        await tx.eventSetting.upsert({
          where: { eventId_key: { eventId: e, key: 'ticket-design.v1' } },
          create: { eventId: e, key: 'ticket-design.v1', value },
          update: { value },
        });
        await tx.auditLog.create({
          data: {
            actorId: r.user.id,
            eventId: e,
            action: 'template.applied',
            details: `Template ${templateId ?? 'default'}; QR identities unchanged`,
          },
        });
        return { applied: config };
      },
      true,
    );
  }
  async preview(e: number, body: unknown, r: Request) {
    await this.events.assertAccess(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
    );
    const input = payload(
        z
          .object({ config: z.unknown(), format: z.enum(['pdf', 'html']) })
          .strict(),
        body,
      ),
      design = parseDesign(input.config);
    await validateImages(design);
    const event = await this.db.event.findUniqueOrThrow({ where: { id: e } });
    const sample = {
      fullName: 'Sample guest / ضيف تجريبي',
      guestInvitation: {
        student: { fullName: 'Sample student / طالب' },
        invitationGroup: 'Family',
      },
    };
    const entrances = await this.db.entrance.findMany({
      where: { eventId: e, active: true },
    });
    const ticket = {
      number: 'PREVIEW - NOT VALID FOR ENTRY',
      status: 'Preview only',
    };
    // Invalid-length payload is intentionally never a usable ticket credential.
    return input.format === 'pdf'
      ? generatePdfTicket(
          event,
          sample,
          { name: 'Sample category' },
          ticket,
          'PREVIEW-ONLY',
          entrances,
          design,
        )
      : generateMobileTicket(
          event,
          sample,
          { name: 'Sample category' },
          ticket,
          'PREVIEW-ONLY',
          entrances,
          design,
        );
  }
}
