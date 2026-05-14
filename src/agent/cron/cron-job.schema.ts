import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CronJobDocument = HydratedDocument<CronJob>;

@Schema({ timestamps: true, collection: 'crons' })
export class CronJob {
  @Prop({ required: true, unique: true, index: true })
  jobID: string;

  @Prop({ required: true, index: true })
  agentID: string;

  @Prop({ required: true })
  schedule: string;

  @Prop({ required: true })
  command: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ default: '' })
  script: string;

  @Prop({ default: '' })
  contextFromJobID: string;

  @Prop({ default: '' })
  lastRunID: string;

  @Prop()
  lastRunAt?: Date;

  @Prop()
  nextRunAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const CronJobSchema = SchemaFactory.createForClass(CronJob);
