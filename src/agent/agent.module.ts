import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ImageStorage } from './storage/image.storage';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { StateModule } from './state/state.module';
import { ChatsModule } from '../chats/chats.module';
import { AgentsModule } from '../agents/agents.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { CronModule } from './cron/cron.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [OrchestrationModule, StateModule, ChatsModule, AgentsModule, HeartbeatModule, CronModule, TasksModule],
  controllers: [AgentController],
  providers: [AgentService, ImageStorage],
  exports: [AgentService, ImageStorage, OrchestrationModule],
})
export class AgentModule {}
