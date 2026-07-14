import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { CurrentUser } from '../../auth/user.decorator';
import type { SessionUser } from '../../auth/session.strategy';

@Controller('agent/presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /**
   * Heartbeat from SERAUI while a chat thread is focused/visible. Self-
   * identifying (userID from the session), so the body is empty.
   */
  @Post(':chatID')
  @HttpCode(204)
  async ping(
    @Param('chatID') chatID: string,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    await this.presence.markViewing(user.sub, chatID);
  }
}
