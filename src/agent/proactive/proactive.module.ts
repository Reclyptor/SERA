import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  HeartbeatConfig,
  HeartbeatConfigSchema,
} from '../heartbeat/heartbeat.schema';
import { ProactiveGateService } from './proactive-gate.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HeartbeatConfig.name, schema: HeartbeatConfigSchema },
    ]),
  ],
  providers: [ProactiveGateService],
  exports: [ProactiveGateService],
})
export class ProactiveModule {}
