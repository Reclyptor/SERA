import { Module } from '@nestjs/common';
import { AgentEventEmitter } from './agent-event-emitter';
import { RunStreamService } from './run-stream.service';

@Module({
  providers: [AgentEventEmitter, RunStreamService],
  exports: [AgentEventEmitter, RunStreamService],
})
export class StreamingModule {}
