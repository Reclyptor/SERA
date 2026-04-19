import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import Redis from 'ioredis';
import { Prompt, PromptDocument } from './prompt.schema';
import { REDIS_CLIENT } from '../redis/redis.constants';

const CACHE_PREFIX = 'prompt:';
const CACHE_TTL = 300;
const SEEDS_DIR = join(__dirname, 'seeds');
const MAX_EXTENDS_DEPTH = 10;

export interface PromptVariables {
  agentName?: string;
  agentID?: string;
  userName?: string;
  userID?: string;
  workspaceDir?: string;
}

@Injectable()
export class PromptsService implements OnModuleInit {
  private readonly logger = new Logger(PromptsService.name);

  constructor(
    @InjectModel(Prompt.name) private promptModel: Model<PromptDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    await this.seedFromFiles();
  }

  /**
   * Resolve a prompt by slug, walking the extends chain and substituting variables.
   * Returns the fully composed prompt string.
   */
  async resolve(slug: string, variables?: PromptVariables): Promise<string | null> {
    const parts: string[] = [];
    const visited = new Set<string>();
    let currentSlug: string | undefined = slug;

    // Walk the extends chain, collecting content from leaf to root
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

  /**
   * Get raw prompt content by slug (no chain resolution).
   */
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

  /**
   * Get full prompt document by slug.
   */
  async getDocument(slug: string): Promise<Prompt | null> {
    return this.promptModel.findOne({ slug }).exec();
  }

  /**
   * Create or update a prompt by slug.
   */
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
    return prompt;
  }

  /**
   * Delete a prompt by slug.
   */
  async delete(slug: string): Promise<boolean> {
    const result = await this.promptModel.deleteOne({ slug }).exec();
    await this.invalidateCache(slug);
    return result.deletedCount > 0;
  }

  /**
   * List all prompts (with metadata, without full content).
   */
  async list(): Promise<
    Pick<Prompt, 'slug' | 'extends' | 'description' | 'metadata' | 'createdAt' | 'updatedAt'>[]
  > {
    return this.promptModel
      .find()
      .select('slug extends description metadata createdAt updatedAt')
      .sort({ slug: 1 })
      .exec();
  }

  /**
   * Seed prompts from MD files in the seeds directory.
   * Creates missing entries and updates existing ones if the file content changed.
   */
  private async seedFromFiles(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(SEEDS_DIR);
    } catch {
      this.logger.warn('Seeds directory not found, skipping prompt seeding');
      return;
    }

    const mdFiles = files.filter((f) => f.endsWith('.md'));

    for (const file of mdFiles) {
      const slug = basename(file, '.md');
      const filePath = join(SEEDS_DIR, file);

      try {
        const content = (await readFile(filePath, 'utf-8')).trimEnd();
        const hash = createHash('sha256').update(content).digest('hex');

        const existing = await this.promptModel.findOne({ slug }).exec();

        if (!existing) {
          await this.promptModel.create({
            slug,
            content,
            seedHash: hash,
            description: `Seeded from ${file}`,
          });
          this.logger.log(`Seeded prompt "${slug}" from ${file}`);
        } else if (existing.seedHash !== hash) {
          await this.promptModel.updateOne(
            { slug },
            { $set: { content, seedHash: hash } },
          );
          await this.invalidateCache(slug);
          this.logger.log(`Updated prompt "${slug}" from ${file} (content changed)`);
        }
      } catch (err) {
        this.logger.error(`Failed to seed prompt from ${file}:`, err);
      }
    }
  }

  private substituteVariables(content: string, variables: PromptVariables): string {
    const now = new Date();
    const allVars: Record<string, string> = {
      agentName: variables.agentName ?? '',
      agentID: variables.agentID ?? '',
      userName: variables.userName ?? '',
      userID: variables.userID ?? '',
      workspaceDir: variables.workspaceDir ?? '',
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
