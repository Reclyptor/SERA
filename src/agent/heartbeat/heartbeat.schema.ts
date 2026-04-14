import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type HeartbeatConfigDocument = HydratedDocument<HeartbeatConfig>;

@Schema()
export class ActiveHours {
  @Prop({ required: true, min: 0, max: 23 })
  start: number;

  @Prop({ required: true, min: 0, max: 23 })
  end: number;

  @Prop({ default: 'UTC' })
  timezone: string;
}

export const ActiveHoursSchema = SchemaFactory.createForClass(ActiveHours);

@Schema({ timestamps: true })
export class HeartbeatConfig {
  @Prop({ required: true, unique: true, index: true })
  agentId: string;

  @Prop({ default: false })
  enabled: boolean;

  @Prop({ default: 30, min: 1 })
  intervalMinutes: number;

  @Prop({ type: ActiveHoursSchema })
  activeHours?: ActiveHours;

  @Prop({ type: [String], default: [] })
  checklist: string[];

  @Prop({ default: 2048 })
  maxTokens: number;

  @Prop()
  lastRunAt?: Date;

  @Prop()
  nextRunAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const HeartbeatConfigSchema =
  SchemaFactory.createForClass(HeartbeatConfig);
