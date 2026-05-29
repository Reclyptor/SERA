import type { ModelMessage } from 'ai';

export interface ContextPrepareInput {
  threadID: string;
  runID: string;
  agentID: string;
  userID: string;
  messages: ModelMessage[];
  provider: string;
  modelID: string;
  systemPrompt?: string;
  force?: boolean;
  /** Per-agent override for the compaction summary model (provider/model). */
  summaryModel?: string;
}

export type ContextDecision =
  | 'noop'
  | 'pruned'
  | 'summarized'
  | 'skipped_thrash'
  | 'cooldown_active'
  | 'force_failed';

export interface ContextPruneStats {
  duplicates: number;
  images: number;
  toolArgs: number;
  toolResults: number;
}

export interface ContextSummaryStats {
  generatedTokens: number;
  costCents: number;
  model: string;
  iterative: boolean;
}

export interface ContextAuxModelFailure {
  model: string;
  error: string;
}

export interface ContextPrepareStats {
  beforeTokens: number;
  afterTokens: number;
  pruned: ContextPruneStats;
  summary?: ContextSummaryStats;
  auxModelFailure?: ContextAuxModelFailure;
}

export interface ContextPrepareResult {
  messages: ModelMessage[];
  decision: ContextDecision;
  stats: ContextPrepareStats;
  summaryUpdated: boolean;
}

export function emptyPruneStats(): ContextPruneStats {
  return { duplicates: 0, images: 0, toolArgs: 0, toolResults: 0 };
}
