import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { TriggersService } from './triggers.service';
import { OrchestratorService } from '../orchestration/orchestrator.service';
import { WebhookProtected } from '../../auth/webhook-protected.decorator';
import { WebhookAuthGuard } from './webhook-auth.guard';
import { WebhookTrigger } from './webhook-trigger.decorator';
import type { Trigger } from './trigger.schema';

@Controller('webhooks')
export class TriggersController {
  private readonly logger = new Logger(TriggersController.name);

  constructor(
    private readonly triggersService: TriggersService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  @WebhookProtected()
  @UseGuards(WebhookAuthGuard)
  @Post(':path')
  @HttpCode(202)
  handleWebhook(
    @WebhookTrigger() trigger: Trigger,
    @Body() payload: unknown,
  ): { runID: string; triggerID: string } {
    const threadID = crypto.randomUUID();
    const runID = crypto.randomUUID();

    const payloadStr =
      typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

    const message = [
      `[Webhook trigger: ${trigger.description || trigger.webhookPath}]`,
      '',
      trigger.command,
      '',
      '## Payload',
      '```json',
      payloadStr,
      '```',
    ].join('\n');

    this.logger.log(
      `Webhook "${trigger.webhookPath}" triggered for agent "${trigger.agentID}" (run: ${runID})`,
    );

    void this.orchestrator
      .executeGoal(
        {
          threadID,
          runID,
          userID: `webhook:${trigger.triggerID}`,
          agentID: trigger.agentID,
          userMessage: message,
          conversationHistory: [],
          isHeartbeat: true,
        },
        { maxSteps: 10, maxIterations: 2 },
      )
      .catch((err) => {
        this.logger.error(`Webhook run ${runID} failed:`, err);
      });

    void this.triggersService
      .recordExecution(trigger.triggerID)
      .catch(() => {});

    return { runID, triggerID: trigger.triggerID };
  }
}
