import { Injectable, Logger } from '@nestjs/common';
import { RunStreamService } from './run-stream.service';
import type { AgentEvent, AgentEventType } from './stream.interfaces';

@Injectable()
export class AgentEventEmitter {
  private readonly logger = new Logger(AgentEventEmitter.name);

  constructor(private readonly runStream: RunStreamService) {}

  async emit(runID: string, event: AgentEvent): Promise<void> {
    try {
      const streamID = await this.runStream.appendEvent(runID, event);
      event.streamID = streamID;
    } catch (err) {
      this.logger.error(`Redis append failed for run ${runID}:`, err);
    }
  }

  async emitEvent(
    runID: string,
    threadID: string,
    type: AgentEventType,
    data: unknown,
  ): Promise<void> {
    await this.emit(runID, {
      type,
      runID,
      threadID,
      timestamp: Date.now(),
      data,
    });
  }

  async initRun(
    runID: string,
    threadID: string,
    chatID: string,
  ): Promise<void> {
    try {
      await this.runStream.initRun(runID, threadID, chatID);
    } catch (err) {
      this.logger.warn(`Redis init failed for run ${runID}:`, err);
    }
  }

  async complete(runID: string, chatID?: string): Promise<void> {
    if (chatID) {
      try {
        await this.runStream.completeRun(runID, chatID);
      } catch (err) {
        this.logger.warn(`Redis cleanup failed for run ${runID}:`, err);
      }
    }
  }
}
