import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateText,
  streamText,
  stepCountIs,
  type GenerateTextResult,
  type StreamTextResult,
  type CoreMessage,
  type ToolSet,
  type LanguageModel,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { ModelRequestOptions, ResolvedModel } from './model.interfaces';

interface ProviderEntry {
  id: string;
  priority: number;
  factory: (modelId: string) => LanguageModel;
  defaultModel: string;
}

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);
  private readonly providers: ProviderEntry[] = [];
  private readonly primaryModel: string;
  private readonly fallbackModels: string[];
  private readonly thinkingEnabled: boolean;
  private readonly thinkingBudget: number;

  constructor(private readonly configService: ConfigService) {
    this.primaryModel = this.configService.getOrThrow<string>('PRIMARY_MODEL');
    this.fallbackModels = (
      this.configService.get<string>('FALLBACK_MODELS', '')
    )
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    this.thinkingEnabled =
      this.configService.get<string>('ANTHROPIC_THINKING_ENABLED', 'true') === 'true';
    this.thinkingBudget = parseInt(
      this.configService.get<string>('ANTHROPIC_THINKING_BUDGET', '10000'),
      10,
    );

    this.initializeProviders();
    this.logger.log(
      `Model router initialized — primary: ${this.primaryModel}, fallbacks: [${this.fallbackModels.join(', ')}]` +
        (this.thinkingEnabled ? `, thinking: budget ${this.thinkingBudget}` : ''),
    );
  }

  private initializeProviders(): void {
    const anthropicKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (anthropicKey) {
      const anthropic = createAnthropic({ apiKey: anthropicKey });
      this.providers.push({
        id: 'anthropic',
        priority: 1,
        factory: (modelId) => anthropic(modelId),
        defaultModel: 'claude-sonnet-4-6',
      });
    }

    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (openaiKey) {
      const openai = createOpenAI({ apiKey: openaiKey });
      this.providers.push({
        id: 'openai',
        priority: 2,
        factory: (modelId) => openai(modelId),
        defaultModel: 'gpt-4o',
      });
    }

    const googleKey = this.configService.get<string>('GOOGLE_API_KEY');
    if (googleKey) {
      const google = createGoogleGenerativeAI({ apiKey: googleKey });
      this.providers.push({
        id: 'google',
        priority: 3,
        factory: (modelId) => google(modelId),
        defaultModel: 'gemini-2.0-flash',
      });
    }

    this.providers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Parse "provider/model" format into components.
   */
  private parseModelSpec(spec: string): { provider: string; model: string } {
    const slashIndex = spec.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(
        `Invalid model spec "${spec}". Expected format: provider/model`,
      );
    }
    return {
      provider: spec.slice(0, slashIndex),
      model: spec.slice(slashIndex + 1),
    };
  }

  /**
   * Resolve a model specification to an AI SDK LanguageModel.
   */
  resolveModel(options?: ModelRequestOptions): ResolvedModel {
    const excludeSet = new Set(options?.excludeProviders ?? []);

    // Try preferred model first
    if (options?.preferredModel) {
      const { provider, model } = this.parseModelSpec(options.preferredModel);
      const entry = this.providers.find(
        (p) => p.id === provider && !excludeSet.has(p.id),
      );
      if (entry) {
        return {
          model: entry.factory(model),
          provider: entry.id,
          modelId: model,
        };
      }
    }

    // Try preferred provider
    if (options?.preferredProvider) {
      const entry = this.providers.find(
        (p) => p.id === options.preferredProvider && !excludeSet.has(p.id),
      );
      if (entry) {
        return {
          model: entry.factory(entry.defaultModel),
          provider: entry.id,
          modelId: entry.defaultModel,
        };
      }
    }

    // Try primary model
    const { provider: primaryProvider, model: primaryModelId } =
      this.parseModelSpec(this.primaryModel);
    const primaryEntry = this.providers.find(
      (p) => p.id === primaryProvider && !excludeSet.has(p.id),
    );
    if (primaryEntry) {
      return {
        model: primaryEntry.factory(primaryModelId),
        provider: primaryEntry.id,
        modelId: primaryModelId,
      };
    }

    // Try fallbacks in order
    for (const fallback of this.fallbackModels) {
      const { provider, model } = this.parseModelSpec(fallback);
      const entry = this.providers.find(
        (p) => p.id === provider && !excludeSet.has(p.id),
      );
      if (entry) {
        return {
          model: entry.factory(model),
          provider: entry.id,
          modelId: model,
        };
      }
    }

    // Last resort: any available provider
    const available = this.providers.find((p) => !excludeSet.has(p.id));
    if (available) {
      return {
        model: available.factory(available.defaultModel),
        provider: available.id,
        modelId: available.defaultModel,
      };
    }

    throw new Error('No model providers available');
  }

  /**
   * Build provider-specific options (e.g. Anthropic thinking).
   */
  private buildProviderOptions(provider: string): ProviderOptions | undefined {
    if (provider === 'anthropic' && this.thinkingEnabled) {
      return {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens: this.thinkingBudget },
        },
      };
    }
    return undefined;
  }

  /**
   * Check if an error is a rate limit (429) response.
   */
  private isRateLimitError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      if (e.status === 429 || e.statusCode === 429) return true;
      if (typeof e.message === 'string' && e.message.includes('429'))
        return true;
    }
    return false;
  }

  /**
   * Generate text with automatic provider fallback on rate limits.
   */
  async generate(params: {
    messages: CoreMessage[];
    tools?: ToolSet;
    system?: string;
    stopSteps?: number;
    maxOutputTokens?: number;
    temperature?: number;
    options?: ModelRequestOptions;
    abortSignal?: AbortSignal;
  }): Promise<GenerateTextResult<ToolSet, never>> {
    const excludeProviders: string[] = [
      ...(params.options?.excludeProviders ?? []),
    ];

    for (let attempt = 0; attempt < this.providers.length; attempt++) {
      const resolved = this.resolveModel({
        ...params.options,
        excludeProviders,
      });

      try {
        this.logger.debug(
          `Calling ${resolved.provider}/${resolved.modelId}`,
        );

        const result = await generateText({
          model: resolved.model,
          messages: params.messages,
          tools: params.tools,
          system: params.system,
          stopWhen: params.stopSteps
            ? stepCountIs(params.stopSteps)
            : undefined,
          maxOutputTokens:
            params.maxOutputTokens ?? params.options?.maxOutputTokens,
          temperature: params.temperature ?? params.options?.temperature,
          abortSignal: params.abortSignal,
          providerOptions: this.buildProviderOptions(resolved.provider),
        });

        return result;
      } catch (error) {
        if (this.isRateLimitError(error)) {
          this.logger.warn(
            `Rate limited by ${resolved.provider}/${resolved.modelId}, falling back...`,
          );
          excludeProviders.push(resolved.provider);
          continue;
        }
        throw error;
      }
    }

    throw new Error('All model providers are rate limited');
  }

  /**
   * Stream text with automatic provider fallback on rate limits.
   */
  stream(params: {
    messages: CoreMessage[];
    tools?: ToolSet;
    system?: string;
    stopSteps?: number;
    maxOutputTokens?: number;
    temperature?: number;
    options?: ModelRequestOptions;
    abortSignal?: AbortSignal;
    onChunk?: Parameters<typeof streamText>[0]['onChunk'];
    onStepFinish?: Parameters<typeof streamText>[0]['onStepFinish'];
    onFinish?: Parameters<typeof streamText>[0]['onFinish'];
  }): StreamTextResult<ToolSet, never> {
    const resolved = this.resolveModel(params.options);

    this.logger.debug(
      `Streaming from ${resolved.provider}/${resolved.modelId}`,
    );

    return streamText({
      model: resolved.model,
      messages: params.messages,
      tools: params.tools,
      system: params.system,
      stopWhen: params.stopSteps
        ? stepCountIs(params.stopSteps)
        : undefined,
      maxOutputTokens:
        params.maxOutputTokens ?? params.options?.maxOutputTokens,
      temperature: params.temperature ?? params.options?.temperature,
      abortSignal: params.abortSignal,
      providerOptions: this.buildProviderOptions(resolved.provider),
      onChunk: params.onChunk,
      onStepFinish: params.onStepFinish,
      onFinish: params.onFinish,
    });
  }
}
