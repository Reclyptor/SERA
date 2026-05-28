import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MemoryModule } from '../memory/memory.module';
import { StateModule } from '../state/state.module';
import { ChatsModule } from '../../chats/chats.module';
import { AgentsModule } from '../../agents/agents.module';
import { StreamingModule } from '../streaming/streaming.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { TasksModule } from '../tasks/tasks.module';
import { TriggersModule } from '../triggers/triggers.module';
import { McpModule } from '../mcp/mcp.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { SkillsModule } from '../skills/skills.module';
import { CronModule } from '../cron/cron.module';
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
    SandboxModule,
    TasksModule,
    TriggersModule,
    McpModule,
    // The three below create import cycles with ToolsModule (each module
    // imports ToolsModule directly or transitively). forwardRef defers
    // resolution so NestJS can close the ring at runtime.
    forwardRef(() => OrchestrationModule),
    forwardRef(() => SkillsModule),
    forwardRef(() => CronModule),
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
