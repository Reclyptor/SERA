import { describe, expect, it } from 'vitest';
import { isIdleSentinel } from './idle-sentinel.util';

describe('isIdleSentinel', () => {
  const S = 'SERA_IDLE';

  it('matches a bare sentinel', () => {
    expect(isIdleSentinel('SERA_IDLE', S)).toBe(true);
    expect(isIdleSentinel('  SERA_IDLE  ', S)).toBe(true);
  });

  it('tolerates light wrapping and markdown', () => {
    expect(isIdleSentinel('Okay, SERA_IDLE.', S)).toBe(true);
    expect(isIdleSentinel('`SERA_IDLE`', S)).toBe(true);
    expect(isIdleSentinel('**SERA_IDLE**', S)).toBe(true);
    expect(isIdleSentinel('SERA_IDLE — nothing', S)).toBe(true);
  });

  it('does not match when the sentinel is buried in a real message', () => {
    expect(
      isIdleSentinel(
        'I noticed your interview is tomorrow, so this is not SERA_IDLE — I will follow up.',
        S,
      ),
    ).toBe(false);
  });

  it('does not match when the sentinel is absent', () => {
    expect(isIdleSentinel('All quiet for now.', S)).toBe(false);
    expect(isIdleSentinel('', S)).toBe(false);
  });

  it('honors a custom sentinel string', () => {
    expect(isIdleSentinel('NOTHING_TO_DO', 'NOTHING_TO_DO')).toBe(true);
    expect(isIdleSentinel('SERA_IDLE', 'NOTHING_TO_DO')).toBe(false);
  });
});
