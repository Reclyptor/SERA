import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaWorkflowsController } from './media-workflows.controller';
import { MediaWorkflowsService } from './media-workflows.service';
import { MediaWorkflowsGateway } from './media-workflows.gateway';
import { ChatsModule } from '../chats/chats.module';
import { Workflow, WorkflowSchema } from './schemas/workflow.schema';

@Module({
  imports: [
    ChatsModule,
    MongooseModule.forFeature([{ name: Workflow.name, schema: WorkflowSchema }]),
  ],
  controllers: [MediaWorkflowsController],
  providers: [MediaWorkflowsService, MediaWorkflowsGateway],
  exports: [MediaWorkflowsService],
})
export class MediaModule {}

