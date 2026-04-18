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
    tasks: Array<{
      taskId: string;
      description: string;
      status: string;
      result?: string;
      runId?: string;
      order: number;
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
      status: 'in_progress' | 'completed' | 'failed' | 'skipped';
      result?: string;
      runId?: string;
    },
  ): Promise<unknown>;
  deletePlan(planId: string): Promise<boolean>;
}

const parameters = z.object({
  operation: z
    .enum([
      'create_plan',
      'get_plan',
      'list_plans',
      'update_task',
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
    .describe('Plan ID (required for get_plan, update_task, delete_plan)'),
  taskId: z
    .string()
    .optional()
    .describe('Task ID within a plan (required for update_task)'),
  status: z
    .enum(['in_progress', 'completed', 'failed', 'skipped'])
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
        tasks: plan.tasks.map((t) => ({
          taskId: t.taskId,
          description: t.description,
          status: t.status,
          result: t.result,
          runId: t.runId,
          order: t.order,
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

    await this.tasksService.updateTask(args.planId, args.taskId, {
      status: args.status,
      result: args.result,
      runId: args.runId,
    });

    return {
      success: true,
      result: { planId: args.planId, taskId: args.taskId, status: args.status },
    };
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
