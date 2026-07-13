/**
 * Detects the heartbeat idle sentinel (§30.2). A proactive run whose final
 * text is the sentinel means "nothing to do" and must produce no user-visible
 * output. Tolerant of light wrapping ("Okay, SERA_IDLE.") and markdown so a
 * model that can't emit a bare token still resolves to silence; a sentinel
 * buried in a real message does not.
 */
export function isIdleSentinel(response: string, sentinel: string): boolean {
  // Strip fenced blocks and markdown emphasis/heading markers, but NOT
  // underscores — the sentinel itself (e.g. SERA_IDLE) contains one.
  const stripped = response
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[`*#>]/g, '')
    .trim();
  if (!stripped.includes(sentinel)) return false;

  const remainder = stripped
    .split(sentinel)
    .join('')
    .replace(/[^a-z0-9]/gi, '');
  return remainder.length <= 16;
}
