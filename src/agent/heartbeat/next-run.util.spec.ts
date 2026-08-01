import { describe, it, expect } from 'vitest';
import { computeNextRunAt } from './next-run.util';

const at = (iso: string) => new Date(iso);
const MIN = 60_000;

describe('computeNextRunAt', () => {
  it('advances one interval from the scheduled time when on time', () => {
    const due = at('2026-08-01T13:00:00Z');
    expect(computeNextRunAt(due, due, 45)).toEqual(at('2026-08-01T13:45:00Z'));
  });

  // Anti-drift: a tick that runs a little late must not push the whole grid
  // later, or a 45-minute heartbeat slowly becomes a 50-minute one.
  it('keeps the original grid when slightly late', () => {
    const due = at('2026-08-01T13:00:00Z');
    const now = new Date(due.getTime() + 3 * MIN);
    expect(computeNextRunAt(due, now, 45)).toEqual(at('2026-08-01T13:45:00Z'));
  });

  it('still keeps the grid one second before a full interval has elapsed', () => {
    const due = at('2026-08-01T13:00:00Z');
    const now = new Date(due.getTime() + 45 * MIN - 1000);
    expect(computeNextRunAt(due, now, 45)).toEqual(at('2026-08-01T13:45:00Z'));
  });

  // The overnight case. nextRunAt is left untouched outside active hours, so at
  // 08:00 it can be ~9.6h stale. The old code advanced by a single interval,
  // landing still in the past, so the next tick fired again — one heartbeat per
  // minute until it caught up. That produced the ~15-run 08:00 burst.
  it('does not leave nextRunAt in the past after an overnight gap', () => {
    const due = at('2026-08-01T03:22:00Z'); // 22:22 CDT, outside the window
    const now = at('2026-08-01T13:00:00Z'); // 08:00 CDT, window reopens
    const next = computeNextRunAt(due, now, 45);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next).toEqual(new Date(now.getTime() + 45 * MIN));
  });

  it('fires once rather than replaying every skipped slot', () => {
    // Walk the scheduler forward a minute at a time and count how many times
    // the config would come due. The bug showed up as this number being ~13.
    const interval = 45;
    let nextRunAt = at('2026-08-01T03:22:00Z');
    let fired = 0;
    for (let i = 0; i < 120; i++) {
      const now = new Date(at('2026-08-01T13:00:00Z').getTime() + i * MIN);
      if (nextRunAt <= now) {
        fired++;
        nextRunAt = computeNextRunAt(nextRunAt, now, interval);
      }
    }
    // Two hours of ticks at a 45-minute cadence: the catch-up run plus the
    // regular ones that legitimately fall inside the window.
    expect(fired).toBe(3);
  });

  it('handles a due time in the future without moving backwards', () => {
    const due = at('2026-08-01T14:00:00Z');
    const now = at('2026-08-01T13:00:00Z');
    expect(computeNextRunAt(due, now, 45)).toEqual(at('2026-08-01T14:45:00Z'));
  });
});
