import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEMORY_BACKEND,
  type MemoryBackend,
} from '../backend/memory-backend.interface';
import { encodeSparse } from '../backend/sparse-tokenizer';
import type { MemoryRecord } from '../memory.types';

const MS_PER_DAY = 86_400_000;
const PAGE_SIZE = 256;

interface CycleSummary {
  scanned: number;
  duplicatesRemoved: number;
  decayed: number;
  expired: number;
}

/**
 * Background lifecycle pass — keeps the memory store bounded as it
 * grows. Daily by default. Operations per cycle:
 *
 *   1. Scroll the entire collection in pages, group records by
 *      `user_id` in memory.
 *   2. Within each user-group, detect duplicates via a simple
 *      Jaccard-on-sparse-tokens approximation (we don't pull dense
 *      vectors in scroll responses — sparse is good enough for
 *      "did the user write essentially the same thing twice?").
 *   3. For points whose `last_read_at` is older than
 *      `MEMORY_STALE_DAYS`, subtract a flat decay from confidence.
 *   4. Expire any point whose confidence falls below
 *      `MEMORY_MIN_CONFIDENCE`.
 *
 * Idempotent and safe to run while the app is taking traffic.
 */
@Injectable()
export class MemoryConsolidatorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MemoryConsolidatorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private readonly intervalMs: number;
  private readonly staleDays: number;
  private readonly minConfidence: number;
  private readonly duplicateThreshold: number;
  private readonly decayStep: number;

  constructor(
    @Inject(MEMORY_BACKEND) private readonly backend: MemoryBackend,
    private readonly configService: ConfigService,
  ) {
    this.intervalMs = Number(
      this.configService.get<string>(
        'MEMORY_CONSOLIDATION_INTERVAL_MS',
        '86400000',
      ),
    );
    this.staleDays = Number(
      this.configService.get<string>('MEMORY_STALE_DAYS', '30'),
    );
    this.minConfidence = Number(
      this.configService.get<string>('MEMORY_MIN_CONFIDENCE', '0.1'),
    );
    this.duplicateThreshold = Number(
      this.configService.get<string>('MEMORY_DUPLICATE_THRESHOLD', '0.95'),
    );
    this.decayStep = 0.02;
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.log('Memory consolidation disabled (interval = 0)');
      return;
    }
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        this.logger.error('Consolidation cycle failed:', err);
      });
    }, this.intervalMs);
    this.logger.log(
      `Memory consolidator started (interval: ${Math.round(this.intervalMs / 60_000)}m)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Public entry point — exposed for unit tests and on-demand
   * triggering from operational tooling. Returns an aggregate summary
   * of what changed.
   */
  async runCycle(now: Date = new Date()): Promise<CycleSummary> {
    if (this.running) {
      this.logger.warn(
        'Consolidation cycle already running; skipping this tick',
      );
      return { scanned: 0, duplicatesRemoved: 0, decayed: 0, expired: 0 };
    }
    this.running = true;

    const summary: CycleSummary = {
      scanned: 0,
      duplicatesRemoved: 0,
      decayed: 0,
      expired: 0,
    };

    try {
      const byUser = new Map<string, MemoryRecord[]>();
      let cursor: string | number | undefined;
      do {
        const page = await this.backend.scroll(PAGE_SIZE, cursor);
        summary.scanned += page.records.length;
        for (const record of page.records) {
          const arr = byUser.get(record.userID) ?? [];
          arr.push(record);
          byUser.set(record.userID, arr);
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);

      for (const [, records] of byUser) {
        const userSummary = await this.processUser(records, now);
        summary.duplicatesRemoved += userSummary.duplicatesRemoved;
        summary.decayed += userSummary.decayed;
        summary.expired += userSummary.expired;
      }

      this.logger.log(
        `Consolidation cycle done: ${summary.scanned} scanned, ${summary.duplicatesRemoved} merged, ${summary.decayed} decayed, ${summary.expired} expired`,
      );
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async processUser(
    records: MemoryRecord[],
    now: Date,
  ): Promise<{ duplicatesRemoved: number; decayed: number; expired: number }> {
    const result = { duplicatesRemoved: 0, decayed: 0, expired: 0 };
    const survivors: MemoryRecord[] = [];

    // Dedupe: O(n²) within a user's slice is fine — users are unlikely
    // to have more than a few thousand memories and this runs daily.
    for (const record of records) {
      let merged = false;
      for (let i = 0; i < survivors.length; i++) {
        const survivor = survivors[i];
        if (
          this.jaccardSimilarity(survivor.content, record.content) >=
          this.duplicateThreshold
        ) {
          const winner = this.pickWinner(survivor, record);
          const loser = winner === survivor ? record : survivor;
          await this.backend.deleteMany([loser.id]);
          if (winner === record) {
            survivors[i] = record;
          }
          result.duplicatesRemoved += 1;
          merged = true;
          break;
        }
      }
      if (!merged) survivors.push(record);
    }

    // Decay + expire
    const staleCutoff = now.getTime() - this.staleDays * MS_PER_DAY;
    for (const survivor of survivors) {
      if (survivor.lastReadAt.getTime() > staleCutoff) continue;
      const next = Math.max(0, survivor.confidence - this.decayStep);
      if (next < this.minConfidence) {
        await this.backend.deleteMany([survivor.id]);
        result.expired += 1;
      } else {
        await this.backend.updateConfidence(survivor.id, next);
        result.decayed += 1;
      }
    }

    return result;
  }

  private pickWinner(a: MemoryRecord, b: MemoryRecord): MemoryRecord {
    if (a.confidence !== b.confidence) {
      return a.confidence > b.confidence ? a : b;
    }
    return a.createdAt.getTime() >= b.createdAt.getTime() ? a : b;
  }

  /**
   * Cheap, deps-free approximation of content similarity. Uses the
   * same sparse encoder the backend uses for retrieval, so two
   * memories that index the same way at query time also collapse
   * the same way here. Good enough for "did the user say nearly the
   * same thing twice?" — we deliberately don't pull dense vectors
   * in scroll responses.
   */
  private jaccardSimilarity(a: string, b: string): number {
    const aIndices = new Set(encodeSparse(a).indices);
    const bIndices = new Set(encodeSparse(b).indices);
    if (aIndices.size === 0 && bIndices.size === 0) return 0;
    let inter = 0;
    for (const idx of aIndices) {
      if (bIndices.has(idx)) inter += 1;
    }
    const union = aIndices.size + bIndices.size - inter;
    return union === 0 ? 0 : inter / union;
  }
}
