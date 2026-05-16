import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ScheduledExecutionDocument = HydratedDocument<ScheduledExecution>;

export type ScheduledExecutionKind = 'cron' | 'heartbeat';
export type ScheduledExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

@Schema({ timestamps: true, collection: 'scheduled_executions' })
export class ScheduledExecution {
  @Prop({ required: true, unique: true, index: true })
  executionID: string;

  @Prop({ required: true, enum: ['cron', 'heartbeat'], index: true })
  kind: ScheduledExecutionKind;

  @Prop({ required: true, index: true })
  targetID: string;

  @Prop({ required: true, index: true })
  agentID: string;

  @Prop({ required: true, index: true })
  scheduledFor: Date;

  @Prop({
    required: true,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status: ScheduledExecutionStatus;

  @Prop({ default: '' })
  runID: string;

  @Prop({ default: '' })
  threadID: string;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: '' })
  leaseOwner: string;

  @Prop()
  leaseExpiresAt?: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ default: '' })
  error: string;

  createdAt: Date;
  updatedAt: Date;
}

export const ScheduledExecutionSchema =
  SchemaFactory.createForClass(ScheduledExecution);

ScheduledExecutionSchema.index(
  { kind: 1, targetID: 1, scheduledFor: 1 },
  { unique: true },
);
ScheduledExecutionSchema.index({
  status: 1,
  scheduledFor: 1,
  leaseExpiresAt: 1,
});
