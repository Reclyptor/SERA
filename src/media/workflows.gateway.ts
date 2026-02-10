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
  threadId: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'unknown' | 'canceled';
  progress: unknown | null;
  pendingReviewWorkflows: string[];
  lastSyncedAt: string;
}

@WebSocketGateway({
  namespace: '/workflows',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class WorkflowsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WorkflowsGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly threadSubscriptions = new Map<string, string>();

  handleConnection(client: Socket): void {
    this.logger.debug(`Workflow WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const threadId = this.threadSubscriptions.get(client.id);
    if (threadId) {
      client.leave(this.threadRoom(threadId));
      this.threadSubscriptions.delete(client.id);
    }
    this.logger.debug(`Workflow WS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe_thread')
  subscribeThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { threadId: string },
  ): { ok: true; threadId: string } {
    const nextThreadId = payload?.threadId?.trim();
    if (!nextThreadId) {
      return { ok: true, threadId: '' };
    }

    const previous = this.threadSubscriptions.get(client.id);
    if (previous && previous !== nextThreadId) {
      client.leave(this.threadRoom(previous));
    }

    client.join(this.threadRoom(nextThreadId));
    this.threadSubscriptions.set(client.id, nextThreadId);
    this.logger.debug(
      `Workflow thread subscription updated for ${client.id}: ${nextThreadId}`,
    );
    return { ok: true, threadId: nextThreadId };
  }

  @SubscribeMessage('unsubscribe_thread')
  unsubscribeThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { threadId: string },
  ): { ok: true } {
    const threadId = payload?.threadId?.trim();
    if (!threadId) return { ok: true };

    const current = this.threadSubscriptions.get(client.id);
    if (current === threadId) {
      client.leave(this.threadRoom(threadId));
      this.threadSubscriptions.delete(client.id);
    }
    return { ok: true };
  }

  emitWorkflowUpdate(event: WorkflowUpdateEvent): void {
    this.server.to(this.threadRoom(event.threadId)).emit('workflow_update', event);
  }

  private threadRoom(threadId: string): string {
    return `thread:${threadId}`;
  }
}

