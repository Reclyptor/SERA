import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AttachmentsModule } from './attachments/attachments.module';
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
import { ModelModule } from './model/model.module';
import { DreamingModule } from './dreaming/dreaming.module';
import { PresenceModule } from './presence/presence.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ModelModule,
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
    AttachmentsModule,
    DreamingModule,
    PresenceModule,
    NotificationsModule,
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService, AttachmentsModule, OrchestrationModule],
})
export class AgentModule {}
