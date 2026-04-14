import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentBinding, AgentBindingDocument } from './agent-binding.schema';

export interface RoutingContext {
  userId?: string;
  chatId?: string;
  threadId?: string;
}

@Injectable()
export class AgentRouterService {
  private readonly logger = new Logger(AgentRouterService.name);

  constructor(
    @InjectModel(AgentBinding.name)
    private readonly bindingModel: Model<AgentBindingDocument>,
  ) {}

  /**
   * Resolve which agentId should handle a request based on bindings.
   *
   * Resolution order:
   * 1. User binding (bindingType='user', bindingValue=userId)
   * 2. Channel binding (bindingType='channel', bindingValue=chatId or threadId)
   * 3. Default binding (bindingType='default')
   * 4. null (use built-in default — no agent config)
   */
  async resolve(context: RoutingContext): Promise<string | null> {
    // 1. User binding
    if (context.userId) {
      const userBinding = await this.findBinding('user', context.userId);
      if (userBinding) {
        this.logger.debug(
          `Routed to agent "${userBinding.agentId}" via user binding`,
        );
        return userBinding.agentId;
      }
    }

    // 2. Channel binding (try chatId first, then threadId)
    const channelId = context.chatId ?? context.threadId;
    if (channelId) {
      const channelBinding = await this.findBinding('channel', channelId);
      if (channelBinding) {
        this.logger.debug(
          `Routed to agent "${channelBinding.agentId}" via channel binding`,
        );
        return channelBinding.agentId;
      }
    }

    // 3. Default binding
    const defaultBinding = await this.findBinding('default');
    if (defaultBinding) {
      this.logger.debug(
        `Routed to agent "${defaultBinding.agentId}" via default binding`,
      );
      return defaultBinding.agentId;
    }

    // 4. No binding found
    return null;
  }

  private async findBinding(
    type: string,
    value?: string,
  ): Promise<AgentBinding | null> {
    const filter: Record<string, unknown> = {
      bindingType: type,
      enabled: true,
    };
    if (value) {
      filter.bindingValue = value;
    }

    return this.bindingModel
      .findOne(filter)
      .sort({ priority: -1 })
      .exec();
  }

  // CRUD for bindings

  async createBinding(data: {
    agentId: string;
    bindingType: 'channel' | 'user' | 'default';
    bindingValue?: string;
    priority?: number;
  }): Promise<AgentBinding> {
    const binding = new this.bindingModel({
      bindingId: crypto.randomUUID(),
      agentId: data.agentId,
      bindingType: data.bindingType,
      bindingValue: data.bindingValue,
      priority: data.priority ?? 0,
      enabled: true,
    });
    return binding.save();
  }

  async listBindings(agentId?: string): Promise<AgentBinding[]> {
    const filter = agentId ? { agentId } : {};
    return this.bindingModel.find(filter).sort({ priority: -1 }).exec();
  }

  async removeBinding(bindingId: string): Promise<boolean> {
    const result = await this.bindingModel
      .deleteOne({ bindingId })
      .exec();
    return result.deletedCount > 0;
  }
}
