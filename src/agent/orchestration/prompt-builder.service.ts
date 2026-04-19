import { Injectable, Logger } from '@nestjs/common';
import { PromptsService } from '../../prompts/prompts.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { SkillsService } from '../skills/skills.service';
import { ToolsService } from '../tools/tools.service';
import { MemoryKnowledgeProvider } from '../knowledge/providers';
import { DEFAULT_SYSTEM_PROMPT } from '../../prompts/defaults';
import type { AgentConfig } from '../../agents/agent-config.schema';

@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  constructor(
    private readonly promptsService: PromptsService,
    private readonly memoryService: MemoryService,
    private readonly knowledgeService: KnowledgeService,
    private readonly skillsService: SkillsService,
    private readonly toolsService: ToolsService,
  ) {}

  async build(
    userID: string,
    query: string,
    agentConfig: AgentConfig,
    frozenMemoryContext?: string,
  ): Promise<string> {
    let basePrompt: string;

    if (agentConfig.systemPrompt) {
      basePrompt = agentConfig.systemPrompt;
    } else {
      try {
        basePrompt =
          (await this.promptsService.get('system')) ?? DEFAULT_SYSTEM_PROMPT;
      } catch (error) {
        this.logger.warn(
          'Failed to load system prompt from DB, using default:',
          error,
        );
        basePrompt = DEFAULT_SYSTEM_PROMPT;
      }
    }

    const parts: string[] = [basePrompt];

    if (agentConfig.personality) {
      parts.push(`## Identity\n${agentConfig.personality}`);
    }

    if (frozenMemoryContext) {
      parts.push(frozenMemoryContext);
    }

    try {
      // Register a single MemoryKnowledgeProvider per user request.
      // We re-register each call so the provider always uses the current userID,
      // avoiding the previous bug where a stale provider served the wrong user's memories.
      const memoryProvider = new MemoryKnowledgeProvider(
        this.memoryService,
        userID,
      );
      this.knowledgeService.registerProvider(memoryProvider);

      const knowledgeContext = await this.knowledgeService.buildContext(query);
      if (knowledgeContext.length > 0) {
        parts.push(
          this.knowledgeService.formatContextForPrompt(knowledgeContext),
        );
      }
    } catch {
      // Supplementary context — safe to skip
    }

    try {
      const availableTools = this.toolsService.getAllToolNames();
      const skills = await this.skillsService.findRelevant(
        query,
        agentConfig.agentID,
        availableTools,
      );
      const skillsPrompt = this.skillsService.formatForPrompt(skills);
      if (skillsPrompt) parts.push(skillsPrompt);
    } catch {
      // Supplementary context — safe to skip
    }

    return parts.join('\n\n');
  }
}
