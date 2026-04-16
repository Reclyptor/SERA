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
      agentId?: string;
      userMessage: string;
      conversationHistory: unknown[];
    },
    config?: { maxSteps?: number; maxIterations?: number },
  ): Promise<void>;
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
});

export class AgentMessageTool implements Tool<typeof parameters> {
  readonly name = 'agent_message';
  readonly description =
    'Send a message to another agent, triggering a new run on the target. Requires messaging to be enabled and the target agent to be in your allowlist.';
  readonly parameters = parameters;

  constructor(
    private readonly agentsService: AgentMessagingServiceLike,
    private readonly orchestrator: OrchestratorLike,
  ) {}

  async execute(
    args: z.infer<typeof parameters>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { targetAgentId, message, maxSteps } = args;
    const senderAgentId = context.agentId;

    if (!senderAgentId) {
      return {
        success: false,
        error: 'Agent messaging requires an agent context. This run has no associated agent.',
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

    this.orchestrator
      .executeGoal(
        {
          threadId,
          runId,
          userId: context.userId ?? `agent:${senderAgentId}`,
          agentId: targetAgentId,
          userMessage: prefixedMessage,
          conversationHistory: [],
        },
        { maxSteps, maxIterations: 2 },
      )
      .catch(() => {});

    return {
      success: true,
      result: {
        threadId,
        runId,
        targetAgentId,
        targetAgentName: target.name,
        messageSent: true,
      },
    };
  }
}
