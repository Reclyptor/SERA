import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoreMessage } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import { ToolsService } from '../tools/tools.service';
import { ActionsService } from '../actions/actions.service';
import { StateService } from '../state/state.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PromptsService } from '../../prompts/prompts.service';
import { AgentsService } from '../../agents/agents.service';
import { SkillsService } from '../skills/skills.service';
import { randomUUID } from 'crypto';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { ChatsService } from '../../chats/chats.service';
import type {
  AgentGoal,
  OrchestratorConfig,
} from './orchestration.interfaces';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './orchestration.interfaces';
import type {
  RunStartedData,
  RunCompletedData,
  RunFailedData,
  ThinkingDeltaData,
  ThinkingDoneData,
  TextDeltaData,
  TextDoneData,
  ToolCallStartedData,
} from '../streaming/stream.interfaces';
import { MemoryKnowledgeProvider } from '../knowledge/providers';
import { DEFAULT_SYSTEM_PROMPT } from '../../prompts/defaults';
import type { AgentConfig } from '../../agents/agent-config.schema';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRouter: ModelRouterService,
    private readonly toolsService: ToolsService,
    private readonly actionsService: ActionsService,
    private readonly stateService: StateService,
    private readonly memoryService: MemoryService,
    private readonly knowledgeService: KnowledgeService,
    private readonly promptsService: PromptsService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly chatsService: ChatsService,
    private readonly agentsService: AgentsService,
    private readonly skillsService: SkillsService,
  ) {}

  async executeGoal(
    goal: AgentGoal,
    config: Partial<OrchestratorConfig> = {},
  ): Promise<void> {
    const cfg = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    const { threadId, runId, userId } = goal;

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    try {
      await this.stateService.getOrCreateThread(threadId);
      await this.stateService.startRun(threadId, runId);

      const agentConfig = await this.agentsService.findByIdOrThrow(goal.agentId);

      const effectiveModelOptions = {
        ...agentConfig.modelOptions,
        ...goal.modelOptions,
      };
      const resolved = this.modelRouter.resolveModel(effectiveModelOptions);
      this.emitEvent(runId, threadId, 'run.started', {
        provider: resolved.provider,
        modelId: resolved.modelId,
        chatId: goal.chatId,
      } satisfies RunStartedData);

      const systemPrompt = await this.buildSystemPrompt(
        userId,
        goal.userMessage,
        agentConfig,
      );

      const toolContext = {
        threadId,
        runId,
        userId,
        agentId: goal.agentId,
        workspaceDir: agentConfig.workspaceDir,
      };
      const agentTools =
        agentConfig.toolPolicy.tools.length > 0
          ? this.toolsService.getFilteredToolSet(
              toolContext,
              agentConfig.toolPolicy,
            )
          : this.toolsService.getToolSet(toolContext);
      const tools = {
        ...agentTools,
        ...this.actionsService.getToolSet(toolContext),
      };

      let history = goal.conversationHistory;
      if (goal.chatId && history.length === 0) {
        const loaded = await this.chatsService.loadConversationHistory(
          goal.chatId,
        );
        history = loaded as CoreMessage[];
      }
      const messages: CoreMessage[] =
        history.length > 0
          ? history
          : [{ role: 'user', content: goal.userMessage }];

      let iterationCount = 0;
      let lastReasoningText: string | undefined;
      let lastThinkingDuration: number | undefined;
      let finalText = '';

      while (iterationCount < cfg.maxIterations) {
        iterationCount++;
        this.checkAborted(abortController);

        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role !== 'user') {
          messages.push({ role: 'user', content: 'Continue.' });
        }

        let accumulatedReasoning = '';
        let accumulatedText = '';
        let thinkingStartTime: number | null = null;

        const streamResult = this.modelRouter.stream({
          messages,
          tools,
          system: systemPrompt,
          stopSteps: cfg.maxSteps,
          options: effectiveModelOptions,
          abortSignal: abortController.signal,
        });

        for await (const part of streamResult.fullStream) {
          switch (part.type) {
            case 'reasoning-start':
              thinkingStartTime = Date.now();
              break;
            case 'reasoning-delta':
              accumulatedReasoning += part.text;
              this.emitEvent(runId, threadId, 'thinking.delta', {
                content: part.text,
              } satisfies ThinkingDeltaData);
              break;
            case 'reasoning-end':
              if (thinkingStartTime !== null) {
                lastThinkingDuration = Math.round(
                  (Date.now() - thinkingStartTime) / 1000,
                );
                thinkingStartTime = null;
              }
              this.emitEvent(runId, threadId, 'thinking.done', {
                content: accumulatedReasoning,
              } satisfies ThinkingDoneData);
              break;
            case 'text-delta':
              accumulatedText += part.text;
              this.emitEvent(runId, threadId, 'text.delta', {
                content: part.text,
              } satisfies TextDeltaData);
              break;
            case 'tool-call':
              this.emitEvent(runId, threadId, 'tool_call.started', {
                toolCallId: String(part.toolCallId),
                toolName: String(part.toolName),
                args: (part.input ?? {}) as Record<string, unknown>,
              } satisfies ToolCallStartedData);
              break;
          }
        }

        if (accumulatedReasoning) {
          lastReasoningText = accumulatedReasoning;
        }

        if (accumulatedText) {
          this.emitEvent(runId, threadId, 'text.done', {
            content: accumulatedText,
          } satisfies TextDoneData);
          finalText = accumulatedText;
        }

        const [steps, streamResponse] = await Promise.all([
          streamResult.steps,
          streamResult.response,
        ]);

        for (const step of steps) {
          for (const tc of step.toolCalls) {
            await this.stateService.recordToolCall(
              threadId,
              tc.toolName,
              (tc.input ?? {}) as Record<string, unknown>,
            );
          }
        }

        if (streamResponse.messages) {
          messages.push(
            ...(streamResponse.messages as unknown as CoreMessage[]),
          );
        }

        // The model is done when its last step has no tool calls —
        // meaning it gave a final text response rather than requesting more work.
        const lastStep = steps[steps.length - 1];
        const modelFinished = !lastStep || lastStep.toolCalls.length === 0;

        if (modelFinished) {
          await this.completeRun(
            goal,
            finalText,
            lastReasoningText,
            lastThinkingDuration,
          );
          break;
        }
      }

      // Safety net: hit maxIterations without the model finishing
      if (iterationCount >= cfg.maxIterations && finalText) {
        await this.completeRun(
          goal,
          finalText,
          lastReasoningText,
          lastThinkingDuration,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage === 'Aborted') {
        this.logger.debug(`Run ${runId} was cancelled`);
        await this.stateService.cancelRun(runId);
      } else {
        this.logger.error(`Run ${runId} failed:`, error);
        await this.stateService.failRun(runId, errorMessage);
        this.emitEvent(runId, threadId, 'run.failed', {
          error: errorMessage,
        } satisfies RunFailedData);
      }
    } finally {
      this.abortControllers.delete(runId);
      this.eventEmitter.complete(runId);
    }
  }

  cancelRun(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  private async buildSystemPrompt(
    userId: string,
    query: string,
    agentConfig: AgentConfig,
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

    try {
      const memoryContext = await this.memoryService.getContextForQuery(
        userId,
        query,
      );
      if (memoryContext) parts.push(memoryContext);
    } catch {
      // Supplementary context — safe to skip
    }

    try {
      const memoryProvider = new MemoryKnowledgeProvider(
        this.memoryService,
        userId,
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
        agentConfig.agentId,
        availableTools,
      );
      const skillsPrompt = this.skillsService.formatForPrompt(skills);
      if (skillsPrompt) parts.push(skillsPrompt);
    } catch {
      // Supplementary context — safe to skip
    }

    return parts.join('\n\n');
  }

  private async completeRun(
    goal: AgentGoal,
    response: string,
    thinking?: string,
    thinkingDuration?: number,
  ): Promise<void> {
    const { runId, threadId, userId } = goal;

    await this.stateService.completeRun(runId);

    if (goal.chatId && response) {
      try {
        await this.chatsService.appendMessage(goal.chatId, {
          id: randomUUID(),
          role: 'assistant',
          content: response,
          thinking,
          thinkingDuration,
          createdAt: new Date(),
        });
      } catch (err) {
        this.logger.warn('Failed to persist assistant message:', err);
      }
    }

    this.emitEvent(runId, threadId, 'run.completed', {
      response,
    } satisfies RunCompletedData);

    if (!goal.isHeartbeat) {
      const lastUserMsg = goal.userMessage;
      if (lastUserMsg && response) {
        this.memoryService
          .extractAndStore(
            userId,
            `User: ${lastUserMsg}\n\nAssistant: ${response}`,
          )
          .catch((err) => {
            this.logger.warn('Memory extraction failed:', err);
          });
      }
    }
  }

  private checkAborted(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new Error('Aborted');
    }
  }

  private emitEvent(
    runId: string,
    threadId: string,
    type: string,
    data: unknown,
  ): void {
    this.eventEmitter.emitEvent(
      runId,
      threadId,
      type as import('../streaming/stream.interfaces').AgentEventType,
      data,
    );
  }
}
