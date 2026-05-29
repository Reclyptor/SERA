import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContextStateDocument = HydratedDocument<ContextState>;

@Schema({ timestamps: true, collection: 'context_states' })
export class ContextState {
  @Prop({ required: true, unique: true, index: true })
  threadID: string;

  @Prop({ default: '' })
  summaryText: string;

  @Prop()
  summaryUpdatedAt?: Date;

  @Prop({ default: 0 })
  summaryGenerations: number;

  @Prop({ default: '' })
  lastDecision: string;

  @Prop({ default: 0 })
  lastSummaryCostCents: number;

  @Prop({ default: '' })
  lastSummaryModel: string;

  @Prop({ default: 0 })
  thrashCounter: number;

  @Prop({ default: 0 })
  lastSavingsRatio: number;

  createdAt: Date;
  updatedAt: Date;
}

export const ContextStateSchema = SchemaFactory.createForClass(ContextState);
