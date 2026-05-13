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
  private readonly mutationMutex = new Mutex();

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

  toAISDKToolSet(context: ToolExecutionContext): ToolSet {
    const toolSet: ToolSet = {};

    for (const [name, t] of this.tools) {
      toolSet[name] = aiTool({
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args) => this.wrapExecute(t, args, context),
      });
    }

    return toolSet;
  }

  toFilteredToolSet(
    context: ToolExecutionContext,
    policy: ToolPolicyFilter,
  ): ToolSet {
    const toolSet: ToolSet = {};

    for (const [name, t] of this.tools) {
      const inList = policy.tools.includes(name);
      const include = policy.mode === 'allow' ? inList : !inList;

      if (include) {
        toolSet[name] = aiTool({
          description: t.description,
          inputSchema: t.parameters,
          execute: async (args) => this.wrapExecute(t, args, context),
        });
      }
    }

    return toolSet;
  }

  private wrapExecute(
    tool: Tool,
    args: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    if (tool.parallelSafe) {
      return tool.execute(args, context);
    }
    return this.mutationMutex.run(() => tool.execute(args, context));
  }
}

class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}
