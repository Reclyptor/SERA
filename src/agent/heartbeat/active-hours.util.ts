export interface ActiveHoursWindow {
  start: number;
  end: number;
  timezone?: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function hourFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

/**
 * Whether `now` falls inside an active-hours window. A missing window means
 * "always active". Windows may wrap midnight (e.g. start 22, end 6). Shared by
 * the heartbeat scheduler (§21) and the proactive gate (§30.3) so both read the
 * same rule from one place.
 */
export function isWithinActiveHours(
  activeHours: ActiveHoursWindow | undefined | null,
  now: Date,
): boolean {
  if (!activeHours) return true;

  const { start, end, timezone } = activeHours;
  const currentHour = parseInt(
    hourFormatter(timezone ?? 'UTC').format(now),
    10,
  );

  if (start <= end) {
    return currentHour >= start && currentHour < end;
  }
  // Wraps midnight (e.g., 22 to 6)
  return currentHour >= start || currentHour < end;
}
