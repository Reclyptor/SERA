import { describe, expect, it } from 'vitest';
import { asSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { adaptMcpTool } from './mcp-tool-adapter';
import type { McpClientService } from './mcp-client.service';
import type { McpToolDefinition } from './mcp.interfaces';

const client = {} as McpClientService;

function makeDef(inputSchema: Record<string, unknown>): McpToolDefinition {
  return {
    name: 'mcp_server_thing',
    serverName: 'server',
    description: 'does a thing',
    inputSchema,
  };
}

// The Anthropic API requires every tool's `input_schema` to be an object
// schema. If the emitted JSON Schema has no top-level `type`, the API rejects
// the ENTIRE request with `tools.N.custom.input_schema.type: Field required`.
// These tests assert the exact contract the adapter must uphold.
function emittedJsonSchema(def: McpToolDefinition) {
  const tool = adaptMcpTool(def, client);
  return asSchema(tool.parameters).jsonSchema as Record<string, unknown>;
}

describe('adaptMcpTool input schema conversion', () => {
  it('emits type:"object" for an empty schema (server omitted inputSchema)', () => {
    const js = emittedJsonSchema(makeDef({}));
    expect(js.type).toBe('object');
  });

  it('preserves properties for an object schema without a top-level type', () => {
    const js = emittedJsonSchema(
      makeDef({
        properties: {
          query: { type: 'string', description: 'the search query' },
        },
        required: ['query'],
      }),
    );
    expect(js.type).toBe('object');
    expect(js.properties).toHaveProperty('query');
    expect(js.required).toContain('query');
  });

  it('normalizes a non-object top-level schema to an object', () => {
    const js = emittedJsonSchema(makeDef({ type: 'string' }));
    expect(js.type).toBe('object');
  });

  it('honors a well-formed object schema and its optional fields', () => {
    const js = emittedJsonSchema(
      makeDef({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
        },
        required: ['a'],
      }),
    );
    expect(js.type).toBe('object');
    expect(js.required).toEqual(['a']);
  });

  it('always yields a Zod object regardless of input shape', () => {
    for (const input of [{}, { type: 'array' }, { type: 'boolean' }]) {
      expect(adaptMcpTool(makeDef(input), client).parameters).toBeInstanceOf(
        z.ZodObject,
      );
    }
  });
});
