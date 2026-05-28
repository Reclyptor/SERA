import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { McpServer, McpServerDocument } from './mcp-server.schema';
import type {
  McpConnection,
  McpToolDefinition,
  McpTransport,
} from './mcp.interfaces';

// The @modelcontextprotocol/sdk packages are pure-ESM and treated as
// optional dependencies (the service quietly disables itself if they're
// not installed). Declaring narrow shapes for the SDK exports we use
// lets the rest of the file stay strictly typed without pulling in the
// SDK's full d.ts surface area.
interface McpClient {
  connect(transport: unknown): Promise<void>;
  close?: () => Promise<void>;
  listTools(): Promise<{ tools?: McpToolListEntry[] }>;
  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content: unknown[] }>;
}

interface McpToolListEntry {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpTransportInstance {
  close?: () => Promise<void>;
}

interface McpClientCtor {
  new (info: { name: string; version: string }): McpClient;
}

interface McpStdioTransportCtor {
  new (opts: {
    command: string;
    args: string[];
    env: Record<string, string>;
  }): McpTransportInstance;
}

interface McpSseTransportCtor {
  new (url: URL): McpTransportInstance;
}

interface McpSdkModule {
  Client: McpClientCtor;
}

interface McpStdioModule {
  StdioClientTransport: McpStdioTransportCtor;
}

interface McpSseModule {
  SSEClientTransport: McpSseTransportCtor;
}

@Injectable()
export class McpClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpClientService.name);
  private readonly connections = new Map<
    string,
    {
      client: McpClient;
      transport: McpTransport;
      rawTransport: McpTransportInstance;
      tools: McpToolDefinition[];
    }
  >();

  private mcpSdk: McpSdkModule | null = null;
  private mcpStdio: McpStdioModule | null = null;

  constructor(
    @InjectModel(McpServer.name)
    private readonly serverModel: Model<McpServerDocument>,
  ) {}

  async onModuleInit() {
    try {
      this.mcpSdk =
        (await import('@modelcontextprotocol/sdk/client/index.js')) as unknown as McpSdkModule;
      this.mcpStdio =
        (await import('@modelcontextprotocol/sdk/client/stdio.js')) as unknown as McpStdioModule;
      this.logger.log('MCP SDK loaded');
    } catch {
      this.logger.warn(
        'MCP SDK not installed (@modelcontextprotocol/sdk). MCP features disabled.',
      );
      return;
    }

    const servers = await this.serverModel.find({ enabled: true }).exec();
    for (const server of servers) {
      await this.connect(server.name).catch((err) => {
        this.logger.error(
          `Failed to connect to MCP server "${server.name}":`,
          err,
        );
      });
    }
  }

  async onModuleDestroy() {
    for (const [name] of this.connections) {
      await this.disconnect(name).catch(() => {});
    }
  }

  async connect(serverName: string): Promise<McpConnection> {
    if (!this.mcpSdk || !this.mcpStdio) {
      throw new Error('MCP SDK not available');
    }

    const config = await this.serverModel.findOne({ name: serverName }).exec();
    if (!config) throw new Error(`MCP server "${serverName}" not found`);

    if (this.connections.has(serverName)) {
      await this.disconnect(serverName);
    }

    const client = new this.mcpSdk.Client({
      name: `sera-${serverName}`,
      version: '1.0.0',
    });

    let transport: McpTransportInstance;

    if (config.transport === 'stdio') {
      if (!config.command)
        throw new Error('stdio transport requires a command');
      transport = new this.mcpStdio.StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...process.env, ...(config.env ?? {}) } as Record<
          string,
          string
        >,
      });
    } else if (config.transport === 'sse') {
      if (!config.url) throw new Error('SSE transport requires a URL');
      const sseModule =
        (await import('@modelcontextprotocol/sdk/client/sse.js')) as unknown as McpSseModule;
      transport = new sseModule.SSEClientTransport(new URL(config.url));
    } else {
      throw new Error(`Unsupported transport: ${config.transport}`);
    }

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools: McpToolDefinition[] = (toolsResult.tools ?? []).map((t) => ({
      name: `mcp_${serverName}_${t.name}`,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? {},
      serverName,
      safety:
        config.toolSafety?.[t.name] ??
        config.toolSafety?.[`mcp_${serverName}_${t.name}`],
    }));

    this.connections.set(serverName, {
      client,
      transport: config.transport,
      rawTransport: transport,
      tools,
    });

    this.logger.log(
      `Connected to MCP server "${serverName}" — ${tools.length} tools discovered`,
    );

    return {
      serverName,
      transport: config.transport,
      connected: true,
      tools,
    };
  }

  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    try {
      await conn.client.close?.();
      await conn.rawTransport.close?.();
    } catch (err) {
      this.logger.debug(`Error closing MCP connection "${serverName}":`, err);
    }

    this.connections.delete(serverName);
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`MCP server "${serverName}" not connected`);

    const result = await conn.client.callTool({
      name: toolName,
      arguments: args,
    });

    return result.content;
  }

  getDiscoveredTools(): McpToolDefinition[] {
    const all: McpToolDefinition[] = [];
    for (const conn of this.connections.values()) {
      all.push(...conn.tools);
    }
    return all;
  }

  getConnections(): McpConnection[] {
    return Array.from(this.connections.entries()).map(([name, conn]) => ({
      serverName: name,
      transport: conn.transport,
      connected: true,
      tools: conn.tools,
    }));
  }
}
