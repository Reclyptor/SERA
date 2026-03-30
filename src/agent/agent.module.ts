import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ImageStorage } from './storage/image.storage';
import { ModelModule } from './model/model.module';
import { ToolsModule } from './tools/tools.module';
import { ActionsModule } from './actions/actions.module';
import { StateModule } from './state/state.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MemoryModule } from './memory/memory.module';
import { PromptsModule } from '../prompts/prompts.module';

@Module({
  imports: [
    ModelModule,
    ToolsModule,
    ActionsModule,
    StateModule,
    KnowledgeModule,
    MemoryModule,
    PromptsModule,
  ],
  controllers: [AgentController],
  providers: [AgentService, ImageStorage],
  exports: [
    AgentService,
    ImageStorage,
    ModelModule,
    ToolsModule,
    ActionsModule,
    StateModule,
    KnowledgeModule,
    MemoryModule,
  ],
})
export class AgentModule {}
