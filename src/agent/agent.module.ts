import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ImageStorageModule } from './storage/image-storage.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { StateModule } from './state/state.module';
import { ChatsModule } from '../chats/chats.module';
import { AgentsModule } from '../agents/agents.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { CronModule } from './cron/cron.module';
import { TasksModule } from './tasks/tasks.module';
import { TriggersModule } from './triggers/triggers.module';
import { SandboxModule } from './sandbox/sandbox.module';
import { InsightsModule } from './insights/insights.module';
import { McpModule } from './mcp/mcp.module';
import { PluginsModule } from './plugins/plugins.module';

@Module({
  imports: [
    OrchestrationModule,
    StateModule,
    ChatsModule,
    AgentsModule,
    HeartbeatModule,
    CronModule,
    TasksModule,
    TriggersModule,
    SandboxModule,
    InsightsModule,
    McpModule,
    PluginsModule,
    ImageStorageModule,
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService, ImageStorageModule, OrchestrationModule],
})
export class AgentModule {}
