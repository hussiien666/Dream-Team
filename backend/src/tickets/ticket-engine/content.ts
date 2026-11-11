import type { TicketDesign } from './design.js';
export function formatEventTime(event: any): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: event.timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: event.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date.format(new Date(event.startsAt))} - ${time.format(new Date(event.startsAt))} to ${time.format(new Date(event.endsAt))} (${event.timezone})`;
}
export function details(
  event: any,
  attendee: any,
  category: any,
  ticket: any,
  entrances: any[],
  design: TicketDesign,
) {
  const values: Record<string, [string, unknown]> = {
    organization: ['Organization', event.organization],
    subtitle: ['', event.subtitle],
    date: ['Date', formatEventTime(event)],
    venue: ['Venue', event.venue],
    student: ['Invited by', attendee.guestInvitation?.student.fullName],
    group: ['Invitation group', attendee.guestInvitation?.invitationGroup],
    category: ['Category', category.name],
    number: ['Ticket number', ticket.number],
    status: ['Status at generation', ticket.status],
    entrances: [
      'Allowed entrances',
      entrances
        .map((e) => e.name + (e.instructions ? `: ${e.instructions}` : ''))
        .join('; ') || 'Contact the organizer',
    ],
    instructions: [
      'Instructions',
      String(event.instructions ?? '').slice(0, 3000),
    ],
  };
  return design.fields
    .map((field) => values[field])
    .filter(
      ([, value]) =>
        value !== undefined && value !== null && String(value) !== '',
    )
    .map(([label, value]) => ({ label, value: String(value) }));
}
