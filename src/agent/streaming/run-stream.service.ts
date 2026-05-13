import { Inject, Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import type { AgentEvent } from './stream.interfaces';

const STREAM_TTL = 1800; // 30 minutes — safety net for crash orphans
const COMPLETED_TTL = 300; // 5 minutes — grace period after run ends

interface StreamEntry {
  id: string;
  event: AgentEvent;
}

// NestJS SSE MessageEvent shape (avoids DOM MessageEvent mismatch)
interface SseEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

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
  ): Observable<SseEvent> {
    const isFullReplay = afterID === '0';

    return new Observable((subscriber) => {
      let duplicateClient: Redis | null = null;
      let cancelled = false;

      const emit = (data: string, id: string) => {
        subscriber.next({ data, id });
      };

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
          emit(JSON.stringify(entry.event), entry.id);
          cursor = entry.id;

          if (
            entry.event.type === 'run.completed' ||
            entry.event.type === 'run.failed'
          ) {
            replayedTerminal = true;
          }
        }

        // 2. Emit replay.done boundary for full replays so the client
        //    can flush accumulated state in a single render pass.
        if (isFullReplay) {
          const replayDoneEvent: AgentEvent = {
            type: 'replay.done',
            runID,
            threadID: '',
            timestamp: Date.now(),
            data: null,
          };
          emit(JSON.stringify(replayDoneEvent), `replay-done-${runID}`);
        }

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
            5000,
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
            emit(JSON.stringify(entry.event), entry.id);
            cursor = entry.id;

            if (
              entry.event.type === 'run.completed' ||
              entry.event.type === 'run.failed'
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
        if (duplicateClient) {
          duplicateClient.disconnect();
          duplicateClient = null;
        }
      };
    });
  }
}
