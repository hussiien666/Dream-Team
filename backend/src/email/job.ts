import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { EmailService } from './email.service.js';

/** Bounded Cloud Run Job: no HTTP listener or idle background loop in the API service. */
async function main() {
  if (process.env.EMAIL_ENABLED !== 'true') throw new Error('Email must be explicitly authorized/enabled.');
  const max = Number(process.env.EMAIL_JOB_MAX_MESSAGES ?? 100);
  const seconds = Number(process.env.EMAIL_JOB_MAX_SECONDS ?? 240);
  if (!Number.isInteger(max) || max < 1 || max > 500 || !Number.isInteger(seconds) || seconds < 1 || seconds > 600)
    throw new Error('Invalid email job bounds.');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let running = true;
  process.once('SIGTERM', () => { running = false; });
  process.once('SIGINT', () => { running = false; });
  const until = Date.now() + seconds * 1000;
  let processed = 0;
  try {
    while (running && processed < max && Date.now() < until) {
      if (!await app.get(EmailService).tick()) break;
      processed++;
    }
    console.log(JSON.stringify({ event: 'email.job_finished', processed }));
  } finally { await app.close(); }
}
main().catch(() => { console.error(JSON.stringify({ event: 'email.job_failed' })); process.exitCode = 1; });
