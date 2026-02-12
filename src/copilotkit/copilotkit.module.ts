import { Module } from '@nestjs/common';
import { CopilotKitController } from './copilotkit.controller';
import { CopilotKitService } from './copilotkit.service';
import { ImageStorage } from './storage/image.storage';
import { ToolsModule } from './tools/tools.module';
import { ActionsModule } from './actions/actions.module';
import { StateModule } from './state/state.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MemoryModule } from './memory/memory.module';

@Module({
  imports: [
    ToolsModule,
    ActionsModule,
    StateModule,
    KnowledgeModule,
    MemoryModule,
  ],
  controllers: [CopilotKitController],
  providers: [CopilotKitService, ImageStorage],
  exports: [
    CopilotKitService,
    ImageStorage,
    ToolsModule,
    ActionsModule,
    StateModule,
    KnowledgeModule,
    MemoryModule,
  ],
})
export class CopilotKitModule {}
