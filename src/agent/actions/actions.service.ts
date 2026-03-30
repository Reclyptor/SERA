import { Injectable, Logger } from '@nestjs/common';
import type { ToolSet } from 'ai';
import { ActionsRegistry } from './actions.registry';
import {
  ActionExecutionContext,
  ActionExecutionResult,
  BackendAction,
} from './action.interface';

@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);

  constructor(private readonly registry: ActionsRegistry) {}

  registerAction(action: BackendAction): void {
    this.registry.register(action);
    this.logger.log(`Registered action: ${action.name}`);
  }

  /**
   * Get an AI SDK-compatible ToolSet from registered actions.
   */
  getToolSet(context: ActionExecutionContext): ToolSet {
    return this.registry.toAISDKToolSet(context);
  }

  async executeAction(
    name: string,
    args: Record<string, unknown>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const action = this.registry.get(name);

    if (!action) {
      this.logger.warn(`Action not found: ${name}`);
      return {
        success: false,
        error: `Action '${name}' not found`,
      };
    }

    try {
      this.logger.debug(`Executing action: ${name}`, { args, context });
      const result = await action.execute(args, context);
      this.logger.debug(`Action complete: ${name}`, { result });
      return result;
    } catch (error) {
      this.logger.error(`Action failed: ${name}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  requiresConfirmation(name: string): boolean {
    return this.registry.requiresConfirmation(name);
  }
}
