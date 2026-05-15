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

export class MessageAttachmentDto {
  id: string;
  kind: 'image' | 'file';
  mimeType: string;
  size: number;
  filename?: string;
  createdAt?: string | Date;
}

export class MessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  toolCalls?: ToolCallBlockDto[];
  attachments?: MessageAttachmentDto[];
  createdAt?: string | Date;
}

export class CreateChatDto {
  messages: MessageDto[];
}
