import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AgentStateDocument = HydratedDocument<AgentState>;

@Schema()
export class PendingConfirmation {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  actionName: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  args: Record<string, unknown>;

  @Prop({ required: true })
  message: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const PendingConfirmationSchema = SchemaFactory.createForClass(PendingConfirmation);

@Schema({ timestamps: true })
export class AgentState {
  @Prop({ required: true, unique: true, index: true })
  threadId: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  custom: Record<string, unknown>;

  @Prop()
  currentStep?: string;

  @Prop({ type: [PendingConfirmationSchema], default: [] })
  pendingConfirmations: PendingConfirmation[];
}

export const AgentStateSchema = SchemaFactory.createForClass(AgentState);
