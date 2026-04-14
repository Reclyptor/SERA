import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentConfig, AgentConfigSchema } from './agent-config.schema';
import { AgentBinding, AgentBindingSchema } from './agent-binding.schema';
import { AgentsService } from './agents.service';
import { AgentRouterService } from './agent-router.service';
import { AgentsController } from './agents.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentConfig.name, schema: AgentConfigSchema },
      { name: AgentBinding.name, schema: AgentBindingSchema },
    ]),
  ],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRouterService],
  exports: [AgentsService, AgentRouterService],
})
export class AgentsModule {}
