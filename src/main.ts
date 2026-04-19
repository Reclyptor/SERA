import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

const requiredEnvVars = [
  'AUTH_SECRET',
  'ANTHROPIC_API_KEY',
  'PRIMARY_MODEL',
  'CORS_ORIGIN',
  'AUTHENTIK_ISSUER',
  'AUTHENTIK_CLIENT_ID',
  'MONGODB_URI',
  'OPENAI_API_KEY',
  'REDIS_URL',
] as const;

function validateEnv(): void {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}

async function bootstrap() {
  validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.setGlobalPrefix('api/v1', {
    exclude: ['health'],
  });

  // Increase body size limit for image uploads (50MB)
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Cookie'],
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`Sera backend running on http://localhost:${port}/api/v1`);
}
bootstrap();
