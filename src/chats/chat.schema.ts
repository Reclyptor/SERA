import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ChatDocument = HydratedDocument<Chat>;

@Schema({ _id: false })
export class SubagentMeta {
  @Prop({ required: true })
  runID: string;

  @Prop({ required: true })
  threadID: string;

  @Prop({ required: true })
  agentID: string;

  @Prop({ required: true })
  goal: string;
}

export const SubagentMetaSchema = SchemaFactory.createForClass(SubagentMeta);

@Schema({ _id: false })
export class ToolCallBlock {
  @Prop({ required: true })
  toolCallID: string;

  @Prop({ required: true })
  toolName: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  args: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  result?: unknown;

  @Prop()
  error?: string;

  @Prop({
    required: true,
    enum: ['started', 'executing', 'completed', 'failed'],
    default: 'started',
  })
  status: string;

  @Prop()
  isSubagent?: boolean;

  @Prop({ type: SubagentMetaSchema })
  subagentMeta?: SubagentMeta;
}

export const ToolCallBlockSchema = SchemaFactory.createForClass(ToolCallBlock);

@Schema({ _id: false })
export class MessageAttachment {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true, enum: ['image', 'file'] })
  kind: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  @Prop()
  filename?: string;

  @Prop()
  createdAt?: Date;
}

export const MessageAttachmentSchema =
  SchemaFactory.createForClass(MessageAttachment);

@Schema()
export class Message {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true, enum: ['user', 'assistant', 'system'] })
  role: string;

  @Prop({ required: true })
  content: string;

  @Prop()
  thinking?: string;

  @Prop()
  thinkingDuration?: number;

  @Prop({ type: [ToolCallBlockSchema] })
  toolCalls?: ToolCallBlock[];

  @Prop({ type: [MessageAttachmentSchema], default: [] })
  attachments?: MessageAttachment[];

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

@Schema({ timestamps: true })
export class Chat {
  @Prop({ required: true, index: true })
  userID: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  model?: string;

  // Sticky agent for the chat. Parallel to `model?` above. When set, the
  // orchestrator defaults to this agent for new messages unless the request
  // body overrides it. See SPEC §6 Execution Flow.
  @Prop()
  agentID?: string;

  @Prop({ type: [MessageSchema], default: [] })
  messages: Message[];

  // 'agent' marks a thread SERA opened on her own initiative (§30.11). Ordinary
  // user-started chats are 'user'.
  @Prop({ enum: ['user', 'agent'], default: 'user' })
  origin: string;

  // Owner's last-view timestamp; a chat is unread when updatedAt > lastReadAt.
  @Prop()
  lastReadAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
ChatSchema.index({ userID: 1, updatedAt: -1 });
ChatSchema.index({ title: 'text', 'messages.content': 'text' });
