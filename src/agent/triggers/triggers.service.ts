import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Trigger, TriggerDocument } from './trigger.schema';

@Injectable()
export class TriggersService {
  private readonly logger = new Logger(TriggersService.name);

  constructor(
    @InjectModel(Trigger.name)
    private readonly triggerModel: Model<TriggerDocument>,
  ) {}

  async create(data: {
    agentId: string;
    webhookPath: string;
    command: string;
    description?: string;
    secret?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
  }): Promise<Trigger> {
    const triggerId = crypto.randomUUID();

    const trigger = new this.triggerModel({
      triggerId,
      agentId: data.agentId,
      webhookPath: data.webhookPath,
      command: data.command,
      description: data.description ?? '',
      secret: data.secret,
      headers: data.headers,
      enabled: data.enabled ?? true,
    });

    return trigger.save();
  }

  async findByPath(webhookPath: string): Promise<Trigger | null> {
    return this.triggerModel.findOne({ webhookPath, enabled: true }).exec();
  }

  async findById(triggerId: string): Promise<Trigger | null> {
    return this.triggerModel.findOne({ triggerId }).exec();
  }

  async findAll(agentId?: string): Promise<Trigger[]> {
    const filter = agentId ? { agentId } : {};
    return this.triggerModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async update(
    triggerId: string,
    data: Partial<{
      command: string;
      description: string;
      secret: string;
      headers: Record<string, string>;
      enabled: boolean;
    }>,
  ): Promise<Trigger | null> {
    return this.triggerModel
      .findOneAndUpdate({ triggerId }, { $set: data }, { new: true })
      .exec();
  }

  async remove(triggerId: string): Promise<boolean> {
    const result = await this.triggerModel.deleteOne({ triggerId }).exec();
    return result.deletedCount > 0;
  }

  async recordExecution(triggerId: string): Promise<void> {
    await this.triggerModel.updateOne(
      { triggerId },
      {
        $inc: { executionCount: 1 },
        $set: { lastTriggeredAt: new Date() },
      },
    );
  }
}
