import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type TriggerDocument = HydratedDocument<Trigger>;

@Schema({ timestamps: true })
export class Trigger {
  @Prop({ required: true, unique: true, index: true })
  triggerID: string;

  @Prop({ required: true, index: true })
  agentID: string;

  @Prop({ required: true, unique: true, index: true })
  webhookPath: string;

  @Prop({ required: true })
  command: string;

  @Prop({ default: '' })
  description: string;

  @Prop()
  secret?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  headers?: Record<string, string>;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ default: 0 })
  executionCount: number;

  @Prop()
  lastTriggeredAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const TriggerSchema = SchemaFactory.createForClass(Trigger);
