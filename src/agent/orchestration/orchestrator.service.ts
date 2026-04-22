import { Injectable, Logger } from '@nestjs/common';
import type { CoreMessage } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import { ToolsService } from '../tools/tools.service';
import { ActionsService } from '../actions/actions.service';
import { StateService } from '../state/state.service';
import { MemoryService } from '../memory/memory.service';
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
import { ContextCompressorService } from '../context/context-compressor.service';
import { PromptBuilderService } from './prompt-builder.service';
import { AbortedError } from './aborted.error';
import { PromptsService } from '../../prompts/prompts.service';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly toolsService: ToolsService,
    private readonly actionsService: ActionsService,
    private readonly stateService: StateService,
    private readonly memoryService: MemoryService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly chatsService: ChatsService,
    private readonly agentsService: AgentsService,
    private readonly skillsService: SkillsService,
    private readonly contextCompressor: ContextCompressorService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly promptsService: PromptsService,
  ) {}

  async executeGoal(
    goal: AgentGoal,
    config: Partial<OrchestratorConfig> = {},
  ): Promise<void> {
    const cfg = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    const { threadID, runID, userID } = goal;

    const abortController = new AbortController();
    this.abortControllers.set(runID, abortController);

    try {
      await this.stateService.getOrCreateThread(threadID);
      await this.stateService.startRun(threadID, runID);

      if (goal.chatID) {
        await this.eventEmitter.initRun(runID, threadID, goal.chatID);
      }

      const agentConfig = await this.agentsService.findByIDOrThrow(goal.agentID);

      const effectiveModelOptions = {
        ...agentConfig.modelOptions,
        ...goal.modelOptions,
      };
      const resolved = this.modelRouter.resolveModel(effectiveModelOptions);
      await this.emitEvent(runID, threadID, 'run.started', {
        provider: resolved.provider,
        modelID: resolved.modelID,
        chatID: goal.chatID,
      } satisfies RunStartedData);

      // Capture memory context once per session — mid-session memory writes
      // update the store but don't mutate the prompt, preserving prefix cache.
      let frozenMemoryContext = '';
      try {
        frozenMemoryContext = await this.memoryService.getContextForQuery(
          userID,
          goal.userMessage,
        );
      } catch {
        // Memory unavailable — proceed without it
      }

      const systemPrompt = await this.promptBuilder.build(
        userID,
        goal.userMessage,
        agentConfig,
        frozenMemoryContext,
      );

      const sandbox = agentConfig.sandboxConfig?.enabled
        ? {
            image: agentConfig.sandboxConfig.image,
            memoryMb: agentConfig.sandboxConfig.memoryMb,
            cpuShares: agentConfig.sandboxConfig.cpuShares,
            networkEnabled: agentConfig.sandboxConfig.networkEnabled,
            envVars: agentConfig.sandboxConfig.envVars ?? {},
          }
        : undefined;

      const toolContext = {
        threadID,
        runID,
        userID,
        agentID: goal.agentID,
        sandbox,
        delegationDepth: goal.delegationDepth ?? 0,
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
      if (goal.chatID && history.length === 0) {
        const loaded = await this.chatsService.loadConversationHistory(
          goal.chatID,
        );
        history = loaded as CoreMessage[];
      }
      const messages: CoreMessage[] =
        history.length > 0
          ? history
          : [{ role: 'user', content: goal.userMessage }];

      let iterationCount = 0;
      let totalToolCalls = 0;
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

        const compressed = await this.contextCompressor.compress(
          messages,
          resolved.provider,
          systemPrompt,
        );
        if (compressed !== messages) {
          messages.length = 0;
          messages.push(...compressed);
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
              await this.emitEvent(runID, threadID, 'thinking.delta', {
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
              await this.emitEvent(runID, threadID, 'thinking.done', {
                content: accumulatedReasoning,
              } satisfies ThinkingDoneData);
              break;
            case 'text-delta':
              accumulatedText += part.text;
              await this.emitEvent(runID, threadID, 'text.delta', {
                content: part.text,
              } satisfies TextDeltaData);
              break;
            case 'tool-call':
              await this.emitEvent(runID, threadID, 'tool_call.started', {
                toolCallID: String(part.toolCallId),
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
          await this.emitEvent(runID, threadID, 'text.done', {
            content: accumulatedText,
          } satisfies TextDoneData);
          finalText = accumulatedText;
        }

        const [steps, streamResponse] = await Promise.all([
          streamResult.steps,
          streamResult.response,
        ]);

        for (const step of steps) {
          totalToolCalls += step.toolCalls.length;
          for (const tc of step.toolCalls) {
            await this.stateService.recordToolCall(
              threadID,
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
            totalToolCalls,
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
          totalToolCalls,
        );
      }
    } catch (error) {
      if (error instanceof AbortedError) {
        this.logger.debug(`Run ${runID} was cancelled`);
        await this.stateService.cancelRun(runID);
      } else {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Run ${runID} failed:`, error);
        await this.stateService.failRun(runID, errorMessage);
        await this.emitEvent(runID, threadID, 'run.failed', {
          error: errorMessage,
        } satisfies RunFailedData);
      }
    } finally {
      this.abortControllers.delete(runID);
      await this.eventEmitter.complete(runID, goal.chatID);
    }
  }

  cancelRun(runID: string): boolean {
    const controller = this.abortControllers.get(runID);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  private async completeRun(
    goal: AgentGoal,
    response: string,
    thinking?: string,
    thinkingDuration?: number,
    totalToolCalls?: number,
  ): Promise<void> {
    const { runID, threadID, userID } = goal;

    await this.stateService.completeRun(runID, response);

    if (goal.chatID && response) {
      try {
        await this.chatsService.appendMessage(goal.chatID, {
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

    await this.emitEvent(runID, threadID, 'run.completed', {
      response,
    } satisfies RunCompletedData);

    if (!goal.isHeartbeat) {
      const lastUserMsg = goal.userMessage;
      if (lastUserMsg && response) {
        this.memoryService
          .extractAndStore(
            userID,
            `User: ${lastUserMsg}\n\nAssistant: ${response}`,
          )
          .catch((err) => {
            this.logger.warn('Memory extraction failed:', err);
          });
      }

      if (totalToolCalls && totalToolCalls >= 5) {
        this.evaluateSkillCreation(goal, response, totalToolCalls).catch(
          (err) => {
            this.logger.warn('Skill evaluation failed:', err);
          },
        );
      }
    }
  }

  private async evaluateSkillCreation(
    goal: AgentGoal,
    response: string,
    toolCallCount: number,
  ): Promise<void> {
    try {
      const skillEvalPrompt =
        (await this.promptsService.get('evaluation')) ??
        'Evaluate whether this interaction should become a reusable skill. Respond with JSON: {"create": false} or {"create": true, "name": "kebab-case-name", "description": "What it does and when to use it.", "content": "...", "allowedTools": [...]}';

      const result = await this.modelRouter.generate({
        system: skillEvalPrompt,
        messages: [
          {
            role: 'user',
            content:
              `Agent "${goal.agentID}" completed a run with ${toolCallCount} tool calls.\n\n` +
              `User request: ${goal.userMessage}\n\n` +
              `Agent response (truncated): ${response.slice(0, 2000)}\n\n` +
              'Should this be turned into a reusable skill? Consider: Is this a repeatable pattern? ' +
              'Would a skill template help the agent handle similar requests faster?',
          },
        ],
        maxOutputTokens: 1024,
        temperature: 0.1,
      });

      let raw = result.text.trim();
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) raw = fenceMatch[1].trim();

      const evaluation = JSON.parse(raw) as {
        create: boolean;
        name?: string;
        description?: string;
        content?: string;
        allowedTools?: string[];
      };

      if (!evaluation.create || !evaluation.name || !evaluation.content) {
        return;
      }

      const existing = await this.skillsService.findByName(evaluation.name);
      if (existing) {
        this.logger.debug(
          `Skill "${evaluation.name}" already exists, skipping auto-creation`,
        );
        return;
      }

      await this.skillsService.create({
        name: evaluation.name,
        description: evaluation.description ?? '',
        content: evaluation.content,
        allowedTools: evaluation.allowedTools,
      });

      this.logger.log(
        `Auto-created skill "${evaluation.name}" from run ${goal.runID}`,
      );
    } catch (err) {
      this.logger.debug(
        `Skill evaluation skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private checkAborted(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new AbortedError();
    }
  }

  private async emitEvent(
    runID: string,
    threadID: string,
    type: string,
    data: unknown,
  ): Promise<void> {
    await this.eventEmitter.emitEvent(
      runID,
      threadID,
      type as import('../streaming/stream.interfaces').AgentEventType,
      data,
    );
  }
}
