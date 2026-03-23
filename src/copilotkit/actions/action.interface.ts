export interface ActionParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ActionDefinition {
  name: string;
  description: string;
  parameters: ActionParameter[];
  /**
   * Whether this action requires human confirmation before execution
   */
  requiresConfirmation?: boolean;
  /**
   * Whether this action should be executed on the frontend
   */
  frontend?: boolean;
}

export interface ActionExecutionContext {
  threadId: string;
  runId: string;
  messageId: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  /**
   * If true, the action is pending user confirmation
   */
  pendingConfirmation?: boolean;
}

/**
 * Frontend actions are defined on the client and routed through the backend
 * The backend tracks these definitions but execution happens on the frontend
 */
export interface FrontendAction {
  definition: ActionDefinition;
}

/**
 * Backend actions are defined and executed entirely on the server
 */
export interface BackendAction {
  definition: ActionDefinition;
  execute(
    args: Record<string, unknown>,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult>;
}
