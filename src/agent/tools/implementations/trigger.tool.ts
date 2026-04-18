import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface TriggersServiceLike {
  create(data: {
    agentId: string;
    webhookPath: string;
    command: string;
    description?: string;
    secret?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
  }): Promise<{
    triggerId: string;
    webhookPath: string;
    command: string;
    description: string;
    enabled: boolean;
  }>;
  findAll(agentId?: string): Promise<
    Array<{
      triggerId: string;
      agentId: string;
      webhookPath: string;
      command: string;
      description: string;
      enabled: boolean;
      executionCount: number;
      lastTriggeredAt?: Date;
    }>
  >;
  update(
    triggerId: string,
    data: Partial<{
      command: string;
      description: string;
      secret: string;
      enabled: boolean;
    }>,
  ): Promise<unknown>;
  remove(triggerId: string): Promise<boolean>;
}

const parameters = z.object({
  operation: z
    .enum(['create', 'list', 'update', 'delete'])
    .describe('Operation to perform'),
  webhookPath: z
    .string()
    .optional()
    .describe('Unique URL path for the webhook (required for create). The full URL will be POST /webhooks/{path}'),
  command: z
    .string()
    .optional()
    .describe('Instruction for the agent when the webhook fires (required for create)'),
  description: z
    .string()
    .optional()
    .describe('Human-readable description'),
  secret: z
    .string()
    .optional()
    .describe('Shared secret — callers must send this in the X-Webhook-Secret header'),
  triggerId: z
    .string()
    .optional()
    .describe('Trigger ID (required for update/delete)'),
  enabled: z
    .boolean()
    .optional()
    .describe('Enable or disable the trigger (for update)'),
});

export class TriggerTool implements Tool<typeof parameters> {
  readonly name = 'trigger';
  readonly description =
    'Manage webhook triggers. When an external system POSTs to /webhooks/{path}, an autonomous agent run executes with the payload.';
  readonly parameters = parameters;

  constructor(private readonly triggers: TriggersServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      switch (args.operation) {
        case 'create':
          return await this.create(args, context);
        case 'list':
          return await this.list(context);
        case 'update':
          return await this.update(args);
        case 'delete':
          return await this.deleteTrigger(args);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Trigger operation failed',
      };
    }
  }

  private async create(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.webhookPath || !args.command) {
      return {
        success: false,
        error: 'webhookPath and command are required for create',
      };
    }

    const trigger = await this.triggers.create({
      agentId: context.agentId,
      webhookPath: args.webhookPath,
      command: args.command,
      description: args.description,
      secret: args.secret,
    });

    return {
      success: true,
      result: {
        triggerId: trigger.triggerId,
        webhookPath: trigger.webhookPath,
        endpoint: `POST /webhooks/${trigger.webhookPath}`,
        command: trigger.command,
      },
    };
  }

  private async list(
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const triggers = await this.triggers.findAll(context.agentId);
    return {
      success: true,
      result: triggers.map((t) => ({
        triggerId: t.triggerId,
        webhookPath: t.webhookPath,
        endpoint: `POST /webhooks/${t.webhookPath}`,
        command: t.command,
        description: t.description,
        enabled: t.enabled,
        executionCount: t.executionCount,
        lastTriggeredAt: t.lastTriggeredAt,
      })),
    };
  }

  private async update(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.triggerId) {
      return { success: false, error: 'triggerId is required for update' };
    }

    const update: Record<string, unknown> = {};
    if (args.command !== undefined) update.command = args.command;
    if (args.description !== undefined) update.description = args.description;
    if (args.secret !== undefined) update.secret = args.secret;
    if (args.enabled !== undefined) update.enabled = args.enabled;

    const result = await this.triggers.update(args.triggerId, update);
    if (!result) {
      return { success: false, error: `Trigger "${args.triggerId}" not found` };
    }

    return { success: true, result: { triggerId: args.triggerId, updated: true } };
  }

  private async deleteTrigger(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.triggerId) {
      return { success: false, error: 'triggerId is required for delete' };
    }

    const deleted = await this.triggers.remove(args.triggerId);
    if (!deleted) {
      return { success: false, error: `Trigger "${args.triggerId}" not found` };
    }

    return { success: true, result: { deleted: args.triggerId } };
  }
}
