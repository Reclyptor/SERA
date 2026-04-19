import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AgentConfig,
  AgentConfigDocument,
  ToolPolicy,
} from './agent-config.schema';
import type { CreateAgentDto, UpdateAgentDto } from './agents.dto';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectModel(AgentConfig.name)
    private readonly agentModel: Model<AgentConfigDocument>,
  ) {}

  async create(dto: CreateAgentDto): Promise<AgentConfig> {
    const agent = new this.agentModel({
      agentID: dto.agentID,
      name: dto.name,
      description: dto.description ?? '',
      systemPrompt: dto.systemPrompt,
      personality: dto.personality,
      modelOptions: dto.modelOptions,
      toolPolicy: dto.toolPolicy ?? { mode: 'deny', tools: [] },
      workspaceDir: dto.workspaceDir,
      messagingPolicy: dto.messagingPolicy ?? {
        enabled: false,
        allowedAgents: [],
      },
      sandboxConfig: dto.sandboxConfig,
      enabled: dto.enabled ?? true,
    });
    return agent.save();
  }

  async findAll(): Promise<AgentConfig[]> {
    return this.agentModel.find().sort({ createdAt: 1 }).exec();
  }

  async findEnabled(): Promise<AgentConfig[]> {
    return this.agentModel
      .find({ enabled: true })
      .sort({ createdAt: 1 })
      .exec();
  }

  async findByID(agentID: string): Promise<AgentConfig | null> {
    return this.agentModel.findOne({ agentID }).exec();
  }

  async findByIDOrThrow(agentID: string): Promise<AgentConfig> {
    const agent = await this.findByID(agentID);
    if (!agent) {
      throw new NotFoundException(`Agent "${agentID}" not found`);
    }
    return agent;
  }

  async update(
    agentID: string,
    dto: UpdateAgentDto,
  ): Promise<AgentConfig> {
    const agent = await this.agentModel
      .findOneAndUpdate({ agentID }, { $set: dto }, { new: true })
      .exec();
    if (!agent) {
      throw new NotFoundException(`Agent "${agentID}" not found`);
    }
    return agent;
  }

  async remove(agentID: string): Promise<boolean> {
    const result = await this.agentModel.deleteOne({ agentID }).exec();
    return result.deletedCount > 0;
  }

  async getToolPolicy(agentID: string): Promise<ToolPolicy | null> {
    const agent = await this.findByID(agentID);
    return agent?.toolPolicy ?? null;
  }
}
