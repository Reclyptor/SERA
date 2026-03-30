import { Injectable, Logger } from '@nestjs/common';
import { OrchestratorService } from './orchestration/orchestrator.service';
import { AgentEventEmitter } from './streaming/agent-event-emitter';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly eventEmitter: AgentEventEmitter,
  ) {
    this.logger.log('Agent service initialized');
  }

  get orchestratorService(): OrchestratorService {
    return this.orchestrator;
  }

  get events(): AgentEventEmitter {
    return this.eventEmitter;
  }
}
