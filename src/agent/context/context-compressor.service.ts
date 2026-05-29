import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import { PromptsService } from '../../prompts/prompts.service';
import { TokenCounterService } from './tokens/token-counter.service';
import { ModelContextWindowService } from './tokens/model-context-window.service';

const COMPRESSION_THRESHOLD = 0.75;
const PROTECTED_TAIL_TOKENS = 30_000;
const PROTECTED_HEAD_COUNT = 2;
const TOOL_OUTPUT_PRUNE_THRESHOLD = 2_000;

const SUMMARY_PREFIX = '[CONTEXT SUMMARY]';

const STRUCTURED_SUMMARY_PROMPT = `You are summarizing a conversation between a user and an AI assistant for context handoff.
Produce a structured summary in this exact format:

## Resolved
- Bullet list of completed tasks, decisions made, questions answered

## Pending
- Bullet list of open items, unresolved questions, things still in progress

## Active Task
- What the assistant was most recently working on (single item, or "None")

## Key Context
- Important file paths, variable names, identifiers, error messages, or facts that would be needed to continue the work

Rules:
- Be concise but preserve specifics: exact file paths, function names, error text, config values
- If an existing summary is included, update it — merge resolved items, promote pending to resolved if done, add new items
- Do not invent information not present in the conversation`;

@Injectable()
export class ContextCompressorService {
  private readonly logger = new Logger(ContextCompressorService.name);

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly promptsService: PromptsService,
    private readonly tokenCounter: TokenCounterService,
    private readonly modelContextWindow: ModelContextWindowService,
  ) {}

  async compress(
    messages: ModelMessage[],
    provider: string,
    systemPrompt?: string,
    force = false,
    modelID?: string,
  ): Promise<ModelMessage[]> {
    const contextWindow = this.modelContextWindow.get(provider, modelID);
    const threshold = Math.floor(contextWindow * COMPRESSION_THRESHOLD);

    const systemTokens = systemPrompt
      ? this.tokenCounter.count(systemPrompt, provider)
      : 0;
    const messageTokens = this.tokenCounter.countMessages(messages, provider);
    const totalTokens = systemTokens + messageTokens;

    if (!force && totalTokens <= threshold) {
      return messages;
    }

    this.logger.debug(
      `Context at ${totalTokens} tokens (threshold: ${threshold}), compressing...`,
    );

    // Tier 1: Prune large tool outputs
    const pruned = this.pruneToolOutputs(messages);
    const prunedTokens =
      systemTokens + this.tokenCounter.countMessages(pruned, provider);

    if (prunedTokens <= threshold) {
      this.logger.debug(
        `Tool output pruning sufficient: ${totalTokens} → ${prunedTokens} tokens`,
      );
      return pruned;
    }

    // Tier 2: Structured LLM summarization of middle turns
    const compressed = await this.summarizeStructured(
      pruned,
      threshold - systemTokens,
      provider,
    );
    this.logger.debug(
      `LLM compression: ${prunedTokens} → ${systemTokens + this.tokenCounter.countMessages(compressed, provider)} tokens`,
    );
    return compressed;
  }

  private pruneToolOutputs(messages: ModelMessage[]): ModelMessage[] {
    return messages.map((msg): ModelMessage => {
      if (msg.role !== 'tool') return msg;

      if (!Array.isArray(msg.content)) return msg;

      const serialized = JSON.stringify(msg.content);
      if (serialized.length <= TOOL_OUTPUT_PRUNE_THRESHOLD) return msg;

      const prunedContent = (
        msg.content as unknown as Array<{
          type: string;
          output?: unknown;
          [k: string]: unknown;
        }>
      ).map((part) => {
        if (part.type !== 'tool-result') return part;

        const outputStr =
          typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output ?? '');
        if (outputStr.length <= TOOL_OUTPUT_PRUNE_THRESHOLD) return part;

        const lines = outputStr.split('\n').length;
        return {
          ...part,
          output: `[Pruned: ${outputStr.length} chars, ${lines} lines]`,
        };
      });

      return { ...msg, content: prunedContent as unknown } as ModelMessage;
    });
  }

  private async summarizeStructured(
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
    const tailBudget = Math.min(
      PROTECTED_TAIL_TOKENS,
      Math.floor(tokenBudget * 0.4),
    );

    for (let i = messages.length - 1; i >= PROTECTED_HEAD_COUNT; i--) {
      const msgTokens = this.tokenCounter.countMessage(messages[i], provider);
      if (tailTokens + msgTokens > tailBudget) break;
      tailTokens += msgTokens;
      tailStart = i;
    }

    const middle = messages.slice(PROTECTED_HEAD_COUNT, tailStart);
    const tail = messages.slice(tailStart);

    if (middle.length === 0) {
      return messages;
    }

    const existingSummary = this.extractExistingSummary(middle);
    const middleText = this.messagesToText(
      existingSummary ? middle.slice(2) : middle,
    );

    const userContent = existingSummary
      ? `Here is the previous summary to update:\n\n${existingSummary}\n\n---\n\nNew conversation to incorporate:\n\n${middleText}`
      : middleText;

    try {
      const customPrompt = await this.promptsService.get('summary');
      const summaryPrompt = customPrompt ?? STRUCTURED_SUMMARY_PROMPT;

      const result = await this.modelRouter.generate({
        system: summaryPrompt,
        messages: [{ role: 'user', content: userContent }],
        maxOutputTokens: 2048,
        temperature: 0.2,
      });

      const summary = `${SUMMARY_PREFIX}\n\n${result.text}`;

      return [
        ...head,
        { role: 'system' as const, content: summary },
        {
          role: 'assistant' as const,
          content:
            'Understood. I have the context summary and will continue from where we left off.',
        },
        ...tail,
      ];
    } catch (err) {
      this.logger.warn(
        'LLM summarization failed, returning pruned messages:',
        err,
      );
      return [...head, ...middle, ...tail];
    }
  }

  private extractExistingSummary(middle: ModelMessage[]): string | null {
    if (middle.length < 2) return null;
    const first = middle[0];
    if (first.role !== 'system' || typeof first.content !== 'string')
      return null;
    if (!first.content.startsWith(SUMMARY_PREFIX)) return null;
    return first.content;
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
}
