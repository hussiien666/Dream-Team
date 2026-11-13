import { createHttpApp } from './http-app.js';
async function bootstrap() {
  const app = await createHttpApp();
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3000;
  await app.listen(port, process.env.K_SERVICE ? '0.0.0.0' : process.env.HOST ?? '127.0.0.1');
  console.log(`Dream Events API running on http://localhost:${port}/api/v1`);
  console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
