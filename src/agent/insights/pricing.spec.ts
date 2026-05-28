import { describe, expect, it } from 'vitest';
import { calculateCost } from './pricing';

describe('calculateCost', () => {
  it('returns 0 for an unknown model', () => {
    expect(
      calculateCost('unknown-model', { input: 1_000_000, output: 0 }),
    ).toBe(0);
  });

  it('charges 1M input tokens at the documented per-MTok rate', () => {
    // claude-sonnet-4-6 input: $3.00 / MTok = 300 cents
    expect(
      calculateCost('claude-sonnet-4-6', { input: 1_000_000, output: 0 }),
    ).toBe(300);
  });

  it('charges 1M output tokens at the documented per-MTok rate', () => {
    // claude-opus-4-7 output: $75.00 / MTok = 7500 cents
    expect(
      calculateCost('claude-opus-4-7', { input: 0, output: 1_000_000 }),
    ).toBe(7500);
  });

  it('folds thinking tokens into the input cost', () => {
    // claude-haiku-4-5 input: $0.80 / MTok
    // 500k input + 500k thinking = 1M input-billable = 80 cents
    expect(
      calculateCost('claude-haiku-4-5', {
        input: 500_000,
        output: 0,
        thinking: 500_000,
      }),
    ).toBe(80);
  });

  it('includes cache read and write when the pricing row supports them', () => {
    // claude-sonnet-4-6: cacheRead $0.30, cacheWrite $3.75 per MTok
    // 1M cacheRead + 1M cacheWrite = 30 + 375 = 405 cents
    expect(
      calculateCost('claude-sonnet-4-6', {
        input: 0,
        output: 0,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
      }),
    ).toBe(405);
  });

  it('ignores cache tokens when the pricing row has no cache rates', () => {
    // gpt-4o has no cache rates; cache tokens must contribute 0
    // 1M input @ $2.50 / MTok = 250 cents
    expect(
      calculateCost('gpt-4o', {
        input: 1_000_000,
        output: 0,
        cacheRead: 5_000_000,
        cacheWrite: 5_000_000,
      }),
    ).toBe(250);
  });

  it('returns an integer (no fractional cents)', () => {
    // gemini-2.0-flash @ $0.10 / MTok on 333 tokens rounds to 0 cents
    const result = calculateCost('gemini-2.0-flash', {
      input: 333,
      output: 0,
    });
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(0);
  });

  it('sums input + output + cache read + cache write into a single total', () => {
    // claude-haiku-4-5: input $0.80, output $4.00, cacheRead $0.08, cacheWrite $1.00
    // 1M each: 80 + 400 + 8 + 100 = 588 cents
    expect(
      calculateCost('claude-haiku-4-5', {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
      }),
    ).toBe(588);
  });
});
