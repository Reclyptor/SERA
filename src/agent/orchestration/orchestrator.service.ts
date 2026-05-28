import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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
import {
  AUTONOMOUS_RUN_CONFIG,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './orchestration.interfaces';
import type {
  RunStartedData,
  TextDeltaData,
  TextDoneData,
  ModelAttemptData,
  ModelFallbackData,
} from '../streaming/stream.interfaces';
import { ContextCompressorService } from '../context/context-compressor.service';
import { PromptBuilderService } from './prompt-builder.service';
import { AbortedError } from './aborted.error';
import { LoopDetectionService } from '../tools/loop-detection.service';
import { classifyError } from '../model/error-classifier';
import type { PluginLoaderService } from '../plugins/plugin-loader.service';
import { AttachmentMessageResolverService } from './attachment-message-resolver.service';
import { AiSdkAgentRuntimeService } from './ai-sdk-agent-runtime.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { StreamEventReducer } from './stream-event-reducer.service';

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
    private readonly contextCompressor: ContextCompressorService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly loopDetection: LoopDetectionService,
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
    private readonly attachmentMessageResolver: AttachmentMessageResolverService,
    private readonly agentRuntime: AiSdkAgentRuntimeService,
    private readonly lifecycle: RunLifecycleService,
    private readonly streamReducer: StreamEventReducer,
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

  private _pluginLoader: PluginLoaderService | null = null;

  private get pluginLoader(): PluginLoaderService | null {
    if (!this._pluginLoader) {
      try {
        const {
          PluginLoaderService: PLS,
        } = require('../plugins/plugin-loader.service');
        this._pluginLoader = this.moduleRef.get(PLS, { strict: false }) ?? null;
      } catch {
        this._pluginLoader = null;
      }
    }
    return this._pluginLoader;
  }

  private cancelChannel(runID: string): string {
    return `cancel:${runID}`;
  }

  private async runPluginHooks<T>(type: string, args: T): Promise<void> {
    try {
      await this.pluginLoader?.runHooks(type, args);
    } catch {
      // Plugin hooks must never fail the run
    }
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
      await this.stateService.startRun(
        threadID,
        runID,
        goal.userMessage,
        goal.agentID,
      );

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
      let activeModel = resolved;
      await this.emitEvent(runID, threadID, 'run.started', {
        provider: resolved.provider,
        modelID: resolved.modelID,
        chatID: goal.chatID,
      } satisfies RunStartedData);

      await this.runPluginHooks('onSessionStart', {
        threadID,
        runID,
        agentID: goal.agentID,
        userID: goal.userID,
      });

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
        abortSignal: abortController.signal,
        metadata: {
          chatID: goal.chatID,
        },
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
      let yieldRequested = false;
      const runStartTime = Date.now();
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let terminalStateReached = false;

      const memoryNudgeInterval =
        parseInt(
          this.configService.get<string>('MEMORY_NUDGE_INTERVAL', '10'),
          10,
        ) || 0;
      let toolCallsSinceNudge = 0;

      while (iterationCount < cfg.maxIterations) {
        iterationCount++;
        this.checkAborted(abortController);
        this.checkTimeout(
          runStartTime,
          cfg.wallClockTimeoutMs,
          abortController,
        );

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

        let streamResult: ReturnType<typeof this.agentRuntime.streamAttempt>;
        try {
          const llmCallStart = Date.now();
          await this.runPluginHooks('onPreLLMCall', {
            threadID,
            runID,
            provider: activeModel.provider,
            modelID: activeModel.modelID,
            messageCount: messages.length,
          });

          const messagesForModel = await this.attachmentMessageResolver.resolve(
            messages,
            userID,
          );
          streamResult = this.agentRuntime.streamAttempt({
            messages: messagesForModel,
            tools,
            system: systemPrompt,
            stopSteps: cfg.maxSteps,
            options: effectiveModelOptions,
            abortSignal: abortController.signal,
            onAttempt: async (attempt) => {
              activeModel = {
                ...activeModel,
                provider: attempt.provider,
                modelID: attempt.modelID,
              };
              await this.emitEvent(runID, threadID, 'model.attempt', {
                attempt: attempt.attempt,
                provider: attempt.provider,
                modelID: attempt.modelID,
              } satisfies ModelAttemptData);
            },
            onFallback: async (fallback) => {
              await this.emitEvent(runID, threadID, 'model.fallback', {
                attempt: fallback.attempt,
                provider: fallback.provider,
                modelID: fallback.modelID,
                reason: fallback.reason,
                message: fallback.message,
                nextProvider: fallback.nextProvider,
                nextModelID: fallback.nextModelID,
              } satisfies ModelFallbackData);
            },
          });

          const reduction = await this.streamReducer.reduce({
            runID,
            threadID,
            stream: streamResult.fullStream,
            runPluginHooks: (type, args) => this.runPluginHooks(type, args),
          });

          toolCallBlocks.push(...reduction.toolCallBlocks);
          if (reduction.lastThinkingDuration !== undefined) {
            lastThinkingDuration = reduction.lastThinkingDuration;
          }
          if (reduction.accumulatedReasoning) {
            lastReasoningText = reduction.accumulatedReasoning;
          }
          if (reduction.yieldRequested) {
            yieldRequested = true;
          }

          if (reduction.accumulatedText) {
            await this.emitEvent(runID, threadID, 'text.done', {
              content: reduction.accumulatedText,
            } satisfies TextDoneData);
            finalText = reduction.accumulatedText;
          }

          const [steps, streamResponse] = await Promise.all([
            streamResult.steps,
            streamResult.response,
          ]);

          for (const step of steps) {
            totalToolCalls += step.toolCalls.length;
            if (memoryNudgeInterval > 0) {
              toolCallsSinceNudge += step.toolCalls.length;
            }
            if (step.usage) {
              totalInputTokens += step.usage.inputTokens ?? 0;
              totalOutputTokens += step.usage.outputTokens ?? 0;
            }
          }

          await this.runPluginHooks('onPostLLMCall', {
            threadID,
            runID,
            provider: activeModel.provider,
            modelID: activeModel.modelID,
            messageCount: messages.length,
            inputTokens: steps.reduce(
              (sum, s) => sum + (s.usage?.inputTokens ?? 0),
              0,
            ),
            outputTokens: steps.reduce(
              (sum, s) => sum + (s.usage?.outputTokens ?? 0),
              0,
            ),
            toolCallCount: steps.reduce(
              (sum, s) => sum + s.toolCalls.length,
              0,
            ),
            durationMs: Date.now() - llmCallStart,
          });

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
              const finalMessagesForModel =
                await this.attachmentMessageResolver.resolve(messages, userID);
              const finalStream = this.agentRuntime.streamAttempt({
                messages: finalMessagesForModel,
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
              terminalStateReached = true;
              await this.lifecycle.completeRun(goal, finalText, {
                thinking: lastReasoningText,
                thinkingDuration: lastThinkingDuration,
                totalToolCalls,
                toolCalls: toolCallBlocks,
                usage: {
                  provider: activeModel.provider,
                  modelID: activeModel.modelID,
                  inputTokens: totalInputTokens,
                  outputTokens: totalOutputTokens,
                  durationMs: Date.now() - runStartTime,
                  iterationCount,
                },
              });
              await this.maybeResumeYield(goal, finalText);
              break;
            }
            messages.push({
              role: 'user',
              content: `[SYSTEM] Warning: ${loop.message}`,
            });
          }

          if (
            !goal.isHeartbeat &&
            memoryNudgeInterval > 0 &&
            toolCallsSinceNudge >= memoryNudgeInterval
          ) {
            messages.push({
              role: 'user',
              content:
                '[SYSTEM] Reminder: If important facts, user preferences, or commitments emerged during this conversation, consider saving them with memory tools before continuing.',
            });
            toolCallsSinceNudge = 0;
          }

          if (yieldRequested) {
            terminalStateReached = true;
            const yieldResponse = finalText || 'Yielded.';
            await this.lifecycle.completeRun(goal, yieldResponse, {
              thinking: lastReasoningText,
              thinkingDuration: lastThinkingDuration,
              totalToolCalls,
              toolCalls: toolCallBlocks,
              usage: {
                provider: activeModel.provider,
                modelID: activeModel.modelID,
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                durationMs: Date.now() - runStartTime,
                iterationCount,
              },
            });
            await this.maybeResumeYield(goal, yieldResponse);
            break;
          }

          const lastStep = steps[steps.length - 1];
          const modelFinished = !lastStep || lastStep.toolCalls.length === 0;

          if (modelFinished) {
            terminalStateReached = true;
            await this.lifecycle.completeRun(goal, finalText, {
              thinking: lastReasoningText,
              thinkingDuration: lastThinkingDuration,
              totalToolCalls,
              toolCalls: toolCallBlocks,
              usage: {
                provider: activeModel.provider,
                modelID: activeModel.modelID,
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                durationMs: Date.now() - runStartTime,
                iterationCount,
              },
            });
            await this.maybeResumeYield(goal, finalText);
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

      // Safety net: hit maxIterations without the model finishing.
      if (!terminalStateReached && iterationCount >= cfg.maxIterations) {
        if (finalText) {
          terminalStateReached = true;
          await this.lifecycle.completeRun(goal, finalText, {
            thinking: lastReasoningText,
            thinkingDuration: lastThinkingDuration,
            totalToolCalls,
            usage: {
              provider: activeModel.provider,
              modelID: activeModel.modelID,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              durationMs: Date.now() - runStartTime,
              iterationCount,
            },
          });
          await this.maybeResumeYield(goal, finalText);
        } else {
          const error = `max_iterations_exceeded: run reached ${cfg.maxIterations} iterations without final text`;
          terminalStateReached = true;
          await this.lifecycle.failRun(runID, threadID, error);
        }
      }
    } catch (error) {
      if (error instanceof AbortedError) {
        this.logger.debug(`Run ${runID} was cancelled`);
        await this.lifecycle.cancelRun(runID, threadID);
      } else {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Run ${runID} failed:`, error);
        await this.lifecycle.failRun(runID, threadID, errorMessage);
      }
    } finally {
      await this.runPluginHooks('onSessionEnd', {
        threadID,
        runID,
        agentID: goal.agentID,
        userID: goal.userID,
      });
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

  /**
   * After a run completes, check if its parent thread is yielding for
   * subagent results (via `sessions_yield`) and, if so, schedule a
   * resume run on the parent with this run's response as the new
   * message. Stays in the orchestrator because it SCHEDULES another
   * run rather than finalizing this one — the lifecycle service only
   * owns terminal-state side effects, not run scheduling.
   */
  private async maybeResumeYield(
    goal: AgentGoal,
    response: string,
  ): Promise<void> {
    try {
      const parentThreadID = await this.stateService.getCustomState<string>(
        goal.threadID,
        'parentThreadID',
      );
      if (!parentThreadID) return;
      const yielding = await this.stateService.getCustomState<boolean>(
        parentThreadID,
        'yielding',
      );
      if (!yielding) return;

      const yieldAgentID =
        (await this.stateService.getCustomState<string>(
          parentThreadID,
          'yieldAgentID',
        )) ?? goal.agentID;
      const yieldUserID =
        (await this.stateService.getCustomState<string>(
          parentThreadID,
          'yieldUserID',
        )) ?? goal.userID;
      const yieldChatID = await this.stateService.getCustomState<string>(
        parentThreadID,
        'yieldChatID',
      );

      await this.stateService.setCustomState(parentThreadID, 'yielding', false);

      const resumeRunID = randomUUID();
      const resumeMessage = `[Subagent completed]\nThread: ${goal.threadID}\nRun: ${goal.runID}\n\n${response || '(no response)'}`;
      this.executeGoal(
        {
          threadID: parentThreadID,
          runID: resumeRunID,
          userID: yieldUserID,
          agentID: yieldAgentID,
          chatID: yieldChatID || undefined,
          userMessage: resumeMessage,
          conversationHistory: [],
          isHeartbeat: true,
        },
        this.getAutonomousRunConfig(),
      ).catch((err) => {
        this.logger.warn(
          `Failed to resume yielded parent ${parentThreadID}:`,
          err,
        );
      });
    } catch {
      // Non-critical — ignore
    }
  }

  private checkAborted(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new AbortedError();
    }
  }

  private checkTimeout(
    runStartTime: number,
    timeoutMs: number,
    controller: AbortController,
  ): void {
    if (timeoutMs > 0 && Date.now() - runStartTime >= timeoutMs) {
      this.logger.warn(`Run exceeded wall-clock timeout of ${timeoutMs}ms`);
      controller.abort();
      throw new AbortedError();
    }
  }

  private getAutonomousRunConfig(): OrchestratorConfig {
    return {
      ...AUTONOMOUS_RUN_CONFIG,
      wallClockTimeoutMs:
        parseInt(
          this.configService.get<string>(
            'AUTONOMOUS_WALL_CLOCK_TIMEOUT_MS',
            String(AUTONOMOUS_RUN_CONFIG.wallClockTimeoutMs),
          ),
          10,
        ) || AUTONOMOUS_RUN_CONFIG.wallClockTimeoutMs,
    };
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
