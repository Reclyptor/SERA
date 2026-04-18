import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TaskPlan, TaskPlanSchema } from './task.schema';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TaskPlan.name, schema: TaskPlanSchema },
    ]),
  ],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
