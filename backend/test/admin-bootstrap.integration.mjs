import { removeAdminAccounts } from '../dist/users/account-removal.js';
import { UsersService } from '../dist/users/users.service.js';
import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { createFirstAdmin } from '../dist/cli/admin-provisioning.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { digest } from '../dist/common/crypto.util.js';
import { totp } from '../dist/auth/totp.js';
let db, auth, url;
const account = {
  username: 'FIRST_ADMIN',
  displayName: 'First administrator',
  password: 'a-private-synthetic-password',
};
before(
  async () => {
    const source = process.env.TEST_DATABASE_URL;
    assert.ok(
      source?.startsWith('postgres'),
      'Set TEST_DATABASE_URL to disposable PostgreSQL.',
    );
    const control = new pg.Client({ connectionString: source });
    await control.connect();
    const name = 'dream_admin_test_' + Date.now();
    await control.query('CREATE DATABASE "' + name + '"');
    await control.end();
    const target = new URL(source);
    target.pathname = '/' + name;
    url = target.toString();
    const migrated = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        env: {
          ...process.env,
          NODE_DATABASE_URL: url,
          PRISMA_MIGRATION_DATABASE_URL: url,
        },
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    assert.equal(
      migrated.status,
      0,
      'Disposable admin test database migration failed.',
    );
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await db.$connect();
    auth = new AuthService(db);
  },
  { timeout: 90000 },
);
after(async () => {
  if (db) await db.$disconnect();
});
test('first administrator validates input before creating records', async () => {
  for (const patch of [
    { username: 'bad name' },
    { displayName: ' ' },
    { password: 'short' },
    { organizationName: ' ' },
    { organizationId: 0 },
  ])
    await assert.rejects(createFirstAdmin(db, { ...account, ...patch }));
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.organization.count(), 0);
});
test('first administrator and organization roll back if their audit cannot be written', async () => {
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_admin_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='user.bootstrap_admin' THEN RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER reject_admin_bootstrap BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_admin_bootstrap()',
  );
  try {
    await assert.rejects(createFirstAdmin(db, account));
    assert.equal(await db.user.count(), 0);
    assert.equal(await db.organization.count(), 0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER reject_admin_bootstrap ON audit_logs',
    );
    await db.$executeRawUnsafe('DROP FUNCTION reject_admin_bootstrap()');
  }
});
test('concurrent first administrator requests create one Argon2id account with required enrollment', async () => {
  const results = await Promise.allSettled([
    createFirstAdmin(db, account),
    createFirstAdmin(db, { ...account, username: 'another_first_admin' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  const user = await db.user.findFirst({
    include: { organizationUser: true, securityProfile: true },
  });
  assert.ok(await argon2.verify(user.passwordHash, account.password));
  assert.match(user.passwordHash, /^\$argon2id\$/);
  assert.equal(user.organizationUser.role, 'super_admin');
  assert.equal(user.securityProfile.factorMethod, '');
  assert.equal(
    await db.auditLog.count({ where: { action: 'user.bootstrap_admin' } }),
    1,
  );
  const login = await auth.login(user.username, account.password);
  assert.equal(login.identity.requiresFactor, true);
  assert.equal(login.identity.enrolled, false);
  await assert.rejects(auth.authenticate(login.accessToken));
  const enrollment = await auth.beginTotp(digest(login.accessToken));
  await auth.finishTotp(digest(login.accessToken), totp(enrollment.secret));
  const identity = await auth.authenticate(login.accessToken);
  assert.equal(identity.orgRole, 'super_admin');
  assert.equal(identity.requiresFactor, false);
  await auth.logout(digest(login.accessToken));
});
test('bootstrap never overwrites an existing user or bypasses existing-account authorization', async () => {
  const count = await db.user.count();
  await assert.rejects(
    createFirstAdmin(db, { ...account, username: 'unauthorized_addition' }),
    /Accounts already exist/,
  );
  assert.equal(await db.user.count(), count);
});
test('administrator command refuses piped credentials and prints no input password', () => {
  const child = spawnSync(process.execPath, ['dist/cli/create-admin.js'], {
    input: 'not-a-terminal-password\n',
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /interactive terminal/);
  assert.ok(!(child.stdout + child.stderr).includes('not-a-terminal-password'));
});

test('database check is read-only and never prints its connection string', () => {
  const result = spawnSync(process.execPath, ['dist/cli/check-database.js'], {
    env: {
      ...process.env,
      NODE_DATABASE_URL: url,
      PG_SSL: 'false',
      NODE_ENV: 'test',
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /PostgreSQL connection successful/);
  assert.ok(!(result.stdout + result.stderr).includes(url));
});

async function extraAdmin(username) {
  const root = await db.user.findFirst({
    where: { organizationUser: { role: 'super_admin' } },
  });
  const member = await db.organizationUser.findUnique({
    where: { userId: root.id },
  });
  return new UsersService(db).create(
    {
      username,
      displayName: username,
      password: 'a-removal-synthetic-password',
      orgRole: 'super_admin',
    },
    root.id,
    member.organizationId,
    'super_admin',
  );
}
test('removal refuses the last Super Admin and stale target names without changing accounts', async () => {
  const root = await db.user.findFirst();
  await assert.rejects(
    removeAdminAccounts(
      db,
      [{ id: root.id, username: root.username }],
      'Owner requested removal',
    ),
    /other active Super Admin/,
  );
  const extra = await extraAdmin('stale_target');
  await assert.rejects(
    removeAdminAccounts(
      db,
      [{ id: extra.id, username: 'wrong_name' }],
      'Owner requested removal',
    ),
    /changed/,
  );
  assert.ok(await db.user.findUnique({ where: { id: extra.id } }));
});
test('physical removal deletes credentials but preserves immutable evidence through anonymized identities', async () => {
  const first = await extraAdmin('retire_one'),
    second = await extraAdmin('retire_two');
  const ids = [first.id, second.id];
  const org = await db.organizationUser.findUnique({
    where: { userId: first.id },
  });
  const event = await db.event.create({
    data: {
      name: 'Retirement history',
      venue: 'Test hall',
      eventDate: new Date('2039-01-01'),
      startsAt: new Date('2039-01-01T08:00Z'),
      endsAt: new Date('2039-01-01T18:00Z'),
      capacity: 10,
      maxTickets: 10,
      organizationEvent: { create: { organizationId: org.organizationId } },
    },
  });
  const category = await db.ticketCategory.create({
    data: { eventId: event.id, name: 'Guest', code: 'G', allocation: 10 },
  });
  const entrance = await db.entrance.create({
    data: { eventId: event.id, name: 'Gate', code: 'G' },
  });
  const attendee = await db.attendee.create({
    data: {
      eventId: event.id,
      categoryId: category.id,
      fullName: 'Historical guest',
      email: 'synthetic@example.com',
    },
  });
  const ticket = await db.ticket.create({
    data: {
      eventId: event.id,
      attendeeId: attendee.id,
      categoryId: category.id,
      number: 'REMOVAL-HISTORY',
      tokenHash: 'f'.repeat(64),
      status: 'Used',
      expiresAt: event.endsAt,
    },
  });
  const admission = await db.checkIn.create({
    data: {
      eventId: event.id,
      ticketId: ticket.id,
      entranceId: entrance.id,
      staffId: first.id,
    },
  });
  const audit = await db.auditLog.create({
    data: {
      actorId: first.id,
      eventId: event.id,
      action: 'test.retirement_history',
      details: 'Immutable evidence',
    },
  });
  const attempt = await db.scanAttempt.create({
    data: {
      eventId: event.id,
      userId: first.id,
      sessionHash: 'e'.repeat(64),
      accepted: true,
      message: 'Historical result',
    },
  });
  const receipt = await db.registrationImport.create({
    data: {
      eventId: event.id,
      actorId: second.id,
      requestKey: 'removal-history-receipt',
      contentHash: 'd'.repeat(64),
      result: { retained: true },
    },
  });
  await db.securityProfile.create({
    data: { userId: first.id, email: 'retired-profile@example.com' },
  });
  await db.recoveryCode.create({
    data: { userId: first.id, tokenHash: 'b'.repeat(64) },
  });
  await db.actionToken.create({
    data: {
      userId: first.id,
      tokenHash: 'c'.repeat(64),
      purpose: 'synthetic',
      expiresAt: event.endsAt,
    },
  });
  await db.scannerPreference.create({ data: { userId: first.id } });
  const login = await auth.login(
    first.username,
    'a-removal-synthetic-password',
  );
  const result = await removeAdminAccounts(
    db,
    [
      { id: first.id, username: first.username },
      { id: second.id, username: second.username },
    ],
    'Owner requested removal with anonymized labels',
  );
  assert.equal(result.deletedIds.length, 2);
  assert.equal(await db.user.count({ where: { id: { in: ids } } }), 0);
  assert.equal(
    await db.authSession.count({ where: { userId: { in: ids } } }),
    0,
  );
  assert.equal(
    await db.securityProfile.count({ where: { userId: { in: ids } } }),
    0,
  );
  assert.equal(
    await db.actionToken.count({ where: { userId: { in: ids } } }),
    0,
  );
  assert.equal(
    await db.recoveryCode.count({ where: { userId: { in: ids } } }),
    0,
  );
  await assert.rejects(auth.authenticate(login.accessToken, true));
  assert.deepEqual(
    await db.auditLog.findUnique({ where: { id: audit.id } }),
    audit,
  );
  assert.deepEqual(
    await db.checkIn.findUnique({ where: { id: admission.id } }),
    admission,
  );
  assert.deepEqual(
    await db.scanAttempt.findUnique({ where: { id: attempt.id } }),
    attempt,
  );
  assert.deepEqual(
    await db.registrationImport.findUnique({ where: { id: receipt.id } }),
    receipt,
  );
  for (const id of ids) {
    const identity = await db.accountIdentity.findUnique({ where: { id } });
    assert.equal(identity.displayName, 'Deleted account #' + id);
    assert.ok(identity.deletedAt);
    await assert.rejects(
      db.accountIdentity.update({
        where: { id },
        data: { displayName: 'Restore identity' },
      }),
    );
    await assert.rejects(db.accountIdentity.delete({ where: { id } }));
  }
  assert.equal(
    (
      await db.auditLog.findUnique({
        where: { id: audit.id },
        include: { actor: true },
      })
    ).actor.displayName,
    'Deleted account #' + first.id,
  );
  const replacement = await extraAdmin('retire_one');
  assert.notEqual(replacement.id, first.id);
  assert.equal(
    (await db.auditLog.findUnique({ where: { id: audit.id } })).actorId,
    first.id,
  );
  await assert.rejects(
    db.auditLog.update({
      where: { id: audit.id },
      data: { details: 'Changed' },
    }),
  );
  await assert.rejects(db.checkIn.delete({ where: { id: admission.id } }));
});
test('removal audit failure rolls back credentials, identities and account deletion together', async () => {
  const account = await extraAdmin('rollback_removal');
  const login = await auth.login(
    account.username,
    'a-removal-synthetic-password',
  );
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_account_removal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='user.removed_by_local_operator' THEN RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER reject_account_removal BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_account_removal()',
  );
  try {
    await assert.rejects(
      removeAdminAccounts(
        db,
        [{ id: account.id, username: account.username }],
        'Owner requested removal',
      ),
    );
    assert.ok(await db.user.findUnique({ where: { id: account.id } }));
    assert.equal(
      (await db.accountIdentity.findUnique({ where: { id: account.id } }))
        .deletedAt,
      null,
    );
    assert.ok(await auth.authenticate(login.accessToken, true));
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER reject_account_removal ON audit_logs',
    );
    await db.$executeRawUnsafe('DROP FUNCTION reject_account_removal()');
  }
});
