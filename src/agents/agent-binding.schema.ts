import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AgentBindingDocument = HydratedDocument<AgentBinding>;

@Schema({ timestamps: true, collection: 'bindings' })
export class AgentBinding {
  @Prop({ required: true, unique: true, index: true })
  bindingID: string;

  @Prop({ required: true, index: true })
  agentID: string;

  @Prop({
    required: true,
    enum: ['channel', 'user', 'default'],
    index: true,
  })
  bindingType: 'channel' | 'user' | 'default';

  @Prop()
  bindingValue?: string;

  @Prop({ default: 0 })
  priority: number;

  @Prop({ default: true })
  enabled: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const AgentBindingSchema = SchemaFactory.createForClass(AgentBinding);
