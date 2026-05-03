import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { PromptBuilderService } from './prompt-builder.service';
import { StreamingModule } from '../streaming/streaming.module';
import { ModelModule } from '../model/model.module';
import { ToolsModule } from '../tools/tools.module';
import { ActionsModule } from '../actions/actions.module';
import { StateModule } from '../state/state.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PromptsModule } from '../../prompts/prompts.module';
import { ChatsModule } from '../../chats/chats.module';
import { AgentsModule } from '../../agents/agents.module';
import { SkillsModule } from '../skills/skills.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { ContextModule } from '../context/context.module';
import { InsightsModule } from '../insights/insights.module';

@Module({
  imports: [
    forwardRef(() => StreamingModule),
    ModelModule,
    ToolsModule,
    ActionsModule,
    StateModule,
    MemoryModule,
    KnowledgeModule,
    PromptsModule,
    ChatsModule,
    AgentsModule,
    SkillsModule,
    SandboxModule,
    ContextModule,
    InsightsModule,
  ],
  providers: [OrchestratorService, PromptBuilderService],
  exports: [OrchestratorService, StreamingModule],
})
export class OrchestrationModule {}
