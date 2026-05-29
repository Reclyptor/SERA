import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  AgentConfig,
  AgentConfigDocument,
  ToolPolicy,
} from './agent-config.schema';
import type { CreateAgentDto, UpdateAgentDto } from './agents.dto';

const CACHE_TTL_SECONDS = 300;
const LIST_KEY = 'agent:catalog';
const ENABLED_KEY = 'agent:catalog:enabled';
const AGENT_KEY = (agentID: string) => `agent:${agentID}`;

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectModel(AgentConfig.name)
    private readonly agentModel: Model<AgentConfigDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async create(dto: CreateAgentDto): Promise<AgentConfig> {
    const agent = new this.agentModel({
      agentID: dto.agentID,
      name: dto.name,
      description: dto.description ?? '',
      promptSlug: dto.promptSlug,
      modelOptions: dto.modelOptions,
      toolPolicy: dto.toolPolicy ?? { mode: 'deny', tools: [] },
      messagingPolicy: dto.messagingPolicy ?? {
        enabled: false,
        allowedAgents: [],
      },
      sandboxConfig: dto.sandboxConfig,
      enabled: dto.enabled ?? true,
    });
    const saved = await agent.save();
    await this.invalidate(dto.agentID);
    return saved;
  }

  async findAll(): Promise<AgentConfig[]> {
    const cached = await this.readListCache(LIST_KEY);
    if (cached) return cached;
    const docs = await this.agentModel
      .find()
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await this.writeListCache(LIST_KEY, docs);
    return docs;
  }

  async findEnabled(): Promise<AgentConfig[]> {
    const cached = await this.readListCache(ENABLED_KEY);
    if (cached) return cached;
    const docs = await this.agentModel
      .find({ enabled: true })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await this.writeListCache(ENABLED_KEY, docs);
    return docs;
  }

  async findByID(agentID: string): Promise<AgentConfig | null> {
    const raw = await this.redis.get(AGENT_KEY(agentID));
    if (raw) {
      try {
        return JSON.parse(raw) as AgentConfig;
      } catch {
        // fall through and refetch
      }
    }
    const doc = await this.agentModel.findOne({ agentID }).lean().exec();
    if (doc) {
      await this.redis.set(
        AGENT_KEY(agentID),
        JSON.stringify(doc),
        'EX',
        CACHE_TTL_SECONDS,
      );
    }
    return doc;
  }

  async findByIDOrThrow(agentID: string): Promise<AgentConfig> {
    const agent = await this.findByID(agentID);
    if (!agent) {
      throw new NotFoundException(`Agent "${agentID}" not found`);
    }
    return agent;
  }

  async isValidActiveAgent(agentID: string): Promise<boolean> {
    const agent = await this.findByID(agentID);
    return !!agent && agent.enabled !== false;
  }

  async update(agentID: string, dto: UpdateAgentDto): Promise<AgentConfig> {
    const agent = await this.agentModel
      .findOneAndUpdate({ agentID }, { $set: dto }, { new: true })
      .exec();
    if (!agent) {
      throw new NotFoundException(`Agent "${agentID}" not found`);
    }
    await this.invalidate(agentID);
    return agent;
  }

  async remove(agentID: string): Promise<boolean> {
    const result = await this.agentModel.deleteOne({ agentID }).exec();
    await this.invalidate(agentID);
    return result.deletedCount > 0;
  }

  async getToolPolicy(agentID: string): Promise<ToolPolicy | null> {
    const agent = await this.findByID(agentID);
    return agent?.toolPolicy ?? null;
  }

  private async readListCache(key: string): Promise<AgentConfig[] | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AgentConfig[];
    } catch {
      return null;
    }
  }

  private async writeListCache(key: string, docs: unknown[]): Promise<void> {
    await this.redis.set(key, JSON.stringify(docs), 'EX', CACHE_TTL_SECONDS);
  }

  private async invalidate(agentID?: string): Promise<void> {
    const keys: string[] = [LIST_KEY, ENABLED_KEY];
    if (agentID) keys.push(AGENT_KEY(agentID));
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate agent cache for ${keys.join(', ')}:`,
        err,
      );
    }
  }
}
