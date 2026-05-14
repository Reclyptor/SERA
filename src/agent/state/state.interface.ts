export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  timestamp: Date;
}

export interface ThreadState {
  threadID: string;
  toolCalls: ToolCall[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunState {
  runID: string;
  threadID: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  response?: string;
  userMessage: string;
  agentID: string;
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
    runID?: string;
    status: 'pending' | 'approved' | 'rejected';
    feedback?: string;
    resolvedBy?: string;
    resolvedAt?: Date;
    createdAt: Date;
  }>;
}

export interface StateSnapshot {
  thread: ThreadState;
  run?: RunState;
  agent: AgentState;
}
