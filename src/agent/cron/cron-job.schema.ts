import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CronJobDocument = HydratedDocument<CronJob>;

@Schema({ timestamps: true })
export class CronJob {
  @Prop({ required: true, unique: true, index: true })
  jobId: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({ required: true })
  schedule: string;

  @Prop({ required: true })
  command: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop()
  lastRunAt?: Date;

  @Prop()
  nextRunAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const CronJobSchema = SchemaFactory.createForClass(CronJob);
