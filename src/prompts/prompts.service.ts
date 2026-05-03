import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { Prompt, PromptDocument } from './prompt.schema';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { GitHubSyncService } from '../github/github-sync.service';

const CACHE_PREFIX = 'prompt:';
const CACHE_TTL = 300;
const MAX_EXTENDS_DEPTH = 10;

export interface PromptVariables {
  agentName?: string;
  agentID?: string;
  userName?: string;
  userID?: string;
}

@Injectable()
export class PromptsService implements OnModuleInit {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    @InjectModel(Prompt.name) private promptModel: Model<PromptDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly githubSync: GitHubSyncService,
  ) {}

  async onModuleInit() {
    this.syncFromGitHub().catch((err) =>
      this.logger.error('GitHub sync failed, using existing MongoDB data:', err),
    );
  }

  async syncFromGitHub() {
    return this.githubSync.syncPrompts(this.promptModel);
  }

  async resolve(slug: string, variables?: PromptVariables): Promise<string | null> {
    const visited = new Set<string>();
    let currentSlug: string | undefined = slug;

    const chain: string[] = [];
    while (currentSlug) {
      if (visited.has(currentSlug)) {
        this.logger.warn(`Circular extends detected at "${currentSlug}"`);
        break;
      }
      if (visited.size >= MAX_EXTENDS_DEPTH) {
        this.logger.warn(`Max extends depth reached at "${currentSlug}"`);
        break;
      }
      visited.add(currentSlug);

      const prompt = await this.getDocument(currentSlug);
      if (!prompt) {
        if (chain.length === 0) return null;
        break;
      }

      chain.unshift(prompt.content);
      currentSlug = prompt.extends ?? undefined;
    }

    if (chain.length === 0) return null;

    const resolved = chain.join('\n\n');
    return variables ? this.substituteVariables(resolved, variables) : resolved;
  }

  async get(slug: string): Promise<string | null> {
    const cacheKey = `${CACHE_PREFIX}${slug}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return cached;
    } catch {
      this.logger.warn('Redis read failed, falling back to MongoDB');
    }

    const prompt = await this.promptModel.findOne({ slug }).exec();
    if (!prompt) return null;

    try {
      await this.redis.set(cacheKey, prompt.content, 'EX', CACHE_TTL);
    } catch {
      this.logger.warn('Redis write failed');
    }

    return prompt.content;
  }

  async getDocument(slug: string): Promise<Prompt | null> {
    return this.promptModel.findOne({ slug }).exec();
  }

  async upsert(
    slug: string,
    data: {
      content: string;
      extends?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Prompt> {
    const update: Record<string, unknown> = { content: data.content };
    if (data.extends !== undefined) update.extends = data.extends || null;
    if (data.description !== undefined) update.description = data.description;
    if (data.metadata) update.metadata = data.metadata;

    const prompt = await this.promptModel
      .findOneAndUpdate(
        { slug },
        { $set: update },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();

    await this.invalidateCache(slug);
    this.logger.log(`Prompt "${slug}" upserted`);

    const newSha = await this.githubSync.pushPrompt(slug, data);
    if (newSha) {
      await this.promptModel.updateOne({ slug }, { $set: { seedHash: newSha } });
    }

    return prompt;
  }

  async delete(slug: string): Promise<boolean> {
    const result = await this.promptModel.deleteOne({ slug }).exec();
    await this.invalidateCache(slug);

    if (result.deletedCount > 0) {
      this.githubSync.deletePromptFile(slug).catch((err) =>
        this.logger.warn(`Failed to delete prompt "${slug}" from GitHub:`, err),
      );
    }

    return result.deletedCount > 0;
  }

  async list(): Promise<
    Pick<Prompt, 'slug' | 'extends' | 'description' | 'metadata' | 'createdAt' | 'updatedAt'>[]
  > {
    return this.promptModel
      .find()
      .select('slug extends description metadata createdAt updatedAt')
      .sort({ slug: 1 })
      .exec();
  }

  private substituteVariables(content: string, variables: PromptVariables): string {
    const now = new Date();
    const allVars: Record<string, string> = {
      agentName: variables.agentName ?? '',
      agentID: variables.agentID ?? '',
      userName: variables.userName ?? '',
      userID: variables.userID ?? '',
      currentDate: now.toISOString().split('T')[0],
      currentTime: now.toTimeString().slice(0, 5),
      currentDateTime: now.toISOString(),
    };

    return content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      return key in allVars ? allVars[key] : match;
    });
  }

  private async invalidateCache(slug: string): Promise<void> {
    try {
      await this.redis.del(`${CACHE_PREFIX}${slug}`);
    } catch {
      this.logger.warn('Redis cache invalidation failed');
    }
  }
}
