import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { MemoryService } from '../memory/memory.service';
import { NtfyService } from '../ntfy/ntfy.service';
import { StateService } from '../state/state.service';
import { ConfirmationSignalService } from '../state/confirmation-signal.service';
import { AgentEventEmitter } from '../streaming/agent-event-emitter';
import { ProactiveGateService } from '../proactive/proactive-gate.service';
import { IntentionsService } from '../intentions/intentions.service';
import {
  SaveMemoryAction,
  SearchMemoryAction,
  DeleteMemoryAction,
  NotificationAction,
  PushNotificationAction,
  RequestConfirmationAction,
  ManageIntentionAction,
} from './implementations';

@Injectable()
export class ActionsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ActionsBootstrapService.name);

  constructor(
    private readonly actionsService: ActionsService,
    private readonly memoryService: MemoryService,
    private readonly ntfyService: NtfyService,
    private readonly stateService: StateService,
    private readonly confirmationSignal: ConfirmationSignalService,
    private readonly emitter: AgentEventEmitter,
    private readonly proactiveGate: ProactiveGateService,
    private readonly intentionsService: IntentionsService,
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
      new PushNotificationAction(this.ntfyService, this.proactiveGate),
    );

    // Confirmation flow
    this.actionsService.registerAction(
      new RequestConfirmationAction(
        this.stateService,
        this.emitter,
        this.confirmationSignal,
      ),
    );

    // Volition — self-managed intentions (§30.9 Phase 4)
    this.actionsService.registerAction(
      new ManageIntentionAction(this.intentionsService),
    );

    this.logger.log(
      `Registered ${this.actionsService.actionCount} core actions`,
    );
  }
}
