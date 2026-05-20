export type McpTransport = 'stdio' | 'sse';

export interface McpToolSafety {
  readOnly?: boolean;
  parallelSafe?: boolean;
  requiresApproval?: boolean;
}

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  toolSafety?: Record<string, McpToolSafety>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
  safety?: McpToolSafety;
}

export interface McpConnection {
  serverName: string;
  transport: McpTransport;
  connected: boolean;
  tools: McpToolDefinition[];
}
