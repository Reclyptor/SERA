import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowsGateway } from './workflows.gateway';
import { ChatsModule } from '../chats/chats.module';
import { Workflow, WorkflowSchema } from './schemas/workflow.schema';

@Module({
  imports: [
    ChatsModule,
    MongooseModule.forFeature([{ name: Workflow.name, schema: WorkflowSchema }]),
  ],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowsGateway],
  exports: [WorkflowsService],
})
export class MediaModule {}

