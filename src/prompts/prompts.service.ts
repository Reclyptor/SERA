import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { Prompt, PromptDocument } from './prompt.schema';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { PromptSyncStrategy } from './prompt-sync.strategy';

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
    private readonly syncStrategy: PromptSyncStrategy,
  ) {}

  onModuleInit(): void {
    this.syncFromGitHub().catch((err) =>
      this.logger.error(
        'GitHub sync failed, using existing MongoDB data:',
        err,
      ),
    );
  }

  async syncFromGitHub() {
    return this.syncStrategy.syncFromGitHub();
  }

  async resolve(
    slug: string,
    variables?: PromptVariables,
  ): Promise<string | null> {
    const chain = await this.loadPromptChain(slug);
    if (chain.length === 0) return null;

    const resolved = chain.map((prompt) => prompt.content).join('\n\n');
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
    const existing = await this.getDocument(slug);
    const nextExtends =
      data.extends !== undefined
        ? data.extends || null
        : (existing?.extends ?? null);
    await this.assertValidExtendsChain(slug, nextExtends);

    const update: Record<string, unknown> = { content: data.content };
    if (data.extends !== undefined) update.extends = data.extends || null;
    if (data.description !== undefined) update.description = data.description;
    if (data.metadata) update.metadata = data.metadata;

    await this.promptModel
      .findOneAndUpdate(
        { slug },
        { $set: update },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();

    await this.invalidateCache(slug);
    this.logger.log(`Prompt "${slug}" upserted`);

    const newSha = await this.syncStrategy.pushPrompt(slug, data);
    if (newSha) {
      await this.promptModel.updateOne(
        { slug },
        { $set: { seedHash: newSha } },
      );
    }

    const prompt = await this.getDocument(slug);
    if (!prompt) {
      throw new Error(`Prompt "${slug}" could not be reloaded after upsert`);
    }

    return prompt;
  }

  async delete(slug: string): Promise<boolean> {
    const result = await this.promptModel.deleteOne({ slug }).exec();
    await this.invalidateCache(slug);

    if (result.deletedCount > 0) {
      this.syncStrategy
        .deletePromptFile(slug)
        .catch((err) =>
          this.logger.warn(
            `Failed to delete prompt "${slug}" from GitHub:`,
            err,
          ),
        );
    }

    return result.deletedCount > 0;
  }

  async list(): Promise<
    Pick<
      Prompt,
      | 'slug'
      | 'extends'
      | 'seedHash'
      | 'description'
      | 'metadata'
      | 'createdAt'
      | 'updatedAt'
    >[]
  > {
    return this.promptModel
      .find()
      .select('slug extends seedHash description metadata createdAt updatedAt')
      .sort({ slug: 1 })
      .exec();
  }

  private substituteVariables(
    content: string,
    variables: PromptVariables,
  ): string {
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

  private async loadPromptChain(slug: string): Promise<Prompt[]> {
    // Single round trip: fetch the leaf plus its entire `extends`
    // ancestry via $graphLookup, then assemble in memory. Previously
    // this issued N queries for a chain of length N (one per hop).
    interface ChainNode {
      slug: string;
      extends?: string | null;
      content: string;
      description?: string;
      metadata?: Record<string, unknown>;
      seedHash?: string;
      createdAt?: Date;
      updatedAt?: Date;
    }

    interface LeafWithAncestors extends ChainNode {
      ancestors: ChainNode[];
    }

    const collection = this.promptModel.collection.name;
    const results = await this.promptModel
      .aggregate<LeafWithAncestors>([
        { $match: { slug } },
        {
          $graphLookup: {
            from: collection,
            startWith: '$extends',
            connectFromField: 'extends',
            connectToField: 'slug',
            as: 'ancestors',
            // maxDepth is 0-based; MAX_EXTENDS_DEPTH - 1 lets the chain
            // include up to MAX_EXTENDS_DEPTH total documents (leaf + N
            // ancestors).
            maxDepth: MAX_EXTENDS_DEPTH - 1,
            depthField: '_chainDepth',
          },
        },
      ])
      .exec();

    if (results.length === 0) return [];

    const leaf = results[0];
    const ancestorBySlug = new Map<string, ChainNode>();
    for (const a of leaf.ancestors) {
      ancestorBySlug.set(a.slug, a);
    }

    // Walk from leaf up the chain via `extends`, detecting cycles and
    // capping the apparent depth defensively (the maxDepth above is the
    // primary guard; this is belt-and-suspenders).
    const chain: ChainNode[] = [leaf];
    const visited = new Set<string>([leaf.slug]);
    let cursor: string | null | undefined = leaf.extends;
    let hops = 0;

    while (cursor) {
      hops++;
      if (hops > MAX_EXTENDS_DEPTH) {
        throw new BadRequestException(
          `Prompt inheritance exceeds max depth of ${MAX_EXTENDS_DEPTH}`,
        );
      }
      if (visited.has(cursor)) {
        throw new BadRequestException(
          `Circular prompt inheritance detected at "${cursor}"`,
        );
      }
      const parent = ancestorBySlug.get(cursor);
      if (!parent) break; // referenced extends doesn't exist — stop
      visited.add(parent.slug);
      chain.unshift(parent);
      cursor = parent.extends;
    }

    return chain as Prompt[];
  }

  private async assertValidExtendsChain(
    slug: string,
    nextExtends?: string | null,
  ): Promise<void> {
    if (!nextExtends) return;

    const visited = new Set<string>([slug]);
    let currentSlug: string | undefined = nextExtends;
    let depth = 0;

    while (currentSlug) {
      depth++;
      if (depth > MAX_EXTENDS_DEPTH) {
        throw new BadRequestException(
          `Prompt inheritance exceeds max depth of ${MAX_EXTENDS_DEPTH}`,
        );
      }
      if (visited.has(currentSlug)) {
        throw new BadRequestException(
          `Circular prompt inheritance detected at "${currentSlug}"`,
        );
      }

      visited.add(currentSlug);
      const prompt = await this.getDocument(currentSlug);
      currentSlug = prompt?.extends ?? undefined;
    }
  }
}
