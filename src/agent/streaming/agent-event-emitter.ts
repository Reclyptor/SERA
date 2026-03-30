import { Injectable } from '@nestjs/common';
import { Subject, Observable, filter } from 'rxjs';
import type { AgentEvent, AgentEventType } from './stream.interfaces';

@Injectable()
export class AgentEventEmitter {
  private readonly subjects = new Map<string, Subject<AgentEvent>>();

  /**
   * Get or create an event stream for a run.
   */
  getStream(runId: string): Observable<AgentEvent> {
    return this.getOrCreateSubject(runId).asObservable();
  }

  /**
   * Get a filtered stream for specific event types.
   */
  getFilteredStream(
    runId: string,
    ...types: AgentEventType[]
  ): Observable<AgentEvent> {
    const typeSet = new Set(types);
    return this.getStream(runId).pipe(
      filter((event) => typeSet.has(event.type)),
    );
  }

  /**
   * Emit an event to all subscribers of a run.
   */
  emit(runId: string, event: AgentEvent): void {
    this.getOrCreateSubject(runId).next(event);
  }

  /**
   * Helper to create and emit an event in one call.
   */
  emitEvent(
    runId: string,
    threadId: string,
    type: AgentEventType,
    data: unknown,
  ): void {
    this.emit(runId, {
      type,
      runId,
      threadId,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Complete the stream for a run (signals no more events).
   */
  complete(runId: string): void {
    const subject = this.subjects.get(runId);
    if (subject) {
      subject.complete();
      this.subjects.delete(runId);
    }
  }

  /**
   * Check if a run has an active stream.
   */
  hasStream(runId: string): boolean {
    return this.subjects.has(runId);
  }

  private getOrCreateSubject(runId: string): Subject<AgentEvent> {
    let subject = this.subjects.get(runId);
    if (!subject) {
      subject = new Subject<AgentEvent>();
      this.subjects.set(runId, subject);
    }
    return subject;
  }
}
