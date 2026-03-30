import { Injectable, Logger } from '@nestjs/common';
import { tool as aiTool, type ToolSet } from 'ai';
import { BackendAction, ActionExecutionContext } from './action.interface';

@Injectable()
export class ActionsRegistry {
  private readonly logger = new Logger(ActionsRegistry.name);
  private readonly actions = new Map<string, BackendAction>();

  register(action: BackendAction): void {
    this.actions.set(action.name, action);
    this.logger.log(`Registered action: ${action.name}`);
  }

  unregister(name: string): boolean {
    return this.actions.delete(name);
  }

  get(name: string): BackendAction | undefined {
    return this.actions.get(name);
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  getAll(): BackendAction[] {
    return Array.from(this.actions.values());
  }

  requiresConfirmation(name: string): boolean {
    return this.actions.get(name)?.requiresConfirmation ?? false;
  }

  /**
   * Convert all registered actions to a Vercel AI SDK ToolSet.
   * Actions that require confirmation will have their execute
   * wrapped by the orchestrator to handle the confirmation flow.
   */
  toAISDKToolSet(context: ActionExecutionContext): ToolSet {
    const toolSet: ToolSet = {};

    for (const [name, action] of this.actions) {
      toolSet[name] = aiTool({
        description: action.description,
        inputSchema: action.parameters,
        execute: async (args) => action.execute(args, context),
      });
    }

    return toolSet;
  }
}
