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
      agentId: dto.agentId,
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

  async findById(agentId: string): Promise<AgentConfig | null> {
    return this.agentModel.findOne({ agentId }).exec();
  }

  async findByIdOrThrow(agentId: string): Promise<AgentConfig> {
    const agent = await this.findById(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent "${agentId}" not found`);
    }
    return agent;
  }

  async update(
    agentId: string,
    dto: UpdateAgentDto,
  ): Promise<AgentConfig> {
    const agent = await this.agentModel
      .findOneAndUpdate({ agentId }, { $set: dto }, { new: true })
      .exec();
    if (!agent) {
      throw new NotFoundException(`Agent "${agentId}" not found`);
    }
    return agent;
  }

  async remove(agentId: string): Promise<boolean> {
    const result = await this.agentModel.deleteOne({ agentId }).exec();
    return result.deletedCount > 0;
  }

  async getToolPolicy(agentId: string): Promise<ToolPolicy | null> {
    const agent = await this.findById(agentId);
    return agent?.toolPolicy ?? null;
  }
}
