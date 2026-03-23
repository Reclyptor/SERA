export class MessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: Date;
}

export class CreateChatDto {
  messages: MessageDto[];
}
