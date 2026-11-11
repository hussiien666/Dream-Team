import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ConsoleLogger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: true }),
    rawBody: true,
  });
  // Two bounded base64 ticket images fit within this request limit.
  app.useBodyParser('json', {limit:'1mb'});

  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));
  // No session cookies: the current admin/scanner clients use bearer tokens.
  app.use(cookieParser());
  app.use(
    (
      req: { path: string },
      res: { setHeader: (key: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      if (req.path.startsWith('/api/v1/'))
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; frame-ancestors 'none'",
        );
      next();
    },
  );
  const scannerDist = resolve(import.meta.dirname, '../../scanner/dist');
  if (existsSync(scannerDist))
    app.useStaticAssets(scannerDist, { prefix: '/scan/' });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS
  const origins = (
    process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174'
  )
    .split(',')
    .map((value) => value.trim());
  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Dream Events API')
    .setDescription('Multi-event management and ticketing platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  app.enableShutdownHooks();
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
  console.log(`Dream Events API running on http://localhost:${port}/api/v1`);
  console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
