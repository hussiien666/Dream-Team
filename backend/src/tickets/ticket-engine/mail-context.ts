import type { Prisma } from '@prisma/client';
import { digest } from '../../common/crypto.util.js';
import { eventDesign, escapeHtml } from './design.js';
import { formatEventTime } from './content.js';
export async function mailContext(
  tx: Prisma.TransactionClient,
  ticketId: number,
) {
  const ticket = await tx.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      event: true,
      category: true,
      attendee: {
        include: { guestInvitation: { include: { student: true } } },
      },
    },
  });
  const { event, attendee, category } = ticket,
    guest = attendee.guestInvitation;
  const settings = JSON.parse(
    (
      await tx.eventSetting.findUnique({
        where: { eventId_key: { eventId: event.id, key: 'product.v1' } },
      })
    )?.value ?? '{}',
  );
  const design = await eventDesign(tx, event.id);
  const entrances = await tx.entrance.findMany({
    where: {
      eventId: event.id,
      active: true,
      entrancePermissions: { some: { categoryId: category.id } },
    },
    orderBy: { id: 'asc' },
  });
  const recipient = guest ? guest.email : attendee.email;
  const recipients = new Set<string>();
  if (recipient && settings.directGuestDelivery !== false)
    recipients.add(recipient.toLowerCase());
  if (guest && (settings.studentCopies !== false || !recipient))
    recipients.add(guest.student.email.toLowerCase());
  const content = {
    name: attendee.fullName,
    guestEmail: recipient,
    student: guest?.student.fullName,
    studentEmail: guest?.student.email,
    group: guest?.invitationGroup,
    eventName: event.name,
    subtitle: event.subtitle,
    organization: event.organization,
    venue: event.venue,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    instructions: event.instructions,
    categoryId: category.id,
    categoryName: category.name,
    entrances: entrances.map((e) => ({
      name: e.name,
      instructions: e.instructions,
      location: e.location,
    })),
    design,
    eventLogo: event.logo
      ? digest(Buffer.from(event.logo).toString('base64'))
      : null,
    mailTemplate:
      (
        await tx.eventSetting.findUnique({
          where: { eventId_key: { eventId: event.id, key: 'ticket-email.v1' } },
        })
      )?.value ?? '',
  };
  const valid =
    !event.archived &&
    ['Published', 'Ongoing', 'Upcoming', 'Active'].includes(event.status) &&
    event.endsAt > new Date() &&
    ticket.expiresAt > new Date() &&
    ticket.status === 'Active' &&
    attendee.status === 'Registered' &&
    category.active &&
    (!guest || (guest.active && guest.student.active)) &&
    entrances.length > 0;
  return {
    ticket,
    event,
    attendee,
    category,
    entrances,
    design,
    settings,
    recipients: [...recipients],
    fingerprint: digest(JSON.stringify(content)),
    valid,
  };
}
export const defaultMailTemplate = {
  subject: 'Your ticket for {event_name}',
  greeting: 'Hello {guest_name},',
  body: 'Your ticket for {event_name} on {event_date} is attached. Keep this ticket private.',
  signature: 'Dream Events',
  contact: '',
};
export function ticketMessage(
  template: typeof defaultMailTemplate,
  context: Awaited<ReturnType<typeof mailContext>>,
) {
  const replacements: Record<string, string> = {
    guest_name: context.attendee.fullName,
    student_name: context.attendee.guestInvitation?.student.fullName ?? '',
    event_name: context.event.name,
    event_date: formatEventTime(context.event),
  };
  const fill = (v: string) =>
    v.replace(
      /\{(guest_name|student_name|event_name|event_date)\}/g,
      (_, key) => replacements[key],
    );
  const subject = fill(template.subject)
      .replace(/[\r\n]/g, ' ')
      .slice(0, 300),
    lines = [
      template.greeting,
      template.body,
      template.signature,
      template.contact,
    ]
      .filter(Boolean)
      .map(fill);
  return {
    subject,
    text: lines.join('\n\n'),
    html:
      `<div style="font:16px/1.5 Arial,sans-serif;color:${context.design.primaryColor};border-top:4px solid ${context.design.accentColor};padding:20px">` +
      lines
        .map(
          (line) =>
            `<p dir="auto" style="white-space:pre-wrap">${escapeHtml(line)}</p>`,
        )
        .join('') +
      '</div>',
  };
}
