import { describe, expect, it } from 'vitest';
import { encodeSparse, tokenize } from './sparse-tokenizer';

describe('sparse-tokenizer', () => {
  describe('tokenize', () => {
    it('lowercases and splits on non-word characters', () => {
      expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
    });

    it('drops single-character tokens', () => {
      expect(tokenize('a fox and a hound')).toEqual(['fox', 'and', 'hound']);
    });

    it('handles unicode letters and digits', () => {
      expect(tokenize('café 123 naïve')).toEqual(['café', '123', 'naïve']);
    });

    it('returns empty for whitespace-only input', () => {
      expect(tokenize('   \n\t   ')).toEqual([]);
    });
  });

  describe('encodeSparse', () => {
    it('produces matching indices and values arrays', () => {
      const vec = encodeSparse('hello world hello');
      expect(vec.indices.length).toBe(vec.values.length);
    });

    it('accumulates frequency for repeated tokens', () => {
      const vec = encodeSparse('alpha alpha alpha beta');
      const lookup = new Map(
        vec.indices.map((idx, i) => [idx, vec.values[i]] as const),
      );
      const sortedValues = [...lookup.values()].sort((a, b) => b - a);
      expect(sortedValues[0]).toBe(3);
      expect(sortedValues[1]).toBe(1);
    });

    it('is deterministic across calls', () => {
      const a = encodeSparse('the quick brown fox');
      const b = encodeSparse('the quick brown fox');
      expect(a).toEqual(b);
    });

    it('returns empty vector for empty input', () => {
      const vec = encodeSparse('');
      expect(vec.indices).toEqual([]);
      expect(vec.values).toEqual([]);
    });

    it('produces overlapping indices for shared tokens', () => {
      const a = encodeSparse('shared token unique a');
      const b = encodeSparse('shared token unique b');
      const aSet = new Set(a.indices);
      const overlap = b.indices.filter((idx) => aSet.has(idx));
      // "shared", "token", "unique" overlap; "a" / "b" are filtered as
      // single-char tokens.
      expect(overlap.length).toBe(3);
    });
  });
});
