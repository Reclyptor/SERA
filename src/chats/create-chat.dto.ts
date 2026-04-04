export class MessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  createdAt?: Date;
}

export class CreateChatDto {
  messages: MessageDto[];
}
