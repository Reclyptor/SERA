import { Inject, Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import type { AgentEvent } from './stream.interfaces';

const STREAM_TTL = 1800; // 30 minutes — safety net for crash orphans
const COMPLETED_TTL = 300; // 5 minutes — grace period after run ends
const HEARTBEAT_INTERVAL_MS = 15_000;
const XREAD_BLOCK_MS = 10_000;

interface StreamEntry {
  id: string;
  event: AgentEvent;
}

export type SseFrame =
  | { kind: 'event'; data: string; id: string }
  | { kind: 'comment'; text: string };

@Injectable()
export class RunStreamService {
  private readonly logger = new Logger(RunStreamService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private streamKey(runID: string): string {
    return `run:${runID}:stream`;
  }

  private activeRunKey(chatID: string): string {
    return `chat:${chatID}:activeRun`;
  }

  async initRun(
    runID: string,
    threadID: string,
    chatID: string,
  ): Promise<void> {
    await this.redis.set(
      this.activeRunKey(chatID),
      JSON.stringify({ runID, threadID }),
      'EX',
      STREAM_TTL,
    );
  }

  async appendEvent(runID: string, event: AgentEvent): Promise<string> {
    const streamID = await this.redis.xadd(
      this.streamKey(runID),
      '*',
      'event',
      JSON.stringify(event),
    );
    if (!streamID) {
      throw new Error(`Failed to append event to stream for run ${runID}`);
    }
    await this.redis.expire(this.streamKey(runID), STREAM_TTL);
    return streamID;
  }

  async readEvents(
    runID: string,
    afterID: string = '0',
  ): Promise<StreamEntry[]> {
    const startID = afterID === '0' ? '-' : `(${afterID}`;
    const results = await this.redis.xrange(
      this.streamKey(runID),
      startID,
      '+',
    );
    return results.map(([id, fields]) => ({
      id,
      event: JSON.parse(fields[1]) as AgentEvent,
    }));
  }

  private async readEventsBlocking(
    client: Redis,
    runID: string,
    afterID: string,
    blockMs: number,
  ): Promise<StreamEntry[]> {
    const results = await client.xread(
      'COUNT',
      100,
      'BLOCK',
      blockMs,
      'STREAMS',
      this.streamKey(runID),
      afterID,
    );
    if (!results) return [];
    const [, entries] = results[0];
    return entries.map(([id, fields]) => ({
      id,
      event: JSON.parse(fields[1]) as AgentEvent,
    }));
  }

  async getActiveRun(
    chatID: string,
  ): Promise<{ runID: string; threadID: string } | null> {
    const raw = await this.redis.get(this.activeRunKey(chatID));
    if (!raw) return null;
    return JSON.parse(raw) as { runID: string; threadID: string };
  }

  async completeRun(runID: string, chatID: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.expire(this.streamKey(runID), COMPLETED_TTL);
    pipeline.del(this.activeRunKey(chatID));
    await pipeline.exec();
  }

  createReconnectionObservable(
    runID: string,
    afterID: string = '0',
  ): Observable<SseFrame> {
    const isFullReplay = afterID === '0';

    return new Observable((subscriber) => {
      let duplicateClient: Redis | null = null;
      let cancelled = false;

      const emitEvent = (data: string, id: string) => {
        subscriber.next({ kind: 'event', data, id });
      };

      const heartbeat = setInterval(() => {
        if (cancelled) return;
        subscriber.next({ kind: 'comment', text: `ping ${Date.now()}` });
      }, HEARTBEAT_INTERVAL_MS);

      const run = async () => {
        duplicateClient = this.redis.duplicate();
        await duplicateClient.connect();

        let cursor = afterID;
        let replayedTerminal = false;

        // 1. Replay existing events from the stream
        const existing = await this.readEvents(runID, afterID);
        for (const entry of existing) {
          if (cancelled) return;
          entry.event.streamID = entry.id;
          emitEvent(JSON.stringify(entry.event), entry.id);
          cursor = entry.id;

          if (
            entry.event.type === 'run.completed' ||
            entry.event.type === 'run.failed' ||
            entry.event.type === 'run.cancelled'
          ) {
            replayedTerminal = true;
          }
        }

        // 2. Emit replay.done boundary so the client can flush accumulated
        //    state in a single render pass — sent for every connect (full
        //    replay or resume) so the client's replay-mode logic is uniform.
        const replayDoneEvent: AgentEvent = {
          type: 'replay.done',
          runID,
          threadID: '',
          timestamp: Date.now(),
          data: null,
        };
        const replayDoneID = isFullReplay
          ? `replay-done-${runID}`
          : `replay-done-${runID}-${cursor}`;
        emitEvent(JSON.stringify(replayDoneEvent), replayDoneID);

        if (replayedTerminal) {
          subscriber.complete();
          return;
        }

        // 3. Tail for live events via XREAD BLOCK
        while (!cancelled) {
          const entries = await this.readEventsBlocking(
            duplicateClient,
            runID,
            cursor,
            XREAD_BLOCK_MS,
          );

          if (cancelled) return;

          if (entries.length === 0) {
            const exists = await this.redis.exists(this.streamKey(runID));
            if (!exists) {
              subscriber.complete();
              return;
            }
            continue;
          }

          for (const entry of entries) {
            if (cancelled) return;
            entry.event.streamID = entry.id;
            emitEvent(JSON.stringify(entry.event), entry.id);
            cursor = entry.id;

            if (
              entry.event.type === 'run.completed' ||
              entry.event.type === 'run.failed' ||
              entry.event.type === 'run.cancelled'
            ) {
              subscriber.complete();
              return;
            }
          }
        }
      };

      run().catch((err) => {
        if (!cancelled) {
          this.logger.error(`Reconnection stream error for run ${runID}:`, err);
          subscriber.error(err);
        }
      });

      return () => {
        cancelled = true;
        clearInterval(heartbeat);
        if (duplicateClient) {
          duplicateClient.disconnect();
          duplicateClient = null;
        }
      };
    });
  }
}
