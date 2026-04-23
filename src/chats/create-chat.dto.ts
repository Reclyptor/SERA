export class SubagentMetaDto {
  runID: string;
  threadID: string;
  agentID: string;
  goal: string;
}

export class ToolCallBlockDto {
  toolCallID: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'started' | 'executing' | 'completed' | 'failed';
  isSubagent?: boolean;
  subagentMeta?: SubagentMetaDto;
}

export class MessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  toolCalls?: ToolCallBlockDto[];
  createdAt?: Date;
}

export class CreateChatDto {
  messages: MessageDto[];
}
