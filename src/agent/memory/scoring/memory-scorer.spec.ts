import { describe, expect, it } from 'vitest';
import { MemoryScorer } from './memory-scorer';
import type { MemorySearchHit } from '../memory.types';

function makeConfig(values: Record<string, string>) {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as never;
}

function makeHit(opts: {
  id: string;
  rawScore: number;
  confidence: number;
  lastReadAgoDays: number;
  now?: Date;
}): MemorySearchHit {
  const now = opts.now ?? new Date('2026-05-29T00:00:00.000Z');
  const lastReadAt = new Date(
    now.getTime() - opts.lastReadAgoDays * 86_400_000,
  );
  return {
    record: {
      id: opts.id,
      userID: 'u1',
      content: `mem ${opts.id}`,
      tags: [],
      source: 'user-saved',
      confidence: opts.confidence,
      scope: {},
      metadata: {},
      createdAt: lastReadAt,
      lastReadAt,
    },
    rawScore: opts.rawScore,
    effectiveScore: opts.rawScore,
  };
}

describe('MemoryScorer', () => {
  const now = new Date('2026-05-29T00:00:00.000Z');

  it('returns hits unchanged when nothing is stale and all are equal', () => {
    const scorer = new MemoryScorer(
      makeConfig({
        MEMORY_DECAY_TAU_DAYS: '90',
        MEMORY_CONFIDENCE_WEIGHT: '0.5',
      }),
    );
    const hits = [
      makeHit({ id: 'a', rawScore: 1, confidence: 1, lastReadAgoDays: 0, now }),
      makeHit({ id: 'b', rawScore: 1, confidence: 1, lastReadAgoDays: 0, now }),
    ];
    const out = scorer.rescore(hits, now);
    expect(out[0].effectiveScore).toBe(1);
    expect(out[1].effectiveScore).toBe(1);
  });

  it('decays older memories below recently-read ones with equal rawScore', () => {
    const scorer = new MemoryScorer(
      makeConfig({
        MEMORY_DECAY_TAU_DAYS: '30',
        MEMORY_CONFIDENCE_WEIGHT: '0',
      }),
    );
    const fresh = makeHit({
      id: 'fresh',
      rawScore: 1,
      confidence: 1,
      lastReadAgoDays: 0,
      now,
    });
    const old = makeHit({
      id: 'old',
      rawScore: 1,
      confidence: 1,
      lastReadAgoDays: 90,
      now,
    });

    const out = scorer.rescore([old, fresh], now);
    expect(out[0].record.id).toBe('fresh');
    expect(out[1].record.id).toBe('old');
    expect(out[1].effectiveScore).toBeLessThan(out[0].effectiveScore);
  });

  it('weights confidence into the effective score', () => {
    const scorer = new MemoryScorer(
      makeConfig({
        MEMORY_DECAY_TAU_DAYS: '1000',
        MEMORY_CONFIDENCE_WEIGHT: '1',
      }),
    );
    const hi = makeHit({
      id: 'hi',
      rawScore: 1,
      confidence: 1,
      lastReadAgoDays: 0,
      now,
    });
    const lo = makeHit({
      id: 'lo',
      rawScore: 1,
      confidence: 0.2,
      lastReadAgoDays: 0,
      now,
    });

    const out = scorer.rescore([lo, hi], now);
    expect(out[0].record.id).toBe('hi');
    expect(out[1].effectiveScore).toBeCloseTo(0.2, 5);
  });

  it('falls back to safe defaults on invalid config', () => {
    const scorer = new MemoryScorer(
      makeConfig({
        MEMORY_DECAY_TAU_DAYS: 'NaN',
        MEMORY_CONFIDENCE_WEIGHT: '5',
      }),
    );
    const hits = [
      makeHit({ id: 'a', rawScore: 1, confidence: 1, lastReadAgoDays: 0, now }),
    ];
    const out = scorer.rescore(hits, now);
    expect(out[0].effectiveScore).toBeGreaterThan(0);
    expect(out[0].effectiveScore).toBeLessThanOrEqual(1);
  });

  it('sorts by effective score descending', () => {
    const scorer = new MemoryScorer(
      makeConfig({
        MEMORY_DECAY_TAU_DAYS: '90',
        MEMORY_CONFIDENCE_WEIGHT: '0.5',
      }),
    );
    const hits = [
      makeHit({
        id: 'mid',
        rawScore: 0.5,
        confidence: 1,
        lastReadAgoDays: 0,
        now,
      }),
      makeHit({
        id: 'hi',
        rawScore: 0.9,
        confidence: 1,
        lastReadAgoDays: 0,
        now,
      }),
      makeHit({
        id: 'lo',
        rawScore: 0.1,
        confidence: 1,
        lastReadAgoDays: 0,
        now,
      }),
    ];
    const out = scorer.rescore(hits, now);
    expect(out.map((h) => h.record.id)).toEqual(['hi', 'mid', 'lo']);
  });
});
