import { Injectable } from '@nestjs/common';
import { Tool, ToolDefinition } from './interfaces/tool.interface';

@Injectable()
export class ToolsRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((tool) => tool.definition);
  }

  /**
   * Convert tool definitions to Anthropic's tool format
   */
  toAnthropicFormat(): Array<{
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  }> {
    return this.getAll().map((tool) => ({
      name: tool.definition.name,
      description: tool.definition.description,
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(
          tool.definition.parameters.map((param) => [
            param.name,
            {
              type: param.type,
              description: param.description,
              ...(param.enum && { enum: param.enum }),
              ...(param.default !== undefined && { default: param.default }),
            },
          ]),
        ),
        required: tool.definition.parameters
          .filter((p) => p.required)
          .map((p) => p.name),
      },
    }));
  }
}
