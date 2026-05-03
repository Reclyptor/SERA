export type McpTransport = 'stdio' | 'sse';

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface McpConnection {
  serverName: string;
  transport: McpTransport;
  connected: boolean;
  tools: McpToolDefinition[];
}
