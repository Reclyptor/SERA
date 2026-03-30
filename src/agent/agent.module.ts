import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ImageStorage } from './storage/image.storage';
import { OrchestrationModule } from './orchestration/orchestration.module';

@Module({
  imports: [OrchestrationModule],
  controllers: [AgentController],
  providers: [AgentService, ImageStorage],
  exports: [AgentService, ImageStorage, OrchestrationModule],
})
export class AgentModule {}
