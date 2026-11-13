import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-dream-events',
    firestore: { host: '127.0.0.1', port: 8088, rules: await readFile('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile('storage.rules', 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
for (const principal of ['anonymous', 'student', 'super_admin']) {
  test(`${principal} cannot bypass server APIs through Firestore or Storage`, async () => {
    const context = principal === 'anonymous' ? env.unauthenticatedContext() :
      env.authenticatedContext('synthetic-' + principal, { role: principal, organizationId: 1 });
    for (const path of ['events/7', 'attendees/42', 'tickets/10', 'audit_logs/13', 'auth_sessions/synthetic']) {
      await assertFails(getDoc(doc(context.firestore(), path)));
      await assertFails(setDoc(doc(context.firestore(), path), { synthetic: true }));
    }
    const file = ref(context.storage(), 'events/7/tickets/synthetic.pdf');
    await assertFails(uploadBytes(file, new Uint8Array([1])));
    await assertFails(getBytes(file));
  });
}
