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
import { Public } from '../../auth/public.decorator';
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

  @Public()
  @UseGuards(WebhookAuthGuard)
  @Post(':path')
  @HttpCode(202)
  async handleWebhook(
    @WebhookTrigger() trigger: Trigger,
    @Body() payload: unknown,
  ): Promise<{ runId: string; triggerId: string }> {
    const threadId = crypto.randomUUID();
    const runId = crypto.randomUUID();

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
      `Webhook "${trigger.webhookPath}" triggered for agent "${trigger.agentId}" (run: ${runId})`,
    );

    this.orchestrator
      .executeGoal(
        {
          threadId,
          runId,
          userId: `webhook:${trigger.triggerId}`,
          agentId: trigger.agentId,
          userMessage: message,
          conversationHistory: [],
          isHeartbeat: true,
        },
        { maxSteps: 10, maxIterations: 2 },
      )
      .catch((err) => {
        this.logger.error(`Webhook run ${runId} failed:`, err);
      });

    this.triggersService.recordExecution(trigger.triggerId).catch(() => {});

    return { runId, triggerId: trigger.triggerId };
  }
}
