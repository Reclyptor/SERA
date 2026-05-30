import { EventEmitter } from 'events';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

const CHANNEL_PREFIX = 'sera:confirm';

export interface ConfirmationDecision {
  status: 'approved' | 'rejected';
  feedback?: string;
}

export type ResolutionOutcome = ConfirmationDecision | 'timeout';

export interface AwaitResolutionOptions {
  /**
   * Runs after the listener is attached but before the timeout race begins.
   * If it returns a non-null decision, the wait short-circuits with that
   * value. This is the "subscribe-then-reread" race fix: callers pass a
   * closure that re-reads the durable store, so a resolution that landed
   * before the subscribe is never lost.
   */
  preCheck?: () => Promise<ConfirmationDecision | null>;
  abortSignal?: AbortSignal;
}

/**
 * Wake-up wire for action-layer confirmation waits. Mongo (`pendingConfirmations`)
 * remains the system of record; this service only signals "go look again."
 *
 * One Redis subscriber connection is held for the process lifetime and
 * `psubscribe`s to `sera:confirm:*`. Per-confirmation fan-out happens through
 * an in-process `EventEmitter` keyed by full channel name, so attaching and
 * detaching listeners is synchronous and free. Adding a new awaiter does not
 * issue a Redis command.
 *
 * Pub/Sub message loss (Redis restart, network blip, subscriber reconnect mid-
 * wait) is tolerated by the caller's atomic `tryExpireConfirmation` backstop
 * in `RequestConfirmationAction`: if the deadline fires and the durable store
 * already has a resolution, that resolution is surfaced instead of `timeout`.
 */
@Injectable()
export class ConfirmationSignalService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConfirmationSignalService.name);
  private readonly emitter = new EventEmitter();
  private subscriber: Redis | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly publisher: Redis) {
    // Node's default cap of 10 listeners is wrong for this use case: every
    // concurrent confirmation wait registers one. Set high enough that a
    // burst of approvals across threads does not spam warnings.
    this.emitter.setMaxListeners(1000);
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.publisher.duplicate();
    await this.subscriber.connect();
    await this.subscriber.psubscribe(`${CHANNEL_PREFIX}:*`);
    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      this.handleMessage(channel, message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.emitter.removeAllListeners();
    if (!this.subscriber) return;
    try {
      await this.subscriber.punsubscribe();
      await this.subscriber.quit();
    } catch (err) {
      this.logger.warn(
        `Subscriber shutdown error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.subscriber = null;
    }
  }

  async publish(
    threadID: string,
    confirmationID: string,
    decision: ConfirmationDecision,
  ): Promise<void> {
    const channel = this.channelName(threadID, confirmationID);
    await this.publisher.publish(channel, JSON.stringify(decision));
  }

  async awaitResolution(
    threadID: string,
    confirmationID: string,
    timeoutMs: number,
    opts: AwaitResolutionOptions = {},
  ): Promise<ResolutionOutcome> {
    const channel = this.channelName(threadID, confirmationID);

    return new Promise<ResolutionOutcome>((resolve) => {
      let settled = false;

      const finish = (outcome: ResolutionOutcome): void => {
        if (settled) return;
        settled = true;
        this.emitter.off(channel, onMessage);
        clearTimeout(timer);
        opts.abortSignal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      };

      const onMessage = (decision: ConfirmationDecision): void => {
        finish(decision);
      };
      const onAbort = (): void => {
        finish('timeout');
      };

      // Attach listener BEFORE the pre-check so a resolution arriving during
      // the store re-read still wakes us. The Redis subscription is already
      // live process-wide; this is just an in-process emitter registration.
      this.emitter.on(channel, onMessage);
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      opts.abortSignal?.addEventListener('abort', onAbort);

      if (opts.preCheck) {
        opts
          .preCheck()
          .then((decision) => {
            if (decision) finish(decision);
          })
          .catch((err) => {
            this.logger.warn(
              `Pre-check error on ${channel}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
    });
  }

  private handleMessage(channel: string, message: string): void {
    let decision: ConfirmationDecision;
    try {
      decision = JSON.parse(message) as ConfirmationDecision;
    } catch (err) {
      this.logger.warn(
        `Bad confirmation signal payload on ${channel}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (decision.status !== 'approved' && decision.status !== 'rejected') {
      this.logger.warn(`Unknown decision status on ${channel}`);
      return;
    }
    this.emitter.emit(channel, decision);
  }

  private channelName(threadID: string, confirmationID: string): string {
    return `${CHANNEL_PREFIX}:${threadID}:${confirmationID}`;
  }
}
