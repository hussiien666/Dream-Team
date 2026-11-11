import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import type { Prisma } from '@prisma/client';
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const optionalFields = [
  'organization',
  'subtitle',
  'date',
  'venue',
  'student',
  'group',
  'category',
  'number',
  'entrances',
  'instructions',
  'status',
] as const;
export const designSchema = z
  .object({
    layout: z.enum(['classic', 'compact', 'banner']).default('classic'),
    primaryColor: color.default('#142d4e'),
    accentColor: color.default('#b5974e'),
    backgroundColor: color.default('#ffffff'),
    heading: z.string().trim().max(120).default(''),
    footer: z
      .string()
      .trim()
      .max(400)
      .default('Keep this ticket private. Status is verified at check-in.'),
    fields: z
      .array(z.enum(optionalFields))
      .max(optionalFields.length)
      .default([
        'date',
        'venue',
        'student',
        'category',
        'number',
        'entrances',
        'instructions',
      ]),
    showLogo: z.boolean().default(true),
    logo: z.string().max(360000).nullable().default(null),
    background: z.string().max(360000).nullable().default(null),
  })
  .strict();
export type TicketDesign = z.infer<typeof designSchema>;
export const defaultDesign = designSchema.parse({});
export function parseDesign(value: unknown): TicketDesign {
  const parsed = designSchema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(
      'Invalid ticket design. Use supported fields, six-digit colors and bounded text/images.',
    );
  return { ...parsed.data, fields: [...new Set(parsed.data.fields)] };
}
export function imageBytes(value: string) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match) throw new BadRequestException('Use a PNG or JPEG image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 256 * 1024)
    throw new BadRequestException('Each ticket image must be at most 256 KB.');
  if (
    match[1] === 'png' &&
    (bytes.length < 24 ||
      bytes.readUInt32BE(16) > 2048 ||
      bytes.readUInt32BE(20) > 2048)
  )
    throw new BadRequestException(
      'Image dimensions must not exceed 2048 pixels.',
    );
  return { type: match[1], bytes };
}
export async function validateImages(design: TicketDesign) {
  const pdf = await PDFDocument.create();
  for (const value of [design.logo, design.background])
    if (value) {
      const { type, bytes } = imageBytes(value);
      try {
        const img =
          type === 'png'
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes);
        if (img.width > 2048 || img.height > 2048) throw new Error();
      } catch {
        throw new BadRequestException(
          'Invalid image or dimensions larger than 2048 pixels.',
        );
      }
    }
}
export async function eventDesign(
  tx: Pick<Prisma.TransactionClient, 'eventSetting'>,
  eventId: number,
): Promise<TicketDesign> {
  const value = await tx.eventSetting.findUnique({
    where: { eventId_key: { eventId, key: 'ticket-design.v1' } },
  });
  return value ? parseDesign(JSON.parse(value.value).config) : defaultDesign;
}
export const escapeHtml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
