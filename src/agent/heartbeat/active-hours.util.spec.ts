import { describe, expect, it } from 'vitest';
import { isWithinActiveHours } from './active-hours.util';

describe('isWithinActiveHours', () => {
  it('is always active when no window is set', () => {
    expect(isWithinActiveHours(undefined, new Date())).toBe(true);
    expect(isWithinActiveHours(null, new Date())).toBe(true);
  });

  it('honors a same-day window in UTC', () => {
    const window = { start: 9, end: 17, timezone: 'UTC' };
    expect(isWithinActiveHours(window, new Date('2026-07-13T12:00:00Z'))).toBe(
      true,
    );
    expect(isWithinActiveHours(window, new Date('2026-07-13T08:59:00Z'))).toBe(
      false,
    );
    // end is exclusive
    expect(isWithinActiveHours(window, new Date('2026-07-13T17:00:00Z'))).toBe(
      false,
    );
  });

  it('handles a window that wraps midnight', () => {
    const window = { start: 22, end: 6, timezone: 'UTC' };
    expect(isWithinActiveHours(window, new Date('2026-07-13T23:00:00Z'))).toBe(
      true,
    );
    expect(isWithinActiveHours(window, new Date('2026-07-13T03:00:00Z'))).toBe(
      true,
    );
    expect(isWithinActiveHours(window, new Date('2026-07-13T12:00:00Z'))).toBe(
      false,
    );
  });

  it('respects the configured timezone', () => {
    // 12:00 UTC is 08:00 in New York (EDT, UTC-4) — outside a 9–17 local window.
    const window = { start: 9, end: 17, timezone: 'America/New_York' };
    expect(isWithinActiveHours(window, new Date('2026-07-13T12:00:00Z'))).toBe(
      false,
    );
    expect(isWithinActiveHours(window, new Date('2026-07-13T16:00:00Z'))).toBe(
      true,
    );
  });
});
