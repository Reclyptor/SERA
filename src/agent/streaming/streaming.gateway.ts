import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { AgentEventEmitter } from './agent-event-emitter';
import { OrchestratorService } from '../orchestration/orchestrator.service';
import { StateService } from '../state/state.service';

@WebSocketGateway({ namespace: '/agent', cors: true })
export class StreamingGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(StreamingGateway.name);
  private readonly subscriptions = new Map<string, Subscription[]>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly eventEmitter: AgentEventEmitter,
    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestrator: OrchestratorService,
    private readonly stateService: StateService,
  ) {}

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { runId: string }): void {
    const { runId } = payload;
    if (!runId) {
      client.emit('error', { message: 'runId is required' });
      return;
    }

    this.logger.debug(`Client ${client.id} subscribing to run ${runId}`);

    const subscription = this.eventEmitter.getStream(runId).subscribe({
      next: (event) => {
        client.emit('agent_event', event);
      },
      complete: () => {
        client.emit('agent_event', { type: 'stream.end', runId });
      },
      error: (err) => {
        this.logger.error(`Stream error for run ${runId}:`, err);
        client.emit('error', { message: 'Stream error', runId });
      },
    });

    const existing = this.subscriptions.get(client.id) ?? [];
    existing.push(subscription);
    this.subscriptions.set(client.id, existing);
  }

  @SubscribeMessage('cancel')
  handleCancel(client: Socket, payload: { runId: string }): void {
    const { runId } = payload;
    if (!runId) {
      client.emit('error', { message: 'runId is required' });
      return;
    }

    this.logger.debug(`Client ${client.id} cancelling run ${runId}`);
    const cancelled = this.orchestrator.cancelRun(runId);
    client.emit('cancel_ack', { runId, cancelled });
  }

  @SubscribeMessage('confirm')
  async handleConfirm(
    client: Socket,
    payload: { threadId: string; confirmationId: string },
  ): Promise<void> {
    const { threadId, confirmationId } = payload;
    if (!threadId || !confirmationId) {
      client.emit('error', { message: 'threadId and confirmationId are required' });
      return;
    }

    this.logger.debug(
      `Client ${client.id} resolving confirmation ${confirmationId} for thread ${threadId}`,
    );
    const resolved = await this.stateService.resolvePendingConfirmation(
      threadId,
      confirmationId,
    );
    client.emit('confirm_ack', { threadId, confirmationId, resolved });
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client ${client.id} disconnected, cleaning up subscriptions`);
    const subs = this.subscriptions.get(client.id);
    if (subs) {
      for (const sub of subs) {
        sub.unsubscribe();
      }
      this.subscriptions.delete(client.id);
    }
  }
}
