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
  handleSubscribe(client: Socket, payload: { runID: string }): void {
    const { runID } = payload;
    if (!runID) {
      client.emit('error', { message: 'runID is required' });
      return;
    }

    this.logger.debug(`Client ${client.id} subscribing to run ${runID}`);

    const subscription = this.eventEmitter.getStream(runID).subscribe({
      next: (event) => {
        client.emit('agent_event', event);
      },
      complete: () => {
        client.emit('agent_event', { type: 'stream.end', runID });
      },
      error: (err) => {
        this.logger.error(`Stream error for run ${runID}:`, err);
        client.emit('error', { message: 'Stream error', runID });
      },
    });

    const existing = this.subscriptions.get(client.id) ?? [];
    existing.push(subscription);
    this.subscriptions.set(client.id, existing);
  }

  @SubscribeMessage('cancel')
  handleCancel(client: Socket, payload: { runID: string }): void {
    const { runID } = payload;
    if (!runID) {
      client.emit('error', { message: 'runID is required' });
      return;
    }

    this.logger.debug(`Client ${client.id} cancelling run ${runID}`);
    const cancelled = this.orchestrator.cancelRun(runID);
    client.emit('cancel_ack', { runID, cancelled });
  }

  @SubscribeMessage('confirm')
  async handleConfirm(
    client: Socket,
    payload: { threadID: string; confirmationID: string },
  ): Promise<void> {
    const { threadID, confirmationID } = payload;
    if (!threadID || !confirmationID) {
      client.emit('error', {
        message: 'threadID and confirmationID are required',
      });
      return;
    }

    this.logger.debug(
      `Client ${client.id} resolving confirmation ${confirmationID} for thread ${threadID}`,
    );
    const resolved = await this.stateService.resolveConfirmation(
      threadID,
      confirmationID,
      { approved: true },
    );
    client.emit('confirm_ack', { threadID, confirmationID, resolved });
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(
      `Client ${client.id} disconnected, cleaning up subscriptions`,
    );
    const subs = this.subscriptions.get(client.id);
    if (subs) {
      for (const sub of subs) {
        sub.unsubscribe();
      }
      this.subscriptions.delete(client.id);
    }
  }
}
