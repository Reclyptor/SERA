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
    agentID: string;
    webhookPath: string;
    command: string;
    description?: string;
    secret?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
  }): Promise<Trigger> {
    const triggerID = crypto.randomUUID();

    const trigger = new this.triggerModel({
      triggerID,
      agentID: data.agentID,
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

  async findByID(triggerID: string): Promise<Trigger | null> {
    return this.triggerModel.findOne({ triggerID }).exec();
  }

  async findAll(agentID?: string): Promise<Trigger[]> {
    const filter = agentID ? { agentID } : {};
    return this.triggerModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async update(
    triggerID: string,
    data: Partial<{
      command: string;
      description: string;
      secret: string;
      headers: Record<string, string>;
      enabled: boolean;
    }>,
  ): Promise<Trigger | null> {
    return this.triggerModel
      .findOneAndUpdate({ triggerID }, { $set: data }, { new: true })
      .exec();
  }

  async remove(triggerID: string): Promise<boolean> {
    const result = await this.triggerModel.deleteOne({ triggerID }).exec();
    return result.deletedCount > 0;
  }

  async recordExecution(triggerID: string): Promise<void> {
    await this.triggerModel.updateOne(
      { triggerID },
      {
        $inc: { executionCount: 1 },
        $set: { lastTriggeredAt: new Date() },
      },
    );
  }
}
