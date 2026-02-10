import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

const requiredEnvVars = [
  'AUTH_SECRET',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'COPILOTKIT_RUNTIME_VERSION',
  'CORS_ORIGIN',
  'AUTHENTIK_ISSUER',
  'AUTHENTIK_CLIENT_ID',
  'MONGODB_URI',
  'OPENAI_API_KEY',
] as const;

function validateEnv(): void {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function bootstrap() {
  validateEnv();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  // Increase body size limit for image uploads (50MB)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Cookie'],
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Sera backend running on http://localhost:${port}/api/v1`);
}
bootstrap();
