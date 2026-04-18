import type { z } from 'zod';

export interface SandboxContext {
  image: string;
  memoryMb: number;
  cpuShares: number;
  networkEnabled: boolean;
  envVars: Record<string, string>;
}

export interface ToolExecutionContext {
  threadId: string;
  runId: string;
  userId?: string;
  agentId: string;
  workspaceDir?: string;
  sandbox?: SandboxContext;
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
