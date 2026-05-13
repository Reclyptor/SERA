import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import type { ModelMessage } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import { ToolsService } from '../tools/tools.service';
import { ActionsService } from '../actions/actions.service';
import { StateService } from '../state/state.service';
import { MemoryService } from '../memory/memory.service';
import { AgentsService } from '../../agents/agents.service';
import { SkillReviewService } from '../skills/skill-review.service';
import { randomUUID } from 'crypto';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { ChatsService } from '../../chats/chats.service';
import type { ToolCallBlock } from '../../chats/chat.schema';
import type { AgentGoal, OrchestratorConfig } from './orchestration.interfaces';
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
  ToolCallExecutingData,
  ToolCallResultData,
  ToolCallErrorData,
  SubagentSpawnedData,
  SubagentCompletedData,
  SubagentFailedData,
} from '../streaming/stream.interfaces';
import { ContextCompressorService } from '../context/context-compressor.service';
import { PromptBuilderService } from './prompt-builder.service';
import { AbortedError } from './aborted.error';
import { LoopDetectionService } from '../tools/loop-detection.service';
import { classifyError } from '../model/error-classifier';
import { InsightsService } from '../insights/insights.service';

const SUBAGENT_TOOL_NAMES = new Set(['sessions_spawn', 'agent_message']);
const MAX_EVENT_RESULT_LENGTH = 5000;

function truncateResult(value: unknown): unknown {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str || str.length <= MAX_EVENT_RESULT_LENGTH) return value;
  return (
    str.slice(0, MAX_EVENT_RESULT_LENGTH) +
    `\n...[truncated, ${str.length} chars total]`
  );
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly subscriber: Redis;

  constructor(
    private readonly modelRouter: ModelRouterService,
    private readonly toolsService: ToolsService,
    private readonly actionsService: ActionsService,
    private readonly stateService: StateService,
    private readonly memoryService: MemoryService,
    private readonly eventEmitter: AgentEventEmitter,
    private readonly chatsService: ChatsService,
    private readonly agentsService: AgentsService,
    private readonly skillReview: SkillReviewService,
    private readonly contextCompressor: ContextCompressorService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly loopDetection: LoopDetectionService,
    private readonly insightsService: InsightsService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('message', (_channel: string, runID: string) => {
      const controller = this.abortControllers.get(runID);
      if (controller) {
        controller.abort();
      }
    });
  }

  private cancelChannel(runID: string): string {
    return `cancel:${runID}`;
  }

  async executeGoal(
    goal: AgentGoal,
    config: Partial<OrchestratorConfig> = {},
  ): Promise<void> {
    const cfg = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    const { threadID, runID, userID } = goal;

    const abortController = new AbortController();
    this.abortControllers.set(runID, abortController);
    await this.subscriber.subscribe(this.cancelChannel(runID));

    try {
      await this.stateService.getOrCreateThread(threadID);
      await this.stateService.startRun(threadID, runID);

      if (goal.chatID) {
        await this.eventEmitter.initRun(runID, threadID, goal.chatID);
      }

      const agentConfig = await this.agentsService.findByIDOrThrow(
        goal.agentID,
      );

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
        goal.userName,
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
        history = loaded as ModelMessage[];
      }
      const messages: ModelMessage[] =
        history.length > 0
          ? history
          : [{ role: 'user', content: goal.userMessage }];

      let iterationCount = 0;
      let totalToolCalls = 0;
      let lastReasoningText: string | undefined;
      let lastThinkingDuration: number | undefined;
      let finalText = '';
      const toolCallBlocks: ToolCallBlock[] = [];
      let forceCompress = false;
      const runStartTime = Date.now();
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

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
          forceCompress,
        );
        forceCompress = false;
        if (compressed !== messages) {
          messages.length = 0;
          messages.push(...compressed);
        }

        let accumulatedReasoning = '';
        let accumulatedText = '';
        let thinkingStartTime: number | null = null;
        const pendingToolArgs = new Map<
          string,
          { toolName: string; args: Record<string, unknown> }
        >();

        let streamResult: ReturnType<typeof this.modelRouter.stream>;
        try {
          streamResult = this.modelRouter.stream({
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
              case 'tool-call': {
                const toolCallID = String(part.toolCallId);
                const toolName = String(part.toolName);
                const args = (part.input ?? {}) as Record<string, unknown>;
                pendingToolArgs.set(toolCallID, { toolName, args });
                toolCallBlocks.push({
                  toolCallID,
                  toolName,
                  args,
                  status: 'executing',
                });
                await this.emitEvent(runID, threadID, 'tool_call.started', {
                  toolCallID,
                  toolName,
                  args,
                } satisfies ToolCallStartedData);
                await this.stateService.recordToolCall(
                  threadID,
                  toolName,
                  args,
                  toolCallID,
                );
                await this.stateService.markToolCallExecuting(
                  threadID,
                  toolCallID,
                );
                await this.emitEvent(runID, threadID, 'tool_call.executing', {
                  toolCallID,
                  toolName,
                } satisfies ToolCallExecutingData);
                break;
              }
              case 'tool-result': {
                const toolCallID = String(part.toolCallId);
                const toolName = String(part.toolName);
                const output = part.output;
                const pending = pendingToolArgs.get(toolCallID);
                this.loopDetection.record(runID, toolName, pending?.args ?? {});
                const block = toolCallBlocks.find(
                  (b) => b.toolCallID === toolCallID,
                );
                if (block) {
                  block.status = 'completed';
                  block.result = output;
                }
                await this.stateService.markToolCallCompleted(
                  threadID,
                  toolCallID,
                  output,
                );
                await this.emitEvent(runID, threadID, 'tool_call.result', {
                  toolCallID,
                  toolName,
                  result: truncateResult(output),
                  success: true,
                } satisfies ToolCallResultData);
                if (SUBAGENT_TOOL_NAMES.has(toolName)) {
                  await this.emitSubagentEvents(
                    runID,
                    threadID,
                    toolCallID,
                    output,
                  );
                  if (block) {
                    block.isSubagent = true;
                    const inner = (output as Record<string, unknown>)
                      ?.result as Record<string, unknown> | undefined;
                    if (inner) {
                      block.subagentMeta = {
                        runID: (inner.runID ?? '') as string,
                        threadID: (inner.threadID ?? '') as string,
                        agentID: (inner.agentID ??
                          inner.targetAgentID ??
                          '') as string,
                        goal: (inner.goal ?? inner.message ?? '') as string,
                      };
                    }
                  }
                }
                break;
              }
              case 'tool-error': {
                const toolCallID = String(part.toolCallId);
                const toolName = String(part.toolName);
                const errorStr =
                  part.error instanceof Error
                    ? part.error.message
                    : String(part.error);
                const pending = pendingToolArgs.get(toolCallID);
                this.loopDetection.record(
                  runID,
                  toolName,
                  pending?.args ?? {},
                  errorStr,
                );
                const block = toolCallBlocks.find(
                  (b) => b.toolCallID === toolCallID,
                );
                if (block) {
                  block.status = 'failed';
                  block.error = errorStr;
                }
                await this.stateService.markToolCallFailed(
                  threadID,
                  toolCallID,
                  errorStr,
                );
                await this.emitEvent(runID, threadID, 'tool_call.error', {
                  toolCallID,
                  toolName,
                  error: errorStr,
                } satisfies ToolCallErrorData);
                if (SUBAGENT_TOOL_NAMES.has(toolName)) {
                  const result = (part as unknown as { output?: unknown })
                    .output;
                  const subRunID = (result as Record<string, unknown>)
                    ?.runID as string | undefined;
                  if (subRunID) {
                    await this.emitEvent(runID, threadID, 'subagent.failed', {
                      toolCallID,
                      subagentRunID: subRunID,
                      error: errorStr,
                    } satisfies SubagentFailedData);
                  }
                }
                break;
              }
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
            if (step.usage) {
              totalInputTokens += step.usage.inputTokens ?? 0;
              totalOutputTokens += step.usage.outputTokens ?? 0;
            }
          }

          if (streamResponse.messages) {
            messages.push(
              ...(streamResponse.messages as unknown as ModelMessage[]),
            );
          }

          const loop = this.loopDetection.detect(runID);
          if (loop) {
            this.logger.warn(
              `Loop detected in run ${runID}: [${loop.type}] ${loop.message}`,
            );
            if (loop.type === 'circuit_breaker') {
              messages.push({
                role: 'user',
                content: `[SYSTEM] ${loop.message} You must provide a final answer now without calling any more tools.`,
              });
              const finalStream = this.modelRouter.stream({
                messages,
                system: systemPrompt,
                options: effectiveModelOptions,
                abortSignal: abortController.signal,
              });
              for await (const p of finalStream.fullStream) {
                if (p.type === 'text-delta') {
                  finalText += p.text;
                  await this.emitEvent(runID, threadID, 'text.delta', {
                    content: p.text,
                  } satisfies TextDeltaData);
                }
              }
              if (finalText) {
                await this.emitEvent(runID, threadID, 'text.done', {
                  content: finalText,
                } satisfies TextDoneData);
              }
              await this.completeRun(
                goal,
                finalText,
                lastReasoningText,
                lastThinkingDuration,
                totalToolCalls,
                toolCallBlocks,
                {
                  provider: resolved.provider,
                  modelID: resolved.modelID,
                  inputTokens: totalInputTokens,
                  outputTokens: totalOutputTokens,
                  durationMs: Date.now() - runStartTime,
                  iterationCount,
                },
              );
              break;
            }
            messages.push({
              role: 'user',
              content: `[SYSTEM] Warning: ${loop.message}`,
            });
          }

          const lastStep = steps[steps.length - 1];
          const modelFinished = !lastStep || lastStep.toolCalls.length === 0;

          if (modelFinished) {
            await this.completeRun(
              goal,
              finalText,
              lastReasoningText,
              lastThinkingDuration,
              totalToolCalls,
              toolCallBlocks,
              {
                provider: resolved.provider,
                modelID: resolved.modelID,
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                durationMs: Date.now() - runStartTime,
                iterationCount,
              },
            );
            break;
          }
        } catch (streamError) {
          const classified = classifyError(streamError);
          if (classified.shouldCompress && iterationCount < cfg.maxIterations) {
            this.logger.warn(
              `Context length exceeded in run ${runID}, forcing compression and retrying...`,
            );
            forceCompress = true;
            continue;
          }
          throw streamError;
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
          undefined,
          {
            provider: resolved.provider,
            modelID: resolved.modelID,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            durationMs: Date.now() - runStartTime,
            iterationCount,
          },
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
      this.loopDetection.clear(runID);
      this.abortControllers.delete(runID);
      await this.subscriber.unsubscribe(this.cancelChannel(runID));
      await this.eventEmitter.complete(runID, goal.chatID);
    }
  }

  async cancelRun(runID: string): Promise<boolean> {
    const listeners = await this.redis.publish(
      this.cancelChannel(runID),
      runID,
    );
    return listeners > 0;
  }

  private async completeRun(
    goal: AgentGoal,
    response: string,
    thinking?: string,
    thinkingDuration?: number,
    totalToolCalls?: number,
    toolCalls?: ToolCallBlock[],
    usageData?: {
      provider: string;
      modelID: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      iterationCount: number;
    },
  ): Promise<void> {
    const { runID, threadID, userID } = goal;

    await this.stateService.completeRun(runID, response);

    if (usageData) {
      this.insightsService
        .recordUsage({
          runID,
          userID,
          provider: usageData.provider,
          modelID: usageData.modelID,
          tokens: {
            input: usageData.inputTokens,
            output: usageData.outputTokens,
          },
          toolCallCount: totalToolCalls ?? 0,
          durationMs: usageData.durationMs,
          iterationCount: usageData.iterationCount,
        })
        .catch((err) => {
          this.logger.warn('Usage recording failed:', err);
        });
    }

    if (goal.chatID && response) {
      try {
        await this.chatsService.appendMessage(goal.chatID, {
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

  private async emitSubagentEvents(
    runID: string,
    threadID: string,
    toolCallID: string,
    output: unknown,
  ): Promise<void> {
    const result = output as Record<string, unknown> | undefined;
    if (!result?.result) return;
    const inner = result.result as Record<string, unknown>;
    const subRunID = (inner.runID ?? '') as string;
    const subThreadID = (inner.threadID ?? '') as string;
    const agentID = (inner.agentID ?? inner.targetAgentID ?? '') as string;
    const goal = (inner.goal ?? inner.message ?? '') as string;
    const status = (inner.status ?? '') as string;

    if (!subRunID) return;

    await this.emitEvent(runID, threadID, 'subagent.spawned', {
      toolCallID,
      subagentRunID: subRunID,
      subagentThreadID: subThreadID,
      agentID,
      goal,
    } satisfies SubagentSpawnedData);

    if (status === 'completed') {
      await this.emitEvent(runID, threadID, 'subagent.completed', {
        toolCallID,
        subagentRunID: subRunID,
        status,
        response: inner.response as string | undefined,
      } satisfies SubagentCompletedData);
    } else if (status === 'failed') {
      await this.emitEvent(runID, threadID, 'subagent.failed', {
        toolCallID,
        subagentRunID: subRunID,
        error: (inner.error as string) ?? 'Unknown error',
      } satisfies SubagentFailedData);
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
