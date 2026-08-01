/**
 * Compute the next heartbeat slot after firing one scheduled for `dueAt`.
 *
 * Two cases, and the distinction is the whole point:
 *
 * - **Slightly late** (a congested tick, a slow claim): advance from the
 *   SCHEDULED time so the cadence does not drift. Forty-five-minute heartbeats
 *   stay on their original grid rather than sliding later every cycle.
 *
 * - **Late by a full interval or more**: advance from `now` instead. This
 *   happens every night, because `nextRunAt` is deliberately left untouched
 *   while outside active hours — so by the time the window reopens it can sit
 *   many hours in the past. Advancing by a single interval there would leave it
 *   still in the past, making it due again on the very next tick, and the
 *   scheduler would fire one catch-up heartbeat per minute until it caught up.
 *   Those runs are not work that was missed and owed; they are runs that were
 *   deliberately skipped because the user was asleep. Replaying them costs real
 *   money and tells the user nothing.
 */
export function computeNextRunAt(
  dueAt: Date,
  now: Date,
  intervalMinutes: number,
): Date {
  const intervalMs = intervalMinutes * 60_000;
  const lateBy = now.getTime() - dueAt.getTime();

  return lateBy < intervalMs
    ? new Date(dueAt.getTime() + intervalMs)
    : new Date(now.getTime() + intervalMs);
}
