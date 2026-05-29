import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  ModelCatalogEntry,
  ModelCatalogEntryDocument,
} from './model-catalog.schema';

const CACHE_TTL_SECONDS = 300;
const LIST_KEY = 'model:catalog';
const ENABLED_KEY = 'model:catalog:enabled';
const SPEC_KEY = (spec: string) => `model:${spec}`;

export interface CreateModelInput {
  spec: string;
  provider: string;
  modelID: string;
  displayName: string;
  enabled?: boolean;
  contextWindow?: number;
  inputCostCentsPerMTok?: number;
  outputCostCentsPerMTok?: number;
  cacheReadCostCentsPerMTok?: number;
  cacheWriteCostCentsPerMTok?: number;
  metadata?: Record<string, unknown>;
}

export type UpdateModelInput = Partial<Omit<CreateModelInput, 'spec'>>;

@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);

  constructor(
    @InjectModel(ModelCatalogEntry.name)
    private readonly catalogModel: Model<ModelCatalogEntryDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async findAll(): Promise<ModelCatalogEntry[]> {
    const cached = await this.readListCache(LIST_KEY);
    if (cached) return cached;
    const docs = await this.catalogModel.find().lean().exec();
    await this.writeListCache(LIST_KEY, docs);
    return docs;
  }

  async findEnabled(): Promise<ModelCatalogEntry[]> {
    const cached = await this.readListCache(ENABLED_KEY);
    if (cached) return cached;
    const docs = await this.catalogModel.find({ enabled: true }).lean().exec();
    await this.writeListCache(ENABLED_KEY, docs);
    return docs;
  }

  async findBySpec(spec: string): Promise<ModelCatalogEntry | null> {
    const raw = await this.redis.get(SPEC_KEY(spec));
    if (raw) {
      try {
        return JSON.parse(raw) as ModelCatalogEntry;
      } catch {
        // Fall through and refetch.
      }
    }
    const doc = await this.catalogModel.findOne({ spec }).lean().exec();
    if (doc) {
      await this.redis.set(
        SPEC_KEY(spec),
        JSON.stringify(doc),
        'EX',
        CACHE_TTL_SECONDS,
      );
    }
    return doc;
  }

  async isValidActiveModel(spec: string): Promise<boolean> {
    const entry = await this.findBySpec(spec);
    return !!entry && entry.enabled !== false;
  }

  async create(input: CreateModelInput): Promise<ModelCatalogEntry> {
    const doc = await this.catalogModel.create({
      spec: input.spec,
      provider: input.provider,
      modelID: input.modelID,
      displayName: input.displayName,
      enabled: input.enabled ?? true,
      contextWindow: input.contextWindow,
      inputCostCentsPerMTok: input.inputCostCentsPerMTok,
      outputCostCentsPerMTok: input.outputCostCentsPerMTok,
      cacheReadCostCentsPerMTok: input.cacheReadCostCentsPerMTok,
      cacheWriteCostCentsPerMTok: input.cacheWriteCostCentsPerMTok,
      metadata: input.metadata ?? {},
    });
    await this.invalidate(input.spec);
    return doc.toObject();
  }

  async update(
    spec: string,
    input: UpdateModelInput,
  ): Promise<ModelCatalogEntry> {
    const doc = await this.catalogModel
      .findOneAndUpdate({ spec }, { $set: input }, { new: true })
      .lean()
      .exec();
    if (!doc) {
      throw new NotFoundException(`Model "${spec}" not found`);
    }
    await this.invalidate(spec);
    return doc;
  }

  async remove(spec: string): Promise<boolean> {
    const result = await this.catalogModel.deleteOne({ spec }).exec();
    await this.invalidate(spec);
    return result.deletedCount > 0;
  }

  private async readListCache(
    key: string,
  ): Promise<ModelCatalogEntry[] | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ModelCatalogEntry[];
    } catch {
      return null;
    }
  }

  private async writeListCache(
    key: string,
    docs: ModelCatalogEntry[],
  ): Promise<void> {
    await this.redis.set(key, JSON.stringify(docs), 'EX', CACHE_TTL_SECONDS);
  }

  private async invalidate(spec?: string): Promise<void> {
    const keys: string[] = [LIST_KEY, ENABLED_KEY];
    if (spec) keys.push(SPEC_KEY(spec));
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate model catalog cache for ${keys.join(', ')}:`,
        err,
      );
    }
  }
}
