import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable, filter } from 'rxjs';
import { RunStreamService } from './run-stream.service';
import type { AgentEvent, AgentEventType } from './stream.interfaces';

@Injectable()
export class AgentEventEmitter {
  private readonly logger = new Logger(AgentEventEmitter.name);
  private readonly subjects = new Map<string, Subject<AgentEvent>>();

  constructor(private readonly runStream: RunStreamService) {}

  getStream(runID: string): Observable<AgentEvent> {
    return this.getOrCreateSubject(runID).asObservable();
  }

  getFilteredStream(
    runID: string,
    ...types: AgentEventType[]
  ): Observable<AgentEvent> {
    const typeSet = new Set(types);
    return this.getStream(runID).pipe(
      filter((event) => typeSet.has(event.type)),
    );
  }

  async emit(runID: string, event: AgentEvent): Promise<void> {
    try {
      const streamID = await this.runStream.appendEvent(runID, event);
      event.streamID = streamID;
    } catch (err) {
      this.logger.warn(`Redis append failed for run ${runID}, delivering in-memory only:`, err);
    }
    this.getOrCreateSubject(runID).next(event);
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

  async initRun(runID: string, threadID: string, chatID: string): Promise<void> {
    try {
      await this.runStream.initRun(runID, threadID, chatID);
    } catch (err) {
      this.logger.warn(`Redis init failed for run ${runID}:`, err);
    }
  }

  async complete(runID: string, chatID?: string): Promise<void> {
    const subject = this.subjects.get(runID);
    if (subject) {
      subject.complete();
      this.subjects.delete(runID);
    }
    if (chatID) {
      try {
        await this.runStream.completeRun(runID, chatID);
      } catch (err) {
        this.logger.warn(`Redis cleanup failed for run ${runID}:`, err);
      }
    }
  }

  hasStream(runID: string): boolean {
    return this.subjects.has(runID);
  }

  private getOrCreateSubject(runID: string): Subject<AgentEvent> {
    let subject = this.subjects.get(runID);
    if (!subject) {
      subject = new Subject<AgentEvent>();
      this.subjects.set(runID, subject);
    }
    return subject;
  }
}
