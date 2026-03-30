import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { ModelModule } from '../model/model.module';
import { ToolsModule } from '../tools/tools.module';
import { ActionsModule } from '../actions/actions.module';
import { StateModule } from '../state/state.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PromptsModule } from '../../prompts/prompts.module';

@Module({
  imports: [
    ModelModule,
    ToolsModule,
    ActionsModule,
    StateModule,
    MemoryModule,
    KnowledgeModule,
    PromptsModule,
  ],
  providers: [OrchestratorService, AgentEventEmitter],
  exports: [OrchestratorService, AgentEventEmitter],
})
export class OrchestrationModule {}
