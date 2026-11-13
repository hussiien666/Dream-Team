import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ConsoleLogger } from '@nestjs/common';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import cookieParser from 'cookie-parser';

/** Shared configuration for standalone and Firebase; never opens a listener. */
export async function createHttpApp(server?: Express) {
  const options = { logger: new ConsoleLogger({ json: true }), rawBody: true, abortOnError: false };
  const app = server
    ? await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(server), options)
    : await NestFactory.create<NestExpressApplication>(AppModule, options);
  app.useBodyParser('json', { limit: '1mb' });
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));
  app.use(cookieParser());
  app.use((req: { path: string }, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/v1/'))
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  const scannerDist = process.env.FUNCTION_TARGET
    ? resolve(import.meta.dirname, '../static/scanner')
    : resolve(import.meta.dirname, '../../scanner/dist');
  if (existsSync(scannerDist)) app.useStaticAssets(scannerDist, { prefix: '/scan/' });
  app.setGlobalPrefix('api/v1');
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174').split(',').map(v => v.trim());
  app.enableCors({ origin: origins, credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const config = new DocumentBuilder().setTitle('Dream Events API')
    .setDescription('Multi-event management and ticketing platform').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  return app;
}
