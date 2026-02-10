export class MessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: Date;
}

export class WorkflowStateEntryDto {
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'unknown';
  progress: Record<string, unknown> | null;
  pendingReviewWorkflows: string[];
  startedAt: Date;
  lastSyncedAt: Date;
}

export class CreateChatDto {
  messages: MessageDto[];
  workflowState?: WorkflowStateEntryDto[];
}
