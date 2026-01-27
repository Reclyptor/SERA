import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const requiredEnvVars = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'COPILOTKIT_RUNTIME_VERSION',
  'CORS_ORIGIN',
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

  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Sera backend running on http://localhost:${port}`);
}
bootstrap();
