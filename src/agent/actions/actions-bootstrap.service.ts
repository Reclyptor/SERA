import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { MemoryService } from '../memory/memory.service';
import { NtfyService } from '../ntfy/ntfy.service';
import { StateService } from '../state/state.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import {
  SaveMemoryAction,
  SearchMemoryAction,
  DeleteMemoryAction,
  NotificationAction,
  PushNotificationAction,
  RequestConfirmationAction,
} from './implementations';

@Injectable()
export class ActionsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ActionsBootstrapService.name);

  constructor(
    private readonly actionsService: ActionsService,
    private readonly memoryService: MemoryService,
    private readonly ntfyService: NtfyService,
    private readonly stateService: StateService,
    private readonly emitter: AgentEventEmitter,
  ) {}

  onModuleInit() {
    this.registerCoreActions();
  }

  private registerCoreActions() {
    // Memory management
    this.actionsService.registerAction(
      new SaveMemoryAction(this.memoryService),
    );
    this.actionsService.registerAction(
      new SearchMemoryAction(this.memoryService),
    );
    this.actionsService.registerAction(
      new DeleteMemoryAction(this.memoryService),
    );

    // Notifications
    this.actionsService.registerAction(new NotificationAction(this.emitter));
    this.actionsService.registerAction(
      new PushNotificationAction(this.ntfyService),
    );

    // Confirmation flow
    this.actionsService.registerAction(
      new RequestConfirmationAction(this.stateService, this.emitter),
    );

    this.logger.log('Registered 6 core actions');
  }
}
