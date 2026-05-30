import { describe, expect, it, vi } from 'vitest';
import { MemoryConsolidatorService } from './memory-consolidator.service';
import type { MemoryBackend } from '../backend/memory-backend.interface';
import type { MemoryRecord, MemoryScrollPage } from '../memory.types';

function makeConfig(values: Record<string, string>) {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as never;
}

function makeRecord(opts: {
  id: string;
  userID: string;
  content: string;
  confidence?: number;
  lastReadAgoDays?: number;
  now?: Date;
}): MemoryRecord {
  const now = opts.now ?? new Date('2026-05-29T00:00:00.000Z');
  const lastReadAt = new Date(
    now.getTime() - (opts.lastReadAgoDays ?? 0) * 86_400_000,
  );
  return {
    id: opts.id,
    userID: opts.userID,
    content: opts.content,
    tags: [],
    source: 'user-saved',
    confidence: opts.confidence ?? 1,
    scope: {},
    metadata: {},
    createdAt: lastReadAt,
    lastReadAt,
  };
}

interface MockBackend extends MemoryBackend {
  deletedIDs: string[];
  confidenceUpdates: Array<{ id: string; confidence: number }>;
}

function makeBackend(initial: MemoryRecord[]): MockBackend {
  const remaining = new Map(initial.map((r) => [r.id, r]));
  const deletedIDs: string[] = [];
  const confidenceUpdates: Array<{ id: string; confidence: number }> = [];
  let yielded = false;

  return {
    deletedIDs,
    confidenceUpdates,
    add: vi.fn(),
    hybridSearch: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    getByID: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(true),
    deleteMany: vi.fn().mockImplementation((ids: string[]) => {
      for (const id of ids) {
        remaining.delete(id);
        deletedIDs.push(id);
      }
      return Promise.resolve();
    }),
    touch: vi.fn().mockResolvedValue(undefined),
    updateConfidence: vi
      .fn()
      .mockImplementation((id: string, confidence: number) => {
        confidenceUpdates.push({ id, confidence });
        return Promise.resolve();
      }),
    scroll: vi.fn().mockImplementation((): Promise<MemoryScrollPage> => {
      if (yielded) return Promise.resolve({ records: [] });
      yielded = true;
      return Promise.resolve({ records: [...remaining.values()] });
    }),
  } satisfies MockBackend;
}

describe('MemoryConsolidatorService', () => {
  const now = new Date('2026-05-29T00:00:00.000Z');

  it('merges duplicates within a single user (keeps higher-confidence winner)', async () => {
    const dupA = makeRecord({
      id: 'a',
      userID: 'u1',
      content: 'the user prefers tabs over spaces',
      confidence: 0.4,
      now,
    });
    const dupB = makeRecord({
      id: 'b',
      userID: 'u1',
      content: 'the user prefers tabs over spaces',
      confidence: 1,
      now,
    });
    const distinct = makeRecord({
      id: 'c',
      userID: 'u1',
      content: 'completely different fact about deployments',
      confidence: 1,
      now,
    });
    const backend = makeBackend([dupA, dupB, distinct]);
    const consolidator = new MemoryConsolidatorService(
      backend,
      makeConfig({ MEMORY_CONSOLIDATION_INTERVAL_MS: '0' }),
    );

    const summary = await consolidator.runCycle(now);

    expect(summary.duplicatesRemoved).toBe(1);
    expect(backend.deletedIDs).toEqual(['a']);
  });

  it('does not merge across users', async () => {
    const a = makeRecord({
      id: 'a',
      userID: 'u1',
      content: 'shared content for two users',
      now,
    });
    const b = makeRecord({
      id: 'b',
      userID: 'u2',
      content: 'shared content for two users',
      now,
    });
    const backend = makeBackend([a, b]);
    const consolidator = new MemoryConsolidatorService(
      backend,
      makeConfig({ MEMORY_CONSOLIDATION_INTERVAL_MS: '0' }),
    );

    const summary = await consolidator.runCycle(now);

    expect(summary.duplicatesRemoved).toBe(0);
    expect(backend.deletedIDs).toEqual([]);
  });

  it('decays confidence on stale records but keeps them above floor', async () => {
    const stale = makeRecord({
      id: 'stale',
      userID: 'u1',
      content: 'stale unique content',
      confidence: 0.8,
      lastReadAgoDays: 60,
      now,
    });
    const backend = makeBackend([stale]);
    const consolidator = new MemoryConsolidatorService(
      backend,
      makeConfig({
        MEMORY_CONSOLIDATION_INTERVAL_MS: '0',
        MEMORY_STALE_DAYS: '30',
        MEMORY_MIN_CONFIDENCE: '0.1',
      }),
    );

    const summary = await consolidator.runCycle(now);

    expect(summary.decayed).toBe(1);
    expect(summary.expired).toBe(0);
    expect(backend.confidenceUpdates).toEqual([
      { id: 'stale', confidence: 0.78 },
    ]);
  });

  it('expires records that fall below the confidence floor', async () => {
    const ghost = makeRecord({
      id: 'ghost',
      userID: 'u1',
      content: 'about to die ghost content',
      confidence: 0.1,
      lastReadAgoDays: 90,
      now,
    });
    const backend = makeBackend([ghost]);
    const consolidator = new MemoryConsolidatorService(
      backend,
      makeConfig({
        MEMORY_CONSOLIDATION_INTERVAL_MS: '0',
        MEMORY_STALE_DAYS: '30',
        MEMORY_MIN_CONFIDENCE: '0.1',
      }),
    );

    const summary = await consolidator.runCycle(now);

    expect(summary.expired).toBe(1);
    expect(backend.deletedIDs).toEqual(['ghost']);
  });

  it('does not decay records read within the stale window', async () => {
    const fresh = makeRecord({
      id: 'fresh',
      userID: 'u1',
      content: 'fresh unique content',
      confidence: 0.8,
      lastReadAgoDays: 10,
      now,
    });
    const backend = makeBackend([fresh]);
    const consolidator = new MemoryConsolidatorService(
      backend,
      makeConfig({
        MEMORY_CONSOLIDATION_INTERVAL_MS: '0',
        MEMORY_STALE_DAYS: '30',
      }),
    );

    const summary = await consolidator.runCycle(now);

    expect(summary.decayed).toBe(0);
    expect(summary.expired).toBe(0);
    expect(backend.confidenceUpdates).toEqual([]);
  });
});
