import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoreMessage } from 'ai';
import { ModelRouterService } from '../model/model-router.service';

const CHARS_PER_TOKEN = 4;

const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  google: 1_000_000,
};

const COMPRESSION_THRESHOLD = 0.75;
const PROTECTED_TAIL_TOKENS = 30_000;
const PROTECTED_HEAD_COUNT = 2;
const TOOL_OUTPUT_PRUNE_THRESHOLD = 2_000;

const SUMMARY_SYSTEM_PROMPT =
  'You are a conversation summarizer. Produce a concise structured summary of the conversation excerpt below. ' +
  'Use this format:\n\n## Resolved\nBullet points of questions answered or tasks completed.\n\n' +
  '## Pending\nBullet points of open questions or in-progress tasks.\n\n' +
  '## Key Facts\nImportant context, decisions, or constraints established.\n\n' +
  'Be concise. Preserve all actionable details. Do not include greetings or filler.';

@Injectable()
export class ContextCompressorService {
  private readonly logger = new Logger(ContextCompressorService.name);
  private readonly contextWindows: Record<string, number>;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRouter: ModelRouterService,
  ) {
    this.contextWindows = { ...DEFAULT_CONTEXT_WINDOWS };

    const anthropicWindow = this.configService.get<string>('ANTHROPIC_CONTEXT_WINDOW');
    if (anthropicWindow) this.contextWindows.anthropic = parseInt(anthropicWindow, 10);

    const openaiWindow = this.configService.get<string>('OPENAI_CONTEXT_WINDOW');
    if (openaiWindow) this.contextWindows.openai = parseInt(openaiWindow, 10);

    const googleWindow = this.configService.get<string>('GOOGLE_CONTEXT_WINDOW');
    if (googleWindow) this.contextWindows.google = parseInt(googleWindow, 10);
  }

  async compress(
    messages: CoreMessage[],
    provider: string,
    systemPrompt?: string,
  ): Promise<CoreMessage[]> {
    const contextWindow = this.contextWindows[provider] ?? 200_000;
    const threshold = Math.floor(contextWindow * COMPRESSION_THRESHOLD);

    const systemTokens = systemPrompt
      ? this.estimateTokens(systemPrompt)
      : 0;
    const messageTokens = this.estimateMessagesTokens(messages);
    const totalTokens = systemTokens + messageTokens;

    if (totalTokens <= threshold) {
      return messages;
    }

    this.logger.debug(
      `Context at ${totalTokens} tokens (threshold: ${threshold}), compressing...`,
    );

    // Tier 1: Prune large tool outputs
    const pruned = this.pruneToolOutputs(messages);
    const prunedTokens = systemTokens + this.estimateMessagesTokens(pruned);

    if (prunedTokens <= threshold) {
      this.logger.debug(
        `Tool output pruning sufficient: ${totalTokens} → ${prunedTokens} tokens`,
      );
      return pruned;
    }

    // Tier 2: LLM summarization of middle turns
    const compressed = await this.summarizeMiddle(pruned, threshold - systemTokens);
    this.logger.debug(
      `LLM compression: ${prunedTokens} → ${systemTokens + this.estimateMessagesTokens(compressed)} tokens`,
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

        const outputStr = JSON.stringify(part.output ?? '');
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
      const msgTokens = this.estimateMessageTokens(messages[i]);
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
      const result = await this.modelRouter.generate({
        system: SUMMARY_SYSTEM_PROMPT,
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

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  private estimateMessageTokens(msg: CoreMessage): number {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
    return this.estimateTokens(content) + 4; // role overhead
  }

  private estimateMessagesTokens(messages: CoreMessage[]): number {
    return messages.reduce(
      (sum, msg) => sum + this.estimateMessageTokens(msg),
      0,
    );
  }
}
