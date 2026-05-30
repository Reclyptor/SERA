import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEMORY_BACKEND,
  type MemoryBackend,
} from './backend/memory-backend.interface';
import { MemoryScorer } from './scoring/memory-scorer';
import { MemoryReranker } from './reranker/memory-reranker';
import type {
  AddMemoryInput,
  ListMemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemorySearchHit,
} from './memory.types';

export interface SearchOptions {
  scope?: MemoryScope;
  tags?: string[];
  limit?: number;
  prefetchLimit?: number;
}

export interface ContextOptions {
  scope?: MemoryScope;
  limit?: number;
}

/**
 * Public surface of the memory subsystem. The only thing imported by
 * orchestrator, run-lifecycle, prompt-builder, tools, actions, the
 * knowledge provider, and the controller. Storage details live behind
 * the `MemoryBackend` interface; ranking lives in `MemoryScorer`;
 * optional LLM rerank lives in `MemoryReranker`. See SPEC §13.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly searchLimit: number;
  private readonly contextLimit: number;
  private readonly prefetchLimit: number;

  constructor(
    @Inject(MEMORY_BACKEND) private readonly backend: MemoryBackend,
    private readonly scorer: MemoryScorer,
    private readonly reranker: MemoryReranker,
    private readonly configService: ConfigService,
  ) {
    this.searchLimit = Number(
      this.configService.get<string>('MEMORY_SEARCH_LIMIT', '10'),
    );
    this.contextLimit = Number(
      this.configService.get<string>('MEMORY_CONTEXT_LIMIT', '5'),
    );
    this.prefetchLimit = Number(
      this.configService.get<string>('MEMORY_PREFETCH_LIMIT', '50'),
    );
  }

  // ─── Writes ────────────────────────────────────────────────────────

  async add(userID: string, input: AddMemoryInput): Promise<MemoryRecord> {
    return this.backend.add(userID, input);
  }

  /**
   * Verbatim conversation-pair write. Used by `RunLifecycleService` at
   * run completion. Stores the round-trip text exactly as it was sent,
   * with `source: run-extracted` and the default mid-confidence so the
   * scorer can outrank it with explicitly user-saved memories.
   */
  async addPair(
    userID: string,
    userText: string,
    assistantText: string,
    scope?: MemoryScope,
  ): Promise<MemoryRecord> {
    const content = `User: ${userText}\n\nAssistant: ${assistantText}`;
    return this.backend.add(userID, {
      content,
      source: 'run-extracted',
      confidence: 0.5,
      tags: ['auto-extracted'],
      ...(scope && { scope }),
    });
  }

  // ─── Reads ─────────────────────────────────────────────────────────

  async search(
    userID: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<MemorySearchHit[]> {
    const limit = options.limit ?? this.searchLimit;
    const prefetchLimit = options.prefetchLimit ?? this.prefetchLimit;

    const raw = await this.backend.hybridSearch({
      userID,
      query,
      limit,
      prefetchLimit,
      ...(options.scope && { scope: options.scope }),
      ...(options.tags && { tags: options.tags }),
    });

    const scored = this.scorer.rescore(raw);
    this.touchAsync(scored.map((hit) => hit.record.id));
    return scored.slice(0, limit);
  }

  /**
   * Per-session frozen-context capture. Hybrid search → score → LLM
   * rerank → format as a prompt block. Failure is non-fatal:
   * caller-visible errors here would block the run, and a missing
   * memory block is always better than a failed run.
   */
  async getContextForQuery(
    userID: string,
    query: string,
    options: ContextOptions = {},
  ): Promise<string> {
    try {
      const limit = options.limit ?? this.contextLimit;
      const raw = await this.backend.hybridSearch({
        userID,
        query,
        limit: Math.max(limit * 4, this.prefetchLimit),
        prefetchLimit: this.prefetchLimit,
        ...(options.scope && { scope: options.scope }),
      });

      if (raw.length === 0) return '';

      const scored = this.scorer.rescore(raw);
      const reranked = await this.reranker.rerank(query, scored, limit);
      if (reranked.length === 0) return '';

      this.touchAsync(reranked.map((hit) => hit.record.id));

      const lines = reranked.map((hit) => `- ${hit.record.content}`).join('\n');
      return `Relevant information about this user:\n${lines}`;
    } catch (err) {
      this.logger.debug(
        `getContextForQuery failed (non-fatal): ${err instanceof Error ? err.message : err}`,
      );
      return '';
    }
  }

  async list(query: ListMemoryQuery): Promise<MemoryRecord[]> {
    return this.backend.list(query);
  }

  async getAll(
    userID: string,
    options: { scope?: MemoryScope; tags?: string[] } = {},
  ): Promise<MemoryRecord[]> {
    return this.backend.list({
      userID,
      ...(options.scope && { scope: options.scope }),
      ...(options.tags && { tags: options.tags }),
    });
  }

  async getByID(
    userID: string,
    memoryID: string,
  ): Promise<MemoryRecord | null> {
    return this.backend.getByID(userID, memoryID);
  }

  async delete(userID: string, memoryID: string): Promise<boolean> {
    return this.backend.delete(userID, memoryID);
  }

  /**
   * Convenience used by `RunLifecycleService.completeRun`. Fire-and-
   * forget by the caller; here we await internally and swallow errors
   * so a memory write failure cannot mask a successful run.
   */
  async extractFromRun(
    userID: string,
    userMessage: string,
    assistantMessage: string,
    scope?: MemoryScope,
  ): Promise<void> {
    try {
      await this.addPair(userID, userMessage, assistantMessage, scope);
    } catch (err) {
      this.logger.warn(
        `extractFromRun failed for user ${userID}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private touchAsync(memoryIDs: string[]): void {
    if (memoryIDs.length === 0) return;
    void this.backend.touch(memoryIDs);
  }
}
