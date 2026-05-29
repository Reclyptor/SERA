import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';
import type { ToolApprovalRequester } from '../tool-approval.service';

const DEFAULT_AGENT_ID = 'default';
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface AgentsServiceLike {
  create(dto: {
    agentID: string;
    name: string;
    description?: string;
    promptSlug?: string;
    modelOptions?: {
      preferredProvider?: string;
      preferredModel?: string;
      maxOutputTokens?: number;
      temperature?: number;
      summaryModel?: string;
    };
    toolPolicy?: { mode: 'allow' | 'deny'; tools: string[] };
    messagingPolicy?: { enabled: boolean; allowedAgents: string[] };
    sandboxConfig?: {
      enabled: boolean;
      image: string;
      memoryMb: number;
      cpuShares: number;
      networkEnabled: boolean;
      envVars: Record<string, string>;
    };
    enabled?: boolean;
  }): Promise<{
    agentID: string;
    name: string;
    description: string;
    enabled: boolean;
  }>;
  update(
    agentID: string,
    dto: {
      name?: string;
      description?: string;
      promptSlug?: string;
      modelOptions?: {
        preferredProvider?: string;
        preferredModel?: string;
        maxOutputTokens?: number;
        temperature?: number;
        summaryModel?: string;
      };
      toolPolicy?: { mode: 'allow' | 'deny'; tools: string[] };
      messagingPolicy?: { enabled: boolean; allowedAgents: string[] };
      sandboxConfig?: {
        enabled: boolean;
        image: string;
        memoryMb: number;
        cpuShares: number;
        networkEnabled: boolean;
        envVars: Record<string, string>;
      };
      enabled?: boolean;
    },
  ): Promise<{
    agentID: string;
    name: string;
    description: string;
    enabled: boolean;
    toolPolicy?: { mode: 'allow' | 'deny'; tools: string[] };
  }>;
  findByID(agentID: string): Promise<{
    agentID: string;
    name: string;
    description: string;
    enabled: boolean;
    toolPolicy?: { mode: 'allow' | 'deny'; tools: string[] };
  } | null>;
  findAll(): Promise<
    Array<{
      agentID: string;
      name: string;
      description: string;
      enabled: boolean;
    }>
  >;
  remove(agentID: string): Promise<boolean>;
}

const modelOptionsSchema = z
  .object({
    preferredProvider: z.string().optional(),
    preferredModel: z.string().optional(),
    maxOutputTokens: z.number().optional(),
    temperature: z.number().optional(),
    summaryModel: z.string().optional(),
  })
  .optional();

const toolPolicySchema = z
  .object({
    mode: z.enum(['allow', 'deny']),
    tools: z.array(z.string()),
  })
  .optional();

const messagingPolicySchema = z
  .object({
    enabled: z.boolean(),
    allowedAgents: z.array(z.string()),
  })
  .optional();

const sandboxConfigSchema = z
  .object({
    enabled: z.boolean(),
    image: z.string(),
    memoryMb: z.number(),
    cpuShares: z.number(),
    networkEnabled: z.boolean(),
    envVars: z.record(z.string()),
  })
  .optional();

const parameters = z.object({
  operation: z
    .enum(['create', 'update', 'get', 'list', 'delete', 'enable', 'disable'])
    .describe('Operation to perform on the agent catalog'),
  agentID: z
    .string()
    .optional()
    .describe(
      'Target agent ID (required for create/update/get/delete/enable/disable). Lowercase alphanumeric and dashes only.',
    ),
  name: z
    .string()
    .optional()
    .describe('Human-readable agent name (required for create)'),
  description: z.string().optional().describe('Short description of the agent'),
  promptSlug: z
    .string()
    .optional()
    .describe('Prompt slug overriding the default system prompt'),
  modelOptions: modelOptionsSchema.describe(
    'Model preferences for runs handled by this agent',
  ),
  toolPolicy: toolPolicySchema.describe(
    'Tool allow/deny list. Mutating tools[] requires operator approval.',
  ),
  messagingPolicy: messagingPolicySchema.describe(
    'Inter-agent messaging policy',
  ),
  sandboxConfig: sandboxConfigSchema.describe('Sandbox runtime configuration'),
  enabled: z
    .boolean()
    .optional()
    .describe('Whether the agent should be available'),
});

type Args = z.infer<typeof parameters>;

export class AgentManagementTool implements Tool<typeof parameters> {
  readonly name = 'agent_management';
  readonly description =
    "Create, update, list, get, delete, enable, or disable agent personas. Mutating an agent's toolPolicy.tools requires operator approval. Cannot modify the calling agent or delete/disable the default agent.";
  readonly parameters = parameters;

  constructor(
    private readonly agentsService: AgentsServiceLike,
    private readonly approvalRequester?: ToolApprovalRequester,
  ) {}

  async execute(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    switch (args.operation) {
      case 'list':
        return this.list();
      case 'get':
        return this.get(args.agentID);
      case 'create':
        return this.create(args, context);
      case 'update':
        return this.update(args, context);
      case 'delete':
        return this.delete(args, context);
      case 'enable':
        return this.setEnabled(args, context, true);
      case 'disable':
        return this.setEnabled(args, context, false);
    }
  }

  private async list(): Promise<ToolExecutionResult> {
    try {
      const agents = await this.agentsService.findAll();
      return {
        success: true,
        result: agents.map((a) => ({
          agentID: a.agentID,
          name: a.name,
          description: a.description,
          enabled: a.enabled,
        })),
      };
    } catch (error) {
      return { success: false, error: this.errString(error) };
    }
  }

  private async get(agentID: string | undefined): Promise<ToolExecutionResult> {
    if (!agentID) {
      return { success: false, error: 'agentID is required for get' };
    }
    try {
      const agent = await this.agentsService.findByID(agentID);
      if (!agent) {
        return { success: false, error: `Agent "${agentID}" not found` };
      }
      return { success: true, result: agent };
    } catch (error) {
      return { success: false, error: this.errString(error) };
    }
  }

  private async create(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.agentID || !args.name) {
      return {
        success: false,
        error: 'agentID and name are required for create',
      };
    }
    if (!AGENT_ID_PATTERN.test(args.agentID)) {
      return {
        success: false,
        error:
          'agentID must be lowercase alphanumeric with dashes (e.g. "frank-the-coder")',
      };
    }
    const selfBlock = this.guardSelfMutation(args.agentID, context);
    if (selfBlock) return selfBlock;

    const newTools = args.toolPolicy?.tools ?? [];
    if (newTools.length > 0) {
      const approval = await this.requestToolPolicyApproval({
        operation: 'create',
        agentID: args.agentID,
        toolPolicy: args.toolPolicy!,
        message: `Approval required to create agent "${args.agentID}" with tools: ${newTools.join(', ')}`,
        context,
      });
      if (approval) return approval;
    }

    try {
      const created = await this.agentsService.create({
        agentID: args.agentID,
        name: args.name,
        description: args.description,
        promptSlug: args.promptSlug,
        modelOptions: args.modelOptions,
        toolPolicy: args.toolPolicy,
        messagingPolicy: args.messagingPolicy,
        sandboxConfig: args.sandboxConfig,
        enabled: args.enabled,
      });
      return {
        success: true,
        result: {
          agentID: created.agentID,
          name: created.name,
          description: created.description,
          enabled: created.enabled,
        },
      };
    } catch (error) {
      return { success: false, error: this.errString(error) };
    }
  }

  private async update(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.agentID) {
      return { success: false, error: 'agentID is required for update' };
    }
    const selfBlock = this.guardSelfMutation(args.agentID, context);
    if (selfBlock) return selfBlock;

    if (args.toolPolicy !== undefined) {
      const current = await this.agentsService.findByID(args.agentID);
      if (!current) {
        return { success: false, error: `Agent "${args.agentID}" not found` };
      }
      if (this.toolPolicyDiffers(current.toolPolicy, args.toolPolicy)) {
        const approval = await this.requestToolPolicyApproval({
          operation: 'update',
          agentID: args.agentID,
          toolPolicy: args.toolPolicy,
          message: `Approval required to change tools for agent "${args.agentID}" to: ${args.toolPolicy.tools.join(', ') || '(none)'}`,
          context,
        });
        if (approval) return approval;
      }
    }

    try {
      const updated = await this.agentsService.update(args.agentID, {
        name: args.name,
        description: args.description,
        promptSlug: args.promptSlug,
        modelOptions: args.modelOptions,
        toolPolicy: args.toolPolicy,
        messagingPolicy: args.messagingPolicy,
        sandboxConfig: args.sandboxConfig,
        enabled: args.enabled,
      });
      return {
        success: true,
        result: {
          agentID: updated.agentID,
          name: updated.name,
          description: updated.description,
          enabled: updated.enabled,
        },
      };
    } catch (error) {
      return { success: false, error: this.errString(error) };
    }
  }

  private async delete(
    args: Args,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.agentID) {
      return { success: false, error: 'agentID is required for delete' };
    }
    const selfBlock = this.guardSelfMutation(args.agentID, context);
    if (selfBlock) return selfBlock;
    const defaultBlock = this.guardDefaultAgent(args.agentID, 'delete');
    if (defaultBlock) return defaultBlock;

    try {
      const deleted = await this.agentsService.remove(args.agentID);
      if (!deleted) {
        return { success: false, error: `Agent "${args.agentID}" not found` };
      }
      return { success: true, result: { deleted: args.agentID } };
    } catch (error) {
      return { success: false, error: this.errString(error) };
    }
  }

  private async setEnabled(
    args: Args,
    context: ToolExecutionContext,
    enabled: boolean,
  ): Promise<ToolExecutionResult> {
    if (!args.agentID) {
      return {
        success: false,
        error: `agentID is required for ${enabled ? 'enable' : 'disable'}`,
      };
    }
    const selfBlock = this.guardSelfMutation(args.agentID, context);
    if (selfBlock) return selfBlock;
    if (!enabled) {
      const defaultBlock = this.guardDefaultAgent(args.agentID, 'disable');
      if (defaultBlock) return defaultBlock;
    }

    try {
      const updated = await this.agentsService.update(args.agentID, {
        enabled,
      });
      return {
        success: true,
        result: { agentID: updated.agentID, enabled: updated.enabled },
      };
    } catch (error) {
      return { success: false, error: this.errString(error) };
    }
  }

  private guardSelfMutation(
    targetAgentID: string,
    context: ToolExecutionContext,
  ): ToolExecutionResult | null {
    if (targetAgentID === context.agentID) {
      return {
        success: false,
        error:
          'Cannot modify the agent making this call. Ask the operator to make this change directly.',
      };
    }
    return null;
  }

  private guardDefaultAgent(
    agentID: string,
    operation: 'delete' | 'disable',
  ): ToolExecutionResult | null {
    if (agentID === DEFAULT_AGENT_ID) {
      return {
        success: false,
        error: `The default agent cannot be ${operation}d.`,
      };
    }
    return null;
  }

  private toolPolicyDiffers(
    current: { mode: 'allow' | 'deny'; tools: string[] } | undefined,
    next: { mode: 'allow' | 'deny'; tools: string[] },
  ): boolean {
    if (!current) return true;
    if (current.mode !== next.mode) return true;
    const currentTools = new Set(current.tools);
    const nextTools = new Set(next.tools);
    if (currentTools.size !== nextTools.size) return true;
    for (const t of nextTools) {
      if (!currentTools.has(t)) return true;
    }
    return false;
  }

  private async requestToolPolicyApproval(opts: {
    operation: 'create' | 'update';
    agentID: string;
    toolPolicy: { mode: 'allow' | 'deny'; tools: string[] };
    message: string;
    context: ToolExecutionContext;
  }): Promise<ToolExecutionResult | null> {
    if (!this.approvalRequester) {
      return {
        success: false,
        error:
          'toolPolicy.tools change requires approval, but approval handling is unavailable',
      };
    }
    const approval = await this.approvalRequester.requestApproval({
      threadID: opts.context.threadID,
      runID: opts.context.runID,
      actionName: this.name,
      args: {
        operation: opts.operation,
        agentID: opts.agentID,
        toolPolicy: opts.toolPolicy,
      },
      message: opts.message,
    });
    if (approval.status === 'rejected') {
      return {
        success: false,
        error: `agent_management rejected by operator${
          approval.feedback ? `: ${approval.feedback}` : ''
        }`,
      };
    }
    if (approval.status === 'pending') {
      return {
        success: false,
        result: {
          status: 'approval_required',
          confirmationID: approval.confirmationID,
          fingerprint: approval.fingerprint,
        },
        error: `agent_management requires approval (${approval.confirmationID})`,
      };
    }
    return null;
  }

  private errString(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  renderResultSummary(args: Args, result: unknown): string {
    const op = args.operation;
    if (result == null || typeof result !== 'object') {
      return `[agent_management] ${op}${args.agentID ? ` ${args.agentID}` : ''}`;
    }
    if (op === 'list' && Array.isArray(result)) {
      return `[agent_management] list -> ${result.length} agents`;
    }
    const r = result as { agentID?: string; deleted?: string };
    const id = r.agentID ?? r.deleted ?? args.agentID;
    return id ? `[agent_management] ${op} ${id}` : `[agent_management] ${op}`;
  }
}
