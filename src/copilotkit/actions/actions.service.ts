import { Injectable, Logger } from '@nestjs/common';
import { ActionsRegistry } from './actions.registry';
import {
  ActionDefinition,
  ActionExecutionContext,
  ActionExecutionResult,
  BackendAction,
} from './interfaces/action.interface';

@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);

  constructor(private readonly registry: ActionsRegistry) {}

  registerBackendAction(action: BackendAction): void {
    this.registry.registerBackendAction(action);
  }

  syncFrontendActions(actions: ActionDefinition[]): void {
    this.registry.syncFrontendActions(actions);
  }

  getAllDefinitions(): ActionDefinition[] {
    return this.registry.getAllDefinitions();
  }

  /**
   * Determine if an action should be executed on backend or routed to frontend
   */
  getActionLocation(name: string): 'backend' | 'frontend' | null {
    if (this.registry.isBackendAction(name)) {
      return 'backend';
    }
    if (this.registry.isFrontendAction(name)) {
      return 'frontend';
    }
    return null;
  }

  /**
   * Execute a backend action
   * Frontend actions are not executed here - they're routed via AG-UI events
   */
  async executeBackendAction(
    name: string,
    args: Record<string, unknown>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const action = this.registry.getBackendAction(name);

    if (!action) {
      this.logger.warn(`Backend action not found: ${name}`);
      return {
        success: false,
        error: `Backend action '${name}' not found`,
      };
    }

    try {
      this.logger.debug(`Executing backend action: ${name}`, { args, context });
      const result = await action.execute(args, context);
      this.logger.debug(`Backend action complete: ${name}`, { result });
      return result;
    } catch (error) {
      this.logger.error(`Backend action failed: ${name}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if an action requires human confirmation
   */
  requiresConfirmation(name: string): boolean {
    const backendAction = this.registry.getBackendAction(name);
    if (backendAction) {
      return backendAction.definition.requiresConfirmation ?? false;
    }

    const frontendAction = this.registry.getFrontendAction(name);
    if (frontendAction) {
      return frontendAction.definition.requiresConfirmation ?? false;
    }

    return false;
  }
}
