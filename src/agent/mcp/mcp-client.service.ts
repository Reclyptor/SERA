import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { McpServer, McpServerDocument } from './mcp-server.schema';
import type { McpConnection, McpToolDefinition } from './mcp.interfaces';

@Injectable()
export class McpClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpClientService.name);
  private readonly connections = new Map<
    string,
    {
      client: unknown;
      transport: unknown;
      tools: McpToolDefinition[];
    }
  >();

  private mcpSdk: any = null;

  private mcpStdio: any = null;

  constructor(
    @InjectModel(McpServer.name)
    private readonly serverModel: Model<McpServerDocument>,
  ) {}

  async onModuleInit() {
    try {
      const clientMod = '@modelcontextprotocol/sdk/client/index.js';
      const stdioMod = '@modelcontextprotocol/sdk/client/stdio.js';
      this.mcpSdk = await (
        Function('m', 'return import(m)') as (m: string) => Promise<unknown>
      )(clientMod);
      this.mcpStdio = await (
        Function('m', 'return import(m)') as (m: string) => Promise<unknown>
      )(stdioMod);
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

    const { Client } = this.mcpSdk;
    const client = new Client({ name: `sera-${serverName}`, version: '1.0.0' });

    let transport: unknown;

    if (config.transport === 'stdio') {
      if (!config.command)
        throw new Error('stdio transport requires a command');
      const { StdioClientTransport } = this.mcpStdio;
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...process.env, ...(config.env ?? {}) } as Record<
          string,
          string
        >,
      });
    } else if (config.transport === 'sse') {
      if (!config.url) throw new Error('SSE transport requires a URL');
      // SSE transport via fetch-based SSE client
      const sseMod = '@modelcontextprotocol/sdk/client/sse.js';
      const sseModule = await (
        Function('m', 'return import(m)') as (m: string) => Promise<any>
      )(sseMod);
      transport = new sseModule.SSEClientTransport(new URL(config.url));
    } else {
      throw new Error(`Unsupported transport: ${config.transport}`);
    }

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools: McpToolDefinition[] = (toolsResult.tools ?? []).map(
      (t: {
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }) => ({
        name: `mcp_${serverName}_${t.name}`,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? {},
        serverName,
      }),
    );

    this.connections.set(serverName, { client, transport, tools });

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
      const client = conn.client as { close?: () => Promise<void> };
      await client.close?.();
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

    const client = conn.client as {
      callTool: (params: {
        name: string;
        arguments: Record<string, unknown>;
      }) => Promise<{
        content: unknown[];
      }>;
    };

    const result = await client.callTool({
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
      transport: 'stdio' as const,
      connected: true,
      tools: conn.tools,
    }));
  }
}
