import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { setTimeout } from 'node:timers/promises';
import { AppModule } from '../app.module.js';
import { EmailService } from './email.service.js';
async function main() {
  if (process.env.EMAIL_ENABLED !== 'true')
    throw new Error('Enable email explicitly before starting its worker.');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  let running = true;
  process.on('SIGTERM', () => {
    running = false;
  });
  process.on('SIGINT', () => {
    running = false;
  });
  try {
    while (running) {
      try {
        const worked = await app.get(EmailService).tick();
        if (!worked) await setTimeout(1000);
      } catch {
        console.error(JSON.stringify({ event: 'email.worker_unavailable' }));
        await setTimeout(5000);
      }
    }
  } finally {
    await app.close();
  }
}
main().catch(() => {
  console.error(JSON.stringify({ event: 'email.worker_start_failed' }));
  process.exitCode = 1;
});
