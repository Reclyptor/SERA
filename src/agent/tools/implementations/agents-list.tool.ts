import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

const ALL_TOOLS = [
  'read', 'write', 'edit', 'apply_patch',
  'exec', 'bash', 'process', 'code_execution',
  'web_search', 'web_fetch', 'x_search', 'browser',
  'image', 'image_generate', 'tts',
  'memory_search', 'memory_get',
  'message',
  'cron',
  'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn',
  'session_status', 'subagents', 'agents_list',
];

const parameters = z.object({
  includeTools: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include the list of available tools for each agent'),
});

export class AgentsListTool implements Tool<typeof parameters> {
  readonly name = 'agents_list';
  readonly description =
    'List available agent configurations and their capabilities.';
  readonly parameters = parameters;

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const agents = [
      {
        id: 'default',
        name: 'SERA Agent',
        description: 'General-purpose AI assistant with tool access',
        status: 'available',
        capabilities: [
          'web_search',
          'web_fetch',
          'file_operations',
          'code_execution',
          'memory',
          'planning',
        ],
        ...(args.includeTools && { tools: ALL_TOOLS }),
      },
    ];

    return {
      success: true,
      result: { agentCount: agents.length, agents },
    };
  }
}
