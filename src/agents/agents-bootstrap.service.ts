import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentRouterService } from './agent-router.service';

const DEFAULT_AGENT_ID = 'default';

@Injectable()
export class AgentsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AgentsBootstrapService.name);

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentRouter: AgentRouterService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultAgent();
  }

  private async seedDefaultAgent(): Promise<void> {
    const existing = await this.agentsService.findById(DEFAULT_AGENT_ID);
    if (existing) return;

    this.logger.log('Seeding default agent configuration...');

    await this.agentsService.create({
      agentId: DEFAULT_AGENT_ID,
      name: 'SERA',
      description: 'Default agent — handles all unrouted requests',
      enabled: true,
    });

    await this.agentRouter.createBinding({
      agentId: DEFAULT_AGENT_ID,
      bindingType: 'default',
    });

    this.logger.log('Default agent and binding created');
  }
}
