import { Module } from '@nestjs/common';
import { CopilotKitController } from './copilotkit.controller';
import { CopilotKitService } from './copilotkit.service';
import { ImageStorage } from './storage/image.storage';
import { ToolsModule } from './tools/tools.module';
import { ActionsModule } from './actions/actions.module';
import { StateModule } from './state/state.module';
import { EventsModule } from './events/events.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [
    ToolsModule,
    ActionsModule,
    StateModule,
    EventsModule,
    KnowledgeModule,
  ],
  controllers: [CopilotKitController],
  providers: [CopilotKitService, ImageStorage],
  exports: [
    CopilotKitService,
    ImageStorage,
    ToolsModule,
    ActionsModule,
    StateModule,
    EventsModule,
    KnowledgeModule,
  ],
})
export class CopilotKitModule {}
