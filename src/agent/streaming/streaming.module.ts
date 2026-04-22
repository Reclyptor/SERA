import { Module, forwardRef } from '@nestjs/common';
import { StreamingGateway } from './streaming.gateway';
import { AgentEventEmitter } from './agent-event-emitter';
import { RunStreamService } from './run-stream.service';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { StateModule } from '../state/state.module';

@Module({
  imports: [forwardRef(() => OrchestrationModule), StateModule],
  providers: [StreamingGateway, AgentEventEmitter, RunStreamService],
  exports: [AgentEventEmitter, RunStreamService],
})
export class StreamingModule {}
