const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const JITTER_FACTOR = 0.5;

export function jitteredBackoff(attempt: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = exponential * JITTER_FACTOR * Math.random();
  return Math.floor(exponential + jitter);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      },
      { once: true },
    );
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    shouldRetry: (error: unknown) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
    signal?: AbortSignal;
  },
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxAttempts - 1;
      if (isLast || !opts.shouldRetry(error)) throw error;

      const delay = jitteredBackoff(attempt);
      opts.onRetry?.(error, attempt + 1, delay);
      await sleep(delay, opts.signal);
    }
  }

  throw new Error('Unreachable');
}
