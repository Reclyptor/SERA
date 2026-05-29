import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { ModelRouterService } from '../../model/model-router.service';
import { PromptsService } from '../../../prompts/prompts.service';
import { TokenCounterService } from '../tokens/token-counter.service';
import { ModelContextWindowService } from '../tokens/model-context-window.service';
import {
  emptyPruneStats,
  type ContextDecision,
  type ContextPrepareInput,
  type ContextPrepareResult,
  type ContextPruneStats,
} from '../interfaces';
import type { IContextEngine } from './context-engine.interface';

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

interface PruneOutcome {
  messages: ModelMessage[];
  stats: ContextPruneStats;
}

@Injectable()
export class CompactingEngineService implements IContextEngine {
  readonly name = 'compacting';
  private readonly logger = new Logger(CompactingEngineService.name);

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly promptsService: PromptsService,
    private readonly tokenCounter: TokenCounterService,
    private readonly modelContextWindow: ModelContextWindowService,
  ) {}

  async prepare(input: ContextPrepareInput): Promise<ContextPrepareResult> {
    const { messages, provider, modelID, systemPrompt, force } = input;

    const contextWindow = this.modelContextWindow.get(provider, modelID);
    const threshold = Math.floor(contextWindow * COMPRESSION_THRESHOLD);

    const systemTokens = systemPrompt
      ? this.tokenCounter.count(systemPrompt, provider)
      : 0;
    const beforeMessageTokens = this.tokenCounter.countMessages(
      messages,
      provider,
    );
    const beforeTokens = systemTokens + beforeMessageTokens;

    if (!force && beforeTokens <= threshold) {
      return this.result(
        messages,
        'noop',
        beforeTokens,
        beforeTokens,
        emptyPruneStats(),
        false,
      );
    }

    this.logger.debug(
      `Context at ${beforeTokens} tokens (threshold: ${threshold}), compressing...`,
    );

    const pruneOutcome = this.pruneToolOutputs(messages);
    const afterPruneTokens =
      systemTokens +
      this.tokenCounter.countMessages(pruneOutcome.messages, provider);

    if (afterPruneTokens <= threshold) {
      this.logger.debug(
        `Tool output pruning sufficient: ${beforeTokens} → ${afterPruneTokens} tokens`,
      );
      return this.result(
        pruneOutcome.messages,
        'pruned',
        beforeTokens,
        afterPruneTokens,
        pruneOutcome.stats,
        false,
      );
    }

    const summarized = await this.summarizeStructured(
      pruneOutcome.messages,
      threshold - systemTokens,
      provider,
    );

    if (summarized === pruneOutcome.messages) {
      const finalTokens =
        systemTokens + this.tokenCounter.countMessages(summarized, provider);
      return this.result(
        summarized,
        force ? 'force_failed' : 'pruned',
        beforeTokens,
        finalTokens,
        pruneOutcome.stats,
        false,
      );
    }

    const afterTokens =
      systemTokens + this.tokenCounter.countMessages(summarized, provider);
    this.logger.debug(
      `LLM compression: ${afterPruneTokens} → ${afterTokens} tokens`,
    );

    return this.result(
      summarized,
      'summarized',
      beforeTokens,
      afterTokens,
      pruneOutcome.stats,
      true,
    );
  }

  private result(
    messages: ModelMessage[],
    decision: ContextDecision,
    beforeTokens: number,
    afterTokens: number,
    pruned: ContextPruneStats,
    summaryUpdated: boolean,
  ): ContextPrepareResult {
    return {
      messages,
      decision,
      stats: { beforeTokens, afterTokens, pruned },
      summaryUpdated,
    };
  }

  private pruneToolOutputs(messages: ModelMessage[]): PruneOutcome {
    const stats = emptyPruneStats();
    const pruned = messages.map((msg): ModelMessage => {
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
        stats.toolResults += 1;
        return {
          ...part,
          output: `[Pruned: ${outputStr.length} chars, ${lines} lines]`,
        };
      });

      return { ...msg, content: prunedContent as unknown } as ModelMessage;
    });
    return { messages: pruned, stats };
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
      return messages;
    }
  }

  private extractExistingSummary(middle: ModelMessage[]): string | null {
    if (middle.length < 2) return null;
    const first = middle[0];
    if (first.role !== 'system' || typeof first.content !== 'string') {
      return null;
    }
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
