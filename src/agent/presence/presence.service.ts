import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { ChatsService } from '../../chats/chats.service';

const DEFAULT_TTL_SECONDS = 45;

/**
 * Tracks whether a user is actively viewing a specific chat right now (§30.11.2)
 * — an ephemeral Redis key (`sera:presence:{userID}:{chatID}`) refreshed by the
 * SERAUI ping while the thread tab is visible. Used to suppress the ntfy push
 * for a message the user is already looking at.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly chatsService: ChatsService,
    private readonly config: ConfigService,
  ) {}

  /** The user is looking at this chat now: refresh presence + mark it read. */
  async markViewing(userID: string, chatID: string): Promise<void> {
    try {
      await this.redis.set(
        this.key(userID, chatID),
        '1',
        'EX',
        this.ttlSeconds(),
      );
    } catch (err) {
      this.logger.warn(
        `Presence set failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Viewing is reading — clears the unread badge (§30.11.5).
    await this.chatsService.markRead(chatID, userID).catch((err) => {
      this.logger.warn(
        `markRead failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Whether the user is currently viewing this chat. Fails **open to false**
   * (i.e. "not viewing") so a Redis error never wrongly suppresses a push — the
   * user would rather get a redundant ping than silently miss a message.
   */
  async isViewing(userID: string, chatID: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.key(userID, chatID))) === 1;
    } catch (err) {
      this.logger.warn(
        `Presence check failed, assuming not viewing: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private ttlSeconds(): number {
    const raw = parseInt(
      this.config.get<string>(
        'PRESENCE_TTL_SECONDS',
        String(DEFAULT_TTL_SECONDS),
      ),
      10,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS;
  }

  private key(userID: string, chatID: string): string {
    return `sera:presence:${userID}:${chatID}`;
  }
}
