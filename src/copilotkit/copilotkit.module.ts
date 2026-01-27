import { Module } from '@nestjs/common';
import { CopilotKitController } from './copilotkit.controller';
import { CopilotKitService } from './copilotkit.service';
import { ImageStorage } from './storage/image.storage';
import { ToolsModule } from './tools';
import { ActionsModule } from './actions';
import { StateModule } from './state';
import { EventsModule } from './events';
import { KnowledgeModule } from './knowledge';

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
