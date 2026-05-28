import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const SYNC_SHA_PREFIX = 'github:sync:';

/**
 * Tracks the last-synced commit SHA per GitHub repository, persisted in
 * Redis. Used by sync flows to short-circuit when the upstream HEAD
 * hasn't changed since the previous run. All errors are absorbed — a
 * Redis hiccup degrades sync to "always run" but never fails it.
 */
@Injectable()
export class GitHubShaTracker {
  private readonly logger = new Logger(GitHubShaTracker.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(repo: string): Promise<string | null> {
    try {
      return await this.redis.get(`${SYNC_SHA_PREFIX}${repo}:sha`);
    } catch {
      return null;
    }
  }

  async set(repo: string, sha: string): Promise<void> {
    try {
      await this.redis.set(`${SYNC_SHA_PREFIX}${repo}:sha`, sha);
    } catch {
      this.logger.warn('Failed to store sync SHA in Redis');
    }
  }
}
