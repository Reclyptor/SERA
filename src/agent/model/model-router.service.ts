import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateText,
  streamText,
  stepCountIs,
  type GenerateTextResult,
  type StreamTextResult,
  type ModelMessage,
  type ToolSet,
  type LanguageModel,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { ModelRequestOptions, ResolvedModel } from './model.interfaces';
import { PromptCacheService } from './prompt-cache.service';
import { CredentialPoolService } from './credential-pool.service';
import { classifyError } from './error-classifier';
import { withRetry } from './retry-utils';

interface ProviderEntry {
  id: string;
  priority: number;
  factory: (modelID: string) => LanguageModel;
  defaultModel: string;
  allowedModels: Set<string>;
}

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);
  private readonly providers: ProviderEntry[] = [];
  private readonly primaryModel: string;
  private readonly fallbackModels: string[];
  private readonly thinkingEnabled: boolean;
  private readonly thinkingBudget: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly promptCache: PromptCacheService,
    private readonly credentialPool: CredentialPoolService,
  ) {
    this.primaryModel = this.configService.getOrThrow<string>('PRIMARY_MODEL');
    this.fallbackModels = this.configService
      .get<string>('FALLBACK_MODELS', '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    this.thinkingEnabled =
      this.configService.get<string>('ANTHROPIC_THINKING_ENABLED', 'true') ===
      'true';
    const parsedBudget = parseInt(
      this.configService.get<string>('ANTHROPIC_THINKING_BUDGET', '10000'),
      10,
    );
    this.thinkingBudget = Number.isNaN(parsedBudget) ? 10000 : parsedBudget;

    this.initializeProviders();
    this.logger.log(
      `Model router initialized — primary: ${this.primaryModel}, fallbacks: [${this.fallbackModels.join(', ')}]` +
        (this.thinkingEnabled
          ? `, thinking: budget ${this.thinkingBudget}`
          : ''),
    );
  }

  private initializeProviders(): void {
    const anthropicKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (anthropicKey) {
      this.providers.push({
        id: 'anthropic',
        priority: 1,
        factory: (modelID) => {
          const key = this.credentialPool.getKey('anthropic') ?? anthropicKey;
          return createAnthropic({ apiKey: key })(modelID);
        },
        defaultModel: 'claude-sonnet-4-6',
        allowedModels: new Set([
          'claude-haiku-4-5',
          'claude-sonnet-4-6',
          'claude-opus-4-7',
        ]),
      });
    }

    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (openaiKey) {
      this.providers.push({
        id: 'openai',
        priority: 2,
        factory: (modelID) => {
          const key = this.credentialPool.getKey('openai') ?? openaiKey;
          return createOpenAI({ apiKey: key })(modelID);
        },
        defaultModel: 'gpt-4o',
        allowedModels: new Set(['gpt-4o-mini', 'gpt-4o', 'o3']),
      });
    }

    const googleKey = this.configService.get<string>('GOOGLE_API_KEY');
    if (googleKey) {
      this.providers.push({
        id: 'google',
        priority: 3,
        factory: (modelID) => {
          const key = this.credentialPool.getKey('google') ?? googleKey;
          return createGoogleGenerativeAI({ apiKey: key })(modelID);
        },
        defaultModel: 'gemini-2.0-flash',
        allowedModels: new Set(['gemini-2.0-flash']),
      });
    }

    const vllmURL = this.configService.get<string>('VLLM_URL');
    if (vllmURL) {
      const vllm = createOpenAICompatible({
        name: 'vllm',
        baseURL: `${vllmURL.replace(/\/+$/, '')}/v1`,
        apiKey: 'noop',
      });
      this.providers.push({
        id: 'vllm',
        priority: 4,
        factory: (modelID) => vllm.chatModel(modelID),
        defaultModel: 'Qwen3.6-27B-FP8',
        allowedModels: new Set([
          'Qwen3.6-27B-FP8',
          'Huihui-Qwen3.6-27B-abliterated',
        ]),
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
  private buildResolved(entry: ProviderEntry, modelID: string): ResolvedModel {
    if (!entry.allowedModels.has(modelID)) {
      throw new Error(
        `Model "${modelID}" is not allowed for provider "${entry.id}"`,
      );
    }
    return {
      model: entry.factory(modelID),
      provider: entry.id,
      modelID,
    };
  }

  resolveModel(options?: ModelRequestOptions): ResolvedModel {
    const first = this.resolveModelCandidates(options)[0];
    if (!first) {
      throw new Error('No model providers available');
    }
    return first;
  }

  private resolveModelCandidates(
    options?: ModelRequestOptions,
  ): ResolvedModel[] {
    const excludeSet = new Set(options?.excludeProviders ?? []);
    const candidates: ResolvedModel[] = [];
    const seen = new Set<string>();

    const addCandidate = (
      provider: string,
      modelID?: string,
      strict = false,
    ): void => {
      if (excludeSet.has(provider)) return;
      const entry = this.providers.find((p) => p.id === provider);
      if (!entry) return;
      const selectedModel = modelID ?? entry.defaultModel;
      const key = `${provider}/${selectedModel}`;
      if (seen.has(key)) return;
      try {
        candidates.push(this.buildResolved(entry, selectedModel));
        seen.add(key);
      } catch (error) {
        if (strict) throw error;
        this.logger.warn(
          `Skipping unavailable fallback model ${key}: ${error instanceof Error ? error.message : error}`,
        );
      }
    };

    if (options?.preferredModel) {
      const { provider, model } = this.parseModelSpec(options.preferredModel);
      addCandidate(provider, model, true);
    }

    if (options?.preferredProvider) {
      addCandidate(options.preferredProvider);
    }

    const { provider: primaryProvider, model: primaryModelID } =
      this.parseModelSpec(this.primaryModel);
    addCandidate(primaryProvider, primaryModelID, true);

    for (const fallback of this.fallbackModels) {
      const { provider, model } = this.parseModelSpec(fallback);
      addCandidate(provider, model);
    }

    for (const provider of this.providers) {
      addCandidate(provider.id);
    }

    return candidates;
  }

  /**
   * Build provider-specific options (e.g. Anthropic thinking).
   */
  private buildProviderOptions(
    provider: string,
    modelID: string,
  ): ProviderOptions | undefined {
    if (provider === 'anthropic' && this.thinkingEnabled) {
      const isAdaptiveModel =
        modelID.includes('claude-opus-4') ||
        modelID.includes('claude-sonnet-4-6') ||
        modelID.includes('claude-sonnet-4-5');
      return {
        anthropic: {
          thinking: isAdaptiveModel
            ? { type: 'adaptive' as const }
            : { type: 'enabled' as const, budgetTokens: this.thinkingBudget },
        },
      };
    }
    return undefined;
  }

  async generate(params: {
    messages: ModelMessage[];
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

      const cachedMessages = this.promptCache.applyCacheBreakpoints(
        params.messages,
        resolved.provider,
      );
      const cachedSystem = params.system
        ? this.promptCache.buildSystemWithCache(
            params.system,
            resolved.provider,
          )
        : undefined;

      try {
        this.logger.debug(`Calling ${resolved.provider}/${resolved.modelID}`);

        const result = await withRetry(
          () =>
            generateText({
              model: resolved.model,
              messages: cachedMessages,
              tools: params.tools,
              system: cachedSystem,
              stopWhen: params.stopSteps
                ? stepCountIs(params.stopSteps)
                : undefined,
              maxOutputTokens:
                params.maxOutputTokens ?? params.options?.maxOutputTokens,
              temperature: params.temperature ?? params.options?.temperature,
              abortSignal: params.abortSignal,
              providerOptions: this.buildProviderOptions(
                resolved.provider,
                resolved.modelID,
              ),
            }),
          {
            maxAttempts: 3,
            signal: params.abortSignal,
            shouldRetry: (err) => {
              const classified = classifyError(err);
              return classified.retryable && !classified.shouldRotate;
            },
            onRetry: (err, retryAttempt, delayMs) => {
              const classified = classifyError(err);
              this.logger.warn(
                `Transient error [${classified.reason}] from ${resolved.provider}/${resolved.modelID}, ` +
                  `retry ${retryAttempt} in ${delayMs}ms`,
              );
            },
          },
        );

        return result;
      } catch (error) {
        const classified = classifyError(error);

        if (classified.shouldCompress) {
          throw error;
        }

        if (classified.shouldRotate) {
          this.logger.warn(
            `[${classified.reason}] ${resolved.provider}/${resolved.modelID}, falling back...`,
          );
          this.credentialPool.markCooldown(resolved.provider);
          excludeProviders.push(resolved.provider);
          continue;
        }

        throw error;
      }
    }

    throw new Error('All model providers exhausted');
  }

  /**
   * Stream text with automatic provider fallback on rate limits.
   */
  stream(params: {
    messages: ModelMessage[];
    tools?: ToolSet;
    system?: string;
    stopSteps?: number;
    maxOutputTokens?: number;
    temperature?: number;
    options?: ModelRequestOptions;
    abortSignal?: AbortSignal;
    onAttempt?: (attempt: {
      attempt: number;
      provider: string;
      modelID: string;
    }) => void | Promise<void>;
    onFallback?: (fallback: {
      attempt: number;
      provider: string;
      modelID: string;
      reason: string;
      message: string;
      nextProvider?: string;
      nextModelID?: string;
    }) => void | Promise<void>;
    onChunk?: Parameters<typeof streamText>[0]['onChunk'];
    onStepFinish?: Parameters<typeof streamText>[0]['onStepFinish'];
    onFinish?: Parameters<typeof streamText>[0]['onFinish'];
  }): StreamTextResult<ToolSet, never> {
    const candidates = this.resolveModelCandidates(params.options);
    if (!candidates.length) {
      throw new Error('No model providers available');
    }

    let activeResult = this.createStreamTextResult(params, candidates[0]);
    let activeIndex = 0;
    let attemptNumber = 0;

    const call = async <T>(fn: (() => T | Promise<T>) | undefined) => {
      if (fn) await fn();
    };

    const fullStream = async function* (this: ModelRouterService) {
      while (activeIndex < candidates.length) {
        const resolved = candidates[activeIndex];
        attemptNumber++;
        await call(() =>
          params.onAttempt?.({
            attempt: attemptNumber,
            provider: resolved.provider,
            modelID: resolved.modelID,
          }),
        );

        let yielded = false;
        try {
          for await (const part of activeResult.fullStream) {
            yielded = true;
            yield part;
          }
          return;
        } catch (error) {
          const classified = classifyError(error);
          const next = candidates[activeIndex + 1];
          if (
            yielded ||
            classified.shouldCompress ||
            !next ||
            (!classified.retryable && !classified.shouldRotate)
          ) {
            throw error;
          }

          if (classified.shouldRotate) {
            this.credentialPool.markCooldown(resolved.provider);
          }

          await call(() =>
            params.onFallback?.({
              attempt: attemptNumber,
              provider: resolved.provider,
              modelID: resolved.modelID,
              reason: classified.reason,
              message: classified.message,
              nextProvider: next.provider,
              nextModelID: next.modelID,
            }),
          );

          activeIndex++;
          activeResult = this.createStreamTextResult(params, next);
        }
      }
    }.call(this);

    return new Proxy(activeResult, {
      get(_target, prop, receiver) {
        if (prop === 'fullStream') return fullStream;
        const value = Reflect.get(activeResult, prop, receiver);
        return typeof value === 'function' ? value.bind(activeResult) : value;
      },
    });
  }

  private createStreamTextResult(
    params: {
      messages: ModelMessage[];
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
    },
    resolved: ResolvedModel,
  ): StreamTextResult<ToolSet, never> {
    const cachedMessages = this.promptCache.applyCacheBreakpoints(
      params.messages,
      resolved.provider,
    );
    const cachedSystem = params.system
      ? this.promptCache.buildSystemWithCache(params.system, resolved.provider)
      : undefined;

    this.logger.debug(
      `Streaming from ${resolved.provider}/${resolved.modelID}`,
    );

    return streamText({
      model: resolved.model,
      messages: cachedMessages,
      tools: params.tools,
      system: cachedSystem,
      stopWhen: params.stopSteps ? stepCountIs(params.stopSteps) : undefined,
      maxOutputTokens:
        params.maxOutputTokens ?? params.options?.maxOutputTokens,
      temperature: params.temperature ?? params.options?.temperature,
      abortSignal: params.abortSignal,
      providerOptions: this.buildProviderOptions(
        resolved.provider,
        resolved.modelID,
      ),
      onChunk: params.onChunk,
      onStepFinish: params.onStepFinish,
      onFinish: params.onFinish,
    });
  }
}
