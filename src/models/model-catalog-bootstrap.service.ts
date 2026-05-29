import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ModelCatalogService,
  type CreateModelInput,
} from './model-catalog.service';

// Default seed list — mirrors the providers wired into `ModelRouter` and the
// pricing table in SPEC §22. The bootstrap is one-shot: it only seeds when the
// catalog is empty, so operators can safely re-deploy without overwriting any
// runtime-added entries.
const SEED_MODELS: CreateModelInput[] = [
  {
    spec: 'anthropic/claude-haiku-4-5',
    provider: 'anthropic',
    modelID: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    inputCostCentsPerMTok: 80,
    outputCostCentsPerMTok: 400,
    cacheReadCostCentsPerMTok: 8,
    cacheWriteCostCentsPerMTok: 100,
  },
  {
    spec: 'anthropic/claude-sonnet-4-6',
    provider: 'anthropic',
    modelID: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200_000,
    inputCostCentsPerMTok: 300,
    outputCostCentsPerMTok: 1500,
    cacheReadCostCentsPerMTok: 30,
    cacheWriteCostCentsPerMTok: 375,
  },
  {
    spec: 'anthropic/claude-opus-4-7',
    provider: 'anthropic',
    modelID: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7',
    contextWindow: 200_000,
    inputCostCentsPerMTok: 1500,
    outputCostCentsPerMTok: 7500,
    cacheReadCostCentsPerMTok: 150,
    cacheWriteCostCentsPerMTok: 1875,
  },
  {
    spec: 'openai/gpt-4o-mini',
    provider: 'openai',
    modelID: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    contextWindow: 128_000,
    inputCostCentsPerMTok: 15,
    outputCostCentsPerMTok: 60,
  },
  {
    spec: 'openai/gpt-4o',
    provider: 'openai',
    modelID: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    inputCostCentsPerMTok: 250,
    outputCostCentsPerMTok: 1000,
  },
  {
    spec: 'openai/o3',
    provider: 'openai',
    modelID: 'o3',
    displayName: 'OpenAI o3',
    contextWindow: 128_000,
    inputCostCentsPerMTok: 200,
    outputCostCentsPerMTok: 800,
  },
  {
    spec: 'google/gemini-2.0-flash',
    provider: 'google',
    modelID: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1_000_000,
    inputCostCentsPerMTok: 10,
    outputCostCentsPerMTok: 40,
  },
  {
    spec: 'vllm/Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-FP8',
    provider: 'vllm',
    modelID: 'Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-FP8',
    displayName: 'Huihui Qwen 3.6 35B A3B Claude 4.7 Opus Abliterated FP8',
    contextWindow: 262_144,
  },
];

@Injectable()
export class ModelCatalogBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ModelCatalogBootstrapService.name);

  constructor(private readonly catalog: ModelCatalogService) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.catalog.findAll();
      if (existing.length > 0) {
        this.logger.log(
          `Model catalog has ${existing.length} entries; skipping seed`,
        );
        return;
      }
      this.logger.log('Seeding model catalog from built-in defaults...');
      for (const seed of SEED_MODELS) {
        try {
          await this.catalog.create(seed);
        } catch (err) {
          this.logger.warn(`Failed to seed ${seed.spec}: ${String(err)}`);
        }
      }
      this.logger.log(`Seeded ${SEED_MODELS.length} model catalog entries`);
    } catch (err) {
      this.logger.error('Model catalog bootstrap failed:', err);
    }
  }
}
