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
import { randomUUID } from 'crypto';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { ChatsService } from '../../chats/chats.service';
import type {
  AgentGoal,
  AgentPlan,
  AgentEvaluation,
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
  PlanCreatedData,
  PlanStepUpdatedData,
  EvaluationDoneData,
} from '../streaming/stream.interfaces';
import { MemoryKnowledgeProvider } from '../knowledge/providers';
import { DEFAULT_SYSTEM_PROMPT } from '../../prompts/defaults';

interface PlanJson {
  goal?: string;
  reasoning?: string;
  steps?: Array<{ id?: string; description?: string }>;
}

interface EvaluationJson {
  goalAchieved?: boolean;
  reasoning?: string;
  nextAction?: string;
  response?: string;
  followUpQuestion?: string;
}

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
  ) {}

  /**
   * Execute an agent goal. This is the main entry point for the agentic loop.
   * Runs asynchronously — the caller should subscribe to events via AgentEventEmitter.
   */
  async executeGoal(
    goal: AgentGoal,
    config: Partial<OrchestratorConfig> = {},
  ): Promise<void> {
    const cfg = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    const { threadId, runId, userId } = goal;

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    try {
      // 1. Initialize state
      await this.stateService.getOrCreateThread(threadId);
      await this.stateService.startRun(threadId, runId);

      const resolved = this.modelRouter.resolveModel(goal.modelOptions);
      this.emitEvent(runId, threadId, 'run.started', {
        provider: resolved.provider,
        modelId: resolved.modelId,
        chatId: goal.chatId,
      } satisfies RunStartedData);

      // 2. Build context
      const systemPrompt = await this.buildSystemPrompt(
        userId,
        goal.userMessage,
      );
      const toolContext = { threadId, runId, userId };
      const tools = {
        ...this.toolsService.getToolSet(toolContext),
        ...this.actionsService.getToolSet(toolContext),
      };

      // 3. Build messages — load from chat if available, otherwise use provided history
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

      // 4. Planning phase (optional)
      let plan: AgentPlan | undefined;
      if (cfg.planningEnabled) {
        plan = await this.planGoal(goal, systemPrompt, abortController.signal);
        if (plan) {
          await this.stateService.setCustomState(threadId, 'plan', plan);
          this.emitEvent(runId, threadId, 'plan.created', {
            plan,
          } satisfies PlanCreatedData);
        }
      }

      // 5. Execution loop with evaluation
      let replanCount = 0;
      let iterationCount = 0;
      let executionComplete = false;
      let lastReasoningText: string | undefined;
      let thinkingStartTime: number | null = null;
      let lastThinkingDuration: number | undefined;

      while (
        !executionComplete &&
        replanCount <= cfg.maxReplans &&
        iterationCount < cfg.maxIterations
      ) {
        iterationCount++;
        this.checkAborted(abortController);

        // Ensure messages end with a user message (required by Anthropic)
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role !== 'user') {
          messages.push({ role: 'user', content: 'Continue.' });
        }

        let accumulatedReasoning = '';
        let accumulatedText = '';

        const streamResult = this.modelRouter.stream({
          messages,
          tools,
          system: systemPrompt,
          stopSteps: cfg.maxSteps,
          options: goal.modelOptions,
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
        }

        const [steps, streamResponse] = await Promise.all([
          streamResult.steps,
          streamResult.response,
        ]);

        // Track tool calls in state
        const hadToolCalls = steps.some((s) => s.toolCalls.length > 0);
        for (const step of steps) {
          for (const tc of step.toolCalls) {
            await this.stateService.recordToolCall(
              threadId,
              tc.toolName,
              (tc.input ?? {}) as Record<string, unknown>,
            );
          }
        }

        // Update plan step progress
        if (plan) {
          this.updatePlanProgress(plan, steps, runId, threadId);
        }

        // Append assistant response to messages for context
        if (streamResponse.messages) {
          messages.push(
            ...(streamResponse.messages as unknown as CoreMessage[]),
          );
        }

        // 6. Evaluation phase — skip when no tools were called (pure conversational turn)
        if (cfg.evaluationEnabled && accumulatedText && hadToolCalls) {
          const evaluation = await this.evaluateResult(
            goal,
            accumulatedText,
            plan,
            systemPrompt,
            abortController.signal,
          );

          this.emitEvent(runId, threadId, 'evaluation.done', {
            goalAchieved: evaluation.goalAchieved,
            reasoning: evaluation.reasoning,
            nextAction: evaluation.nextAction,
          } satisfies EvaluationDoneData);

          switch (evaluation.nextAction) {
            case 'complete':
              executionComplete = true;
              await this.completeRun(
                goal,
                evaluation.response ?? accumulatedText,
                lastReasoningText,
                lastThinkingDuration,
              );
              break;

            case 'continue':
              break;

            case 'replan':
              replanCount++;
              if (replanCount <= cfg.maxReplans) {
                this.logger.debug(
                  `Replanning (attempt ${replanCount}/${cfg.maxReplans})`,
                );
                plan = await this.planGoal(
                  goal,
                  systemPrompt,
                  abortController.signal,
                );
                if (plan) {
                  await this.stateService.setCustomState(
                    threadId,
                    'plan',
                    plan,
                  );
                  this.emitEvent(runId, threadId, 'plan.created', {
                    plan,
                  } satisfies PlanCreatedData);
                }
              }
              break;

            case 'ask_user':
              executionComplete = true;
              await this.completeRun(
                goal,
                evaluation.followUpQuestion ?? accumulatedText,
                lastReasoningText,
                lastThinkingDuration,
              );
              break;
          }
        } else {
          // No evaluation needed — treat the result as final
          executionComplete = true;
          await this.completeRun(
            goal,
            accumulatedText,
            lastReasoningText,
            lastThinkingDuration,
          );
        }
      }

      if (!executionComplete) {
        await this.completeRun(
          goal,
          'I was unable to fully achieve the goal after multiple attempts. Here is what I have so far.',
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

  /**
   * Cancel a running execution.
   */
  cancelRun(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  // ─── Private helpers ───

  private async buildSystemPrompt(
    userId: string,
    query: string,
  ): Promise<string> {
    let basePrompt: string;
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

    const parts: string[] = [basePrompt];

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

    return parts.join('\n\n');
  }

  private async planGoal(
    goal: AgentGoal,
    systemPrompt: string,
    abortSignal: AbortSignal,
  ): Promise<AgentPlan | undefined> {
    const planningPrompt = `${systemPrompt}

You are in PLANNING mode. Analyze the user's request and create a structured plan.
Respond with ONLY a JSON object in this format:
{
  "goal": "concise restatement of the goal",
  "reasoning": "brief analysis of what needs to be done",
  "steps": [
    { "id": "1", "description": "step description", "status": "pending" }
  ]
}

If the request is simple and doesn't need a multi-step plan, return a single step.
Do NOT include any text outside the JSON object.`;

    try {
      const result = await this.modelRouter.generate({
        messages: [
          ...goal.conversationHistory,
          { role: 'user', content: goal.userMessage },
        ],
        system: planningPrompt,
        options: goal.modelOptions,
        abortSignal,
      });

      return this.parsePlan(result.text);
    } catch (error) {
      this.logger.warn('Planning failed, proceeding without plan:', error);
      return undefined;
    }
  }

  private parsePlan(text: string): AgentPlan | undefined {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return undefined;

      const parsed = JSON.parse(jsonMatch[0]) as PlanJson;

      if (!parsed.steps || !Array.isArray(parsed.steps)) return undefined;

      return {
        goal: parsed.goal ?? '',
        reasoning: parsed.reasoning ?? '',
        steps: parsed.steps.map(
          (s: { id?: string; description?: string }, i: number) => ({
            id: s.id ?? String(i + 1),
            description: s.description ?? '',
            status: 'pending' as const,
          }),
        ),
      };
    } catch {
      this.logger.warn('Failed to parse plan JSON');
      return undefined;
    }
  }

  private async evaluateResult(
    goal: AgentGoal,
    resultText: string,
    plan: AgentPlan | undefined,
    systemPrompt: string,
    abortSignal: AbortSignal,
  ): Promise<AgentEvaluation> {
    const evalPrompt = `${systemPrompt}

You are in EVALUATION mode. Assess whether the agent's response achieves the user's goal.

User's request: ${goal.userMessage}
${plan ? `Plan: ${JSON.stringify(plan)}` : ''}
Agent's response: ${resultText}

Respond with ONLY a JSON object:
{
  "goalAchieved": true/false,
  "reasoning": "brief assessment",
  "nextAction": "complete" | "continue" | "replan" | "ask_user",
  "response": "final response to show the user (if complete)",
  "followUpQuestion": "question for user (if ask_user)"
}

- "complete": the goal is achieved, return the response
- "continue": more tool calls are needed
- "replan": the approach isn't working, create a new plan
- "ask_user": clarification is needed from the user`;

    try {
      const result = await this.modelRouter.generate({
        messages: [{ role: 'user', content: 'Evaluate the result.' }],
        system: evalPrompt,
        options: goal.modelOptions,
        abortSignal,
      });

      return this.parseEvaluation(result.text, resultText);
    } catch {
      return {
        goalAchieved: true,
        reasoning: 'Evaluation unavailable',
        nextAction: 'complete',
        response: resultText,
      };
    }
  }

  private parseEvaluation(
    text: string,
    fallbackResponse: string,
  ): AgentEvaluation {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          goalAchieved: true,
          reasoning: 'Could not parse evaluation',
          nextAction: 'complete',
          response: fallbackResponse,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as EvaluationJson;
      return {
        goalAchieved: parsed.goalAchieved ?? true,
        reasoning: parsed.reasoning ?? '',
        nextAction:
          (parsed.nextAction as AgentEvaluation['nextAction']) ?? 'complete',
        response: parsed.response ?? fallbackResponse,
        followUpQuestion: parsed.followUpQuestion,
      };
    } catch {
      return {
        goalAchieved: true,
        reasoning: 'Could not parse evaluation',
        nextAction: 'complete',
        response: fallbackResponse,
      };
    }
  }

  private updatePlanProgress(
    plan: AgentPlan,
    steps: Array<{ toolCalls: Array<{ toolName: string }> }>,
    runId: string,
    threadId: string,
  ): void {
    const toolCallCount = steps.reduce((sum, s) => sum + s.toolCalls.length, 0);

    if (toolCallCount > 0 && plan.steps.length > 0) {
      const pendingIdx = plan.steps.findIndex((s) => s.status === 'pending');
      if (pendingIdx !== -1) {
        plan.steps[pendingIdx].status = 'in_progress';
        this.emitEvent(runId, threadId, 'plan.step_updated', {
          step: plan.steps[pendingIdx],
          stepIndex: pendingIdx,
          totalSteps: plan.steps.length,
        } satisfies PlanStepUpdatedData);
      }
    }
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
