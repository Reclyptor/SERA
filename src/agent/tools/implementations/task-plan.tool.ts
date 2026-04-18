import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface TasksServiceLike {
  createPlan(data: {
    parentRunId: string;
    agentId: string;
    goal: string;
    tasks: Array<{ description: string }>;
  }): Promise<{
    planId: string;
    goal: string;
    status: string;
    revision: number;
    tasks: Array<{
      taskId: string;
      description: string;
      status: string;
      order: number;
    }>;
  }>;
  getPlan(planId: string): Promise<{
    planId: string;
    goal: string;
    status: string;
    revision: number;
    stateJson: Record<string, unknown>;
    tasks: Array<{
      taskId: string;
      description: string;
      status: string;
      result?: string;
      runId?: string;
      order: number;
      waitMeta?: Record<string, unknown>;
    }>;
  }>;
  listPlans(filters: {
    parentRunId?: string;
    agentId?: string;
  }): Promise<
    Array<{
      planId: string;
      goal: string;
      status: string;
      revision: number;
      tasks: Array<{
        taskId: string;
        description: string;
        status: string;
        order: number;
      }>;
    }>
  >;
  updateTask(
    planId: string,
    taskId: string,
    update: {
      status: 'pending' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'skipped';
      result?: string;
      runId?: string;
      waitMeta?: Record<string, unknown>;
    },
    expectedRevision?: number,
  ): Promise<{ revision: number }>;
  cancelPlan(planId: string): Promise<{
    planId: string;
    status: string;
    revision: number;
  }>;
  setState(
    planId: string,
    key: string,
    value: unknown,
    expectedRevision?: number,
  ): Promise<{ revision: number }>;
  getState(planId: string): Promise<Record<string, unknown>>;
  deletePlan(planId: string): Promise<boolean>;
}

const parameters = z.object({
  operation: z
    .enum([
      'create_plan',
      'get_plan',
      'list_plans',
      'update_task',
      'cancel_plan',
      'set_state',
      'get_state',
      'delete_plan',
    ])
    .describe('Operation to perform'),
  goal: z
    .string()
    .optional()
    .describe('High-level goal for the plan (required for create_plan)'),
  tasks: z
    .array(z.object({ description: z.string() }))
    .optional()
    .describe('Ordered list of tasks to accomplish the goal (required for create_plan)'),
  planId: z
    .string()
    .optional()
    .describe('Plan ID (required for most operations except list_plans)'),
  taskId: z
    .string()
    .optional()
    .describe('Task ID within a plan (required for update_task)'),
  status: z
    .enum(['pending', 'in_progress', 'waiting', 'completed', 'failed', 'skipped'])
    .optional()
    .describe('New task status (required for update_task)'),
  result: z
    .string()
    .optional()
    .describe('Result or output of the task (for update_task)'),
  runId: z
    .string()
    .optional()
    .describe('Run ID if this task was delegated to a sub-agent (for update_task)'),
  waitMeta: z
    .record(z.unknown())
    .optional()
    .describe('Metadata for a waiting task — e.g. what event or condition to resume on (for update_task with status=waiting)'),
  expectedRevision: z
    .number()
    .optional()
    .describe('Optimistic concurrency: only apply the mutation if the plan is at this revision (for update_task, set_state)'),
  key: z
    .string()
    .optional()
    .describe('State key to set (required for set_state)'),
  value: z
    .unknown()
    .optional()
    .describe('State value to set (required for set_state)'),
});

export class TaskPlanTool implements Tool<typeof parameters> {
  readonly name = 'task_plan';
  readonly description =
    'Decompose complex goals into structured task plans. Create plans, track progress, and compose results across sub-tasks.';
  readonly parameters = parameters;

  constructor(private readonly tasksService: TasksServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      switch (args.operation) {
        case 'create_plan':
          return await this.createPlan(args, context);
        case 'get_plan':
          return await this.getPlan(args.planId);
        case 'list_plans':
          return await this.listPlans(context);
        case 'update_task':
          return await this.updateTask(args);
        case 'cancel_plan':
          return await this.cancelPlan(args.planId);
        case 'set_state':
          return await this.setState(args);
        case 'get_state':
          return await this.getState(args.planId);
        case 'delete_plan':
          return await this.deletePlan(args.planId);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Task plan operation failed',
      };
    }
  }

  private async createPlan(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!args.goal || !args.tasks?.length) {
      return {
        success: false,
        error: 'goal and tasks are required for create_plan',
      };
    }

    const plan = await this.tasksService.createPlan({
      parentRunId: context.runId,
      agentId: context.agentId,
      goal: args.goal,
      tasks: args.tasks,
    });

    return {
      success: true,
      result: {
        planId: plan.planId,
        goal: plan.goal,
        status: plan.status,
        revision: plan.revision,
        tasks: plan.tasks.map((t) => ({
          taskId: t.taskId,
          description: t.description,
          status: t.status,
          order: t.order,
        })),
      },
    };
  }

  private async getPlan(planId?: string): Promise<ToolExecutionResult> {
    if (!planId) {
      return { success: false, error: 'planId is required for get_plan' };
    }

    const plan = await this.tasksService.getPlan(planId);

    return {
      success: true,
      result: {
        planId: plan.planId,
        goal: plan.goal,
        status: plan.status,
        revision: plan.revision,
        stateJson: plan.stateJson,
        tasks: plan.tasks.map((t) => ({
          taskId: t.taskId,
          description: t.description,
          status: t.status,
          result: t.result,
          runId: t.runId,
          order: t.order,
          waitMeta: t.waitMeta,
        })),
      },
    };
  }

  private async listPlans(
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const plans = await this.tasksService.listPlans({
      agentId: context.agentId,
    });

    return {
      success: true,
      result: plans.map((p) => ({
        planId: p.planId,
        goal: p.goal,
        status: p.status,
        revision: p.revision,
        taskCount: p.tasks.length,
        completed: p.tasks.filter((t) => t.status === 'completed').length,
        failed: p.tasks.filter((t) => t.status === 'failed').length,
      })),
    };
  }

  private async updateTask(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.planId || !args.taskId || !args.status) {
      return {
        success: false,
        error: 'planId, taskId, and status are required for update_task',
      };
    }

    const plan = await this.tasksService.updateTask(
      args.planId,
      args.taskId,
      {
        status: args.status,
        result: args.result,
        runId: args.runId,
        waitMeta: args.waitMeta,
      },
      args.expectedRevision,
    );

    return {
      success: true,
      result: {
        planId: args.planId,
        taskId: args.taskId,
        status: args.status,
        revision: plan.revision,
      },
    };
  }

  private async cancelPlan(planId?: string): Promise<ToolExecutionResult> {
    if (!planId) {
      return { success: false, error: 'planId is required for cancel_plan' };
    }

    const plan = await this.tasksService.cancelPlan(planId);

    return {
      success: true,
      result: {
        planId: plan.planId,
        status: plan.status,
        revision: plan.revision,
      },
    };
  }

  private async setState(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.planId || !args.key) {
      return {
        success: false,
        error: 'planId and key are required for set_state',
      };
    }

    const plan = await this.tasksService.setState(
      args.planId,
      args.key,
      args.value,
      args.expectedRevision,
    );

    return {
      success: true,
      result: { planId: args.planId, key: args.key, revision: plan.revision },
    };
  }

  private async getState(planId?: string): Promise<ToolExecutionResult> {
    if (!planId) {
      return { success: false, error: 'planId is required for get_state' };
    }

    const state = await this.tasksService.getState(planId);

    return { success: true, result: state };
  }

  private async deletePlan(planId?: string): Promise<ToolExecutionResult> {
    if (!planId) {
      return { success: false, error: 'planId is required for delete_plan' };
    }

    const deleted = await this.tasksService.deletePlan(planId);
    if (!deleted) {
      return { success: false, error: `Plan "${planId}" not found` };
    }

    return { success: true, result: { deleted: planId } };
  }
}
