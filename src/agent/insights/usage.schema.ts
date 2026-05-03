import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UsageRecordDocument = HydratedDocument<UsageRecord>;

@Schema({ _id: false })
export class TokenUsage {
  @Prop({ default: 0 })
  input: number;

  @Prop({ default: 0 })
  output: number;

  @Prop({ default: 0 })
  thinking: number;

  @Prop({ default: 0 })
  cacheRead: number;

  @Prop({ default: 0 })
  cacheWrite: number;
}

export const TokenUsageSchema = SchemaFactory.createForClass(TokenUsage);

@Schema({ timestamps: true })
export class UsageRecord {
  @Prop({ required: true, index: true })
  runID: string;

  @Prop({ required: true, index: true })
  userID: string;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  modelID: string;

  @Prop({ type: TokenUsageSchema, default: () => ({}) })
  tokens: TokenUsage;

  @Prop({ default: 0 })
  costCents: number;

  @Prop({ default: 0 })
  toolCallCount: number;

  @Prop({ default: 0 })
  durationMs: number;

  @Prop({ default: 0 })
  iterationCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export const UsageRecordSchema = SchemaFactory.createForClass(UsageRecord);
UsageRecordSchema.index({ userID: 1, createdAt: -1 });
UsageRecordSchema.index({ provider: 1, modelID: 1 });
