import { cp, mkdir, readFile, writeFile, lstat, rm, realpath, readdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const directory = fileURLToPath(new URL('.', import.meta.url));
const backend = path.resolve(directory, '../backend');
const target = path.resolve(directory, 'functions');
const marker = '.dream-events-generated';
for (const args of [['node_modules/prisma/build/index.js', 'generate'], ['node_modules/@nestjs/cli/bin/nest.js', 'build']]) {
  const result = spawnSync(process.execPath, args, { cwd: backend, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// A generated directory is the only recursive-delete target. Refuse links,
// unmarked folders and local configuration; never copy/delete backend/.env.
const existing = await lstat(target).catch(() => null);
if (existing) {
  if (existing.isSymbolicLink() || await realpath(path.dirname(target)) !== await realpath(directory) ||
      await readFile(path.join(target, marker), 'utf8').catch(() => '') !== 'Dream Events generated deployment bundle\n')
    throw new Error('Refusing to replace an unrecognized functions directory.');
  if ((await readdir(target)).some(name => name.startsWith('.env') || name.startsWith('.secret')))
    throw new Error('Move private Functions configuration out before rebuilding.');
  await rm(target, { recursive: true });
}
await mkdir(target, { recursive: true });
for (const name of ['dist', 'assets', 'prisma']) await cp(path.join(backend, name), path.join(target, name), { recursive: true });
const pkg = JSON.parse(await readFile(path.join(backend, 'package.json'), 'utf8'));
pkg.main = 'dist/firebase/index.js'; pkg.engines = { node: '22' };
pkg.scripts = { 'gcp-build': 'prisma generate' };
await writeFile(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2));
await cp(path.join(backend, 'package-lock.json'), path.join(target, 'package-lock.json'));
await writeFile(path.join(target, marker), 'Dream Events generated deployment bundle\n');
// Local emulator dependency lookup only; node_modules is excluded from upload.
await symlink(path.join(backend, 'node_modules'), path.join(target, 'node_modules'), 'junction');
const scanner = path.resolve(directory, '../scanner');
const scannerEnv = { ...process.env, VITE_API_URL: '/api/v1', SCANNER_BASE_PATH: '/scan/' };
for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', path.join(target, 'static/scanner'), '--emptyOutDir']]) {
  const result = spawnSync(process.execPath, args, { cwd: scanner, env: scannerEnv, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await mkdir(path.join(directory, 'public/scan'), { recursive: true });
await cp(path.join(target, 'static/scanner'), path.join(directory, 'public/scan'), { recursive: true });
console.log('Generated firebase/functions from compiled API, assets and Prisma schema. Local secrets were excluded.');
