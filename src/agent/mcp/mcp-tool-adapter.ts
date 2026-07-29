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

  // Treat the schema as an object when it says so explicitly, or when it
  // omits `type` but is clearly object-shaped (`properties`/`required`
  // present). Many MCP servers ship input schemas without a top-level
  // `type`, and without this we'd fall through to `z.unknown()` and lose
  // every declared parameter.
  const isObjectShaped =
    type === 'object' ||
    (type === undefined && ('properties' in schema || 'required' in schema));

  if (isObjectShaped) {
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

/**
 * Convert an MCP tool's top-level input schema to Zod. The MCP spec and the
 * Anthropic API both require a tool's `input_schema` to be an object schema:
 * anything that converts to a non-object (an empty `{}`, a bare primitive)
 * emits JSON Schema with no `type`, which the API rejects with
 * `tools.N.custom.input_schema.type: Field required` — failing the ENTIRE
 * request, not just that tool. Normalize any non-object result to an open
 * object so a single misbehaving server can't take down every model call.
 */
function mcpInputSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const zod = jsonSchemaToZod(schema);
  return zod instanceof z.ZodObject ? zod : z.object({}).passthrough();
}

export function adaptMcpTool(
  def: McpToolDefinition,
  client: McpClientService,
): Tool {
  const params = mcpInputSchemaToZod(def.inputSchema);

  // Strip the mcp_{server}_ prefix to get the original MCP tool name
  const mcpToolName = def.name.replace(/^mcp_[^_]+_/, '');

  return {
    name: def.name,
    description: `[MCP:${def.serverName}] ${def.description}`,
    parameters: params,
    // SPEC §29.7: MCP tools default to conservative mutation/session
    // locking. `parallelSafe` requires an EXPLICIT `true` from the server
    // metadata — `readOnly` is orthogonal (no persistent mutation) and
    // does not imply parallel safety (a read-only tool can still have
    // internal state that breaks concurrent invocation).
    parallelSafe: def.safety?.parallelSafe === true,
    getResources(): ToolResource[] {
      if (def.safety?.readOnly === true) return [];
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
