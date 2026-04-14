import { Injectable } from '@nestjs/common';
import { tool as aiTool, type ToolSet } from 'ai';
import { Tool, ToolExecutionContext } from './tool.interface';

export interface ToolPolicyFilter {
  mode: 'allow' | 'deny';
  tools: string[];
}

@Injectable()
export class ToolsRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
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

  getAllNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Convert all registered tools to a Vercel AI SDK ToolSet.
   * The provided context is injected into each tool's execute function.
   */
  toAISDKToolSet(context: ToolExecutionContext): ToolSet {
    const toolSet: ToolSet = {};

    for (const [name, t] of this.tools) {
      toolSet[name] = aiTool({
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args) => t.execute(args, context),
      });
    }

    return toolSet;
  }

  /**
   * Convert registered tools to a filtered AI SDK ToolSet.
   * Allow mode: only include tools in the list.
   * Deny mode: include all tools except those in the list.
   */
  toFilteredToolSet(
    context: ToolExecutionContext,
    policy: ToolPolicyFilter,
  ): ToolSet {
    const toolSet: ToolSet = {};

    for (const [name, t] of this.tools) {
      const inList = policy.tools.includes(name);
      const include =
        policy.mode === 'allow' ? inList : !inList;

      if (include) {
        toolSet[name] = aiTool({
          description: t.description,
          inputSchema: t.parameters,
          execute: async (args) => t.execute(args, context),
        });
      }
    }

    return toolSet;
  }
}
