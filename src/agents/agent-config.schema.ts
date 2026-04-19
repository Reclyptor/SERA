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

@Schema()
export class MessagingPolicy {
  @Prop({ default: false })
  enabled: boolean;

  @Prop({ type: [String], default: [] })
  allowedAgents: string[];
}

export const MessagingPolicySchema =
  SchemaFactory.createForClass(MessagingPolicy);

@Schema()
export class SandboxConfig {
  @Prop({ default: false })
  enabled: boolean;

  @Prop({ default: 'node:20-slim' })
  image: string;

  @Prop({ default: 512 })
  memoryMb: number;

  @Prop({ default: 1024 })
  cpuShares: number;

  @Prop({ default: false })
  networkEnabled: boolean;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  envVars: Record<string, string>;
}

export const SandboxConfigSchema =
  SchemaFactory.createForClass(SandboxConfig);

@Schema()
export class HeartbeatConfig {
  @Prop({ default: false })
  enabled: boolean;

  @Prop({ default: 30 })
  intervalMinutes: number;
}

export const HeartbeatConfigSchema =
  SchemaFactory.createForClass(HeartbeatConfig);

@Schema({ timestamps: true })
export class AgentConfig {
  @Prop({ required: true, unique: true, index: true })
  agentID: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop()
  promptSlug?: string;

  @Prop({ type: ModelOptionsSchema })
  modelOptions?: ModelOptions;

  @Prop({ type: ToolPolicySchema, default: { mode: 'deny', tools: [] } })
  toolPolicy: ToolPolicy;

  @Prop()
  workspaceDir?: string;

  @Prop({
    type: MessagingPolicySchema,
    default: { enabled: false, allowedAgents: [] },
  })
  messagingPolicy: MessagingPolicy;

  @Prop({ type: SandboxConfigSchema })
  sandboxConfig?: SandboxConfig;

  @Prop({ type: HeartbeatConfigSchema })
  heartbeatConfig?: HeartbeatConfig;

  @Prop({ default: true })
  enabled: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const AgentConfigSchema = SchemaFactory.createForClass(AgentConfig);
