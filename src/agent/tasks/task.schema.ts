import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type TaskPlanDocument = HydratedDocument<TaskPlan>;

@Schema()
export class Task {
  @Prop({ required: true })
  taskID: string;

  @Prop({ required: true })
  description: string;

  @Prop({
    required: true,
    enum: ['pending', 'in_progress', 'waiting', 'completed', 'failed', 'skipped'],
    default: 'pending',
  })
  status: string;

  @Prop()
  result?: string;

  @Prop()
  runID?: string;

  @Prop({ required: true })
  order: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  waitMeta?: Record<string, unknown>;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

@Schema({ timestamps: true, collection: 'tasks' })
export class TaskPlan {
  @Prop({ required: true, unique: true, index: true })
  planID: string;

  @Prop({ required: true, index: true })
  parentRunID: string;

  @Prop({ required: true, index: true })
  agentID: string;

  @Prop({ required: true })
  goal: string;

  @Prop({ type: [TaskSchema], default: [] })
  tasks: Task[];

  @Prop({
    required: true,
    enum: ['planning', 'executing', 'completed', 'failed', 'cancelled'],
    default: 'planning',
  })
  status: string;

  @Prop({ default: 0 })
  revision: number;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  stateJson: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const TaskPlanSchema = SchemaFactory.createForClass(TaskPlan);
TaskPlanSchema.index({ parentRunID: 1, status: 1 });
TaskPlanSchema.index({ agentID: 1, createdAt: -1 });
