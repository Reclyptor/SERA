import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CronJob, CronJobSchema } from './cron-job.schema';
import { CronSchedulerService } from './cron-scheduler.service';
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CronJob.name, schema: CronJobSchema }]),
    forwardRef(() => OrchestrationModule),
  ],
  providers: [CronSchedulerService],
  exports: [CronSchedulerService],
})
export class CronModule {}
