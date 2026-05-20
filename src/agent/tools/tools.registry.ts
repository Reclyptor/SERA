import { Injectable } from '@nestjs/common';
import { tool as aiTool, type ToolSet } from 'ai';
import * as path from 'path';
import { Tool, ToolExecutionContext } from './tool.interface';

export interface ToolPolicyFilter {
  mode: 'allow' | 'deny';
  tools: string[];
}

@Injectable()
export class ToolsRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly locks = new LockManager();

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
    if (policy.tools.length === 0) {
      return this.toAISDKToolSet(context);
    }

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
    const resources = tool.getResources?.(args, context) ?? [];
    const lockKeys = resources
      .map((resource) => {
        switch (resource.type) {
          case 'workspace-path':
            return resource.mode === 'write'
              ? `workspace:${path.resolve(resource.path)}`
              : null;
          case 'process':
            return 'process';
          case 'session-state':
            return `session:${resource.key ?? context.threadID}`;
          case 'network':
            return null;
        }
      })
      .filter((key): key is string => Boolean(key));

    if (lockKeys.length === 0 && tool.parallelSafe) {
      return tool.execute(args, context);
    }
    return this.locks.run(
      lockKeys.length > 0 ? lockKeys : [`session:${context.threadID}`],
      () => tool.execute(args, context),
    );
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

  acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

class LockManager {
  private readonly mutexes = new Map<string, Mutex>();

  async run<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const uniqueKeys = Array.from(new Set(keys)).sort();
    const acquired: Mutex[] = [];
    try {
      for (const key of uniqueKeys) {
        const mutex = this.getMutex(key);
        await mutex.acquire();
        acquired.push(mutex);
      }
      return await fn();
    } finally {
      for (const mutex of acquired.reverse()) {
        mutex.release();
      }
    }
  }

  private getMutex(key: string): Mutex {
    let mutex = this.mutexes.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(key, mutex);
    }
    return mutex;
  }
}
