import { describe, expect, it, vi } from 'vitest';
import { RequestConfirmationAction } from './confirmation.action';
import type {
  AwaitResolutionOptions,
  ConfirmationDecision,
  ResolutionOutcome,
} from '../../state/confirmation-signal.service';

function makeAction(opts: {
  storeResolution?: ConfirmationDecision | null;
  signalOutcome?: ResolutionOutcome;
  signalDelayMs?: number;
  tryExpireResult?: {
    claimed: boolean;
    resolution?: { status: 'approved' | 'rejected'; feedback?: string };
  };
}) {
  const stateService = {
    addPendingConfirmation: vi.fn().mockResolvedValue('conf-1'),
    getConfirmation: vi.fn().mockImplementation(() => {
      if (opts.storeResolution) {
        return Promise.resolve({
          id: 'conf-1',
          status: opts.storeResolution.status,
          feedback: opts.storeResolution.feedback,
        });
      }
      return Promise.resolve({ id: 'conf-1', status: 'pending' });
    }),
    tryExpireConfirmation: vi
      .fn()
      .mockResolvedValue(opts.tryExpireResult ?? { claimed: true }),
    removePendingConfirmation: vi.fn().mockResolvedValue(true),
  };
  const emitter = { emitEvent: vi.fn().mockResolvedValue(undefined) };
  const signal = {
    awaitResolution: vi
      .fn()
      .mockImplementation(
        async (
          _threadID: string,
          _confirmationID: string,
          timeoutMs: number,
          callerOpts: AwaitResolutionOptions = {},
        ): Promise<ResolutionOutcome> => {
          // Honor preCheck the same way the real service does: short-circuit
          // when it surfaces an already-resolved entry.
          if (callerOpts.preCheck) {
            const fromStore = await callerOpts.preCheck();
            if (fromStore) return fromStore;
          }
          if (opts.signalOutcome) {
            if (opts.signalDelayMs != null) {
              await new Promise((r) => setTimeout(r, opts.signalDelayMs));
            }
            return opts.signalOutcome;
          }
          await new Promise((r) => setTimeout(r, timeoutMs));
          return 'timeout';
        },
      ),
  };
  const action = new RequestConfirmationAction(
    stateService as never,
    emitter as never,
    signal as never,
  );
  return { action, stateService, emitter, signal };
}

const ctx = {
  threadID: 'thread-1',
  runID: 'run-1',
  agentID: 'agent-1',
};

describe('RequestConfirmationAction', () => {
  it('returns the user decision when the signal fires', async () => {
    const { action, stateService } = makeAction({
      signalOutcome: { status: 'approved', feedback: 'go ahead' },
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

  it('returns the user decision when preCheck observes an already-resolved store', async () => {
    const { action, stateService, signal } = makeAction({
      storeResolution: { status: 'approved', feedback: 'pre-resolved' },
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

    expect(result.result).toMatchObject({
      decision: 'approved',
      feedback: 'pre-resolved',
    });
    expect(signal.awaitResolution).toHaveBeenCalledOnce();
    expect(stateService.tryExpireConfirmation).not.toHaveBeenCalled();
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
        timeoutMs: 25,
      },
      ctx,
    );

    expect(result.result).toMatchObject({
      decision: 'timed_out',
      approved: false,
    });
    expect(stateService.tryExpireConfirmation).toHaveBeenCalledTimes(1);
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
        timeoutMs: 25,
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

  it('emits approval.expired when the timeout claim wins cleanly', async () => {
    const { action, emitter } = makeAction({
      tryExpireResult: { claimed: true },
    });

    await action.execute(
      {
        message: 'proceed?',
        actionName: 'delete_file',
        actionArgs: {},
        timeoutMs: 25,
      },
      ctx,
    );

    expect(emitter.emitEvent).toHaveBeenCalledWith(
      'run-1',
      'thread-1',
      'approval.expired',
      expect.objectContaining({
        confirmationID: 'conf-1',
        actionName: 'delete_file',
      }),
    );
  });
});
