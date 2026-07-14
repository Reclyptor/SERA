import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { ChatsService } from '../../chats/chats.service';
import { StateService } from '../state/state.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { NtfyService } from '../ntfy/ntfy.service';
import { ProactiveGateService } from '../proactive/proactive-gate.service';
import {
  HeartbeatConfig,
  HeartbeatConfigDocument,
} from '../heartbeat/heartbeat.schema';
import type { AgentGoal } from '../orchestration/orchestration.interfaces';

/**
 * Delivers an autonomous (heartbeat) reply into a real, replyable chat thread
 * (§30.11). The first non-idle response of an autonomous chain opens a new
 * `origin: 'agent'` chat owned by the agent's user; continuation turns share
 * the chain's `threadID`, so they reuse the same chat via thread custom state
 * (`reachOutChatID`) — one initiative reads as one conversation.
 */
@Injectable()
export class ReachOutService {
  private readonly logger = new Logger(ReachOutService.name);

  constructor(
    @InjectModel(HeartbeatConfig.name)
    private readonly heartbeatModel: Model<HeartbeatConfigDocument>,
    private readonly chatsService: ChatsService,
    private readonly stateService: StateService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
    private readonly ntfy: NtfyService,
    private readonly proactiveGate: ProactiveGateService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Persists `response` as an assistant message in the chain's reach-out chat.
   * Returns the chatID, or null when no owner is configured (reach-out skipped).
   */
  async deliver(goal: AgentGoal, response: string): Promise<string | null> {
    const config = await this.heartbeatModel
      .findOne({ agentID: goal.agentID })
      .select('ownerUserID')
      .lean()
      .exec();
    const ownerUserID = config?.ownerUserID;
    if (!ownerUserID) {
      this.logger.warn(
        `Reach-out skipped for agent "${goal.agentID}": no ownerUserID configured`,
      );
      return null;
    }

    let chatID = await this.stateService.getCustomState<string>(
      goal.threadID,
      'reachOutChatID',
    );
    if (!chatID) {
      const chat = await this.chatsService.createForReachOut(
        ownerUserID,
        goal.agentID,
      );
      chatID = String(chat._id);
      await this.stateService.setCustomState(
        goal.threadID,
        'reachOutChatID',
        chatID,
      );
      this.logger.log(
        `Opened reach-out thread ${chatID} for agent "${goal.agentID}"`,
      );
    }

    await this.chatsService.appendMessage(chatID, ownerUserID, {
      id: randomUUID(),
      role: 'assistant',
      content: response,
      createdAt: new Date(),
    });

    // Live unread badge for the chat list (§30.11.3).
    await this.notifications.emit(ownerUserID, {
      type: 'chat.updated',
      chatID,
      agentID: goal.agentID,
      preview: response.slice(0, 140),
      origin: 'agent',
      timestamp: Date.now(),
    });

    // Presence-gated push (§30.11.4): only ping the device if the user is not
    // already looking at this thread, and only within the proactive gate.
    await this.maybePush(goal.agentID, ownerUserID, chatID, response);

    return chatID;
  }

  private async maybePush(
    agentID: string,
    userID: string,
    chatID: string,
    response: string,
  ): Promise<void> {
    if (await this.presence.isViewing(userID, chatID)) return;

    const verdict = await this.proactiveGate.check(agentID);
    if (!verdict.allowed) {
      this.logger.debug(`Reach-out push suppressed by gate: ${verdict.reason}`);
      return;
    }

    const baseURL = this.config.get<string>('SERAUI_BASE_URL');
    try {
      await this.ntfy.publish({
        title: 'SERA',
        message: response.slice(0, 3900),
        ...(baseURL
          ? { click: `${baseURL.replace(/\/+$/, '')}/chat/${chatID}` }
          : {}),
      });
      await this.proactiveGate.record(agentID);
    } catch (err) {
      this.logger.warn(
        `Reach-out push failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
