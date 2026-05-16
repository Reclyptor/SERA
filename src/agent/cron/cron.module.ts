import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CronJob, CronJobSchema } from './cron-job.schema';
import { CronSchedulerService } from './cron-scheduler.service';
import { CronController } from './cron.controller';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { StateModule } from '../state/state.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CronJob.name, schema: CronJobSchema }]),
    forwardRef(() => OrchestrationModule),
    StateModule,
  ],
  controllers: [CronController],
  providers: [CronSchedulerService],
  exports: [CronSchedulerService],
})
export class CronModule {}
