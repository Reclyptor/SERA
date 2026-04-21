import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface SkillsServiceLike {
  findAll(): Promise<Array<{ name: string; description: string }>>;
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
  create(dto: {
    name: string;
    description: string;
    content: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string[];
    metadata?: Record<string, string>;
  }): Promise<{ name: string }>;
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
      'list',
      'get',
      'create',
      'update',
      'delete',
      'list_files',
      'read_file',
      'add_file',
      'update_file',
      'remove_file',
    ])
    .describe('Operation to perform'),
  name: z.string().optional().describe('Skill name'),
  description: z.string().optional().describe('Skill description'),
  content: z.string().optional().describe('Skill content (markdown body)'),
  license: z.string().optional().describe('Skill license'),
  compatibility: z.string().optional().describe('Skill compatibility requirements'),
  allowedTools: z.array(z.string()).optional().describe('Pre-approved tools'),
  metadata: z.record(z.string()).optional().describe('Arbitrary key-value metadata'),
  filePath: z.string().optional().describe('File path within a skill'),
  fileContent: z.string().optional().describe('File content'),
});

export class SkillsTool implements Tool<typeof parameters> {
  readonly name = 'skills';
  readonly description =
    'Manage skills: list, read, create, update, delete skills and their reference files.';
  readonly parameters = parameters;

  constructor(private readonly skills: SkillsServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      switch (args.operation) {
        case 'list':
          return await this.list();
        case 'get':
          return await this.get(args);
        case 'create':
          return await this.create(args);
        case 'update':
          return await this.update(args);
        case 'delete':
          return await this.delete(args);
        case 'list_files':
          return await this.listFiles(args);
        case 'read_file':
          return await this.readFile(args);
        case 'add_file':
          return await this.addFile(args);
        case 'update_file':
          return await this.updateFile(args);
        case 'remove_file':
          return await this.removeFile(args);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Skills operation failed',
      };
    }
  }

  private async list(): Promise<ToolExecutionResult> {
    const all = await this.skills.findAll();
    return {
      success: true,
      result: all.map((s) => ({ name: s.name, description: s.description })),
    };
  }

  private async get(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name) {
      return { success: false, error: 'name is required for get' };
    }

    const skill = await this.skills.findByName(args.name);
    if (!skill) {
      return { success: false, error: `Skill "${args.name}" not found` };
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

  private async create(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name || !args.content) {
      return { success: false, error: 'name and content are required for create' };
    }

    const skill = await this.skills.create({
      name: args.name,
      description: args.description ?? '',
      content: args.content,
      license: args.license,
      compatibility: args.compatibility,
      allowedTools: args.allowedTools,
      metadata: args.metadata,
    });

    return { success: true, result: { name: skill.name } };
  }

  private async update(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name) {
      return { success: false, error: 'name is required for update' };
    }

    const dto: Record<string, unknown> = {};
    if (args.description !== undefined) dto.description = args.description;
    if (args.content !== undefined) dto.content = args.content;
    if (args.license !== undefined) dto.license = args.license;
    if (args.compatibility !== undefined) dto.compatibility = args.compatibility;
    if (args.allowedTools !== undefined) dto.allowedTools = args.allowedTools;
    if (args.metadata !== undefined) dto.metadata = args.metadata;

    await this.skills.update(args.name, dto);
    return { success: true, result: { name: args.name, updated: Object.keys(dto) } };
  }

  private async delete(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name) {
      return { success: false, error: 'name is required for delete' };
    }

    const deleted = await this.skills.remove(args.name);
    if (!deleted) {
      return { success: false, error: `Skill "${args.name}" not found` };
    }
    return { success: true, result: { deleted: args.name } };
  }

  private async listFiles(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name) {
      return { success: false, error: 'name is required for list_files' };
    }

    const files = await this.skills.listFiles(args.name);
    return { success: true, result: { name: args.name, files } };
  }

  private async readFile(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name || !args.filePath) {
      return { success: false, error: 'name and filePath are required for read_file' };
    }

    const content = await this.skills.findFile(args.name, args.filePath);
    if (content === null) {
      return { success: false, error: `File "${args.filePath}" not found in skill "${args.name}"` };
    }
    return { success: true, result: { name: args.name, filePath: args.filePath, content } };
  }

  private async addFile(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name || !args.filePath || args.fileContent === undefined) {
      return { success: false, error: 'name, filePath, and fileContent are required for add_file' };
    }

    await this.skills.addFile(args.name, args.filePath, args.fileContent);
    return { success: true, result: { name: args.name, filePath: args.filePath, action: 'added' } };
  }

  private async updateFile(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name || !args.filePath || args.fileContent === undefined) {
      return { success: false, error: 'name, filePath, and fileContent are required for update_file' };
    }

    await this.skills.updateFile(args.name, args.filePath, args.fileContent);
    return { success: true, result: { name: args.name, filePath: args.filePath, action: 'updated' } };
  }

  private async removeFile(args: z.infer<typeof parameters>): Promise<ToolExecutionResult> {
    if (!args.name || !args.filePath) {
      return { success: false, error: 'name and filePath are required for remove_file' };
    }

    await this.skills.removeFile(args.name, args.filePath);
    return { success: true, result: { name: args.name, filePath: args.filePath, action: 'removed' } };
  }
}
