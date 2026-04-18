import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RunDocument = HydratedDocument<Run>;

@Schema({ timestamps: true })
export class Run {
  @Prop({ required: true, unique: true, index: true })
  runId: string;

  @Prop({ required: true, index: true })
  threadId: string;

  @Prop({
    required: true,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  })
  status: string;

  @Prop({ default: Date.now })
  startedAt: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  error?: string;

  @Prop()
  response?: string;
}

export const RunSchema = SchemaFactory.createForClass(Run);
