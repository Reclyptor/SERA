import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface AgentMessagingServiceLike {
  findByID(agentID: string): Promise<{
    agentID: string;
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
      threadID: string;
      runID: string;
      userID: string;
      agentID: string;
      userMessage: string;
      conversationHistory: unknown[];
      delegationDepth?: number;
    },
    config?: { maxSteps?: number; maxIterations?: number },
  ): Promise<void>;
}

export interface RunReaderLike {
  getRunResponse(runID: string): Promise<{
    status: string;
    response?: string;
  } | null>;
}

const parameters = z.object({
  targetAgentID: z.string().describe('ID of the agent to send a message to'),
  message: z.string().describe('Message content to send to the target agent'),
  maxSteps: z
    .number()
    .optional()
    .default(10)
    .describe('Max tool steps for the target agent run'),
  waitForResult: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, block until the target agent completes and return its response. If false, return immediately with the runID.',
    ),
  timeoutMs: z
    .number()
    .optional()
    .default(120_000)
    .describe('Timeout in ms when waitForResult is true (default: 120000)'),
});

const MAX_DELEGATION_DEPTH = 2;

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
    const { targetAgentID, message, maxSteps, waitForResult, timeoutMs } = args;
    const senderAgentID = context.agentID;
    const currentDepth = context.delegationDepth ?? 0;

    if (currentDepth >= MAX_DELEGATION_DEPTH) {
      return {
        success: false,
        error: `Delegation depth limit reached (max ${MAX_DELEGATION_DEPTH}). Cannot delegate further.`,
      };
    }

    if (targetAgentID === senderAgentID) {
      return {
        success: false,
        error: 'An agent cannot send a message to itself.',
      };
    }

    const sender = await this.agentsService.findByID(senderAgentID);
    if (!sender) {
      return {
        success: false,
        error: `Sender agent "${senderAgentID}" not found.`,
      };
    }

    if (!sender.messagingPolicy.enabled) {
      return {
        success: false,
        error: `Messaging is disabled for agent "${senderAgentID}". Enable it in the agent config.`,
      };
    }

    if (
      sender.messagingPolicy.allowedAgents.length > 0 &&
      !sender.messagingPolicy.allowedAgents.includes(targetAgentID)
    ) {
      return {
        success: false,
        error: `Agent "${senderAgentID}" is not allowed to message "${targetAgentID}". Add it to the allowedAgents list.`,
      };
    }

    const target = await this.agentsService.findByID(targetAgentID);
    if (!target) {
      return {
        success: false,
        error: `Target agent "${targetAgentID}" not found.`,
      };
    }

    if (!target.enabled) {
      return {
        success: false,
        error: `Target agent "${targetAgentID}" is disabled.`,
      };
    }

    const threadID = crypto.randomUUID();
    const runID = crypto.randomUUID();

    const prefixedMessage = `[Message from agent "${sender.name}" (${senderAgentID})]\n\n${message}`;

    const goalPromise = this.orchestrator.executeGoal(
      {
        threadID,
        runID,
        userID: context.userID ?? `agent:${senderAgentID}`,
        agentID: targetAgentID,
        userMessage: prefixedMessage,
        conversationHistory: [],
        delegationDepth: currentDepth + 1,
      },
      { maxSteps, maxIterations: 2 },
    );

    const baseResult = {
      threadID,
      runID,
      targetAgentID,
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

        const run = await this.runReader.getRunResponse(runID);
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
