import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentBinding, AgentBindingDocument } from './agent-binding.schema';
import { AgentConfig, AgentConfigDocument } from './agent-config.schema';

export interface RoutingContext {
  userID?: string;
  chatID?: string;
  threadID?: string;
}

@Injectable()
export class AgentRouterService {
  private readonly logger = new Logger(AgentRouterService.name);

  constructor(
    @InjectModel(AgentBinding.name)
    private readonly bindingModel: Model<AgentBindingDocument>,
    @InjectModel(AgentConfig.name)
    private readonly agentModel: Model<AgentConfigDocument>,
  ) {}

  /**
   * Resolve which agentID should handle a request based on bindings.
   *
   * Resolution order:
   * 1. User binding (bindingType='user', bindingValue=userID)
   * 2. Channel binding (bindingType='channel', bindingValue=chatID or threadID)
   * 3. Default binding (bindingType='default')
   * 4. null (use built-in default — no agent config)
   *
   * Each tier filters both the binding's `enabled` flag and the target
   * agent's `enabled` flag. A binding to a disabled agent falls through
   * to the next tier as if the binding did not exist.
   */
  async resolve(context: RoutingContext): Promise<string | null> {
    if (context.userID) {
      const userBinding = await this.findEnabledBinding('user', context.userID);
      if (userBinding) {
        this.logger.debug(
          `Routed to agent "${userBinding.agentID}" via user binding`,
        );
        return userBinding.agentID;
      }
    }

    const channelID = context.chatID ?? context.threadID;
    if (channelID) {
      const channelBinding = await this.findEnabledBinding(
        'channel',
        channelID,
      );
      if (channelBinding) {
        this.logger.debug(
          `Routed to agent "${channelBinding.agentID}" via channel binding`,
        );
        return channelBinding.agentID;
      }
    }

    const defaultBinding = await this.findEnabledBinding('default');
    if (defaultBinding) {
      this.logger.debug(
        `Routed to agent "${defaultBinding.agentID}" via default binding`,
      );
      return defaultBinding.agentID;
    }

    return null;
  }

  private async findEnabledBinding(
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

    // Iterate in priority order — the first binding whose target agent is
    // also enabled wins. Disabled targets are skipped so a user-binding to
    // a deactivated agent falls through to channel/default tiers instead
    // of routing into an agent that should not be receiving traffic.
    const bindings = await this.bindingModel
      .find(filter)
      .sort({ priority: -1 })
      .exec();

    for (const binding of bindings) {
      const agent = await this.agentModel
        .findOne({ agentID: binding.agentID, enabled: true })
        .exec();
      if (agent) return binding;
    }

    return null;
  }

  // CRUD for bindings

  async createBinding(data: {
    agentID: string;
    bindingType: 'channel' | 'user' | 'default';
    bindingValue?: string;
    priority?: number;
  }): Promise<AgentBinding> {
    const agent = await this.agentModel
      .findOne({ agentID: data.agentID })
      .exec();
    if (!agent) {
      throw new NotFoundException(`Agent "${data.agentID}" not found`);
    }

    const binding = new this.bindingModel({
      bindingID: crypto.randomUUID(),
      agentID: data.agentID,
      bindingType: data.bindingType,
      bindingValue: data.bindingValue,
      priority: data.priority ?? 0,
      enabled: true,
    });
    return binding.save();
  }

  async listBindings(agentID?: string): Promise<AgentBinding[]> {
    const filter = agentID ? { agentID } : {};
    return this.bindingModel.find(filter).sort({ priority: -1 }).exec();
  }

  async removeBinding(bindingID: string): Promise<boolean> {
    const result = await this.bindingModel.deleteOne({ bindingID }).exec();
    return result.deletedCount > 0;
  }
}
