import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface SelfConfigAgentsLike {
  findByID(agentID: string): Promise<{
    agentID: string;
    name: string;
    description: string;
    promptSlug?: string;
    enabled: boolean;
  } | null>;
  update(
    agentID: string,
    dto: { promptSlug?: string; description?: string },
  ): Promise<unknown>;
}

export interface SelfConfigHeartbeatLike {
  findByAgent(agentID: string): Promise<{
    agentID: string;
    intervalMinutes: number;
    activeHours?: { start: number; end: number; timezone?: string };
    checklist: string[];
    maxTokens: number;
    enabled: boolean;
  } | null>;
  create(data: {
    agentID: string;
    intervalMinutes?: number;
    activeHours?: { start: number; end: number; timezone?: string };
    checklist?: string[];
    enabled?: boolean;
  }): Promise<unknown>;
  update(
    agentID: string,
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
    name: string;
    displayName?: string;
    description: string;
    content: string;
    allowedTools?: string[];
    triggerKeywords?: string[];
    agentIDs?: string[];
    priority?: number;
    enabled?: boolean;
  }): Promise<{ name: string; displayName?: string }>;
  findAll(): Promise<
    Array<{
      name: string;
      displayName?: string;
      description: string;
      agentIDs: string[];
      enabled: boolean;
    }>
  >;
  update(
    name: string,
    dto: {
      displayName?: string;
      description?: string;
      content?: string;
      allowedTools?: string[];
      triggerKeywords?: string[];
      priority?: number;
      enabled?: boolean;
    },
  ): Promise<unknown>;
  remove(name: string): Promise<boolean>;
}

const parameters = z.object({
  operation: z
    .enum([
      'get_config',
      'update_config',
      'get_heartbeat',
      'update_heartbeat',
      'list_skills',
      'create_skill',
      'update_skill',
      'delete_skill',
    ])
    .describe('Operation to perform on own agent configuration'),
  promptSlug: z
    .string()
    .optional()
    .describe('Prompt slug to use for this agent (for update_config)'),
  description: z
    .string()
    .optional()
    .describe('New agent description (for update_config)'),
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
      name: z.string().optional(),
      displayName: z.string().optional(),
      description: z.string().optional(),
      content: z.string().optional(),
      allowedTools: z.array(z.string()).optional(),
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
    const agentID = context.agentID;

    try {
      switch (args.operation) {
        case 'get_config':
          return await this.getConfig(agentID);
        case 'update_config':
          return await this.updateConfig(agentID, args);
        case 'get_heartbeat':
          return await this.getHeartbeat(agentID);
        case 'update_heartbeat':
          return await this.updateHeartbeat(agentID, args);
        case 'list_skills':
          return await this.listSkills(agentID);
        case 'create_skill':
          return await this.createSkill(agentID, args);
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

  private async getConfig(agentID: string): Promise<ToolExecutionResult> {
    const config = await this.agents.findByID(agentID);
    if (!config) {
      return { success: false, error: `Agent "${agentID}" not found` };
    }
    return {
      success: true,
      result: {
        agentID: config.agentID,
        name: config.name,
        description: config.description,
        promptSlug: config.promptSlug,
        enabled: config.enabled,
      },
    };
  }

  private async updateConfig(
    agentID: string,
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    const update: Record<string, string> = {};
    if (args.promptSlug !== undefined) update.promptSlug = args.promptSlug;
    if (args.description !== undefined) update.description = args.description;

    if (Object.keys(update).length === 0) {
      return {
        success: false,
        error: 'Provide promptSlug and/or description to update',
      };
    }

    await this.agents.update(agentID, update);
    return { success: true, result: { agentID, updated: Object.keys(update) } };
  }

  private async getHeartbeat(agentID: string): Promise<ToolExecutionResult> {
    const config = await this.heartbeat.findByAgent(agentID);
    if (!config) {
      return {
        success: true,
        result: { agentID, heartbeat: null, message: 'No heartbeat configured' },
      };
    }
    return { success: true, result: config };
  }

  private async updateHeartbeat(
    agentID: string,
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.heartbeat) {
      return { success: false, error: 'heartbeat object is required' };
    }

    const existing = await this.heartbeat.findByAgent(agentID);
    if (!existing) {
      await this.heartbeat.create({
        agentID,
        ...args.heartbeat,
      });
      return { success: true, result: { agentID, action: 'created' } };
    }

    await this.heartbeat.update(agentID, args.heartbeat);
    return { success: true, result: { agentID, action: 'updated' } };
  }

  private async listSkills(agentID: string): Promise<ToolExecutionResult> {
    const all = await this.skills.findAll();
    const mine = all.filter(
      (s) => s.agentIDs.length === 0 || s.agentIDs.includes(agentID),
    );
    return {
      success: true,
      result: mine.map((s) => ({
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        scoped: s.agentIDs.includes(agentID),
        enabled: s.enabled,
      })),
    };
  }

  private async createSkill(
    agentID: string,
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name || !args.skill?.content) {
      return {
        success: false,
        error: 'skill.name and skill.content are required for create_skill',
      };
    }

    const skill = await this.skills.create({
      name: args.skill.name,
      displayName: args.skill.displayName,
      description: args.skill.description ?? '',
      content: args.skill.content,
      allowedTools: args.skill.allowedTools,
      triggerKeywords: args.skill.triggerKeywords,
      agentIDs: [agentID],
      priority: args.skill.priority,
      enabled: args.skill.enabled,
    });

    return {
      success: true,
      result: { name: skill.name, agentID },
    };
  }

  private async updateSkill(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name) {
      return { success: false, error: 'skill.name is required for update_skill' };
    }

    const { name, ...rest } = args.skill;
    await this.skills.update(name, rest);
    return { success: true, result: { name, updated: true } };
  }

  private async deleteSkill(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name) {
      return { success: false, error: 'skill.name is required for delete_skill' };
    }

    const deleted = await this.skills.remove(args.skill.name);
    if (!deleted) {
      return { success: false, error: `Skill "${args.skill.name}" not found` };
    }
    return { success: true, result: { deleted: args.skill.name } };
  }
}
