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

@Schema({ timestamps: true, collection: 'heartbeats' })
export class HeartbeatConfig {
  @Prop({ required: true, unique: true, index: true })
  agentID: string;

  // The user who owns this agent's autonomous reach-out threads and receives
  // its proactive pushes (§30.11.1). Captured from the authenticated creator.
  @Prop()
  ownerUserID?: string;

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
