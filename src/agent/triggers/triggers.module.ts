import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Trigger, TriggerSchema } from './trigger.schema';
import { TriggersService } from './triggers.service';
import { TriggersController } from './triggers.controller';
import { WebhookAuthGuard } from './webhook-auth.guard';
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Trigger.name, schema: TriggerSchema },
    ]),
    forwardRef(() => OrchestrationModule),
  ],
  controllers: [TriggersController],
  providers: [TriggersService, WebhookAuthGuard],
  exports: [TriggersService],
})
export class TriggersModule {}
