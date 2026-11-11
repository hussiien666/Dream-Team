import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service.js';

/** Trusted local maintenance only; no unauthenticated HTTP deletion endpoint. */
export async function removeAdminAccounts(
  db: PrismaService,
  targets: { id: number; username: string }[],
  reason: string,
) {
  if (
    !targets.length ||
    targets.length > 20 ||
    new Set(targets.map((t) => t.id)).size !== targets.length ||
    targets.some(
      (t) =>
        !Number.isSafeInteger(t.id) ||
        t.id <= 0 ||
        !/^[a-z0-9._-]{1,80}$/.test(t.username),
    )
  )
    throw new BadRequestException(
      'Provide exact unique account IDs and usernames.',
    );
  if (
    typeof reason !== 'string' ||
    reason.trim().length < 5 ||
    reason.length > 1000
  )
    throw new BadRequestException('A removal reason is required.');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724194883)`;
      await tx.$queryRaw`SELECT id FROM users ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT user_id FROM organization_users ORDER BY user_id FOR UPDATE`;
      const ids = targets.map((t) => t.id);
      const accounts = await tx.user.findMany({
        where: { id: { in: ids } },
        include: { organizationUser: true },
      });
      if (
        accounts.length !== targets.length ||
        targets.some(
          (t) =>
            !accounts.some((u) => u.id === t.id && u.username === t.username),
        )
      )
        throw new ConflictException(
          'Accounts changed or were already removed. Inspect them again before proceeding.',
        );
      if (accounts.some((u) => u.role !== 'admin' || !u.organizationUser))
        throw new BadRequestException(
          'Only organization administrator accounts can be removed by this operation.',
        );
      for (const org of new Set(
        accounts.map((u) => u.organizationUser!.organizationId),
      )) {
        const remaining = await tx.organizationUser.count({
          where: {
            organizationId: org,
            role: 'super_admin',
            user: { active: true, id: { notIn: ids } },
          },
        });
        if (!remaining)
          throw new BadRequestException(
            'At least one other active Super Admin must remain.',
          );
      }
      // Operational credentials/grants are removed; historical admissions, imports and scans survive.
      await tx.authSession.deleteMany({ where: { userId: { in: ids } } });
      await tx.scannerSession.deleteMany({ where: { userId: { in: ids } } });
      await tx.actionToken.deleteMany({ where: { userId: { in: ids } } });
      await tx.recoveryCode.deleteMany({ where: { userId: { in: ids } } });
      await tx.permissionOverride.deleteMany({
        where: { userId: { in: ids } },
      });
      await tx.scannerPreference.deleteMany({ where: { userId: { in: ids } } });
      await tx.securityProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.codeStaff.deleteMany({ where: { userId: { in: ids } } });
      await tx.eventAssignment.deleteMany({ where: { userId: { in: ids } } });
      await tx.organizationUser.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: 'user.removed_by_local_operator',
          details: JSON.stringify({
            accountIds: ids,
            reason: reason.trim(),
            historicalLabels: 'anonymized',
          }),
        },
      });
      return {
        deletedIds: ids,
        identities: await tx.accountIdentity.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            username: true,
            displayName: true,
            deletedAt: true,
          },
        }),
      };
    },
    { timeout: 30000 },
  );
}
