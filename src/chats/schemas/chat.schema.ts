import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChatDocument = HydratedDocument<Chat>;

@Schema()
export class Message {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true, enum: ['user', 'assistant', 'system'] })
  role: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

@Schema({ _id: false })
export class WorkflowStateEntry {
  @Prop({ required: true })
  workflowId: string;

  @Prop({ required: true, enum: ['running', 'completed', 'failed', 'unknown', 'canceled'] })
  status: string;

  @Prop({ type: Object, default: null })
  progress: Record<string, unknown> | null;

  @Prop({ type: [String], default: [] })
  pendingReviewWorkflows: string[];

  @Prop({ required: true })
  startedAt: Date;

  @Prop({ required: true })
  lastSyncedAt: Date;
}

export const WorkflowStateEntrySchema =
  SchemaFactory.createForClass(WorkflowStateEntry);

@Schema({ timestamps: true })
export class Chat {
  @Prop({ required: true, index: true })
  userID: string;

  @Prop({ required: true })
  title: string;

  @Prop({ type: [MessageSchema], default: [] })
  messages: Message[];

  @Prop({ type: [WorkflowStateEntrySchema], default: [] })
  workflowState: WorkflowStateEntry[];

  createdAt: Date;
  updatedAt: Date;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
