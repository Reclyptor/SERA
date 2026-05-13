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
    parentRunID: string;
    agentID: string;
    goal: string;
    tasks: Array<{ description: string }>;
  }): Promise<TaskPlan> {
    const planID = crypto.randomUUID();
    const tasks: Task[] = data.tasks.map((t, i) => ({
      taskID: crypto.randomUUID(),
      description: t.description,
      status: 'pending',
      order: i,
    }));

    const plan = new this.taskPlanModel({
      planID,
      parentRunID: data.parentRunID,
      agentID: data.agentID,
      goal: data.goal,
      tasks,
      status: 'executing',
    });

    return plan.save();
  }

  async getPlan(planID: string): Promise<TaskPlan> {
    const plan = await this.taskPlanModel.findOne({ planID }).exec();
    if (!plan) {
      throw new NotFoundException(`Plan "${planID}" not found`);
    }
    return plan;
  }

  async listPlans(filters: {
    parentRunID?: string;
    agentID?: string;
  }): Promise<TaskPlan[]> {
    const query: Record<string, unknown> = {};
    if (filters.parentRunID) query.parentRunID = filters.parentRunID;
    if (filters.agentID) query.agentID = filters.agentID;
    return this.taskPlanModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async updateTask(
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
  ): Promise<TaskPlan> {
    const filter: Record<string, unknown> = {
      planID,
      'tasks.taskID': taskID,
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
    if (update.runID !== undefined) {
      setFields['tasks.$.runID'] = update.runID;
    }
    if (update.status === 'waiting' && update.waitMeta) {
      setFields['tasks.$.waitMeta'] = update.waitMeta;
    }
    if (update.status !== 'waiting') {
      setFields['tasks.$.waitMeta'] = null;
    }

    const updateOp: Record<string, unknown> = {
      $set: setFields,
      $inc: { revision: 1 },
    };

    const plan = await this.taskPlanModel
      .findOneAndUpdate(filter, updateOp, { returnDocument: 'after' })
      .exec();

    if (!plan) {
      if (expectedRevision !== undefined) {
        const exists = await this.taskPlanModel
          .findOne({ planID, 'tasks.taskID': taskID })
          .exec();
        if (exists) {
          throw new ConflictException(
            `Revision mismatch: expected ${expectedRevision}, current is ${exists.revision}`,
          );
        }
      }
      throw new NotFoundException(
        `Plan "${planID}" or task "${taskID}" not found`,
      );
    }

    await this.reconcilePlanStatus(plan);
    return plan;
  }

  async cancelPlan(planID: string): Promise<TaskPlan> {
    const plan = await this.taskPlanModel.findOne({ planID }).exec();
    if (!plan) {
      throw new NotFoundException(`Plan "${planID}" not found`);
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
        { planID },
        { $set: bulkUpdates, $inc: { revision: 1 } },
        { returnDocument: 'after' },
      )
      .exec();

    const activeRunIDs = plan.tasks
      .filter((t) => t.status === 'in_progress' && t.runID)
      .map((t) => t.runID!);

    if (activeRunIDs.length > 0) {
      this.logger.warn(
        `Plan "${planID}" cancelled with ${activeRunIDs.length} active run(s): ${activeRunIDs.join(', ')}`,
      );
    }

    return updated!;
  }

  async setState(
    planID: string,
    key: string,
    value: unknown,
    expectedRevision?: number,
  ): Promise<TaskPlan> {
    const filter: Record<string, unknown> = { planID };
    if (expectedRevision !== undefined) {
      filter.revision = expectedRevision;
    }

    const updateOp: Record<string, unknown> = {
      $set: { [`stateJson.${key}`]: value },
      $inc: { revision: 1 },
    };

    const plan = await this.taskPlanModel
      .findOneAndUpdate(filter, updateOp, { returnDocument: 'after' })
      .exec();

    if (!plan) {
      if (expectedRevision !== undefined) {
        const exists = await this.taskPlanModel.findOne({ planID }).exec();
        if (exists) {
          throw new ConflictException(
            `Revision mismatch: expected ${expectedRevision}, current is ${exists.revision}`,
          );
        }
      }
      throw new NotFoundException(`Plan "${planID}" not found`);
    }

    return plan;
  }

  async getState(planID: string): Promise<Record<string, unknown>> {
    const plan = await this.taskPlanModel
      .findOne({ planID })
      .select('stateJson')
      .exec();
    if (!plan) {
      throw new NotFoundException(`Plan "${planID}" not found`);
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
        { planID: plan.planID },
        { $set: { status: newStatus } },
      );
    }
  }

  async deletePlan(planID: string): Promise<boolean> {
    const result = await this.taskPlanModel.deleteOne({ planID }).exec();
    return result.deletedCount > 0;
  }
}
