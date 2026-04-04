import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { Prompt, PromptDocument } from './prompt.schema';
import { REDIS_CLIENT } from '../redis/redis.constants';

const CACHE_PREFIX = 'prompt:';
const CACHE_TTL = 300; // 5 minutes

@Injectable()
export class PromptsService {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    @InjectModel(Prompt.name) private promptModel: Model<PromptDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Get a prompt by slug with Redis caching.
   */
  async get(slug: string): Promise<string | null> {
    const cacheKey = `${CACHE_PREFIX}${slug}`;

    // Try Redis first
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return cached;
    } catch {
      this.logger.warn('Redis read failed, falling back to MongoDB');
    }

    // Fall back to MongoDB
    const prompt = await this.promptModel.findOne({ slug }).exec();
    if (!prompt) return null;

    // Populate cache
    try {
      await this.redis.set(cacheKey, prompt.content, 'EX', CACHE_TTL);
    } catch {
      this.logger.warn('Redis write failed');
    }

    return prompt.content;
  }

  /**
   * Create or update a prompt by slug.
   */
  async upsert(
    slug: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<Prompt> {
    const prompt = await this.promptModel
      .findOneAndUpdate(
        { slug },
        { content, ...(metadata && { metadata }) },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();

    // Invalidate cache
    try {
      await this.redis.del(`${CACHE_PREFIX}${slug}`);
    } catch {
      this.logger.warn('Redis cache invalidation failed');
    }

    this.logger.log(`Prompt "${slug}" upserted`);
    return prompt;
  }

  /**
   * Delete a prompt by slug.
   */
  async delete(slug: string): Promise<boolean> {
    const result = await this.promptModel.deleteOne({ slug }).exec();

    try {
      await this.redis.del(`${CACHE_PREFIX}${slug}`);
    } catch {
      this.logger.warn('Redis cache invalidation failed');
    }

    return result.deletedCount > 0;
  }

  /**
   * List all prompts (without content, for overview).
   */
  async list(): Promise<Pick<Prompt, 'slug' | 'metadata' | 'createdAt' | 'updatedAt'>[]> {
    return this.promptModel
      .find()
      .select('slug metadata createdAt updatedAt')
      .sort({ slug: 1 })
      .exec();
  }
}
