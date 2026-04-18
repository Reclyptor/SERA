import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TaskPlan, TaskPlanDocument, Task } from './task.schema';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectModel(TaskPlan.name)
    private readonly taskPlanModel: Model<TaskPlanDocument>,
  ) {}

  async createPlan(data: {
    parentRunId: string;
    agentId: string;
    goal: string;
    tasks: Array<{ description: string }>;
  }): Promise<TaskPlan> {
    const planId = crypto.randomUUID();
    const tasks: Task[] = data.tasks.map((t, i) => ({
      taskId: crypto.randomUUID(),
      description: t.description,
      status: 'pending',
      order: i,
    }));

    const plan = new this.taskPlanModel({
      planId,
      parentRunId: data.parentRunId,
      agentId: data.agentId,
      goal: data.goal,
      tasks,
      status: 'executing',
    });

    return plan.save();
  }

  async getPlan(planId: string): Promise<TaskPlan> {
    const plan = await this.taskPlanModel.findOne({ planId }).exec();
    if (!plan) {
      throw new NotFoundException(`Plan "${planId}" not found`);
    }
    return plan;
  }

  async listPlans(filters: {
    parentRunId?: string;
    agentId?: string;
  }): Promise<TaskPlan[]> {
    const query: Record<string, unknown> = {};
    if (filters.parentRunId) query.parentRunId = filters.parentRunId;
    if (filters.agentId) query.agentId = filters.agentId;
    return this.taskPlanModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async updateTask(
    planId: string,
    taskId: string,
    update: {
      status: 'in_progress' | 'completed' | 'failed' | 'skipped';
      result?: string;
      runId?: string;
    },
  ): Promise<TaskPlan> {
    const setFields: Record<string, unknown> = {
      'tasks.$.status': update.status,
    };
    if (update.result !== undefined) {
      setFields['tasks.$.result'] = update.result;
    }
    if (update.runId !== undefined) {
      setFields['tasks.$.runId'] = update.runId;
    }

    const plan = await this.taskPlanModel
      .findOneAndUpdate(
        { planId, 'tasks.taskId': taskId },
        { $set: setFields },
        { returnDocument: 'after' },
      )
      .exec();

    if (!plan) {
      throw new NotFoundException(
        `Plan "${planId}" or task "${taskId}" not found`,
      );
    }

    await this.reconcilePlanStatus(plan);
    return plan;
  }

  private async reconcilePlanStatus(plan: TaskPlanDocument): Promise<void> {
    const allDone = plan.tasks.every((t) =>
      ['completed', 'failed', 'skipped'].includes(t.status),
    );

    if (!allDone) return;

    const anyFailed = plan.tasks.some((t) => t.status === 'failed');
    const newStatus = anyFailed ? 'failed' : 'completed';

    if (plan.status !== newStatus) {
      await this.taskPlanModel.updateOne(
        { planId: plan.planId },
        { $set: { status: newStatus } },
      );
    }
  }

  async deletePlan(planId: string): Promise<boolean> {
    const result = await this.taskPlanModel.deleteOne({ planId }).exec();
    return result.deletedCount > 0;
  }
}
