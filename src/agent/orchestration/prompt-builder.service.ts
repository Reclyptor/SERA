import { Injectable, Logger } from '@nestjs/common';
import { PromptsService, PromptVariables } from '../../prompts/prompts.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { SkillsService } from '../skills/skills.service';
import { ToolsService } from '../tools/tools.service';
import { MemoryKnowledgeProvider } from '../knowledge/providers';
import type { AgentConfig } from '../../agents/agent-config.schema';

const PROMPT_LOAD_ORDER: string[] = [
  'system',
  'soul',
  'identity',
  'user',
  'tools',
  'heartbeat',
];

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
    const variables: PromptVariables = {
      agentName: agentConfig.name,
      agentID: agentConfig.agentID,
      userID,
    };

    const parts: string[] = [];

    // Load well-known prompts in priority order
    const loadOrder = agentConfig.promptSlug
      ? [agentConfig.promptSlug, ...PROMPT_LOAD_ORDER.filter((s) => s !== agentConfig.promptSlug)]
      : PROMPT_LOAD_ORDER;

    for (const slug of loadOrder) {
      const resolved = await this.promptsService.resolve(slug, variables);
      if (resolved) parts.push(resolved);
    }

    if (parts.length === 0) {
      this.logger.error('No prompts found in database. Ensure prompts have been synced.');
      throw new Error('No prompts found');
    }

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
      const skillsPrompt = this.skillsService.formatForPrompt(skills, {
        agentName: agentConfig.name,
        agentID: agentConfig.agentID,
        userID,
      });
      if (skillsPrompt) parts.push(skillsPrompt);
    } catch {
      // Supplementary context — safe to skip
    }

    return parts.join('\n\n');
  }
}
