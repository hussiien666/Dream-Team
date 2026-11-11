import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { createHash } from 'node:crypto';
export const text = z.string().trim();
export const phone = text
  .max(40)
  .refine(
    (v) => !v || /^\+?[0-9 ()\-.]{3,40}$/.test(v),
    'Enter a valid phone number.',
  );
export const email = text.toLowerCase().max(254).email();
export const values = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
  z.union([z.string().max(3000), z.number().finite(), z.boolean(), z.null()]),
);
export const reason = text.min(5).max(1000).optional();
export const studentSchema = z
  .object({
    studentId: text.min(1).max(100).toUpperCase(),
    fullName: text.min(1).max(200),
    email,
    phone: phone.default(''),
    customValues: values.default({}),
    guestLimit: z.number().int().min(0).max(2147483647).nullable().optional(),
    overrideReason: reason,
  })
  .strict();
export const guestSchema = z
  .object({
    studentId: z.number().int().positive(),
    fullName: text.min(1).max(200),
    email: z
      .union([email, z.literal(''), z.null()])
      .optional()
      .transform((v) => v || null),
    phone: phone.default(''),
    categoryId: z.number().int().positive().optional(),
    invitationGroup: text.max(200).default(''),
    customValues: values.default({}),
    overrideReason: reason,
  })
  .strict();
export const fieldSchema = z
  .object({
    target: z.enum(['student', 'guest']),
    key: text
      .regex(/^[a-z][a-z0-9_]{0,59}$/)
      .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v)),
    label: text.min(1).max(100),
    type: z.enum([
      'text',
      'number',
      'email',
      'phone',
      'date',
      'dropdown',
      'checkbox',
    ]),
    required: z.boolean().default(false),
    active: z.boolean().default(true),
    options: z.array(text.min(1).max(200)).max(100).default([]),
  })
  .strict();
export const limitsSchema = z
  .object({
    guestLimit: z.number().int().min(0).max(2147483647),
    perStudentLimit: z.number().int().min(0).max(2147483647),
    categoryLimits: z
      .array(
        z
          .object({
            categoryId: z.number().int().positive(),
            limit: z.number().int().min(0).max(2147483647),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    defaultCategoryId: z.number().int().positive().nullable(),
    overrideReason: reason,
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues
        .map((i) => `${i.path.join('.') || 'Record'}: ${i.message}`)
        .join('; '),
    );
  return result.data;
}
export function hash(value: unknown) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
}
export function guestKey(email: string | null, name: string, phone: string) {
  return hash(
    email
      ? ['email', email.toLowerCase()]
      : [
          'person',
          name.toLowerCase().replace(/\s+/g, ' '),
          phone.replace(/[^0-9+]/g, ''),
        ],
  );
}
export type Field = z.infer<typeof fieldSchema>;
export function custom(
  input: Record<string, unknown>,
  defs: Field[],
  old: Record<string, unknown> = {},
) {
  const out = { ...old, ...input };
  for (const key of Object.keys(input))
    if (!defs.some((f) => f.key === key))
      throw new BadRequestException(`Unknown custom field: ${key}.`);
  for (const f of defs) {
    if (!f.active) continue;
    const v = out[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.required) throw new BadRequestException(`${f.label} is required.`);
      continue;
    }
    let valid = true;
    switch (f.type) {
      case 'text':
        valid = typeof v === 'string' && v.length <= 3000;
        break;
      case 'number':
        valid = typeof v === 'number' && Number.isFinite(v);
        break;
      case 'email':
        valid = email.safeParse(v).success;
        break;
      case 'phone':
        valid = typeof v === 'string' && phone.safeParse(v).success;
        break;
      case 'date':
        valid =
          typeof v === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
          !isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v;
        break;
      case 'dropdown':
        valid = typeof v === 'string' && f.options.includes(v);
        break;
      case 'checkbox':
        valid = typeof v === 'boolean';
        break;
    }
    if (!valid)
      throw new BadRequestException(
        `${f.label} must be a valid ${f.type} value.`,
      );
  }
  return out as Record<string, string | number | boolean | null>;
}
