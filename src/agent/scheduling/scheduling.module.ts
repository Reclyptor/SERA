import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ScheduledExecution,
  ScheduledExecutionSchema,
} from './scheduled-execution.schema';
import { ScheduledExecutionService } from './scheduled-execution.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      {
        name: ScheduledExecution.name,
        schema: ScheduledExecutionSchema,
      },
    ]),
  ],
  providers: [ScheduledExecutionService],
  exports: [ScheduledExecutionService],
})
export class SchedulingModule {}
