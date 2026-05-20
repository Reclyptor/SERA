import type { z } from 'zod';

export interface SandboxContext {
  image: string;
  memoryMb: number;
  cpuShares: number;
  networkEnabled: boolean;
  envVars: Record<string, string>;
}

export interface ToolExecutionContext {
  threadID: string;
  runID: string;
  userID?: string;
  agentID: string;
  sandbox?: SandboxContext;
  delegationDepth?: number;
  abortSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export type ToolResource =
  | { type: 'workspace-path'; path: string; mode: 'read' | 'write' }
  | { type: 'network'; host: string }
  | { type: 'process' }
  | { type: 'session-state'; key?: string };

export interface Tool<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams;
  parallelSafe?: boolean;
  getResources?(
    args: z.infer<TParams>,
    context: ToolExecutionContext,
  ): ToolResource[];
  execute(
    args: z.infer<TParams>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}
