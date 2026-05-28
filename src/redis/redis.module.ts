import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (configService: ConfigService): Promise<Redis> => {
        const logger = new Logger('RedisModule');
        const url = configService.getOrThrow<string>('REDIS_URL');
        const client = new Redis(url, { lazyConnect: true });

        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) => logger.error('Redis error:', err.message));

        // Fail-fast on boot rather than running with a broken Redis.
        // Cache reads, SSE streams, sync SHA tracking, and confirmation
        // pub/sub all depend on Redis being reachable; degrading
        // silently produces hard-to-diagnose runtime errors at first
        // traffic. Letting the factory reject kills app boot so the
        // orchestrator (k8s, etc.) can restart.
        await client.connect();

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      // `quit()` waits for in-flight commands to drain, unlike
      // `disconnect()` which is a hard close. Suppress errors so a
      // misbehaving Redis doesn't block the shutdown.
      await this.client.quit();
      this.logger.log('Redis client closed cleanly');
    } catch (err) {
      this.logger.warn(
        `Redis quit failed during shutdown: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
