import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Env validation lives on `ConfigModule.forRoot({ validate })` in
  // app.module — see src/config/env.schema.ts. NestFactory.create()
  // surfaces validation errors and aborts boot if any required
  // variable is missing or malformed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.setGlobalPrefix('api/v1', {
    exclude: ['health'],
  });

  // Increase body size limit for image uploads (50MB)
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });
  app.useBodyParser('text', { limit: '50mb', type: 'text/*' });

  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Cookie'],
    credentials: true,
  });

  // Hook SIGTERM/SIGINT so providers implementing OnApplicationShutdown
  // (e.g., RedisModule) get a chance to drain in-flight work cleanly.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(
    `Sera backend running on http://localhost:${port}/api/v1`,
  );
}
void bootstrap();
