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
    description: string;
    content: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string[];
    metadata?: Record<string, string>;
  }): Promise<{ name: string }>;
  findAll(): Promise<
    Array<{
      name: string;
      description: string;
    }>
  >;
  update(
    name: string,
    dto: {
      description?: string;
      content?: string;
      license?: string;
      compatibility?: string;
      allowedTools?: string[];
      metadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  findByName(name: string): Promise<{
    name: string;
    description: string;
    content: string;
    license?: string;
    compatibility?: string;
    allowedTools: string[];
    metadata?: Record<string, string>;
    files: { path: string }[];
  } | null>;
  remove(name: string): Promise<boolean>;
  listFiles(name: string): Promise<string[]>;
  findFile(name: string, filePath: string): Promise<string | null>;
  addFile(name: string, filePath: string, content: string): Promise<void>;
  updateFile(name: string, filePath: string, content: string): Promise<void>;
  removeFile(name: string, filePath: string): Promise<void>;
}

const parameters = z.object({
  operation: z
    .enum([
      'get_config',
      'update_config',
      'get_heartbeat',
      'update_heartbeat',
      'list_skills',
      'get_skill',
      'create_skill',
      'update_skill',
      'delete_skill',
      'list_skill_files',
      'read_skill_file',
      'add_skill_file',
      'update_skill_file',
      'remove_skill_file',
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
      description: z.string().optional(),
      content: z.string().optional(),
      license: z.string().optional(),
      compatibility: z.string().optional(),
      allowedTools: z.array(z.string()).optional(),
      metadata: z.record(z.string()).optional(),
    })
    .optional()
    .describe('Skill data (for create_skill, update_skill, delete_skill)'),
  filePath: z
    .string()
    .optional()
    .describe('File path within a skill (for skill file operations)'),
  fileContent: z
    .string()
    .optional()
    .describe('File content (for add_skill_file, update_skill_file)'),
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
        case 'get_skill':
          return await this.getSkill(args);
        case 'create_skill':
          return await this.createSkill(agentID, args);
        case 'update_skill':
          return await this.updateSkill(args);
        case 'delete_skill':
          return await this.deleteSkill(args);
        case 'list_skill_files':
          return await this.listSkillFiles(args);
        case 'read_skill_file':
          return await this.readSkillFile(args);
        case 'add_skill_file':
          return await this.addSkillFile(args);
        case 'update_skill_file':
          return await this.updateSkillFile(args);
        case 'remove_skill_file':
          return await this.removeSkillFile(args);
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
    return {
      success: true,
      result: all.map((s) => ({
        name: s.name,
        description: s.description,
      })),
    };
  }

  private async getSkill(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name) {
      return { success: false, error: 'skill.name is required for get_skill' };
    }

    const skill = await this.skills.findByName(args.skill.name);
    if (!skill) {
      return { success: false, error: `Skill "${args.skill.name}" not found` };
    }

    return {
      success: true,
      result: {
        name: skill.name,
        description: skill.description,
        content: skill.content,
        license: skill.license,
        compatibility: skill.compatibility,
        allowedTools: skill.allowedTools,
        metadata: skill.metadata,
        files: skill.files.map((f) => f.path),
      },
    };
  }

  private async createSkill(
    _agentID: string,
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
      description: args.skill.description ?? '',
      content: args.skill.content,
      license: args.skill.license,
      compatibility: args.skill.compatibility,
      allowedTools: args.skill.allowedTools,
      metadata: args.skill.metadata,
    });

    return {
      success: true,
      result: { name: skill.name },
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

  private async listSkillFiles(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name) {
      return { success: false, error: 'skill.name is required for list_skill_files' };
    }

    const files = await this.skills.listFiles(args.skill.name);
    return { success: true, result: { name: args.skill.name, files } };
  }

  private async readSkillFile(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name || !args.filePath) {
      return { success: false, error: 'skill.name and filePath are required for read_skill_file' };
    }

    const content = await this.skills.findFile(args.skill.name, args.filePath);
    if (content === null) {
      return { success: false, error: `File "${args.filePath}" not found in skill "${args.skill.name}"` };
    }
    return { success: true, result: { name: args.skill.name, filePath: args.filePath, content } };
  }

  private async addSkillFile(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name || !args.filePath || args.fileContent === undefined) {
      return { success: false, error: 'skill.name, filePath, and fileContent are required for add_skill_file' };
    }

    await this.skills.addFile(args.skill.name, args.filePath, args.fileContent);
    return { success: true, result: { name: args.skill.name, filePath: args.filePath, action: 'added' } };
  }

  private async updateSkillFile(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name || !args.filePath || args.fileContent === undefined) {
      return { success: false, error: 'skill.name, filePath, and fileContent are required for update_skill_file' };
    }

    await this.skills.updateFile(args.skill.name, args.filePath, args.fileContent);
    return { success: true, result: { name: args.skill.name, filePath: args.filePath, action: 'updated' } };
  }

  private async removeSkillFile(
    args: z.infer<typeof parameters>,
  ): Promise<ToolExecutionResult> {
    if (!args.skill?.name || !args.filePath) {
      return { success: false, error: 'skill.name and filePath are required for remove_skill_file' };
    }

    await this.skills.removeFile(args.skill.name, args.filePath);
    return { success: true, result: { name: args.skill.name, filePath: args.filePath, action: 'removed' } };
  }
}
