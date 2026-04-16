import type { z } from 'zod';

export interface ToolExecutionContext {
  threadId: string;
  runId: string;
  userId?: string;
  agentId: string;
  workspaceDir?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface Tool<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams;
  execute(
    args: z.infer<TParams>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}
