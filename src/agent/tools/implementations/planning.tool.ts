import { z } from 'zod';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../tool.interface';
import type { AgentPlan, AgentStep } from '../../orchestration/orchestration.interfaces';

/**
 * Self-referential planning tools that allow the agent to create, update,
 * and evaluate its own execution plans. These tools interact with the
 * orchestrator's state via a shared plan store.
 */

export type PlanStore = {
  get(runId: string): AgentPlan | undefined;
  set(runId: string, plan: AgentPlan): void;
};

// --- Create Plan ---

const createPlanParams = z.object({
  goal: z.string().describe('The goal this plan aims to achieve'),
  reasoning: z.string().describe('Why this approach was chosen'),
  steps: z
    .array(
      z.object({
        id: z.string().describe('Unique step identifier'),
        description: z.string().describe('What this step accomplishes'),
      }),
    )
    .min(1)
    .describe('Ordered list of steps'),
});

export class CreatePlanTool implements Tool<typeof createPlanParams> {
  readonly name = 'create_plan';
  readonly description =
    'Create an execution plan with ordered steps. Use this to break down a complex task before executing.';
  readonly parameters = createPlanParams;

  constructor(private readonly planStore: PlanStore) {}

  async execute(
    args: z.infer<typeof createPlanParams>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const plan: AgentPlan = {
      goal: args.goal,
      reasoning: args.reasoning,
      steps: args.steps.map((s) => ({
        id: s.id,
        description: s.description,
        status: 'pending' as const,
      })),
    };

    this.planStore.set(context.runId, plan);

    return {
      success: true,
      result: {
        message: 'Plan created',
        totalSteps: plan.steps.length,
        steps: plan.steps,
      },
    };
  }
}

// --- Update Step ---

const updateStepParams = z.object({
  stepId: z.string().describe('ID of the step to update'),
  status: z
    .enum(['in_progress', 'completed', 'failed', 'skipped'])
    .describe('New status'),
  result: z.string().optional().describe('Step result or output'),
  error: z.string().optional().describe('Error message if failed'),
});

export class UpdateStepTool implements Tool<typeof updateStepParams> {
  readonly name = 'update_step';
  readonly description =
    'Update the status of a plan step. Use this to track progress as you execute each step.';
  readonly parameters = updateStepParams;

  constructor(private readonly planStore: PlanStore) {}

  async execute(
    args: z.infer<typeof updateStepParams>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const plan = this.planStore.get(context.runId);
    if (!plan) {
      return { success: false, error: 'No plan exists for this run. Create one first.' };
    }

    const step = plan.steps.find((s) => s.id === args.stepId);
    if (!step) {
      return {
        success: false,
        error: `Step "${args.stepId}" not found. Available: ${plan.steps.map((s) => s.id).join(', ')}`,
      };
    }

    step.status = args.status;
    if (args.result) step.result = args.result;
    if (args.error) step.error = args.error;

    this.planStore.set(context.runId, plan);

    const completed = plan.steps.filter((s) => s.status === 'completed').length;
    const total = plan.steps.length;

    return {
      success: true,
      result: {
        stepId: args.stepId,
        status: args.status,
        progress: `${completed}/${total} steps completed`,
      },
    };
  }
}

// --- Evaluate Progress ---

const evaluateProgressParams = z.object({
  assessment: z
    .string()
    .optional()
    .describe('Optional self-assessment of current progress'),
});

export class EvaluateProgressTool implements Tool<typeof evaluateProgressParams> {
  readonly name = 'evaluate_progress';
  readonly description =
    'Evaluate current plan progress. Returns step statuses and completion percentage.';
  readonly parameters = evaluateProgressParams;

  constructor(private readonly planStore: PlanStore) {}

  async execute(
    _args: z.infer<typeof evaluateProgressParams>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const plan = this.planStore.get(context.runId);
    if (!plan) {
      return { success: false, error: 'No plan exists for this run.' };
    }

    const statusCounts = plan.steps.reduce(
      (acc, step) => {
        acc[step.status] = (acc[step.status] || 0) + 1;
        return acc;
      },
      {} as Record<AgentStep['status'], number>,
    );

    const completed = statusCounts['completed'] || 0;
    const total = plan.steps.length;

    return {
      success: true,
      result: {
        goal: plan.goal,
        progress: `${completed}/${total} (${Math.round((completed / total) * 100)}%)`,
        statusCounts,
        steps: plan.steps,
        allComplete: completed === total,
      },
    };
  }
}
