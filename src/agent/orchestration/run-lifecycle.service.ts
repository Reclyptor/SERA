import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { StateService } from '../state/state.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { ChatsService } from '../../chats/chats.service';
import { InsightsService } from '../insights/insights.service';
import { MemoryService } from '../memory/memory.service';
import { CommitmentExtractorService } from '../commitments/commitment-extractor.service';
import { SkillReviewService } from '../skills/skill-review.service';
import type { AgentGoal } from './orchestration.interfaces';
import type { ToolCallBlock } from '../../chats/chat.schema';
import type {
  RunCompletedData,
  RunFailedData,
  RunCancelledData,
} from '../streaming/stream.interfaces';

export interface CompleteRunOptions {
  thinking?: string;
  thinkingDuration?: number;
  totalToolCalls?: number;
  toolCalls?: ToolCallBlock[];
  usage?: {
    provider: string;
    modelID: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    iterationCount: number;
  };
}

/**
 * Owns the per-run terminal-state transitions and the side-effects that
 * follow them (usage telemetry, chat persistence, memory + commitment
 * extraction, skill review). The orchestrator drives the run loop; this
 * service drives what happens at its edges. Yield-resume linkage stays
 * in the orchestrator because it schedules a new run rather than
 * finalizing the current one.
 */
@Injectable()
export class RunLifecycleService {
  private readonly logger = new Logger(RunLifecycleService.name);

  constructor(
    private readonly stateService: StateService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly chatsService: ChatsService,
    private readonly insightsService: InsightsService,
    private readonly memoryService: MemoryService,
    private readonly commitmentExtractor: CommitmentExtractorService,
    private readonly skillReview: SkillReviewService,
    private readonly configService: ConfigService,
  ) {}

  async failRun(runID: string, threadID: string, error: string): Promise<void> {
    await this.stateService.failRun(runID, error);
    await this.eventEmitter.emitEvent(runID, threadID, 'run.failed', {
      error,
    } satisfies RunFailedData);
  }

  async cancelRun(runID: string, threadID: string): Promise<void> {
    await this.stateService.cancelRun(runID);
    await this.eventEmitter.emitEvent(runID, threadID, 'run.cancelled', {
      reason: 'Run cancelled',
    } satisfies RunCancelledData);
  }

  async completeRun(
    goal: AgentGoal,
    response: string,
    opts: CompleteRunOptions = {},
  ): Promise<void> {
    const { runID, threadID, userID } = goal;
    const { thinking, thinkingDuration, totalToolCalls, toolCalls, usage } =
      opts;

    await this.stateService.completeRun(runID, response);

    if (usage) {
      this.insightsService
        .recordUsage({
          runID,
          userID,
          provider: usage.provider,
          modelID: usage.modelID,
          tokens: {
            input: usage.inputTokens,
            output: usage.outputTokens,
          },
          toolCallCount: totalToolCalls ?? 0,
          durationMs: usage.durationMs,
          iterationCount: usage.iterationCount,
        })
        .catch((err) => {
          this.logger.warn('Usage recording failed:', err);
        });
    }

    if (goal.chatID && response) {
      try {
        await this.chatsService.appendMessage(goal.chatID, goal.userID, {
          id: randomUUID(),
          role: 'assistant',
          content: response,
          thinking,
          thinkingDuration,
          toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
          createdAt: new Date(),
        });
      } catch (err) {
        this.logger.warn('Failed to persist assistant message:', err);
      }
    }

    await this.eventEmitter.emitEvent(runID, threadID, 'run.completed', {
      response,
    } satisfies RunCompletedData);

    if (!goal.isHeartbeat) {
      const lastUserMsg = goal.userMessage;
      if (lastUserMsg && response) {
        const scope = {
          ...(goal.agentID && { agentID: goal.agentID }),
          ...(threadID && { threadID }),
        };
        this.memoryService
          .extractFromRun(userID, lastUserMsg, response, scope)
          .catch((err) => {
            this.logger.warn('Memory extraction failed:', err);
          });

        this.commitmentExtractor
          .extract(
            `User: ${lastUserMsg}\n\nAssistant: ${response}`,
            goal.agentID,
            userID,
            threadID,
            runID,
          )
          .catch((err) => {
            this.logger.warn('Commitment extraction failed:', err);
          });
      }

      this.maybeRunSkillReview(goal, response, totalToolCalls ?? 0).catch(
        (err) => {
          this.logger.warn('Skill review trigger failed:', err);
        },
      );
    }
  }

  private async maybeRunSkillReview(
    goal: AgentGoal,
    response: string,
    totalToolCalls: number,
  ): Promise<void> {
    const { threadID } = goal;

    const prevTurns =
      (await this.stateService.getCustomState<number>(
        threadID,
        'turnsSinceReview',
      )) ?? 0;
    const prevToolCalls =
      (await this.stateService.getCustomState<number>(
        threadID,
        'toolCallsSinceReview',
      )) ?? 0;

    const newTurns = prevTurns + 1;
    const newToolCalls = prevToolCalls + totalToolCalls;

    const turnThreshold =
      parseInt(
        this.configService.get<string>('SKILL_REVIEW_TURN_THRESHOLD', '3'),
        10,
      ) || 3;
    const toolThreshold =
      parseInt(
        this.configService.get<string>('SKILL_REVIEW_TOOL_THRESHOLD', '5'),
        10,
      ) || 5;

    if (newTurns >= turnThreshold || newToolCalls >= toolThreshold) {
      await this.stateService.setCustomState(threadID, 'turnsSinceReview', 0);
      await this.stateService.setCustomState(
        threadID,
        'toolCallsSinceReview',
        0,
      );

      this.skillReview
        .review({
          userMessage: goal.userMessage,
          response,
          conversationHistory: goal.conversationHistory,
          agentID: goal.agentID,
          threadID: goal.threadID,
          runID: goal.runID,
          toolCallCount: totalToolCalls,
        })
        .catch((err) => {
          this.logger.warn('Skill review failed:', err);
        });
    } else {
      await this.stateService.setCustomState(
        threadID,
        'turnsSinceReview',
        newTurns,
      );
      await this.stateService.setCustomState(
        threadID,
        'toolCallsSinceReview',
        newToolCalls,
      );
    }
  }
}
