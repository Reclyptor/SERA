import { Injectable } from '@nestjs/common';
import type { StreamTextResult, ToolSet } from 'ai';
import { ModelRouterService } from '../model/model-router.service';
import type {
  AgentRuntime,
  AgentRuntimeStreamInput,
} from './agent-runtime.interface';

@Injectable()
export class AiSdkAgentRuntimeService implements AgentRuntime {
  constructor(private readonly modelRouter: ModelRouterService) {}

  async streamAttempt(
    input: AgentRuntimeStreamInput,
  ): Promise<StreamTextResult<ToolSet, never>> {
    return this.modelRouter.stream({
      messages: input.messages,
      tools: input.tools,
      system: input.system,
      stopSteps: input.stopSteps,
      maxOutputTokens: input.maxOutputTokens,
      temperature: input.temperature,
      options: input.options,
      abortSignal: input.abortSignal,
      onAttempt: input.onAttempt,
      onFallback: input.onFallback,
    });
  }
}
