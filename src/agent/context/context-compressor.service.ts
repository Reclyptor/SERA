import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModelMessage } from 'ai';
import { getEncoding, type TiktokenEncoding } from 'js-tiktoken';
import { ModelRouterService } from '../model/model-router.service';
import { PromptsService } from '../../prompts/prompts.service';

const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  google: 1_000_000,
};

const ENCODING_FOR_PROVIDER: Record<string, TiktokenEncoding> = {
  anthropic: 'cl100k_base',
  openai: 'o200k_base',
  google: 'o200k_base',
};

const COMPRESSION_THRESHOLD = 0.75;
const PROTECTED_TAIL_TOKENS = 30_000;
const PROTECTED_HEAD_COUNT = 2;
const TOOL_OUTPUT_PRUNE_THRESHOLD = 2_000;

@Injectable()
export class ContextCompressorService {
  private readonly logger = new Logger(ContextCompressorService.name);
  private readonly contextWindows: Record<string, number>;
  private readonly encoders = new Map<string, ReturnType<typeof getEncoding>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRouter: ModelRouterService,
    private readonly promptsService: PromptsService,
  ) {
    this.contextWindows = { ...DEFAULT_CONTEXT_WINDOWS };

    for (const [key, envVar] of Object.entries({
      anthropic: 'ANTHROPIC_CONTEXT_WINDOW',
      openai: 'OPENAI_CONTEXT_WINDOW',
      google: 'GOOGLE_CONTEXT_WINDOW',
    })) {
      const val = this.configService.get<string>(envVar);
      if (val) {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) this.contextWindows[key] = parsed;
      }
    }
  }

  private getEncoder(provider: string) {
    const cached = this.encoders.get(provider);
    if (cached) return cached;

    const encoding = ENCODING_FOR_PROVIDER[provider] ?? 'o200k_base';
    const enc = getEncoding(encoding);
    this.encoders.set(provider, enc);
    return enc;
  }

  async compress(
    messages: ModelMessage[],
    provider: string,
    systemPrompt?: string,
  ): Promise<ModelMessage[]> {
    const contextWindow = this.contextWindows[provider] ?? 200_000;
    const threshold = Math.floor(contextWindow * COMPRESSION_THRESHOLD);

    const systemTokens = systemPrompt
      ? this.countTokens(systemPrompt, provider)
      : 0;
    const messageTokens = this.countMessagesTokens(messages, provider);
    const totalTokens = systemTokens + messageTokens;

    if (totalTokens <= threshold) {
      return messages;
    }

    this.logger.debug(
      `Context at ${totalTokens} tokens (threshold: ${threshold}), compressing...`,
    );

    // Tier 1: Prune large tool outputs
    const pruned = this.pruneToolOutputs(messages);
    const prunedTokens = systemTokens + this.countMessagesTokens(pruned, provider);

    if (prunedTokens <= threshold) {
      this.logger.debug(
        `Tool output pruning sufficient: ${totalTokens} → ${prunedTokens} tokens`,
      );
      return pruned;
    }

    // Tier 2: LLM summarization of middle turns
    const compressed = await this.summarizeMiddle(pruned, threshold - systemTokens, provider);
    this.logger.debug(
      `LLM compression: ${prunedTokens} → ${systemTokens + this.countMessagesTokens(compressed, provider)} tokens`,
    );
    return compressed;
  }

  private pruneToolOutputs(messages: ModelMessage[]): ModelMessage[] {
    return messages.map((msg): ModelMessage => {
      if (msg.role !== 'tool') return msg;

      if (!Array.isArray(msg.content)) return msg;

      const serialized = JSON.stringify(msg.content);
      if (serialized.length <= TOOL_OUTPUT_PRUNE_THRESHOLD) return msg;

      const prunedContent = (msg.content as unknown as Array<{ type: string; output?: unknown; [k: string]: unknown }>).map((part) => {
        if (part.type !== 'tool-result') return part;

        const outputStr = typeof part.output === 'string' ? part.output : JSON.stringify(part.output ?? '');
        if (outputStr.length <= TOOL_OUTPUT_PRUNE_THRESHOLD) return part;

        const lines = outputStr.split('\n').length;
        return { ...part, output: `[Pruned: ${outputStr.length} chars, ${lines} lines]` };
      });

      return { ...msg, content: prunedContent as unknown } as ModelMessage;
    });
  }

  private async summarizeMiddle(
    messages: ModelMessage[],
    tokenBudget: number,
    provider: string,
  ): Promise<ModelMessage[]> {
    if (messages.length <= PROTECTED_HEAD_COUNT + 1) {
      return messages;
    }

    const head = messages.slice(0, PROTECTED_HEAD_COUNT);

    let tailTokens = 0;
    let tailStart = messages.length;
    const tailBudget = Math.min(PROTECTED_TAIL_TOKENS, Math.floor(tokenBudget * 0.4));

    for (let i = messages.length - 1; i >= PROTECTED_HEAD_COUNT; i--) {
      const msgTokens = this.countMessageTokens(messages[i], provider);
      if (tailTokens + msgTokens > tailBudget) break;
      tailTokens += msgTokens;
      tailStart = i;
    }

    const middle = messages.slice(PROTECTED_HEAD_COUNT, tailStart);
    const tail = messages.slice(tailStart);

    if (middle.length === 0) {
      return messages;
    }

    const middleText = this.messagesToText(middle);

    try {
      const summaryPrompt =
        (await this.promptsService.get('summary')) ??
        'Summarize the conversation excerpt. Preserve actionable details.';

      const result = await this.modelRouter.generate({
        system: summaryPrompt,
        messages: [{ role: 'user', content: middleText }],
        maxOutputTokens: 2048,
        temperature: 0.2,
      });

      const summary =
        '[CONTEXT SUMMARY — reference only, do not re-execute actions described here]\n\n' +
        result.text;

      return [
        ...head,
        { role: 'user' as const, content: summary },
        { role: 'assistant' as const, content: 'Understood. I have the context summary. Continuing.' },
        ...tail,
      ];
    } catch (err) {
      this.logger.warn('LLM summarization failed, returning pruned messages:', err);
      return [...head, ...middle, ...tail];
    }
  }

  private messagesToText(messages: ModelMessage[]): string {
    return messages
      .map((msg) => {
        const role = msg.role.toUpperCase();
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
        return `[${role}]: ${content}`;
      })
      .join('\n\n');
  }

  private countTokens(text: string, provider: string): number {
    return this.getEncoder(provider).encode(text).length;
  }

  private countMessageTokens(msg: ModelMessage, provider: string): number {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
    return this.countTokens(content, provider) + 4;
  }

  private countMessagesTokens(messages: ModelMessage[], provider: string): number {
    return messages.reduce(
      (sum, msg) => sum + this.countMessageTokens(msg, provider),
      0,
    );
  }
}
