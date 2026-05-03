import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsageRecord, UsageRecordSchema } from './usage.schema';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageRecord.name, schema: UsageRecordSchema },
    ]),
  ],
  providers: [InsightsService],
  controllers: [InsightsController],
  exports: [InsightsService],
})
export class InsightsModule {}
