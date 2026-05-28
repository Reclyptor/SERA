import { describe, expect, it, vi } from 'vitest';
import { RequestConfirmationAction } from './confirmation.action';

function makeAction(opts: {
  getConfirmationSequence?: Array<unknown>;
  tryExpireResult?: {
    claimed: boolean;
    resolution?: { status: 'approved' | 'rejected'; feedback?: string };
  };
}) {
  const stateService = {
    addPendingConfirmation: vi.fn().mockResolvedValue('conf-1'),
    getConfirmation: vi.fn().mockImplementation(
      () =>
        (opts.getConfirmationSequence ?? []).shift() ?? {
          id: 'conf-1',
          status: 'pending',
        },
    ),
    tryExpireConfirmation: vi
      .fn()
      .mockResolvedValue(opts.tryExpireResult ?? { claimed: true }),
    removePendingConfirmation: vi.fn().mockResolvedValue(true),
  };
  const emitter = { emitEvent: vi.fn() };
  const action = new RequestConfirmationAction(
    stateService as never,
    emitter as never,
  );
  return { action, stateService, emitter };
}

const ctx = {
  threadID: 'thread-1',
  runID: 'run-1',
  agentID: 'agent-1',
};

describe('RequestConfirmationAction timeout-vs-resolve race', () => {
  it('returns the user decision when poll observes a resolved confirmation', async () => {
    const { action, stateService } = makeAction({
      getConfirmationSequence: [
        {
          id: 'conf-1',
          status: 'approved',
          feedback: 'go ahead',
        },
      ],
    });

    const result = await action.execute(
      {
        message: 'proceed?',
        actionName: 'delete_file',
        actionArgs: {},
        timeoutMs: 5_000,
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      decision: 'approved',
      approved: true,
      feedback: 'go ahead',
    });
    expect(stateService.tryExpireConfirmation).not.toHaveBeenCalled();
    expect(stateService.removePendingConfirmation).toHaveBeenCalledWith(
      'thread-1',
      'conf-1',
    );
  });

  it('returns timed_out when the action wins the expire race', async () => {
    const { action, stateService } = makeAction({
      tryExpireResult: { claimed: true },
    });

    const result = await action.execute(
      {
        message: 'proceed?',
        actionName: 'delete_file',
        actionArgs: {},
        timeoutMs: 50,
      },
      ctx,
    );

    expect(result.result).toMatchObject({
      decision: 'timed_out',
      approved: false,
    });
    expect(stateService.tryExpireConfirmation).toHaveBeenCalledTimes(1);
    // No second removePendingConfirmation call — the atomic claim already
    // removed the pending entry.
    expect(stateService.removePendingConfirmation).not.toHaveBeenCalled();
  });

  it('returns the user decision when the user resolves at the same moment as timeout', async () => {
    const { action, stateService } = makeAction({
      tryExpireResult: {
        claimed: false,
        resolution: { status: 'rejected', feedback: 'nope' },
      },
    });

    const result = await action.execute(
      {
        message: 'proceed?',
        actionName: 'delete_file',
        actionArgs: {},
        timeoutMs: 50,
      },
      ctx,
    );

    expect(result.result).toMatchObject({
      decision: 'rejected',
      approved: false,
      feedback: 'nope',
    });
    expect(stateService.removePendingConfirmation).toHaveBeenCalledWith(
      'thread-1',
      'conf-1',
    );
  });
});
