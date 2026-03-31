import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { StreamingModule } from '../streaming/streaming.module';
import { ModelModule } from '../model/model.module';
import { ToolsModule } from '../tools/tools.module';
import { ActionsModule } from '../actions/actions.module';
import { StateModule } from '../state/state.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PromptsModule } from '../../prompts/prompts.module';

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
  ],
  providers: [OrchestratorService],
  exports: [OrchestratorService, StreamingModule],
})
export class OrchestrationModule {}
