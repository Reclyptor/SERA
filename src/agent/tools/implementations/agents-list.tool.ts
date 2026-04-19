import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

export interface AgentsServiceLike {
  findAll(): Promise<
    Array<{
      agentID: string;
      name: string;
      description: string;
      enabled: boolean;
      toolPolicy: { mode: string; tools: string[] };
    }>
  >;
}

const parameters = z.object({
  includeTools: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include tool policy details for each agent'),
  enabledOnly: z
    .boolean()
    .optional()
    .default(true)
    .describe('Only show enabled agents'),
});

export class AgentsListTool implements Tool<typeof parameters> {
  readonly name = 'agents_list';
  readonly parallelSafe = true;
  readonly description =
    'List available agent configurations and their capabilities.';
  readonly parameters = parameters;

  constructor(private readonly agentsService: AgentsServiceLike) {}

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      let agents = await this.agentsService.findAll();

      if (args.enabledOnly) {
        agents = agents.filter((a) => a.enabled);
      }

      const result = agents.map((a) => ({
        agentID: a.agentID,
        name: a.name,
        description: a.description,
        enabled: a.enabled,
        ...(args.includeTools && {
          toolPolicy: a.toolPolicy,
        }),
      }));

      return {
        success: true,
        result: { agentCount: result.length, agents: result },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
      };
    }
  }
}
