import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MemoryModule } from '../memory/memory.module';
import { StateModule } from '../state/state.module';
import { ChatsModule } from '../../chats/chats.module';
import { AgentsModule } from '../../agents/agents.module';
import { StreamingModule } from '../streaming/streaming.module';
import { ToolsRegistry } from './tools.registry';
import { ToolsService } from './tools.service';
import { ToolsBootstrapService } from './tools-bootstrap.service';
import { LoopDetectionService } from './loop-detection.service';
import { ToolApprovalService } from './tool-approval.service';

@Module({
  imports: [
    ConfigModule,
    MemoryModule,
    StateModule,
    ChatsModule,
    AgentsModule,
    StreamingModule,
  ],
  providers: [
    ToolsRegistry,
    ToolsService,
    ToolsBootstrapService,
    LoopDetectionService,
    ToolApprovalService,
  ],
  exports: [
    ToolsService,
    ToolsRegistry,
    LoopDetectionService,
    ToolApprovalService,
  ],
})
export class ToolsModule {}
