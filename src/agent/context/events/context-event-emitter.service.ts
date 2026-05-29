import { Injectable } from '@nestjs/common';
import { AgentEventEmitter } from '../../streaming/agent-event-emitter';
import type {
  ContextCompressionCompletedData,
  ContextCompressionSkippedData,
  ContextCompressionStartedData,
  ContextReferenceExpandedData,
} from '../../streaming/stream.interfaces';

@Injectable()
export class ContextEventEmitterService {
  constructor(private readonly events: AgentEventEmitter) {}

  emitCompressionStarted(
    runID: string,
    threadID: string,
    data: ContextCompressionStartedData,
  ): Promise<void> {
    return this.events.emitEvent(
      runID,
      threadID,
      'context.compression.started',
      data,
    );
  }

  emitCompressionCompleted(
    runID: string,
    threadID: string,
    data: ContextCompressionCompletedData,
  ): Promise<void> {
    return this.events.emitEvent(
      runID,
      threadID,
      'context.compression.completed',
      data,
    );
  }

  emitCompressionSkipped(
    runID: string,
    threadID: string,
    data: ContextCompressionSkippedData,
  ): Promise<void> {
    return this.events.emitEvent(
      runID,
      threadID,
      'context.compression.skipped',
      data,
    );
  }

  emitReferenceExpanded(
    runID: string,
    threadID: string,
    data: ContextReferenceExpandedData,
  ): Promise<void> {
    return this.events.emitEvent(
      runID,
      threadID,
      'context.reference.expanded',
      data,
    );
  }
}
