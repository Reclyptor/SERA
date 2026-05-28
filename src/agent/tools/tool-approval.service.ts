import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { StateService } from '../state/state.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';

export interface ToolApprovalRequestInput {
  threadID: string;
  runID: string;
  actionName: string;
  args: Record<string, unknown>;
  message: string;
}

export type ToolApprovalResult =
  | { status: 'approved' }
  | { status: 'rejected'; feedback?: string }
  | { status: 'pending'; confirmationID: string; fingerprint: string };

export interface ToolApprovalRequester {
  requestApproval(input: ToolApprovalRequestInput): Promise<ToolApprovalResult>;
}

/**
 * Centralizes the approval-gate lifecycle for runtime tools that
 * require operator confirmation (exec, shell, process, and any plugin
 * tool marked `requiresApproval`).
 *
 * The previous shape returned only a `{ confirmationID, fingerprint }`
 * tuple — once the operator approved a confirmation, the next call with
 * matching fingerprint did not see the resolved state and a *new*
 * pending was created, looping forever. This service inspects the
 * durable confirmation store first: an already-resolved entry is
 * consumed and reported back to the caller as `approved` / `rejected`,
 * so the tool can proceed (or refuse) without prompting the user
 * again.
 *
 * The fingerprint deliberately omits `runID`: an approval granted
 * during one run must remain valid when the agent resumes work in a
 * new run on the same thread (the normal flow after the user
 * confirms).
 */
@Injectable()
export class ToolApprovalService implements ToolApprovalRequester {
  constructor(
    private readonly stateService: StateService,
    private readonly eventEmitter: AgentEventEmitter,
  ) {}

  async requestApproval(
    input: ToolApprovalRequestInput,
  ): Promise<ToolApprovalResult> {
    const fingerprint = ToolApprovalService.fingerprint(
      input.actionName,
      input.args,
    );
    const pending = await this.stateService.getPendingConfirmations(
      input.threadID,
    );

    // Consume an already-resolved confirmation with this fingerprint.
    const resolved = pending.find(
      (c) =>
        c.actionName === input.actionName &&
        (c.args as Record<string, unknown> | undefined)?.fingerprint ===
          fingerprint &&
        (c.status === 'approved' || c.status === 'rejected'),
    );

    if (resolved) {
      await this.stateService.removePendingConfirmation(
        input.threadID,
        resolved.id,
      );
      if (resolved.status === 'approved') {
        return { status: 'approved' };
      }
      return { status: 'rejected', feedback: resolved.feedback };
    }

    // De-dupe against an open pending entry.
    const existing = pending.find(
      (c) =>
        c.status === 'pending' &&
        c.actionName === input.actionName &&
        (c.args as Record<string, unknown> | undefined)?.fingerprint ===
          fingerprint,
    );

    if (existing) {
      return {
        status: 'pending',
        confirmationID: existing.id,
        fingerprint,
      };
    }

    // Fresh request.
    const confirmationID = await this.stateService.addPendingConfirmation(
      input.threadID,
      input.actionName,
      { ...input.args, fingerprint },
      input.message,
      input.runID,
    );

    await this.eventEmitter.emitEvent(
      input.runID,
      input.threadID,
      'approval.requested',
      {
        confirmationID,
        actionName: input.actionName,
        args: input.args,
        fingerprint,
        message: input.message,
      },
    );

    return { status: 'pending', confirmationID, fingerprint };
  }

  private static fingerprint(
    actionName: string,
    args: Record<string, unknown>,
  ): string {
    return createHash('sha256')
      .update(JSON.stringify({ actionName, args }))
      .digest('hex');
  }
}
