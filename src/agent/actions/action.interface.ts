import type { z } from 'zod';

export interface ActionExecutionContext {
  threadID: string;
  runID: string;
  userID?: string;
  agentID?: string;
  /** True when this run was started autonomously (heartbeat/cron), not by a user message. */
  isHeartbeat?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ActionExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  /**
   * If true, the action is pending user confirmation
   */
  pendingConfirmation?: boolean;
}

export interface BackendAction<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams;
  requiresConfirmation?: boolean;
  execute(
    args: z.infer<TParams>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult>;
}
