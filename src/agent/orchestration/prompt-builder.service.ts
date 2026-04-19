import { Injectable, Logger } from '@nestjs/common';
import { PromptsService, PromptVariables } from '../../prompts/prompts.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { SkillsService } from '../skills/skills.service';
import { ToolsService } from '../tools/tools.service';
import { MemoryKnowledgeProvider } from '../knowledge/providers';
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
    const promptSlug = agentConfig.promptSlug ?? 'system';

    const variables: PromptVariables = {
      agentName: agentConfig.name,
      agentID: agentConfig.agentID,
      userID,
      workspaceDir: agentConfig.workspaceDir,
    };

    const basePrompt = await this.promptsService.resolve(promptSlug, variables);
    if (!basePrompt) {
      this.logger.error(
        `Prompt "${promptSlug}" not found in database. Ensure prompts have been seeded.`,
      );
      throw new Error(`Prompt "${promptSlug}" not found`);
    }

    const parts: string[] = [basePrompt];

    if (frozenMemoryContext) {
      parts.push(frozenMemoryContext);
    }

    try {
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
