import { Injectable, Logger } from '@nestjs/common';
import { ToolsRegistry } from './tools.registry';
import {
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './interfaces/tool.interface';

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(private readonly registry: ToolsRegistry) {}

  registerTool(tool: Tool): void {
    this.registry.register(tool);
    this.logger.log(`Registered tool: ${tool.definition.name}`);
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.registry.getDefinitions();
  }

  getAnthropicTools(): ReturnType<ToolsRegistry['toAnthropicFormat']> {
    return this.registry.toAnthropicFormat();
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.registry.get(name);

    if (!tool) {
      this.logger.warn(`Tool not found: ${name}`);
      return {
        success: false,
        error: `Tool '${name}' not found`,
      };
    }

    try {
      this.logger.debug(`Executing tool: ${name}`, { args, context });
      const result = await tool.execute(args, context);
      this.logger.debug(`Tool execution complete: ${name}`, { result });
      return result;
    } catch (error) {
      this.logger.error(`Tool execution failed: ${name}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
