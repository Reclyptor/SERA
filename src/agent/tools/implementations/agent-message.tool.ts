import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface AgentMessagingServiceLike {
  findById(agentId: string): Promise<{
    agentId: string;
    name: string;
    enabled: boolean;
    messagingPolicy: {
      enabled: boolean;
      allowedAgents: string[];
    };
  } | null>;
}

export interface OrchestratorLike {
  executeGoal(
    goal: {
      threadId: string;
      runId: string;
      userId: string;
      agentId: string;
      userMessage: string;
      conversationHistory: unknown[];
      delegationDepth?: number;
    },
    config?: { maxSteps?: number; maxIterations?: number },
  ): Promise<void>;
}

export interface RunReaderLike {
  getRunResponse(runId: string): Promise<{
    status: string;
    response?: string;
  } | null>;
}

const parameters = z.object({
  targetAgentId: z
    .string()
    .describe('ID of the agent to send a message to'),
  message: z
    .string()
    .describe('Message content to send to the target agent'),
  maxSteps: z
    .number()
    .optional()
    .default(10)
    .describe('Max tool steps for the target agent run'),
  waitForResult: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, block until the target agent completes and return its response. If false, return immediately with the runId.'),
  timeoutMs: z
    .number()
    .optional()
    .default(120_000)
    .describe('Timeout in ms when waitForResult is true (default: 120000)'),
});

const MAX_DELEGATION_DEPTH = 3;

export class AgentMessageTool implements Tool<typeof parameters> {
  readonly name = 'agent_message';
  readonly description =
    'Send a message to another agent, triggering a new run on the target. Set waitForResult=true to block until the target completes and get its response inline.';
  readonly parameters = parameters;

  constructor(
    private readonly agentsService: AgentMessagingServiceLike,
    private readonly orchestrator: OrchestratorLike,
    private readonly runReader: RunReaderLike,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { targetAgentId, message, maxSteps, waitForResult, timeoutMs } = args;
    const senderAgentId = context.agentId;
    const currentDepth = context.delegationDepth ?? 0;

    if (currentDepth >= MAX_DELEGATION_DEPTH) {
      return {
        success: false,
        error: `Delegation depth limit reached (max ${MAX_DELEGATION_DEPTH}). Cannot delegate further.`,
      };
    }

    if (targetAgentId === senderAgentId) {
      return {
        success: false,
        error: 'An agent cannot send a message to itself.',
      };
    }

    const sender = await this.agentsService.findById(senderAgentId);
    if (!sender) {
      return {
        success: false,
        error: `Sender agent "${senderAgentId}" not found.`,
      };
    }

    if (!sender.messagingPolicy.enabled) {
      return {
        success: false,
        error: `Messaging is disabled for agent "${senderAgentId}". Enable it in the agent config.`,
      };
    }

    if (
      sender.messagingPolicy.allowedAgents.length > 0 &&
      !sender.messagingPolicy.allowedAgents.includes(targetAgentId)
    ) {
      return {
        success: false,
        error: `Agent "${senderAgentId}" is not allowed to message "${targetAgentId}". Add it to the allowedAgents list.`,
      };
    }

    const target = await this.agentsService.findById(targetAgentId);
    if (!target) {
      return {
        success: false,
        error: `Target agent "${targetAgentId}" not found.`,
      };
    }

    if (!target.enabled) {
      return {
        success: false,
        error: `Target agent "${targetAgentId}" is disabled.`,
      };
    }

    const threadId = crypto.randomUUID();
    const runId = crypto.randomUUID();

    const prefixedMessage = `[Message from agent "${sender.name}" (${senderAgentId})]\n\n${message}`;

    const goalPromise = this.orchestrator.executeGoal(
      {
        threadId,
        runId,
        userId: context.userId ?? `agent:${senderAgentId}`,
        agentId: targetAgentId,
        userMessage: prefixedMessage,
        conversationHistory: [],
        delegationDepth: currentDepth + 1,
      },
      { maxSteps, maxIterations: 2 },
    );

    const baseResult = {
      threadId,
      runId,
      targetAgentId,
      targetAgentName: target.name,
    };

    if (waitForResult) {
      try {
        await Promise.race([
          goalPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs),
          ),
        ]);

        const run = await this.runReader.getRunResponse(runId);
        return {
          success: true,
          result: {
            ...baseResult,
            status: run?.status ?? 'completed',
            response: run?.response ?? null,
          },
        };
      } catch (err) {
        if (err instanceof Error && err.message === 'timeout') {
          return {
            success: true,
            result: {
              ...baseResult,
              status: 'running',
              timedOut: true,
            },
          };
        }
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Agent message failed',
        };
      }
    }

    goalPromise.catch(() => {});

    return {
      success: true,
      result: { ...baseResult, messageSent: true },
    };
  }
}
