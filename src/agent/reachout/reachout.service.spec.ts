import { describe, expect, it, vi } from 'vitest';
import { ReachOutService } from './reachout.service';
import type { AgentGoal } from '../orchestration/orchestration.interfaces';

function heartbeatModel(ownerUserID: string | null) {
  return {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(ownerUserID ? { ownerUserID } : null),
        }),
      }),
    }),
  };
}

function create(opts: {
  ownerUserID?: string | null;
  existingChatID?: string;
  viewing?: boolean;
  gateAllowed?: boolean;
  baseURL?: string;
}) {
  const model = heartbeatModel(opts.ownerUserID ?? null);
  const chatsService = {
    createForReachOut: vi.fn().mockResolvedValue({ _id: 'chat-new' }),
    appendMessage: vi.fn().mockResolvedValue(undefined),
  };
  const stateService = {
    getCustomState: vi.fn().mockResolvedValue(opts.existingChatID),
    setCustomState: vi.fn().mockResolvedValue(undefined),
  };
  const notifications = { emit: vi.fn().mockResolvedValue(undefined) };
  const presence = {
    isViewing: vi.fn().mockResolvedValue(opts.viewing ?? false),
  };
  const ntfy = { publish: vi.fn().mockResolvedValue({ id: 'n1' }) };
  const proactiveGate = {
    check: vi.fn().mockResolvedValue({ allowed: opts.gateAllowed ?? true }),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: vi.fn((_key: string) => opts.baseURL),
  };
  const service = new ReachOutService(
    model as never,
    chatsService as never,
    stateService as never,
    notifications as never,
    presence as never,
    ntfy as never,
    proactiveGate as never,
    config as never,
  );
  return {
    service,
    chatsService,
    stateService,
    notifications,
    presence,
    ntfy,
    proactiveGate,
  };
}

const goal = {
  agentID: 'default',
  threadID: 'thread-1',
  runID: 'run-1',
} as AgentGoal;

describe('ReachOutService', () => {
  it('skips delivery (and creates nothing) when no owner is configured', async () => {
    const { service, chatsService } = create({ ownerUserID: null });
    const result = await service.deliver(goal, 'hello');
    expect(result).toBeNull();
    expect(chatsService.createForReachOut).not.toHaveBeenCalled();
    expect(chatsService.appendMessage).not.toHaveBeenCalled();
  });

  it('opens a new thread on the first reach-out and appends the reply', async () => {
    const { service, chatsService, stateService } = create({
      ownerUserID: 'user-1',
    });
    const result = await service.deliver(goal, 'your interview is tomorrow');

    expect(chatsService.createForReachOut).toHaveBeenCalledWith(
      'user-1',
      'default',
    );
    expect(stateService.setCustomState).toHaveBeenCalledWith(
      'thread-1',
      'reachOutChatID',
      'chat-new',
    );
    const [chatID, userID, message] = chatsService.appendMessage.mock.calls[0];
    expect(chatID).toBe('chat-new');
    expect(userID).toBe('user-1');
    expect(message).toMatchObject({
      role: 'assistant',
      content: 'your interview is tomorrow',
    });
    expect(result).toBe('chat-new');
  });

  it('reuses the chain thread on a continuation (no new chat)', async () => {
    const { service, chatsService, stateService } = create({
      ownerUserID: 'user-1',
      existingChatID: 'chat-existing',
    });
    const result = await service.deliver(goal, 'follow-up');

    expect(chatsService.createForReachOut).not.toHaveBeenCalled();
    expect(stateService.setCustomState).not.toHaveBeenCalled();
    expect(chatsService.appendMessage).toHaveBeenCalledWith(
      'chat-existing',
      'user-1',
      expect.objectContaining({ content: 'follow-up' }),
    );
    expect(result).toBe('chat-existing');
  });

  it('emits a chat.updated badge and pushes with a deep-link when the user is away', async () => {
    const { service, notifications, ntfy } = create({
      ownerUserID: 'user-1',
      viewing: false,
      baseURL: 'https://sera.example',
    });
    await service.deliver(goal, 'thinking of you');

    expect(notifications.emit).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'chat.updated', chatID: 'chat-new' }),
    );
    expect(ntfy.publish).toHaveBeenCalledWith(
      expect.objectContaining({ click: 'https://sera.example/chat/chat-new' }),
    );
  });

  it('suppresses the push when the user is already viewing the thread', async () => {
    const { service, notifications, ntfy } = create({
      ownerUserID: 'user-1',
      viewing: true,
    });
    await service.deliver(goal, 'thinking of you');

    expect(notifications.emit).toHaveBeenCalled(); // badge still emitted
    expect(ntfy.publish).not.toHaveBeenCalled(); // but no device push
  });

  it('holds the push when the proactive gate denies it', async () => {
    const { service, ntfy, proactiveGate } = create({
      ownerUserID: 'user-1',
      viewing: false,
      gateAllowed: false,
    });
    await service.deliver(goal, 'thinking of you');

    expect(ntfy.publish).not.toHaveBeenCalled();
    expect(proactiveGate.record).not.toHaveBeenCalled();
  });

  it('omits the deep-link when SERAUI_BASE_URL is unset', async () => {
    const { service, ntfy } = create({ ownerUserID: 'user-1', viewing: false });
    await service.deliver(goal, 'thinking of you');

    const arg = ntfy.publish.mock.calls[0][0];
    expect(arg.click).toBeUndefined();
  });
});
