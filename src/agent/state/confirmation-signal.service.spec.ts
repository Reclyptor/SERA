import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfirmationSignalService,
  type ConfirmationDecision,
} from './confirmation-signal.service';

/**
 * Minimal ioredis stand-in. `publish` writes to the shared bus; the
 * subscriber (the `.duplicate()` instance) receives `pmessage` events for
 * any channel matching its subscribed pattern. Good enough to exercise
 * subscribe → publish → fan-out without a real Redis.
 */
class FakeRedis extends EventEmitter {
  private patterns: string[] = [];
  connected = false;

  constructor(private readonly bus: EventEmitter) {
    super();
  }

  duplicate(): FakeRedis {
    return new FakeRedis(this.bus);
  }

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  psubscribe(pattern: string): Promise<void> {
    this.patterns.push(pattern);
    this.bus.on('publish', (channel: string, message: string) => {
      if (!this.connected) return;
      if (!this.matches(channel)) return;
      this.emit('pmessage', pattern, channel, message);
    });
    return Promise.resolve();
  }

  punsubscribe(): Promise<void> {
    this.patterns = [];
    return Promise.resolve();
  }

  quit(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  publish(channel: string, message: string): Promise<number> {
    this.bus.emit('publish', channel, message);
    return Promise.resolve(1);
  }

  private matches(channel: string): boolean {
    return this.patterns.some((pat) => {
      const regex = new RegExp(
        '^' +
          pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') +
          '$',
      );
      return regex.test(channel);
    });
  }
}

async function bootService(): Promise<{
  service: ConfirmationSignalService;
  publisher: FakeRedis;
}> {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const publisher = new FakeRedis(bus);
  await publisher.connect();
  const service = new ConfirmationSignalService(publisher as never);
  await service.onModuleInit();
  return { service, publisher };
}

const decision: ConfirmationDecision = { status: 'approved' };

describe('ConfirmationSignalService', () => {
  let service: ConfirmationSignalService;
  let publisher: FakeRedis;

  beforeEach(async () => {
    ({ service, publisher } = await bootService());
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('resolves via published message', async () => {
    const wait = service.awaitResolution('t1', 'c1', 1_000);
    await Promise.resolve(); // let the listener attach
    await publisher.publish('sera:confirm:t1:c1', JSON.stringify(decision));
    await expect(wait).resolves.toEqual(decision);
  });

  it('short-circuits via preCheck when entry is already resolved', async () => {
    const preCheck = vi.fn().mockResolvedValue(decision);
    const outcome = await service.awaitResolution('t1', 'c1', 1_000, {
      preCheck,
    });
    expect(outcome).toEqual(decision);
    expect(preCheck).toHaveBeenCalledOnce();
  });

  it('honors a publish that lands during the preCheck window', async () => {
    // preCheck does a slow store re-read that returns "still pending"; a
    // concurrent publish arrives mid-flight and must be caught by the
    // already-attached listener.
    const preCheck = vi.fn().mockImplementation(async () => {
      // schedule the publish from inside the pre-check, then return null
      // (store says still pending). The microtask queue interleaves the
      // publish with the resolve-to-null path; the listener must win.
      await publisher.publish('sera:confirm:t1:c1', JSON.stringify(decision));
      return null;
    });
    const outcome = await service.awaitResolution('t1', 'c1', 1_000, {
      preCheck,
    });
    expect(outcome).toEqual(decision);
  });

  it('returns "timeout" when no publish and no preCheck decision', async () => {
    const outcome = await service.awaitResolution('t1', 'c1', 25);
    expect(outcome).toBe('timeout');
  });

  it('ignores publishes after the timeout fires', async () => {
    const outcome = await service.awaitResolution('t1', 'c1', 25);
    expect(outcome).toBe('timeout');
    // A late publish must not throw, leak listeners, or affect any future
    // call. The wait has settled and the listener is detached.
    await publisher.publish('sera:confirm:t1:c1', JSON.stringify(decision));
  });

  it('isolates publishes to the matching channel', async () => {
    const wait = service.awaitResolution('t1', 'c1', 1_000);
    await Promise.resolve();
    // Same thread, different confirmation — must not wake us.
    await publisher.publish(
      'sera:confirm:t1:c-other',
      JSON.stringify(decision),
    );
    // Different thread, same confirmation ID — must not wake us either.
    await publisher.publish(
      'sera:confirm:t-other:c1',
      JSON.stringify(decision),
    );
    let raceWon = false;
    void wait.then(() => (raceWon = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(raceWon).toBe(false);
    await publisher.publish('sera:confirm:t1:c1', JSON.stringify(decision));
    await expect(wait).resolves.toEqual(decision);
  });

  it('drops malformed payloads without resolving the wait', async () => {
    const wait = service.awaitResolution('t1', 'c1', 30);
    await Promise.resolve();
    await publisher.publish('sera:confirm:t1:c1', '{not json');
    await publisher.publish(
      'sera:confirm:t1:c1',
      JSON.stringify({ status: 'maybe' }),
    );
    await expect(wait).resolves.toBe('timeout');
  });

  it('aborts via AbortSignal', async () => {
    const controller = new AbortController();
    const wait = service.awaitResolution('t1', 'c1', 1_000, {
      abortSignal: controller.signal,
    });
    controller.abort();
    await expect(wait).resolves.toBe('timeout');
  });

  it('publishes to the namespaced channel', async () => {
    const spy = vi.spyOn(publisher, 'publish');
    await service.publish('t1', 'c1', decision);
    expect(spy).toHaveBeenCalledWith(
      'sera:confirm:t1:c1',
      JSON.stringify(decision),
    );
  });
});
