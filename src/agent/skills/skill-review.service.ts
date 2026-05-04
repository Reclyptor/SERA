import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModelMessage } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import { ToolsService } from '../tools/tools.service';
import { SKILL_REVIEW_PROMPT } from './skill-review.prompts';

const MAX_HISTORY_MESSAGES = 10;
const MAX_STEPS = 8;

@Injectable()
export class SkillReviewService {
  private readonly logger = new Logger(SkillReviewService.name);
  private readonly reviewModel: string;

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly toolsService: ToolsService,
    private readonly configService: ConfigService,
  ) {
    this.reviewModel = this.configService.get<string>(
      'SKILL_REVIEW_MODEL',
      '',
    );
  }

  async review(params: {
    userMessage: string;
    response: string;
    conversationHistory: ModelMessage[];
    agentID: string;
    threadID: string;
    runID: string;
    toolCallCount: number;
  }): Promise<void> {
    const toolContext = {
      threadID: `review-${params.threadID}`,
      runID: `review-${params.runID}`,
      agentID: 'skill-reviewer',
    };

    const tools = this.toolsService.getFilteredToolSet(toolContext, {
      mode: 'allow',
      tools: ['skills'],
    });

    const recentHistory = params.conversationHistory.slice(
      -MAX_HISTORY_MESSAGES,
    );

    const summaryParts = [
      `Agent "${params.agentID}" completed a run with ${params.toolCallCount} tool call(s).`,
      '',
      `User request: ${params.userMessage}`,
      '',
      `Agent response (truncated): ${params.response.slice(0, 3000)}`,
    ];

    const messages: ModelMessage[] = [
      ...recentHistory,
      {
        role: 'user' as const,
        content: summaryParts.join('\n'),
      },
    ];

    const modelOptions = this.reviewModel
      ? { preferredModel: this.reviewModel }
      : undefined;

    try {
      const result = await this.modelRouter.generate({
        system: SKILL_REVIEW_PROMPT,
        messages,
        tools,
        stopSteps: MAX_STEPS,
        temperature: 0.1,
        options: modelOptions,
      });

      const stepCount = result.steps?.length ?? 0;
      if (stepCount > 1) {
        this.logger.log(
          `Skill review completed: ${stepCount} steps taken for run ${params.runID}`,
        );
      } else {
        this.logger.debug(
          `Skill review completed with no actions for run ${params.runID}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Skill review error for run ${params.runID}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
