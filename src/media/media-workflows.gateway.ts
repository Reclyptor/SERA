import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

export interface WorkflowUpdateEvent {
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'unknown';
  progress: unknown | null;
  pendingReviewWorkflows: string[];
  lastSyncedAt: string;
}

@WebSocketGateway({
  namespace: '/media-workflows',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class MediaWorkflowsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(MediaWorkflowsGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly subscriptions = new Map<string, Set<string>>();

  handleConnection(client: Socket): void {
    this.subscriptions.set(client.id, new Set());
    this.logger.debug(`Workflow WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.subscriptions.delete(client.id);
    this.logger.debug(`Workflow WS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe_workflows')
  subscribeWorkflows(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { workflowIds: string[] },
  ): { ok: true; count: number } {
    const current = this.subscriptions.get(client.id) ?? new Set<string>();
    const next = new Set<string>(payload?.workflowIds ?? []);
    this.subscriptions.set(client.id, next);
    this.logger.debug(
      `Workflow subscriptions updated for ${client.id}: ${current.size} -> ${next.size}`,
    );
    return { ok: true, count: next.size };
  }

  @SubscribeMessage('unsubscribe_workflows')
  unsubscribeWorkflows(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { workflowIds: string[] },
  ): { ok: true; count: number } {
    const current = this.subscriptions.get(client.id) ?? new Set<string>();
    for (const id of payload?.workflowIds ?? []) {
      current.delete(id);
    }
    this.subscriptions.set(client.id, current);
    return { ok: true, count: current.size };
  }

  emitWorkflowUpdate(event: WorkflowUpdateEvent): void {
    for (const [socketId, workflowIds] of this.subscriptions.entries()) {
      if (!workflowIds.has(event.workflowId)) continue;
      this.server.to(socketId).emit('workflow_update', event);
    }
  }
}

