import { Module } from '@nestjs/common';
import { CopilotKitController } from './copilotkit.controller';
import { CopilotKitService } from './copilotkit.service';
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
  providers: [CopilotKitService],
  exports: [
    CopilotKitService,
    ToolsModule,
    ActionsModule,
    StateModule,
    EventsModule,
    KnowledgeModule,
  ],
})
export class CopilotKitModule {}
