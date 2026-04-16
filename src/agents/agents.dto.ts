export class ToolPolicyDto {
  mode: 'allow' | 'deny';
  tools: string[];
}

export class ModelOptionsDto {
  preferredProvider?: string;
  preferredModel?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export class MessagingPolicyDto {
  enabled?: boolean;
  allowedAgents?: string[];
}

export class CreateAgentDto {
  agentId: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  personality?: string;
  modelOptions?: ModelOptionsDto;
  toolPolicy?: ToolPolicyDto;
  workspaceDir?: string;
  messagingPolicy?: MessagingPolicyDto;
  enabled?: boolean;
}

export class UpdateAgentDto {
  name?: string;
  description?: string;
  systemPrompt?: string;
  personality?: string;
  modelOptions?: ModelOptionsDto;
  toolPolicy?: ToolPolicyDto;
  workspaceDir?: string;
  messagingPolicy?: MessagingPolicyDto;
  enabled?: boolean;
}
