import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Intention, IntentionSchema } from './intention.schema';
import {
  HeartbeatConfig,
  HeartbeatConfigSchema,
} from '../heartbeat/heartbeat.schema';
import { IntentionsService } from './intentions.service';
import { IntentionExtractorService } from './intention-extractor.service';
import { ModelModule } from '../model/model.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Intention.name, schema: IntentionSchema },
      { name: HeartbeatConfig.name, schema: HeartbeatConfigSchema },
    ]),
    ModelModule,
  ],
  providers: [IntentionsService, IntentionExtractorService],
  exports: [IntentionsService, IntentionExtractorService],
})
export class IntentionsModule {}
