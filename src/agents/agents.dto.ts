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

export class SandboxConfigDto {
  enabled?: boolean;
  image?: string;
  memoryMb?: number;
  cpuShares?: number;
  networkEnabled?: boolean;
  envVars?: Record<string, string>;
}

export class HeartbeatConfigDto {
  enabled?: boolean;
  intervalMinutes?: number;
}

export class CreateAgentDto {
  agentID: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  personality?: string;
  modelOptions?: ModelOptionsDto;
  toolPolicy?: ToolPolicyDto;
  workspaceDir?: string;
  messagingPolicy?: MessagingPolicyDto;
  sandboxConfig?: SandboxConfigDto;
  heartbeatConfig?: HeartbeatConfigDto;
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
  sandboxConfig?: SandboxConfigDto;
  heartbeatConfig?: HeartbeatConfigDto;
  enabled?: boolean;
}

export class CreateBindingDto {
  agentID: string;
  bindingType: 'channel' | 'user' | 'default';
  bindingValue?: string;
  priority?: number;
}
