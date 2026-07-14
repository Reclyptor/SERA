import { Inject, Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

const STREAM_MAXLEN = 200;
const STREAM_TTL = 604_800; // 7 days
const HEARTBEAT_INTERVAL_MS = 15_000;
const XREAD_BLOCK_MS = 10_000;

export interface UserNotification {
  type: 'chat.updated';
  chatID: string;
  agentID?: string;
  preview: string;
  origin: string;
  timestamp: number;
}

interface Entry {
  id: string;
  event: UserNotification;
}

export type SseFrame =
  | { kind: 'event'; data: string; id: string }
  | { kind: 'comment'; text: string };

/**
 * A per-user, always-on notification channel (§30.11.3). SERA's run events are
 * per-run only, so the SERAUI chat list has no way to learn a message arrived
 * in a thread it is not watching. This is a dedicated Redis Stream per user
 * (`sera:user:{userID}:notifications`) tailed over SSE — one always-on client
 * subscription drives live unread badges regardless of the open chat.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(userID: string): string {
    return `sera:user:${userID}:notifications`;
  }

  async emit(userID: string, event: UserNotification): Promise<void> {
    try {
      await this.redis.xadd(
        this.key(userID),
        'MAXLEN',
        '~',
        STREAM_MAXLEN,
        '*',
        'event',
        JSON.stringify(event),
      );
      await this.redis.expire(this.key(userID), STREAM_TTL);
    } catch (err) {
      this.logger.warn(
        `Notification emit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async readBlocking(
    client: Redis,
    userID: string,
    afterID: string,
    blockMs: number,
  ): Promise<Entry[]> {
    const results = await client.xread(
      'COUNT',
      100,
      'BLOCK',
      blockMs,
      'STREAMS',
      this.key(userID),
      afterID,
    );
    if (!results) return [];
    const [, entries] = results[0];
    return entries.map(([id, fields]) => ({
      id,
      event: JSON.parse(fields[1]) as UserNotification,
    }));
  }

  /**
   * Tails a user's notification stream over SSE. `afterID` is the client's
   * `Last-Event-ID` on reconnect (replays what it missed), or `'$'` on a fresh
   * connect (new events only — current unread state is fetched via `GET /chats`
   * on load). Never completes; torn down when the subscriber unsubscribes.
   */
  createStream(userID: string, afterID: string): Observable<SseFrame> {
    return new Observable<SseFrame>((subscriber) => {
      let client: Redis | null = null;
      let cancelled = false;

      const heartbeat = setInterval(() => {
        if (!cancelled) {
          subscriber.next({ kind: 'comment', text: `ping ${Date.now()}` });
        }
      }, HEARTBEAT_INTERVAL_MS);

      const run = async () => {
        client = this.redis.duplicate();
        await client.connect();

        let cursor = afterID;
        while (!cancelled) {
          const entries = await this.readBlocking(
            client,
            userID,
            cursor,
            XREAD_BLOCK_MS,
          );
          if (cancelled) return;
          for (const entry of entries) {
            if (cancelled) return;
            subscriber.next({
              kind: 'event',
              data: JSON.stringify(entry.event),
              id: entry.id,
            });
            cursor = entry.id;
          }
        }
      };

      run().catch((err) => {
        if (!cancelled) {
          this.logger.error(`Notification stream error for ${userID}:`, err);
          subscriber.error(err);
        }
      });

      return () => {
        cancelled = true;
        clearInterval(heartbeat);
        if (client) {
          client.disconnect();
          client = null;
        }
      };
    });
  }
}
