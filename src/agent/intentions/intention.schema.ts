import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type IntentionDocument = HydratedDocument<Intention>;

/**
 * A self-generated future follow-up the agent inferred on its own (§4.20).
 * Distinct from Commitment: the agent chose to track this, the user never
 * asked. Only distilled `summary`/`suggestedText` are stored — never raw
 * conversation text.
 */
@Schema({ timestamps: true, collection: 'intentions' })
export class Intention {
  @Prop({ required: true, unique: true, index: true })
  intentionID: string;

  @Prop({ required: true, index: true })
  agentID: string;

  @Prop({ required: true, index: true })
  userID: string;

  @Prop({
    required: true,
    enum: ['event_check_in', 'deadline_check', 'care_check_in', 'open_loop'],
  })
  kind: string;

  @Prop({ required: true })
  summary: string;

  @Prop({ required: true })
  suggestedText: string;

  @Prop({ required: true })
  confidence: number;

  @Prop({ required: true, index: true })
  earliestAt: Date;

  @Prop()
  latestAt?: Date;

  @Prop({ default: 'UTC' })
  timezone: string;

  @Prop({ required: true })
  dedupeKey: string;

  @Prop({
    required: true,
    enum: ['pending', 'surfaced', 'acted', 'dismissed', 'snoozed', 'expired'],
    default: 'pending',
  })
  status: string;

  @Prop()
  snoozedUntil?: Date;

  @Prop({ default: '' })
  sourceRunID: string;

  @Prop({ default: '' })
  sourceThreadID: string;

  @Prop({ default: '' })
  surfacedRunID: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const IntentionSchema = SchemaFactory.createForClass(Intention);

// Dedupe: one live intention per (agent, subject+kind). Re-inference refreshes
// the existing row instead of inserting a second.
IntentionSchema.index({ agentID: 1, dedupeKey: 1 }, { unique: true });
// Primary due-lookup at heartbeat time.
IntentionSchema.index({ agentID: 1, status: 1, earliestAt: 1 });
