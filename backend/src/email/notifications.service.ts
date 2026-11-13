import { Injectable, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EmailService } from './email.service.js';
import { digest } from '../common/crypto.util.js';
export const escapeMail = (value: string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
@Injectable()
export class NotificationsService {
  constructor(private readonly email: EmailService) {}
  enabled() { return this.email.isEnabled(); }
  async attendeeRecipients(tx: Prisma.TransactionClient, id: number) {
    const attendee = await tx.attendee.findUnique({where:{id},include:{guestInvitation:{include:{student:true}}}});
    return [attendee?.email, attendee?.guestInvitation?.email, attendee?.guestInvitation?.student.email];
  }
  async account(tx: Prisma.TransactionClient, userId: number, text: string, key: string) {
    if (!this.enabled()) return;
    const member = await tx.organizationUser.findUnique({where:{userId}});
    const profile = await tx.securityProfile.findUnique({where:{userId}});
    if (!member || !profile?.emailVerified || !profile.email) return;
    await this.email.enqueue(member.organizationId,null,userId,{to:[profile.email],subject:'Dream Events account security',text,
      html:`<p>${escapeMail(text)}</p>`},key,tx);
  }
  async broadcast(tx: Prisma.TransactionClient, eventId: number, actorId: number, subject: string, text: string, key: string) {
    if (!this.enabled()) return;
    const owner = await tx.organizationEvent.findUniqueOrThrow({ where: { eventId } });
    await this.email.broadcast(tx, owner.organizationId, eventId, actorId, subject, text, key);
  }
  publicUrl(path: string) {
    const base = new URL(process.env.PUBLIC_BASE_URL ?? 'invalid:');
    if (base.username || base.password || (base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['127.0.0.1','localhost'].includes(base.hostname))))
      throw new BadRequestException('Configure the approved public frontend URL.');
    return new URL(path, base.origin).href;
  }
  async event(tx: Prisma.TransactionClient, eventId: number, actorId: number | null, recipients: (string | null | undefined)[], subject: string, text: string, key: string,
    capability?: { kind: 'invitation' | 'ticket'; id: number; tokenHash: string }) {
    if (!this.enabled()) return [];
    const owner = await tx.organizationEvent.findUniqueOrThrow({ where: { eventId } });
    const emails = [...new Set(recipients.filter((v): v is string => !!v).map(v => v.trim().toLowerCase()))]
      .filter(v => /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(v));
    const jobs: number[] = [];
    for (const recipient of emails) jobs.push((await this.email.enqueue(owner.organizationId, eventId, actorId, {
      to: [recipient], subject, text, html: `<p>${escapeMail(text).replace(/\n/g, '<br>')}</p>`, capability,
    }, `${key}:${digest(recipient)}`, tx)).id);
    return jobs;
  }
}
