export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  timestamp: Date;
}

export interface ThreadState {
  threadId: string;
  toolCalls: ToolCall[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunState {
  runId: string;
  threadId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface AgentState {
  /**
   * Custom state managed by the agent
   * Can be used for complex multi-step workflows
   */
  custom: Record<string, unknown>;
  /**
   * Current step in a multi-step workflow
   */
  currentStep?: string;
  /**
   * Pending confirmations for human-in-the-loop
   */
  pendingConfirmations: Array<{
    id: string;
    actionName: string;
    args: Record<string, unknown>;
    message: string;
    createdAt: Date;
  }>;
}

export interface StateSnapshot {
  thread: ThreadState;
  run?: RunState;
  agent: AgentState;
}
