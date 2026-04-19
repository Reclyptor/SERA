import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HeartbeatConfig, HeartbeatConfigSchema } from './heartbeat.schema';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatController } from './heartbeat.controller';
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HeartbeatConfig.name, schema: HeartbeatConfigSchema },
    ]),
    forwardRef(() => OrchestrationModule),
  ],
  controllers: [HeartbeatController],
  providers: [HeartbeatService],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
