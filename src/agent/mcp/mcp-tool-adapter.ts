import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResource,
} from '../tools/tool.interface';
import type { McpClientService } from './mcp-client.service';
import type { McpToolDefinition } from './mcp.interfaces';

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  if (!schema || typeof schema !== 'object') {
    return z.object({}).passthrough();
  }

  const type = schema.type as string | undefined;

  if (type === 'object') {
    const properties = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const required = new Set((schema.required ?? []) as string[]);
    const shape: Record<string, z.ZodType> = {};

    for (const [key, prop] of Object.entries(properties)) {
      let field = jsonSchemaToZod(prop);
      if (prop.description) {
        field = field.describe(prop.description as string);
      }
      if (!required.has(key)) {
        field = field.optional();
      }
      shape[key] = field;
    }

    return z.object(shape).passthrough();
  }

  if (type === 'string') return z.string();
  if (type === 'number' || type === 'integer') return z.number();
  if (type === 'boolean') return z.boolean();
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    return z.array(items ? jsonSchemaToZod(items) : z.unknown());
  }

  return z.unknown();
}

export function adaptMcpTool(
  def: McpToolDefinition,
  client: McpClientService,
): Tool {
  const params = jsonSchemaToZod(def.inputSchema);

  // Strip the mcp_{server}_ prefix to get the original MCP tool name
  const mcpToolName = def.name.replace(/^mcp_[^_]+_/, '');

  return {
    name: def.name,
    description: `[MCP:${def.serverName}] ${def.description}`,
    parameters: params,
    parallelSafe: def.safety?.parallelSafe ?? def.safety?.readOnly ?? false,
    getResources(): ToolResource[] {
      if (def.safety?.readOnly) return [];
      return [
        { type: 'session-state', key: `mcp:${def.serverName}:${def.name}` },
      ];
    },
    async execute(
      args: Record<string, unknown>,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      try {
        const result = await client.callTool(def.serverName, mcpToolName, args);
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'MCP tool call failed',
        };
      }
    },
  };
}
