import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CommitmentDocument = HydratedDocument<Commitment>;

@Schema({ timestamps: true, collection: 'commitments' })
export class Commitment {
  @Prop({ required: true, unique: true, index: true })
  commitmentID: string;

  @Prop({ required: true, index: true })
  agentID: string;

  @Prop({ required: true, index: true })
  userID: string;

  @Prop({ required: true })
  description: string;

  @Prop({
    required: true,
    enum: ['pending', 'completed', 'expired', 'cancelled'],
    default: 'pending',
  })
  status: string;

  @Prop()
  dueAt?: Date;

  @Prop()
  reminderAt?: Date;

  @Prop({ default: '' })
  sourceRunID: string;

  @Prop({ default: '' })
  sourceThreadID: string;

  @Prop({ default: '' })
  completionRunID: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const CommitmentSchema = SchemaFactory.createForClass(Commitment);
