import { BadRequestException, ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PrismaService } from '../database/prisma.service.js';

export type FirstAdminInput = {
  username: string;
  displayName: string;
  password: string;
  organizationName?: string;
  organizationId?: number;
};

/** Local operator command only. Never exposed through an HTTP route. */
export async function createFirstAdmin(
  db: PrismaService,
  input: FirstAdminInput,
) {
  const username = input.username?.trim().toLowerCase();
  if (!username || !/^[a-z0-9._-]{1,80}$/.test(username))
    throw new BadRequestException(
      'Use a username of up to 80 letters, numbers, dots, underscores or hyphens.',
    );
  if (
    typeof input.displayName !== 'string' ||
    !input.displayName.trim() ||
    input.displayName.trim().length > 160
  )
    throw new BadRequestException(
      'Enter a display name of up to 160 characters.',
    );
  if (
    typeof input.password !== 'string' ||
    input.password.length < 12 ||
    input.password.length > 256
  )
    throw new BadRequestException(
      'Use a password between 12 and 256 characters.',
    );
  const organizationName = (input.organizationName ?? 'Dream Events').trim();
  if (!organizationName || organizationName.length > 200)
    throw new BadRequestException(
      'Enter an organization name of up to 200 characters.',
    );
  if (
    input.organizationId !== undefined &&
    (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0)
  )
    throw new BadRequestException('Choose a valid organization ID.');
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });
  return db.$transaction(
    async (tx) => {
      // Two local operators cannot both bootstrap a first account.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724194883)`;
      if (await tx.user.count())
        throw new ConflictException(
          'Accounts already exist. Sign in as an existing Super Admin to create another administrator.',
        );
      const organizations = await tx.organization.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      let organizationId = input.organizationId;
      if (organizationId && !organizations.some((o) => o.id === organizationId))
        throw new BadRequestException('Organization not found.');
      if (!organizationId) {
        if (organizations.length > 1)
          throw new BadRequestException(
            'Several organizations exist. Choose an organization ID.',
          );
        organizationId =
          organizations[0]?.id ??
          (await tx.organization.create({ data: { name: organizationName } }))
            .id;
      }
      const user = await tx.user.create({
        data: {
          username,
          displayName: input.displayName.trim(),
          passwordHash,
          role: 'admin',
          organizationUser: { create: { organizationId, role: 'super_admin' } },
          securityProfile: { create: { forcePassword: false } },
        },
        select: { id: true, username: true, displayName: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'user.bootstrap_admin',
          details: JSON.stringify({
            userId: user.id,
            organizationId,
            source: 'local_cli',
          }),
        },
      });
      return user;
    },
    { timeout: 20000 },
  );
}
