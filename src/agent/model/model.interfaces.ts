import type { LanguageModel } from 'ai';

export interface ModelProviderConfig {
  id: string;
  priority: number;
  models: ModelConfig[];
  enabled: boolean;
}

export interface ModelConfig {
  id: string;
  provider: string;
  contextWindow?: number;
}

export interface ModelRequestOptions {
  preferredProvider?: string;
  preferredModel?: string;
  maxOutputTokens?: number;
  temperature?: number;
  excludeProviders?: string[];
}

export interface ResolvedModel {
  model: LanguageModel;
  provider: string;
  modelId: string;
}
