import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MemorySearchHit } from '../memory.types';

const MS_PER_DAY = 86_400_000;

/**
 * Refines raw RRF scores from the backend with two modifiers:
 *
 *   confidenceFactor = confidenceWeight × confidence + (1 - confidenceWeight)
 *   recencyFactor    = exp(-ageDays / tauDays)
 *   effective        = raw × confidenceFactor × recencyFactor
 *
 * Age is measured from `last_read_at`, not `created_at` — a memory
 * that keeps getting read stays "alive" indefinitely even if it was
 * written years ago. The tau and confidence-weight knobs are
 * env-tunable (`MEMORY_DECAY_TAU_DAYS`, `MEMORY_CONFIDENCE_WEIGHT`).
 *
 * After rewrite, hits are re-sorted by `effectiveScore` descending.
 */
@Injectable()
export class MemoryScorer {
  private readonly logger = new Logger(MemoryScorer.name);
  private readonly tauDays: number;
  private readonly confidenceWeight: number;

  constructor(private readonly configService: ConfigService) {
    this.tauDays = Number(
      this.configService.get<string>('MEMORY_DECAY_TAU_DAYS', '90'),
    );
    this.confidenceWeight = Number(
      this.configService.get<string>('MEMORY_CONFIDENCE_WEIGHT', '0.5'),
    );

    if (!Number.isFinite(this.tauDays) || this.tauDays <= 0) {
      this.logger.warn(
        `Invalid MEMORY_DECAY_TAU_DAYS, falling back to 90: ${this.tauDays}`,
      );
    }
    if (
      !Number.isFinite(this.confidenceWeight) ||
      this.confidenceWeight < 0 ||
      this.confidenceWeight > 1
    ) {
      this.logger.warn(
        `Invalid MEMORY_CONFIDENCE_WEIGHT, falling back to 0.5: ${this.confidenceWeight}`,
      );
    }
  }

  rescore(hits: MemorySearchHit[], now: Date = new Date()): MemorySearchHit[] {
    const tau =
      Number.isFinite(this.tauDays) && this.tauDays > 0 ? this.tauDays : 90;
    const cw =
      Number.isFinite(this.confidenceWeight) &&
      this.confidenceWeight >= 0 &&
      this.confidenceWeight <= 1
        ? this.confidenceWeight
        : 0.5;
    const nowMs = now.getTime();

    const rescored = hits.map((hit) => {
      const ageDays =
        Math.max(0, nowMs - hit.record.lastReadAt.getTime()) / MS_PER_DAY;
      const recencyFactor = Math.exp(-ageDays / tau);
      const confidenceFactor = cw * hit.record.confidence + (1 - cw);
      const effectiveScore = hit.rawScore * confidenceFactor * recencyFactor;

      return {
        ...hit,
        effectiveScore,
      };
    });

    rescored.sort((a, b) => b.effectiveScore - a.effectiveScore);
    return rescored;
  }
}
