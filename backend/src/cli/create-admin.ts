import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { UsersService } from '../users/users.service.js';
import { digest } from '../common/crypto.util.js';
import { seal, unseal } from '../common/encryption.util.js';
import { createFirstAdmin } from './admin-provisioning.js';

config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) stdout.write(chunk);
    done();
  },
});
const abort = new AbortController();
const rl = createInterface({ input: stdin, output, terminal: true });
rl.on('SIGINT', () => abort.abort());
async function ask(label: string, secret = false) {
  if (secret) {
    stdout.write(label);
    muted = true;
  }
  try {
    return await rl.question(secret ? '' : label, { signal: abort.signal });
  } finally {
    if (secret) {
      muted = false;
      stdout.write('\n');
    }
  }
}
let db: PrismaService | undefined,
  auth: AuthService | undefined,
  sessionHash: string | undefined;
async function main() {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      'Run this command in an interactive terminal so passwords remain hidden.',
    );
  if (process.argv.length > 2)
    throw new Error(
      'Enter credentials at the prompts, not as command-line arguments.',
    );
  // Validate key access now; do not create an account which cannot enroll its authenticator.
  if (unseal(seal('administrator-setup-check')) !== 'administrator-setup-check')
    throw new Error('Encryption configuration is unavailable.');
  db = new PrismaService();
  await db.$connect();
  const count = await db.user.count();
  const organizations = await db.organization.findMany({
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  let identity: Awaited<ReturnType<AuthService['authenticate']>> | undefined;
  if (count) {
    console.log(
      'Accounts already exist. Verify an existing Super Admin before adding another account.',
    );
    auth = new AuthService(db);
    const current = await ask('Existing Super Admin username: '),
      password = await ask('Existing password: ', true);
    const login = await auth.login(current, password);
    sessionHash = digest(login.accessToken);
    if (login.identity.orgRole !== 'super_admin')
      throw new Error('An existing Super Admin is required.');
    if (login.identity.requiresPasswordChange)
      throw new Error('Change the temporary password through the app first.');
    if (!login.identity.enrolled)
      throw new Error(
        'Enroll an authenticator through the app before using this account in the CLI.',
      );
    await auth.verifyFactor(
      sessionHash,
      await ask('Authenticator or recovery code: ', true),
    );
    identity = await auth.authenticate(login.accessToken);
  }
  let organizationName: string | undefined, organizationId: number | undefined;
  if (!count) {
    console.log(
      'Creating the first Super Admin. No existing records will be replaced.',
    );
    if (!organizations.length)
      organizationName =
        (await ask('Organization name [Dream Events]: ')).trim() ||
        'Dream Events';
    else if (organizations.length > 1) {
      for (const org of organizations) console.log(`${org.id}: ${org.name}`);
      organizationId = Number(await ask('Organization ID: '));
    }
  }
  const username = await ask('New administrator username: ');
  const displayName =
    (await ask(`Display name [${username.trim()}]: `)).trim() ||
    username.trim();
  const password = await ask('New password (12-256 characters): ', true);
  if (password !== (await ask('Confirm password: ', true)))
    throw new Error('Passwords do not match. No account was created.');
  const user = identity
    ? await new UsersService(db).create(
        { username, displayName, password, orgRole: 'super_admin' },
        identity.user.id,
        identity.orgId,
        identity.orgRole,
      )
    : await createFirstAdmin(db, {
        username,
        displayName,
        password,
        organizationName,
        organizationId,
      });
  console.log(`Administrator created: ${user.username}`);
  console.log(
    'Sign in at http://127.0.0.1:5174 and finish authenticator setup.',
  );
}
try {
  await main();
} catch (error) {
  if (error instanceof HttpException) console.error(error.message);
  else if (error instanceof Error && ['AbortError'].includes(error.name))
    console.error('Cancelled.');
  else if (
    error instanceof Error &&
    /^(Run this|Enter credentials|Set a private|Encryption configuration|An existing|Change the|Enroll an|Passwords do not)/.test(
      error.message,
    )
  )
    console.error(error.message);
  else
    console.error(
      'Administrator setup failed. Check the PostgreSQL connection, applied migrations and encryption-key configuration. No credentials were displayed.',
    );
  process.exitCode = 1;
} finally {
  if (auth && sessionHash) await auth.logout(sessionHash).catch(() => {});
  rl.close();
  if (db) await db.$disconnect().catch(() => {});
}
