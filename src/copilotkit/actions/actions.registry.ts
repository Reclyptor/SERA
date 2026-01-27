import { Injectable, Logger } from '@nestjs/common';
import {
  ActionDefinition,
  BackendAction,
  FrontendAction,
} from './interfaces/action.interface';

@Injectable()
export class ActionsRegistry {
  private readonly logger = new Logger(ActionsRegistry.name);
  private readonly backendActions = new Map<string, BackendAction>();
  private readonly frontendActions = new Map<string, FrontendAction>();

  registerBackendAction(action: BackendAction): void {
    this.backendActions.set(action.definition.name, action);
    this.logger.log(`Registered backend action: ${action.definition.name}`);
  }

  registerFrontendAction(action: FrontendAction): void {
    this.frontendActions.set(action.definition.name, action);
    this.logger.log(`Registered frontend action: ${action.definition.name}`);
  }

  /**
   * Sync frontend actions from CopilotKit client
   * Called when the frontend connects and sends its action definitions
   */
  syncFrontendActions(actions: ActionDefinition[]): void {
    this.frontendActions.clear();
    for (const definition of actions) {
      this.frontendActions.set(definition.name, { definition });
    }
    this.logger.log(`Synced ${actions.length} frontend actions`);
  }

  unregister(name: string): boolean {
    const backendRemoved = this.backendActions.delete(name);
    const frontendRemoved = this.frontendActions.delete(name);
    return backendRemoved || frontendRemoved;
  }

  getBackendAction(name: string): BackendAction | undefined {
    return this.backendActions.get(name);
  }

  getFrontendAction(name: string): FrontendAction | undefined {
    return this.frontendActions.get(name);
  }

  isBackendAction(name: string): boolean {
    return this.backendActions.has(name);
  }

  isFrontendAction(name: string): boolean {
    return this.frontendActions.has(name);
  }

  getAllDefinitions(): ActionDefinition[] {
    const backend = Array.from(this.backendActions.values()).map(
      (a) => a.definition,
    );
    const frontend = Array.from(this.frontendActions.values()).map(
      (a) => a.definition,
    );
    return [...backend, ...frontend];
  }

  getBackendDefinitions(): ActionDefinition[] {
    return Array.from(this.backendActions.values()).map((a) => a.definition);
  }

  getFrontendDefinitions(): ActionDefinition[] {
    return Array.from(this.frontendActions.values()).map((a) => a.definition);
  }
}
