import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HeartbeatConfig, HeartbeatConfigSchema } from './heartbeat.schema';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatController } from './heartbeat.controller';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { PromptsModule } from '../../prompts/prompts.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { StateModule } from '../state/state.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HeartbeatConfig.name, schema: HeartbeatConfigSchema },
    ]),
    forwardRef(() => OrchestrationModule),
    PromptsModule,
    CommitmentsModule,
    SchedulingModule,
    StateModule,
  ],
  controllers: [HeartbeatController],
  providers: [HeartbeatService],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
