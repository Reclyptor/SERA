import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface SelfConfigAgentsLike {
  findById(agentId: string): Promise<{
    agentId: string;
    name: string;
    description: string;
    personality?: string;
    enabled: boolean;
  } | null>;
  update(
    agentId: string,
    dto: { personality?: string; description?: string },
  ): Promise<unknown>;
}

export interface SelfConfigHeartbeatLike {
  findByAgent(agentId: string): Promise<{
    agentId: string;
    intervalMinutes: number;
    activeHours?: { start: number; end: number; timezone?: string };
    checklist: string[];
    maxTokens: number;
    enabled: boolean;
  } | null>;
  create(data: {
    agentId: string;
    intervalMinutes?: number;
    activeHours?: { start: number; end: number; timezone?: string };
    checklist?: string[];
    enabled?: boolean;
  }): Promise<unknown>;
  update(
    agentId: string,
    data: Partial<{
      intervalMinutes: number;
      activeHours: { start: number; end: number; timezone?: string };
      checklist: string[];
      enabled: boolean;
    }>,
  ): Promise<unknown>;
}

export interface SelfConfigSkillsLike {
  create(dto: {
    skillId: string;
    name: string;
    description: string;
    content: string;
    triggerTools?: string[];
    triggerKeywords?: string[];
    agentIds?: string[];
    priority?: number;
    enabled?: boolean;
  }): Promise<{ skillId: string; name: string }>;
  findAll(): Promise<
    Array<{
      skillId: string;
      name: string;
      description: string;
      agentIds: string[];
      enabled: boolean;
    }>
  >;
  update(
    skillId: string,
    dto: {
      name?: string;
      description?: string;
      content?: string;
      triggerTools?: string[];
      triggerKeywords?: string[];
      priority?: number;
      enabled?: boolean;
    },
  ): Promise<unknown>;
  remove(skillId: string): Promise<boolean>;
}

const parameters = z.object({
  operation: z
    .enum([
      'get_config',
      'update_personality',
      'get_heartbeat',
      'update_heartbeat',
      'list_skills',
      'create_skill',
      'update_skill',
      'delete_skill',
    ])
    .describe('Operation to perform on own agent configuration'),
  personality: z
    .string()
    .optional()
    .describe('New personality text (for update_personality)'),
  description: z
    .string()
    .optional()
    .describe('New agent description (for update_personality)'),
  heartbeat: z
    .object({
      intervalMinutes: z.number().optional(),
      activeHours: z
        .object({
          start: z.number(),
          end: z.number(),
          timezone: z.string().optional(),
        })
        .optional(),
      checklist: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    })
    .optional()
    .describe('Heartbeat settings (for update_heartbeat)'),
  skill: z
    .object({
      skillId: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      content: z.string().optional(),
      triggerTools: z.array(z.string()).optional(),
      triggerKeywords: z.array(z.string()).optional(),
      priority: z.number().optional(),
      enabled: z.boolean().optional(),
    })
    .optional()
    .describe('Skill data (for create_skill, update_skill, delete_skill)'),
});

export class AgentConfigTool implements Tool<typeof parameters> {
  readonly name = 'agent_config';
  readonly description =
    'View and modify your own agent configuration: personality, heartbeat schedule, and skills. Cannot change tool access or other agents.';
  readonly parameters = parameters;

  constructor(
    private readonly agents: SelfConfigAgentsLike,
    private readonly heartbeat: SelfConfigHeartbeatLike,
    private readonly skills: SelfConfigSkillsLike,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const agentId = context.agentId;

    try {
      switch (args.operation) {
        case 'get_config':
          return await this.getConfig(agentId);
        case 'update_personality':
          return await this.updatePersonality(agentId, args);
        case 'get_heartbeat':
          return await this.getHeartbeat(agentId);
        case 'update_heartbeat':
          return await this.updateHeartbeat(agentId, args);
        case 'list_skills':
          return await this.listSkills(agentId);
        case 'create_skill':
          return await this.createSkill(agentId, args);
        case 'update_skill':
          return await this.updateSkill(args);
        case 'delete_skill':
          return await this.deleteSkill(args);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Config operation failed',
      };
    }
  }

  private async getConfig(agentId: string): Promise<ToolExecutionResult> {
    const config = await this.agents.findById(agentId);
    if (!config) {
      return { success: false, error: `Agent "${agentId}" not found` };
    }
    return {
      success: true,
      result: {
        agentId: config.agentId,
        name: config.name,
        description: config.description,
        personality: config.personality,
        enabled: config.enabled,
      },
    };
  }

  private async updatePersonality(
    agentId: string,
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    const update: Record<string, string> = {};
    if (args.personality !== undefined) update.personality = args.personality;
    if (args.description !== undefined) update.description = args.description;

    if (Object.keys(update).length === 0) {
      return {
        success: false,
        error: 'Provide personality and/or description to update',
      };
    }

    await this.agents.update(agentId, update);
    return { success: true, result: { agentId, updated: Object.keys(update) } };
  }

  private async getHeartbeat(agentId: string): Promise<ToolExecutionResult> {
    const config = await this.heartbeat.findByAgent(agentId);
    if (!config) {
      return {
        success: true,
        result: { agentId, heartbeat: null, message: 'No heartbeat configured' },
      };
    }
    return { success: true, result: config };
  }

  private async updateHeartbeat(
    agentId: string,
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.heartbeat) {
      return { success: false, error: 'heartbeat object is required' };
    }

    const existing = await this.heartbeat.findByAgent(agentId);
    if (!existing) {
      await this.heartbeat.create({
        agentId,
        ...args.heartbeat,
      });
      return { success: true, result: { agentId, action: 'created' } };
    }

    await this.heartbeat.update(agentId, args.heartbeat);
    return { success: true, result: { agentId, action: 'updated' } };
  }

  private async listSkills(agentId: string): Promise<ToolExecutionResult> {
    const all = await this.skills.findAll();
    const mine = all.filter(
      (s) => s.agentIds.length === 0 || s.agentIds.includes(agentId),
    );
    return {
      success: true,
      result: mine.map((s) => ({
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        scoped: s.agentIds.includes(agentId),
        enabled: s.enabled,
      })),
    };
  }

  private async createSkill(
    agentId: string,
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name || !args.skill?.content) {
      return {
        success: false,
        error: 'skill.name and skill.content are required for create_skill',
      };
    }

    const skill = await this.skills.create({
      skillId: args.skill.skillId ?? crypto.randomUUID(),
      name: args.skill.name,
      description: args.skill.description ?? '',
      content: args.skill.content,
      triggerTools: args.skill.triggerTools,
      triggerKeywords: args.skill.triggerKeywords,
      agentIds: [agentId],
      priority: args.skill.priority,
      enabled: args.skill.enabled,
    });

    return {
      success: true,
      result: { skillId: skill.skillId, name: skill.name, agentId },
    };
  }

  private async updateSkill(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.skillId) {
      return { success: false, error: 'skill.skillId is required for update_skill' };
    }

    const { skillId, ...rest } = args.skill;
    await this.skills.update(skillId, rest);
    return { success: true, result: { skillId, updated: true } };
  }

  private async deleteSkill(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.skillId) {
      return { success: false, error: 'skill.skillId is required for delete_skill' };
    }

    const deleted = await this.skills.remove(args.skill.skillId);
    if (!deleted) {
      return { success: false, error: `Skill "${args.skill.skillId}" not found` };
    }
    return { success: true, result: { deleted: args.skill.skillId } };
  }
}
