import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoreMessage } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import { PromptsService } from '../../prompts/prompts.service';

const CHARS_PER_TOKEN: Record<string, number> = {
  anthropic: 3.5,
  openai: 4,
  google: 4,
};

const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  google: 1_000_000,
};

const COMPRESSION_THRESHOLD = 0.75;
const PROTECTED_TAIL_TOKENS = 30_000;
const PROTECTED_HEAD_COUNT = 2;
const TOOL_OUTPUT_PRUNE_THRESHOLD = 2_000;

@Injectable()
export class ContextCompressorService {
  private readonly logger = new Logger(ContextCompressorService.name);
  private readonly contextWindows: Record<string, number>;

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

  async compress(
    messages: CoreMessage[],
    provider: string,
    systemPrompt?: string,
  ): Promise<CoreMessage[]> {
    const contextWindow = this.contextWindows[provider] ?? 200_000;
    const threshold = Math.floor(contextWindow * COMPRESSION_THRESHOLD);

    const systemTokens = systemPrompt
      ? this.estimateTokens(systemPrompt, provider)
      : 0;
    const messageTokens = this.estimateMessagesTokens(messages, provider);
    const totalTokens = systemTokens + messageTokens;

    if (totalTokens <= threshold) {
      return messages;
    }

    this.logger.debug(
      `Context at ${totalTokens} tokens (threshold: ${threshold}), compressing...`,
    );

    // Tier 1: Prune large tool outputs
    const pruned = this.pruneToolOutputs(messages);
    const prunedTokens = systemTokens + this.estimateMessagesTokens(pruned, provider);

    if (prunedTokens <= threshold) {
      this.logger.debug(
        `Tool output pruning sufficient: ${totalTokens} → ${prunedTokens} tokens`,
      );
      return pruned;
    }

    // Tier 2: LLM summarization of middle turns
    const compressed = await this.summarizeMiddle(pruned, threshold - systemTokens, provider);
    this.logger.debug(
      `LLM compression: ${prunedTokens} → ${systemTokens + this.estimateMessagesTokens(compressed, provider)} tokens`,
    );
    return compressed;
  }

  private pruneToolOutputs(messages: CoreMessage[]): CoreMessage[] {
    return messages.map((msg): CoreMessage => {
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

      return { ...msg, content: prunedContent as unknown } as CoreMessage;
    });
  }

  private async summarizeMiddle(
    messages: CoreMessage[],
    tokenBudget: number,
    provider: string,
  ): Promise<CoreMessage[]> {
    if (messages.length <= PROTECTED_HEAD_COUNT + 1) {
      return messages;
    }

    const head = messages.slice(0, PROTECTED_HEAD_COUNT);

    // Find the split point for the tail based on token budget
    let tailTokens = 0;
    let tailStart = messages.length;
    const tailBudget = Math.min(PROTECTED_TAIL_TOKENS, Math.floor(tokenBudget * 0.4));

    for (let i = messages.length - 1; i >= PROTECTED_HEAD_COUNT; i--) {
      const msgTokens = this.estimateMessageTokens(messages[i], provider);
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

  private messagesToText(messages: CoreMessage[]): string {
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

  private estimateTokens(text: string, provider?: string): number {
    const ratio = (provider ? CHARS_PER_TOKEN[provider] : undefined) ?? 4;
    return Math.ceil(text.length / ratio);
  }

  private estimateMessageTokens(msg: CoreMessage, provider?: string): number {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
    return this.estimateTokens(content, provider) + 4; // role overhead
  }

  private estimateMessagesTokens(messages: CoreMessage[], provider?: string): number {
    return messages.reduce(
      (sum, msg) => sum + this.estimateMessageTokens(msg, provider),
      0,
    );
  }
}
