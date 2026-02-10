import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorkflowDocument = HydratedDocument<Workflow>;

@Schema({ timestamps: true })
export class Workflow {
  @Prop({ required: true, index: true })
  threadId: string;

  @Prop({ required: true, index: true })
  workflowId: string;

  @Prop({
    required: true,
    enum: ['running', 'completed', 'failed', 'unknown', 'canceled'],
    index: true,
  })
  status: string;

  @Prop({ type: Object, default: null })
  progress: Record<string, unknown> | null;

  @Prop({ type: [String], default: [] })
  pendingReviewWorkflows: string[];

  @Prop({ required: true })
  startedAt: Date;

  @Prop({ required: true })
  lastSyncedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const WorkflowSchema = SchemaFactory.createForClass(Workflow);
WorkflowSchema.index({ threadId: 1, workflowId: 1 }, { unique: true });

