import { Injectable } from '@nestjs/common';
import { Subject, Observable, filter } from 'rxjs';
import type { AgentEvent, AgentEventType } from './stream.interfaces';

@Injectable()
export class AgentEventEmitter {
  private readonly subjects = new Map<string, Subject<AgentEvent>>();

  /**
   * Get or create an event stream for a run.
   */
  getStream(runID: string): Observable<AgentEvent> {
    return this.getOrCreateSubject(runID).asObservable();
  }

  /**
   * Get a filtered stream for specific event types.
   */
  getFilteredStream(
    runID: string,
    ...types: AgentEventType[]
  ): Observable<AgentEvent> {
    const typeSet = new Set(types);
    return this.getStream(runID).pipe(
      filter((event) => typeSet.has(event.type)),
    );
  }

  /**
   * Emit an event to all subscribers of a run.
   */
  emit(runID: string, event: AgentEvent): void {
    this.getOrCreateSubject(runID).next(event);
  }

  /**
   * Helper to create and emit an event in one call.
   */
  emitEvent(
    runID: string,
    threadID: string,
    type: AgentEventType,
    data: unknown,
  ): void {
    this.emit(runID, {
      type,
      runID,
      threadID,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Complete the stream for a run (signals no more events).
   */
  complete(runID: string): void {
    const subject = this.subjects.get(runID);
    if (subject) {
      subject.complete();
      this.subjects.delete(runID);
    }
  }

  /**
   * Check if a run has an active stream.
   */
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
