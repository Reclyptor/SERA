import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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
      status: 'pending' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'skipped';
      result?: string;
      runId?: string;
      waitMeta?: Record<string, unknown>;
    },
    expectedRevision?: number,
  ): Promise<TaskPlan> {
    const filter: Record<string, unknown> = {
      planId,
      'tasks.taskId': taskId,
    };
    if (expectedRevision !== undefined) {
      filter.revision = expectedRevision;
    }

    const setFields: Record<string, unknown> = {
      'tasks.$.status': update.status,
    };
    if (update.result !== undefined) {
      setFields['tasks.$.result'] = update.result;
    }
    if (update.runId !== undefined) {
      setFields['tasks.$.runId'] = update.runId;
    }
    if (update.status === 'waiting' && update.waitMeta) {
      setFields['tasks.$.waitMeta'] = update.waitMeta;
    }
    if (update.status !== 'waiting') {
      setFields['tasks.$.waitMeta'] = null;
    }

    const updateOp: Record<string, unknown> = { $set: setFields };
    if (expectedRevision !== undefined) {
      updateOp.$inc = { revision: 1 };
    }

    const plan = await this.taskPlanModel
      .findOneAndUpdate(filter, updateOp, { returnDocument: 'after' })
      .exec();

    if (!plan) {
      if (expectedRevision !== undefined) {
        const exists = await this.taskPlanModel
          .findOne({ planId, 'tasks.taskId': taskId })
          .exec();
        if (exists) {
          throw new ConflictException(
            `Revision mismatch: expected ${expectedRevision}, current is ${exists.revision}`,
          );
        }
      }
      throw new NotFoundException(
        `Plan "${planId}" or task "${taskId}" not found`,
      );
    }

    await this.reconcilePlanStatus(plan);
    return plan;
  }

  async cancelPlan(planId: string): Promise<TaskPlan> {
    const plan = await this.taskPlanModel.findOne({ planId }).exec();
    if (!plan) {
      throw new NotFoundException(`Plan "${planId}" not found`);
    }

    if (['completed', 'failed', 'cancelled'].includes(plan.status)) {
      return plan;
    }

    const bulkUpdates: Record<string, unknown> = {
      status: 'cancelled',
    };

    const pendingIndices: number[] = [];
    plan.tasks.forEach((t, i) => {
      if (['pending', 'waiting'].includes(t.status)) {
        pendingIndices.push(i);
      }
    });

    for (const idx of pendingIndices) {
      bulkUpdates[`tasks.${idx}.status`] = 'skipped';
      bulkUpdates[`tasks.${idx}.waitMeta`] = null;
    }

    const updated = await this.taskPlanModel
      .findOneAndUpdate(
        { planId },
        { $set: bulkUpdates, $inc: { revision: 1 } },
        { returnDocument: 'after' },
      )
      .exec();

    const activeRunIds = plan.tasks
      .filter((t) => t.status === 'in_progress' && t.runId)
      .map((t) => t.runId!);

    if (activeRunIds.length > 0) {
      this.logger.warn(
        `Plan "${planId}" cancelled with ${activeRunIds.length} active run(s): ${activeRunIds.join(', ')}`,
      );
    }

    return updated!;
  }

  async setState(
    planId: string,
    key: string,
    value: unknown,
    expectedRevision?: number,
  ): Promise<TaskPlan> {
    const filter: Record<string, unknown> = { planId };
    if (expectedRevision !== undefined) {
      filter.revision = expectedRevision;
    }

    const updateOp: Record<string, unknown> = {
      $set: { [`stateJson.${key}`]: value },
    };
    if (expectedRevision !== undefined) {
      updateOp.$inc = { revision: 1 };
    }

    const plan = await this.taskPlanModel
      .findOneAndUpdate(filter, updateOp, { returnDocument: 'after' })
      .exec();

    if (!plan) {
      if (expectedRevision !== undefined) {
        const exists = await this.taskPlanModel.findOne({ planId }).exec();
        if (exists) {
          throw new ConflictException(
            `Revision mismatch: expected ${expectedRevision}, current is ${exists.revision}`,
          );
        }
      }
      throw new NotFoundException(`Plan "${planId}" not found`);
    }

    return plan;
  }

  async getState(planId: string): Promise<Record<string, unknown>> {
    const plan = await this.taskPlanModel
      .findOne({ planId })
      .select('stateJson')
      .exec();
    if (!plan) {
      throw new NotFoundException(`Plan "${planId}" not found`);
    }
    return plan.stateJson ?? {};
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
