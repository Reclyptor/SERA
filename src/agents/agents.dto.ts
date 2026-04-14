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

export class CreateAgentDto {
  agentId: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  personality?: string;
  modelOptions?: ModelOptionsDto;
  toolPolicy?: ToolPolicyDto;
  enabled?: boolean;
}

export class UpdateAgentDto {
  name?: string;
  description?: string;
  systemPrompt?: string;
  personality?: string;
  modelOptions?: ModelOptionsDto;
  toolPolicy?: ToolPolicyDto;
  enabled?: boolean;
}
