import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AgentConfigDocument = HydratedDocument<AgentConfig>;

@Schema()
export class ToolPolicy {
  @Prop({ required: true, enum: ['allow', 'deny'], default: 'deny' })
  mode: 'allow' | 'deny';

  @Prop({ type: [String], default: [] })
  tools: string[];
}

export const ToolPolicySchema = SchemaFactory.createForClass(ToolPolicy);

@Schema()
export class ModelOptions {
  @Prop()
  preferredProvider?: string;

  @Prop()
  preferredModel?: string;

  @Prop()
  maxOutputTokens?: number;

  @Prop()
  temperature?: number;
}

export const ModelOptionsSchema = SchemaFactory.createForClass(ModelOptions);

@Schema({ timestamps: true })
export class AgentConfig {
  @Prop({ required: true, unique: true, index: true })
  agentId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop()
  systemPrompt?: string;

  @Prop()
  personality?: string;

  @Prop({ type: ModelOptionsSchema })
  modelOptions?: ModelOptions;

  @Prop({ type: ToolPolicySchema, default: { mode: 'deny', tools: [] } })
  toolPolicy: ToolPolicy;

  @Prop({ default: true })
  enabled: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const AgentConfigSchema = SchemaFactory.createForClass(AgentConfig);
