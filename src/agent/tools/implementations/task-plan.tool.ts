import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface TasksServiceLike {
  createPlan(data: {
    parentRunID: string;
    agentID: string;
    goal: string;
    tasks: Array<{ description: string }>;
  }): Promise<{
    planID: string;
    goal: string;
    status: string;
    revision: number;
    tasks: Array<{
      taskID: string;
      description: string;
      status: string;
      order: number;
    }>;
  }>;
  getPlan(planID: string): Promise<{
    planID: string;
    goal: string;
    status: string;
    revision: number;
    stateJson: Record<string, unknown>;
    tasks: Array<{
      taskID: string;
      description: string;
      status: string;
      result?: string;
      runID?: string;
      order: number;
      waitMeta?: Record<string, unknown>;
    }>;
  }>;
  listPlans(filters: { parentRunID?: string; agentID?: string }): Promise<
    Array<{
      planID: string;
      goal: string;
      status: string;
      revision: number;
      tasks: Array<{
        taskID: string;
        description: string;
        status: string;
        order: number;
      }>;
    }>
  >;
  updateTask(
    planID: string,
    taskID: string,
    update: {
      status:
        | 'pending'
        | 'in_progress'
        | 'waiting'
        | 'completed'
        | 'failed'
        | 'skipped';
      result?: string;
      runID?: string;
      waitMeta?: Record<string, unknown>;
    },
    expectedRevision?: number,
  ): Promise<{ revision: number }>;
  cancelPlan(planID: string): Promise<{
    planID: string;
    status: string;
    revision: number;
  }>;
  setState(
    planID: string,
    key: string,
    value: unknown,
    expectedRevision?: number,
  ): Promise<{ revision: number }>;
  getState(planID: string): Promise<Record<string, unknown>>;
  deletePlan(planID: string): Promise<boolean>;
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
    .describe(
      'Ordered list of tasks to accomplish the goal (required for create_plan)',
    ),
  planID: z
    .string()
    .optional()
    .describe('Plan ID (required for most operations except list_plans)'),
  taskID: z
    .string()
    .optional()
    .describe('Task ID within a plan (required for update_task)'),
  status: z
    .enum([
      'pending',
      'in_progress',
      'waiting',
      'completed',
      'failed',
      'skipped',
    ])
    .optional()
    .describe('New task status (required for update_task)'),
  result: z
    .string()
    .optional()
    .describe('Result or output of the task (for update_task)'),
  runID: z
    .string()
    .optional()
    .describe(
      'Run ID if this task was delegated to a sub-agent (for update_task)',
    ),
  waitMeta: z
    .record(z.unknown())
    .optional()
    .describe(
      'Metadata for a waiting task — e.g. what event or condition to resume on (for update_task with status=waiting)',
    ),
  expectedRevision: z
    .number()
    .optional()
    .describe(
      'Optimistic concurrency: only apply the mutation if the plan is at this revision (for update_task, set_state)',
    ),
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
          return await this.getPlan(args.planID);
        case 'list_plans':
          return await this.listPlans(context);
        case 'update_task':
          return await this.updateTask(args);
        case 'cancel_plan':
          return await this.cancelPlan(args.planID);
        case 'set_state':
          return await this.setState(args);
        case 'get_state':
          return await this.getState(args.planID);
        case 'delete_plan':
          return await this.deletePlan(args.planID);
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Task plan operation failed',
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
      parentRunID: context.runID,
      agentID: context.agentID,
      goal: args.goal,
      tasks: args.tasks,
    });

    return {
      success: true,
      result: {
        planID: plan.planID,
        goal: plan.goal,
        status: plan.status,
        revision: plan.revision,
        tasks: plan.tasks.map((t) => ({
          taskID: t.taskID,
          description: t.description,
          status: t.status,
          order: t.order,
        })),
      },
    };
  }

  private async getPlan(planID?: string): Promise<ToolExecutionResult> {
    if (!planID) {
      return { success: false, error: 'planID is required for get_plan' };
    }

    const plan = await this.tasksService.getPlan(planID);

    return {
      success: true,
      result: {
        planID: plan.planID,
        goal: plan.goal,
        status: plan.status,
        revision: plan.revision,
        stateJson: plan.stateJson,
        tasks: plan.tasks.map((t) => ({
          taskID: t.taskID,
          description: t.description,
          status: t.status,
          result: t.result,
          runID: t.runID,
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
      agentID: context.agentID,
    });

    return {
      success: true,
      result: plans.map((p) => ({
        planID: p.planID,
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
    if (!args.planID || !args.taskID || !args.status) {
      return {
        success: false,
        error: 'planID, taskID, and status are required for update_task',
      };
    }

    const plan = await this.tasksService.updateTask(
      args.planID,
      args.taskID,
      {
        status: args.status,
        result: args.result,
        runID: args.runID,
        waitMeta: args.waitMeta,
      },
      args.expectedRevision,
    );

    return {
      success: true,
      result: {
        planID: args.planID,
        taskID: args.taskID,
        status: args.status,
        revision: plan.revision,
      },
    };
  }

  private async cancelPlan(planID?: string): Promise<ToolExecutionResult> {
    if (!planID) {
      return { success: false, error: 'planID is required for cancel_plan' };
    }

    const plan = await this.tasksService.cancelPlan(planID);

    return {
      success: true,
      result: {
        planID: plan.planID,
        status: plan.status,
        revision: plan.revision,
      },
    };
  }

  private async setState(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.planID || !args.key) {
      return {
        success: false,
        error: 'planID and key are required for set_state',
      };
    }

    const plan = await this.tasksService.setState(
      args.planID,
      args.key,
      args.value,
      args.expectedRevision,
    );

    return {
      success: true,
      result: { planID: args.planID, key: args.key, revision: plan.revision },
    };
  }

  private async getState(planID?: string): Promise<ToolExecutionResult> {
    if (!planID) {
      return { success: false, error: 'planID is required for get_state' };
    }

    const state = await this.tasksService.getState(planID);

    return { success: true, result: state };
  }

  private async deletePlan(planID?: string): Promise<ToolExecutionResult> {
    if (!planID) {
      return { success: false, error: 'planID is required for delete_plan' };
    }

    const deleted = await this.tasksService.deletePlan(planID);
    if (!deleted) {
      return { success: false, error: `Plan "${planID}" not found` };
    }

    return { success: true, result: { deleted: planID } };
  }
}
