import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The provider CLI may include its environment in debug diagnostics. Keep app,
// database, mail and encryption secrets out; deployment secrets use --data-file.
const env = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC',
  'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'GOOGLE_APPLICATION_CREDENTIALS'])
  if (process.env[name] !== undefined) env[name] = process.env[name];
Object.assign(env, { FIREBASE_CLI_DISABLE_MOTD: 'true', FUNCTIONS_DISCOVERY_TIMEOUT: '60' });
const cli = fileURLToPath(new URL('./node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url));
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('.', import.meta.url)), env, stdio: 'inherit',
});
child.once('error', () => { console.error('Firebase CLI could not start.'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
