import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { ModelRouterService } from '../../model/model-router.service';
import { PromptsService } from '../../../prompts/prompts.service';
import { TokenCounterService } from '../tokens/token-counter.service';
import { ModelContextWindowService } from '../tokens/model-context-window.service';
import { ToolResultDeduplicatorService } from '../pruning/tool-result-deduplicator.service';
import { ToolArgTruncatorService } from '../pruning/tool-arg-truncator.service';
import { ImagePrunerService } from '../pruning/image-pruner.service';
import type {
  ContextDecision,
  ContextPrepareInput,
  ContextPrepareResult,
  ContextPruneStats,
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

@Injectable()
export class CompactingEngineService implements IContextEngine {
  readonly name = 'compacting';
  private readonly logger = new Logger(CompactingEngineService.name);

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly promptsService: PromptsService,
    private readonly tokenCounter: TokenCounterService,
    private readonly modelContextWindow: ModelContextWindowService,
    private readonly deduplicator: ToolResultDeduplicatorService,
    private readonly argTruncator: ToolArgTruncatorService,
    private readonly imagePruner: ImagePrunerService,
  ) {}

  async prepare(input: ContextPrepareInput): Promise<ContextPrepareResult> {
    const { messages, provider, modelID, systemPrompt, force } = input;

    const contextWindow = this.modelContextWindow.get(provider, modelID);
    const threshold = Math.floor(contextWindow * COMPRESSION_THRESHOLD);

    const systemTokens = systemPrompt
      ? this.tokenCounter.count(systemPrompt, provider)
      : 0;
    const beforeTokens =
      systemTokens + this.tokenCounter.countMessages(messages, provider);

    // Tier 0 — lossless pruning ALWAYS runs.
    const tier0 = this.runTier0(messages);
    const afterTier0Tokens =
      systemTokens + this.tokenCounter.countMessages(tier0.messages, provider);

    const tier0DidWork =
      tier0.stats.duplicates + tier0.stats.images + tier0.stats.toolArgs > 0;

    if (!force && afterTier0Tokens <= threshold) {
      return this.result(
        tier0.messages,
        tier0DidWork ? 'pruned' : 'noop',
        beforeTokens,
        afterTier0Tokens,
        tier0.stats,
        false,
      );
    }

    this.logger.debug(
      `Context at ${beforeTokens} → ${afterTier0Tokens} after Tier 0 (threshold ${threshold}); proceeding to summarization...`,
    );

    const summarized = await this.summarizeStructured(
      tier0.messages,
      threshold - systemTokens,
      provider,
      tier0.stats,
    );

    if (summarized === tier0.messages) {
      // Summarization made no change (short conversation or LLM error).
      return this.result(
        tier0.messages,
        force ? 'force_failed' : tier0DidWork ? 'pruned' : 'noop',
        beforeTokens,
        afterTier0Tokens,
        tier0.stats,
        false,
      );
    }

    const afterTokens =
      systemTokens + this.tokenCounter.countMessages(summarized, provider);
    this.logger.debug(
      `LLM compression: ${afterTier0Tokens} → ${afterTokens} tokens`,
    );

    return this.result(
      summarized,
      'summarized',
      beforeTokens,
      afterTokens,
      tier0.stats,
      true,
    );
  }

  private runTier0(messages: ModelMessage[]): {
    messages: ModelMessage[];
    stats: ContextPruneStats;
  } {
    const dedup = this.deduplicator.dedupe(messages);
    const trunc = this.argTruncator.truncate(dedup.messages);
    const img = this.imagePruner.prune(trunc.messages);
    return {
      messages: img.messages,
      stats: {
        duplicates: dedup.duplicates,
        toolArgs: trunc.truncated,
        images: img.images,
        toolResults: 0,
      },
    };
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

  private pruneLargeToolOutputs(
    messages: ModelMessage[],
    stats: ContextPruneStats,
  ): ModelMessage[] {
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
        stats.toolResults += 1;
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
    stats: ContextPruneStats,
  ): Promise<ModelMessage[]> {
    if (messages.length <= PROTECTED_HEAD_COUNT + 1) {
      return messages;
    }

    // Pre-summarization: replace any remaining large tool outputs with a size
    // placeholder so the summarizer LLM doesn't itself blow context. This is
    // a lossy stop-gap until Phase 4 swaps in tool-result-aware semantic
    // rendering.
    const prepared = this.pruneLargeToolOutputs(messages, stats);

    const head = prepared.slice(0, PROTECTED_HEAD_COUNT);

    let tailTokens = 0;
    let tailStart = prepared.length;
    const tailBudget = Math.min(
      PROTECTED_TAIL_TOKENS,
      Math.floor(tokenBudget * 0.4),
    );

    for (let i = prepared.length - 1; i >= PROTECTED_HEAD_COUNT; i--) {
      const msgTokens = this.tokenCounter.countMessage(prepared[i], provider);
      if (tailTokens + msgTokens > tailBudget) break;
      tailTokens += msgTokens;
      tailStart = i;
    }

    const middle = prepared.slice(PROTECTED_HEAD_COUNT, tailStart);
    const tail = prepared.slice(tailStart);

    if (middle.length === 0) {
      return prepared;
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
      return prepared;
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
