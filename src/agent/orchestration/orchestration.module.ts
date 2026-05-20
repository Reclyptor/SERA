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
import { CommitmentsModule } from '../commitments/commitments.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AttachmentMessageResolverService } from './attachment-message-resolver.service';
import { AiSdkAgentRuntimeService } from './ai-sdk-agent-runtime.service';

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
    CommitmentsModule,
    AttachmentsModule,
  ],
  providers: [
    OrchestratorService,
    AiSdkAgentRuntimeService,
    PromptBuilderService,
    AttachmentMessageResolverService,
  ],
  exports: [OrchestratorService, StreamingModule],
})
export class OrchestrationModule {}
