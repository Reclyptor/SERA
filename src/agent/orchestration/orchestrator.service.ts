import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoreMessage, ToolSet } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import { ToolsService } from '../tools/tools.service';
import { ActionsService } from '../actions/actions.service';
import { StateService } from '../state/state.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PromptsService } from '../../prompts/prompts.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import type {
  AgentGoal,
  AgentPlan,
  AgentStep,
  AgentEvaluation,
  OrchestratorConfig,
} from './orchestration.interfaces';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './orchestration.interfaces';
import type {
  RunStartedData,
  RunCompletedData,
  RunFailedData,
  PlanCreatedData,
  PlanStepUpdatedData,
  EvaluationDoneData,
} from '../streaming/stream.interfaces';

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
      } satisfies RunStartedData);

      // 2. Build context
      const systemPrompt = await this.buildSystemPrompt(userId, goal.userMessage);
      const toolContext = { threadId, runId, userId };
      const tools = {
        ...this.toolsService.getToolSet(toolContext),
        ...this.actionsService.getToolSet(toolContext),
      };

      // 3. Build messages
      const messages: CoreMessage[] = [
        ...goal.conversationHistory,
        { role: 'user', content: goal.userMessage },
      ];

      // 4. Planning phase (optional)
      let plan: AgentPlan | undefined;
      if (cfg.planningEnabled) {
        plan = await this.planGoal(
          goal,
          systemPrompt,
          abortController.signal,
        );
        if (plan) {
          await this.stateService.setCustomState(threadId, 'plan', plan);
          this.emitEvent(runId, threadId, 'plan.created', {
            plan,
          } satisfies PlanCreatedData);
        }
      }

      // 5. Execution loop with evaluation
      let replanCount = 0;
      let executionComplete = false;

      while (!executionComplete && replanCount <= cfg.maxReplans) {
        this.checkAborted(abortController);

        // Execute with tools
        const result = await this.modelRouter.generate({
          messages,
          tools,
          system: systemPrompt,
          stopSteps: cfg.maxSteps,
          options: goal.modelOptions,
          abortSignal: abortController.signal,
        });

        // Track tool calls in state
        for (const step of result.steps) {
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
          await this.updatePlanProgress(plan, result.steps, runId, threadId);
        }

        // Append assistant response to messages for context
        if (result.response.messages) {
          messages.push(
            ...(result.response.messages as unknown as CoreMessage[]),
          );
        }

        // 6. Evaluation phase (optional)
        if (cfg.evaluationEnabled && result.text) {
          const evaluation = await this.evaluateResult(
            goal,
            result.text,
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
                evaluation.response ?? result.text,
                messages,
              );
              break;

            case 'continue':
              // The model wants to do more work — loop again
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
                evaluation.followUpQuestion ?? result.text,
                messages,
              );
              break;
          }
        } else {
          // No evaluation — treat the result as final
          executionComplete = true;
          await this.completeRun(goal, result.text, messages);
        }
      }

      if (!executionComplete) {
        // Exhausted replans
        await this.completeRun(
          goal,
          'I was unable to fully achieve the goal after multiple attempts. Here is what I have so far.',
          messages,
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
    const parts: string[] = [];

    try {
      const basePrompt = await this.promptsService.get('system');
      if (basePrompt) parts.push(basePrompt);
    } catch {
      // Never fail for prompt errors
    }

    try {
      const memoryContext = await this.memoryService.getContextForQuery(
        userId,
        query,
      );
      if (memoryContext) parts.push(memoryContext);
    } catch {
      // Never fail for memory errors
    }

    try {
      const knowledgeContext = await this.knowledgeService.buildContext(query);
      if (knowledgeContext.length > 0) {
        parts.push(this.knowledgeService.formatContextForPrompt(knowledgeContext));
      }
    } catch {
      // Never fail for knowledge errors
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
      // Extract JSON from the response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return undefined;

      const parsed = JSON.parse(jsonMatch[0]);

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
      // If evaluation fails, treat as complete
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

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        goalAchieved: parsed.goalAchieved ?? true,
        reasoning: parsed.reasoning ?? '',
        nextAction: parsed.nextAction ?? 'complete',
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

  private async updatePlanProgress(
    plan: AgentPlan,
    steps: Array<{ toolCalls: Array<{ toolName: string }> }>,
    runId: string,
    threadId: string,
  ): Promise<void> {
    // Simple heuristic: mark plan steps as in_progress/completed
    // based on the number of execution steps completed
    const toolCallCount = steps.reduce(
      (sum, s) => sum + s.toolCalls.length,
      0,
    );

    if (toolCallCount > 0 && plan.steps.length > 0) {
      // Mark first pending step as in_progress
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
    messages: CoreMessage[],
  ): Promise<void> {
    const { runId, threadId, userId } = goal;

    await this.stateService.completeRun(runId);

    this.emitEvent(runId, threadId, 'run.completed', {
      response,
    } satisfies RunCompletedData);

    // Extract memories in the background
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
