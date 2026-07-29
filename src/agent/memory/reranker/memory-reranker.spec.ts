import { describe, expect, it, vi } from 'vitest';
import { MemoryReranker } from './memory-reranker';
import type { MemorySearchHit } from '../memory.types';

function makeConfig(values: Record<string, string>) {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as never;
}

function makeRouter(textOrThrows: string | Error) {
  return {
    generate: vi.fn().mockImplementation(() => {
      if (textOrThrows instanceof Error) return Promise.reject(textOrThrows);
      return Promise.resolve({ text: textOrThrows });
    }),
  } as never;
}

function makeHit(
  id: string,
  content: string,
  rawScore: number,
): MemorySearchHit {
  const now = new Date();
  return {
    record: {
      id,
      userID: 'u1',
      content,
      tags: [],
      source: 'user-saved',
      confidence: 1,
      scope: {},
      metadata: {},
      createdAt: now,
      lastReadAt: now,
    },
    rawScore,
    effectiveScore: rawScore,
  };
}

describe('MemoryReranker', () => {
  it('passes through when disabled', async () => {
    const reranker = new MemoryReranker(
      makeRouter('["a"]'),
      makeConfig({ MEMORY_RERANK_ENABLED: 'false' }),
    );
    const hits = [makeHit('a', 'apple', 1), makeHit('b', 'banana', 0.5)];
    const out = await reranker.rerank('fruit', hits, 2);
    expect(out.map((h) => h.record.id)).toEqual(['a', 'b']);
  });

  it('reorders by LLM output when a JSON array is returned', async () => {
    const reranker = new MemoryReranker(
      makeRouter('["b", "a"]'),
      makeConfig({ MEMORY_RERANK_ENABLED: 'true' }),
    );
    const hits = [makeHit('a', 'apple', 1), makeHit('b', 'banana', 0.5)];
    const out = await reranker.rerank('fruit', hits, 2);
    expect(out.map((h) => h.record.id)).toEqual(['b', 'a']);
  });

  it('extracts ID array from fenced code block', async () => {
    const reranker = new MemoryReranker(
      makeRouter('Reasoning...\n```json\n["b", "a"]\n```'),
      makeConfig({ MEMORY_RERANK_ENABLED: 'true' }),
    );
    const hits = [makeHit('a', 'apple', 1), makeHit('b', 'banana', 0.5)];
    const out = await reranker.rerank('fruit', hits, 2);
    expect(out.map((h) => h.record.id)).toEqual(['b', 'a']);
  });

  it('falls back to original order on LLM exception', async () => {
    const reranker = new MemoryReranker(
      makeRouter(new Error('rate limit')),
      makeConfig({ MEMORY_RERANK_ENABLED: 'true' }),
    );
    const hits = [makeHit('a', 'apple', 1), makeHit('b', 'banana', 0.5)];
    const out = await reranker.rerank('fruit', hits, 2);
    expect(out.map((h) => h.record.id)).toEqual(['a', 'b']);
  });

  it('falls back to original order on parse failure', async () => {
    const reranker = new MemoryReranker(
      makeRouter('not json at all'),
      makeConfig({ MEMORY_RERANK_ENABLED: 'true' }),
    );
    const hits = [makeHit('a', 'apple', 1), makeHit('b', 'banana', 0.5)];
    const out = await reranker.rerank('fruit', hits, 2);
    expect(out.map((h) => h.record.id)).toEqual(['a', 'b']);
  });

  it('drops unknown IDs from the LLM response', async () => {
    const reranker = new MemoryReranker(
      makeRouter('["unknown", "a"]'),
      makeConfig({ MEMORY_RERANK_ENABLED: 'true' }),
    );
    const hits = [makeHit('a', 'apple', 1), makeHit('b', 'banana', 0.5)];
    const out = await reranker.rerank('fruit', hits, 2);
    expect(out.map((h) => h.record.id)).toEqual(['a']);
  });

  it('passes a full provider/model spec as preferredModel', async () => {
    // Regression: the router parses `preferredModel` as a `provider/model`
    // spec. Passing the bare model made every rerank throw "Invalid model
    // spec" and silently fall back to the un-reranked order.
    const router = makeRouter('["a"]');
    const reranker = new MemoryReranker(
      router,
      makeConfig({ MEMORY_RERANK_ENABLED: 'true' }),
    );
    const hits = [makeHit('a', 'apple', 1), makeHit('b', 'banana', 0.5)];
    await reranker.rerank('fruit', hits, 2);

    const generate = (
      router as unknown as { generate: ReturnType<typeof vi.fn> }
    ).generate;
    const options = generate.mock.calls[0][0].options as {
      preferredModel: string;
    };
    expect(options.preferredModel).toBe('anthropic/claude-haiku-4-5');
    expect(options.preferredModel).toContain('/');
  });

  it('caps output at topK', async () => {
    const reranker = new MemoryReranker(
      makeRouter('["a", "b", "c"]'),
      makeConfig({ MEMORY_RERANK_ENABLED: 'true' }),
    );
    const hits = [
      makeHit('a', 'apple', 1),
      makeHit('b', 'banana', 0.9),
      makeHit('c', 'cherry', 0.8),
    ];
    const out = await reranker.rerank('fruit', hits, 2);
    expect(out.length).toBe(2);
    expect(out.map((h) => h.record.id)).toEqual(['a', 'b']);
  });
});
