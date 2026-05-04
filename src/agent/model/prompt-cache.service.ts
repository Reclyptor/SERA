import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage, SystemModelMessage } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';

const ANTHROPIC_CACHE_CONTROL: ProviderOptions = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
};

const MAX_MESSAGE_BREAKPOINTS = 3;

type CacheStrategy = 'explicit' | 'automatic' | 'none';

const PROVIDER_CACHE_STRATEGY: Record<string, CacheStrategy> = {
  anthropic: 'explicit',
  openai: 'automatic',
  google: 'automatic',
  vllm: 'none',
};

@Injectable()
export class PromptCacheService {
  private readonly logger = new Logger(PromptCacheService.name);

  getCacheStrategy(provider: string): CacheStrategy {
    return PROVIDER_CACHE_STRATEGY[provider] ?? 'none';
  }

  buildSystemWithCache(
    system: string,
    provider: string,
  ): string | SystemModelMessage {
    const strategy = this.getCacheStrategy(provider);

    if (strategy === 'explicit' && provider === 'anthropic') {
      return {
        role: 'system' as const,
        content: system,
        providerOptions: ANTHROPIC_CACHE_CONTROL,
      };
    }

    // OpenAI and Google cache automatically on stable prefixes — return as-is
    return system;
  }

  applyCacheBreakpoints(
    messages: ModelMessage[],
    provider: string,
  ): ModelMessage[] {
    const strategy = this.getCacheStrategy(provider);

    if (strategy !== 'explicit') return messages;
    if (messages.length === 0) return messages;

    if (provider === 'anthropic') {
      return this.applyAnthropicBreakpoints(messages);
    }

    return messages;
  }

  private applyAnthropicBreakpoints(messages: ModelMessage[]): ModelMessage[] {
    const indices: number[] = [];
    for (let i = messages.length - 1; i >= 0 && indices.length < MAX_MESSAGE_BREAKPOINTS; i--) {
      if (messages[i].role !== 'tool') {
        indices.push(i);
      }
    }

    if (indices.length === 0) return messages;

    const result = messages.map((msg, i) => {
      if (!indices.includes(i)) return msg;
      if (msg.providerOptions?.anthropic) return msg;

      return { ...msg, providerOptions: ANTHROPIC_CACHE_CONTROL };
    });

    this.logger.debug(
      `Applied ${indices.length} Anthropic cache breakpoints at indices [${indices.join(', ')}]`,
    );

    return result;
  }
}
