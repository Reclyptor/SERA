import { Injectable, Logger } from '@nestjs/common';
import type { ModelMessage } from 'ai';
import { TokenCounterService } from '../tokens/token-counter.service';
import { ModelContextWindowService } from '../tokens/model-context-window.service';
import { ToolResultDeduplicatorService } from '../pruning/tool-result-deduplicator.service';
import { ToolArgTruncatorService } from '../pruning/tool-arg-truncator.service';
import { ImagePrunerService } from '../pruning/image-pruner.service';
import { ToolResultRendererService } from '../pruning/tool-result-renderer.service';
import { CompressionPolicyService } from '../policy/compression-policy.service';
import { ContextEventEmitterService } from '../events/context-event-emitter.service';
import {
  HANDOFF_PREFIX,
  SummarizerService,
  type SummarizerResult,
} from './summarizer.service';
import { SummaryStoreService } from '../persistence/summary-store.service';
import type {
  ContextAuxModelFailure,
  ContextDecision,
  ContextPrepareInput,
  ContextPrepareResult,
  ContextPruneStats,
  ContextSummaryStats,
} from '../interfaces';
import type { IContextEngine } from './context-engine.interface';

const COMPRESSION_THRESHOLD = 0.75;
const PROTECTED_TAIL_TOKENS = 30_000;
const PROTECTED_HEAD_COUNT = 2;
const TOOL_OUTPUT_PRUNE_THRESHOLD = 2_000;

@Injectable()
export class CompactingEngineService implements IContextEngine {
  readonly name = 'compacting';
  private readonly logger = new Logger(CompactingEngineService.name);

  constructor(
    private readonly tokenCounter: TokenCounterService,
    private readonly modelContextWindow: ModelContextWindowService,
    private readonly deduplicator: ToolResultDeduplicatorService,
    private readonly argTruncator: ToolArgTruncatorService,
    private readonly imagePruner: ImagePrunerService,
    private readonly resultRenderer: ToolResultRendererService,
    private readonly policy: CompressionPolicyService,
    private readonly events: ContextEventEmitterService,
    private readonly summarizer: SummarizerService,
    private readonly summaryStore: SummaryStoreService,
  ) {}

  async prepare(input: ContextPrepareInput): Promise<ContextPrepareResult> {
    const {
      threadID,
      runID,
      messages,
      provider,
      modelID,
      systemPrompt,
      force,
      summaryModel,
    } = input;

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
      const decision: ContextDecision = tier0DidWork ? 'pruned' : 'noop';
      void this.events.emitCompressionCompleted(runID, threadID, {
        decision,
        beforeTokens,
        afterTokens: afterTier0Tokens,
        pruned: tier0.stats,
      });
      return this.result({
        messages: tier0.messages,
        decision,
        beforeTokens,
        afterTokens: afterTier0Tokens,
        pruned: tier0.stats,
        summaryUpdated: false,
      });
    }

    // Policy check: anti-thrash & cooldown both gate Tier 1 (force bypasses).
    const policyDecision = this.policy.shouldRun(threadID, !!force);
    if (!policyDecision.allow) {
      const decision: ContextDecision =
        policyDecision.reason === 'thrash'
          ? 'skipped_thrash'
          : 'cooldown_active';
      void this.events.emitCompressionSkipped(runID, threadID, {
        reason: policyDecision.reason ?? 'cooldown',
        detail: policyDecision.detail ?? '',
      });
      return this.result({
        messages: tier0.messages,
        decision,
        beforeTokens,
        afterTokens: afterTier0Tokens,
        pruned: tier0.stats,
        summaryUpdated: false,
      });
    }

    void this.events.emitCompressionStarted(runID, threadID, {
      provider,
      modelID,
      beforeTokens,
    });

    this.logger.debug(
      `Context at ${beforeTokens} → ${afterTier0Tokens} after Tier 0 (threshold ${threshold}); proceeding to summarization...`,
    );

    const persistedSummary = await this.summaryStore.load(threadID);

    let summarizedOutcome: SummarizationOutcome;
    try {
      summarizedOutcome = await this.runSummarization({
        messages: tier0.messages,
        tokenBudget: threshold - systemTokens,
        provider,
        modelID,
        summaryModel,
        stats: tier0.stats,
        persistedSummary: persistedSummary?.text,
      });
    } catch (err) {
      this.policy.noteFailure(threadID);
      this.logger.warn('Tier 1 summarization threw, entering cooldown:', err);
      const decision: ContextDecision = force ? 'force_failed' : 'pruned';
      void this.events.emitCompressionCompleted(runID, threadID, {
        decision,
        beforeTokens,
        afterTokens: afterTier0Tokens,
        pruned: tier0.stats,
      });
      return this.result({
        messages: tier0.messages,
        decision,
        beforeTokens,
        afterTokens: afterTier0Tokens,
        pruned: tier0.stats,
        summaryUpdated: false,
      });
    }

    if (summarizedOutcome.kind === 'no_op') {
      const decision: ContextDecision = force
        ? 'force_failed'
        : tier0DidWork
          ? 'pruned'
          : 'noop';
      void this.events.emitCompressionCompleted(runID, threadID, {
        decision,
        beforeTokens,
        afterTokens: afterTier0Tokens,
        pruned: tier0.stats,
      });
      return this.result({
        messages: tier0.messages,
        decision,
        beforeTokens,
        afterTokens: afterTier0Tokens,
        pruned: tier0.stats,
        summaryUpdated: false,
      });
    }

    const finalMessages = summarizedOutcome.messages;
    const afterTokens =
      systemTokens + this.tokenCounter.countMessages(finalMessages, provider);
    this.logger.debug(
      `LLM compression: ${afterTier0Tokens} → ${afterTokens} tokens`,
    );

    const savingsRatio =
      afterTier0Tokens > 0
        ? Math.max(0, (afterTier0Tokens - afterTokens) / afterTier0Tokens)
        : 0;
    this.policy.noteSummarization(threadID, savingsRatio);

    const summaryStats: ContextSummaryStats = {
      generatedTokens: summarizedOutcome.summary.generatedTokens,
      costCents: 0,
      model: summarizedOutcome.summary.modelUsed,
      iterative: summarizedOutcome.summary.iterative,
    };

    try {
      await this.summaryStore.save({
        threadID,
        summaryText: summarizedOutcome.summary.body,
        decision: 'summarized',
        model: summarizedOutcome.summary.modelUsed,
        costCents: 0,
        savingsRatio,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist context summary for thread ${threadID}:`,
        err,
      );
    }

    void this.events.emitCompressionCompleted(runID, threadID, {
      decision: 'summarized',
      beforeTokens,
      afterTokens,
      pruned: tier0.stats,
      summary: summaryStats,
      auxModelFailure: summarizedOutcome.summary.auxModelFailure,
    });

    return this.result({
      messages: finalMessages,
      decision: 'summarized',
      beforeTokens,
      afterTokens,
      pruned: tier0.stats,
      summary: summaryStats,
      auxModelFailure: summarizedOutcome.summary.auxModelFailure,
      summaryUpdated: true,
    });
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

  private result(opts: {
    messages: ModelMessage[];
    decision: ContextDecision;
    beforeTokens: number;
    afterTokens: number;
    pruned: ContextPruneStats;
    summary?: ContextSummaryStats;
    auxModelFailure?: ContextAuxModelFailure;
    summaryUpdated: boolean;
  }): ContextPrepareResult {
    return {
      messages: opts.messages,
      decision: opts.decision,
      stats: {
        beforeTokens: opts.beforeTokens,
        afterTokens: opts.afterTokens,
        pruned: opts.pruned,
        summary: opts.summary,
        auxModelFailure: opts.auxModelFailure,
      },
      summaryUpdated: opts.summaryUpdated,
    };
  }

  private pruneLargeToolOutputs(
    messages: ModelMessage[],
    stats: ContextPruneStats,
  ): ModelMessage[] {
    const callMeta = this.collectToolCallMeta(messages);

    return messages.map((msg): ModelMessage => {
      if (msg.role !== 'tool') return msg;
      if (!Array.isArray(msg.content)) return msg;

      const serialized = JSON.stringify(msg.content);
      if (serialized.length <= TOOL_OUTPUT_PRUNE_THRESHOLD) return msg;

      const prunedContent = (
        msg.content as unknown as Array<{
          type: string;
          toolCallId?: string;
          toolName?: string;
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

        const meta = part.toolCallId
          ? callMeta.get(part.toolCallId)
          : undefined;
        const toolName = meta?.toolName ?? part.toolName ?? 'unknown';
        const args = meta?.args ?? {};
        const summary = this.resultRenderer.render(toolName, args, part.output);
        stats.toolResults += 1;
        return { ...part, output: summary };
      });

      return { ...msg, content: prunedContent as unknown } as ModelMessage;
    });
  }

  private collectToolCallMeta(
    messages: ModelMessage[],
  ): Map<string, { toolName: string; args: unknown }> {
    const meta = new Map<string, { toolName: string; args: unknown }>();
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content as Array<{
        type?: string;
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
      }>) {
        if (
          part?.type === 'tool-call' &&
          typeof part.toolCallId === 'string' &&
          typeof part.toolName === 'string'
        ) {
          meta.set(part.toolCallId, {
            toolName: part.toolName,
            args: part.args,
          });
        }
      }
    }
    return meta;
  }

  private async runSummarization(opts: {
    messages: ModelMessage[];
    tokenBudget: number;
    provider: string;
    modelID: string;
    summaryModel?: string;
    stats: ContextPruneStats;
    persistedSummary?: string;
  }): Promise<SummarizationOutcome> {
    if (opts.messages.length <= PROTECTED_HEAD_COUNT + 1) {
      return { kind: 'no_op' };
    }

    // Pre-summarization: replace any remaining large tool outputs with the
    // semantic renderer so the summarizer LLM doesn't itself blow context.
    const prepared = this.pruneLargeToolOutputs(opts.messages, opts.stats);

    const head = prepared.slice(0, PROTECTED_HEAD_COUNT);

    let tailTokens = 0;
    let tailStart = prepared.length;
    const tailBudget = Math.min(
      PROTECTED_TAIL_TOKENS,
      Math.floor(opts.tokenBudget * 0.4),
    );
    for (let i = prepared.length - 1; i >= PROTECTED_HEAD_COUNT; i--) {
      const msgTokens = this.tokenCounter.countMessage(
        prepared[i],
        opts.provider,
      );
      if (tailTokens + msgTokens > tailBudget) break;
      tailTokens += msgTokens;
      tailStart = i;
    }

    const middle = prepared.slice(PROTECTED_HEAD_COUNT, tailStart);
    const tail = prepared.slice(tailStart);

    if (middle.length === 0) {
      return { kind: 'no_op' };
    }

    const inMessageSummary = this.extractExistingSummary(middle);
    // The persisted store (ContextState) is the authoritative source for the
    // previous summary across runs. The in-message summary is the same value
    // re-emitted by an earlier iteration of the same run and is functionally
    // equivalent — prefer the persisted one when both exist.
    const previousSummary =
      opts.persistedSummary ?? inMessageSummary ?? undefined;
    const middleSlice = inMessageSummary ? middle.slice(2) : middle;
    const middleText = this.messagesToText(middleSlice);
    const middleTokens = this.tokenCounter.count(middleText, opts.provider);

    const summary: SummarizerResult = await this.summarizer.summarize({
      middleText,
      middleTokens,
      provider: opts.provider,
      modelID: opts.modelID,
      summaryModelOverride: opts.summaryModel,
      previousSummary,
    });

    const messages = [
      ...head,
      ...this.summarizer.buildSummaryMessages(summary.wrappedSummary),
      ...tail,
    ];

    return { kind: 'summarized', messages, summary };
  }

  private extractExistingSummary(middle: ModelMessage[]): string | null {
    if (middle.length < 2) return null;
    const first = middle[0];
    if (first.role !== 'system' || typeof first.content !== 'string') {
      return null;
    }
    if (!first.content.startsWith(HANDOFF_PREFIX)) return null;
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

type SummarizationOutcome =
  | { kind: 'no_op' }
  | { kind: 'summarized'; messages: ModelMessage[]; summary: SummarizerResult };
