import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
import { Chat, ChatDocument, Message } from './chat.schema';
import { CreateChatDto, MessageDto } from './create-chat.dto';
import { UpdateChatDto } from './update-chat.dto';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);
  private readonly anthropic: Anthropic;

  constructor(@InjectModel(Chat.name) private chatModel: Model<ChatDocument>) {
    this.anthropic = new Anthropic();
  }

  async generateTitle(firstMessage: string): Promise<string> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `Generate a brief 5-7 word title for a chat that starts with the following message. Return ONLY the title, nothing else:\n\n"${firstMessage.slice(0, 500)}"`,
          },
        ],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        return textBlock.text.trim().replace(/^["']|["']$/g, '');
      }

      return 'New Chat';
    } catch (error) {
      this.logger.error('Failed to generate title:', error);
      // Fallback to first 50 chars of message
      return (
        firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '')
      );
    }
  }

  async create(userID: string, createChatDto: CreateChatDto): Promise<Chat> {
    const messages = createChatDto.messages.map((m) =>
      this.normalizeMessage(m),
    );
    const firstUserMessage = messages.find((m) => m.role === 'user');
    const title = firstUserMessage
      ? await this.generateTitle(firstUserMessage.content)
      : 'New Chat';

    const chat = new this.chatModel({
      userID,
      title,
      messages,
    });

    return chat.save();
  }

  async findAllByUser(userID: string): Promise<Chat[]> {
    return this.chatModel
      .find({ userID })
      .sort({ updatedAt: -1 })
      .select('-messages')
      .exec();
  }

  async findOne(chatID: string, userID: string): Promise<Chat> {
    const chat = await this.chatModel.findById(chatID).exec();

    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatID} not found`);
    }

    if (chat.userID !== userID) {
      throw new ForbiddenException('You do not have access to this chat');
    }

    return chat;
  }

  async update(
    chatID: string,
    userID: string,
    updateChatDto: UpdateChatDto,
  ): Promise<Chat> {
    const chat = await this.chatModel.findById(chatID).exec();

    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatID} not found`);
    }

    if (chat.userID !== userID) {
      throw new ForbiddenException('You do not have access to this chat');
    }

    chat.messages = updateChatDto.messages.map((m) => this.normalizeMessage(m));
    return chat.save();
  }

  private normalizeMessage(message: MessageDto): Message {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      thinking: message.thinking,
      thinkingDuration: message.thinkingDuration,
      toolCalls: message.toolCalls,
      attachments: message.attachments?.map((attachment) => ({
        ...attachment,
        createdAt: this.normalizeCreatedAt(attachment.createdAt),
      })),
      createdAt: this.normalizeCreatedAt(message.createdAt),
    };
  }

  private normalizeCreatedAt(createdAt?: string | Date): Date {
    if (!createdAt) return new Date();
    const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  async updateModel(chatID: string, model: string): Promise<void> {
    await this.chatModel.findByIdAndUpdate(chatID, { model }).exec();
  }

  async createWithUserMessage(
    userID: string,
    message: Message,
    model?: string,
  ): Promise<ChatDocument> {
    const chat = new this.chatModel({
      userID,
      title: 'New Chat',
      messages: [message],
      ...(model && { model }),
    });
    const saved = await chat.save();

    this.generateTitle(message.content)
      .then((title) =>
        this.chatModel.findByIdAndUpdate(saved._id, { title }).exec(),
      )
      .catch((err) => this.logger.error('Failed to update chat title:', err));

    return saved;
  }

  async appendMessage(
    chatID: string,
    userID: string,
    message: Message,
  ): Promise<void> {
    // Filter by BOTH _id and userID so a misrouted call from one user's
    // run cannot mutate another user's chat. A failed match throws
    // ForbiddenException rather than silently writing — silent failure
    // would let cross-user contamination land in chat history without
    // the agent noticing.
    const result = await this.chatModel
      .findOneAndUpdate(
        { _id: chatID, userID },
        { $push: { messages: message } },
      )
      .exec();

    if (!result) {
      throw new ForbiddenException(
        `Cannot append to chat "${chatID}": not found or not owned by user`,
      );
    }
  }

  async loadConversationHistory(
    chatID: string,
  ): Promise<{ role: string; content: string; attachments?: unknown[] }[]> {
    const chat = await this.chatModel.findById(chatID).exec();
    if (!chat) return [];
    return chat.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.attachments &&
        m.attachments.length > 0 && { attachments: m.attachments }),
    }));
  }

  async searchMessages(
    userID: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<
    Array<{
      chatID: string;
      title: string;
      matches: Array<{ role: string; content: string; createdAt: Date }>;
      score: number;
    }>
  > {
    const limit = opts?.limit ?? 10;

    const results = await this.chatModel
      .find(
        { userID, $text: { $search: query } },
        { score: { $meta: 'textScore' } },
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .exec();

    return results.map((chat) => {
      const queryWords = query.toLowerCase().split(/\s+/);
      const matches = chat.messages
        .filter((m) => {
          const lower = m.content.toLowerCase();
          return queryWords.some((w) => lower.includes(w));
        })
        .slice(0, 5)
        .map((m) => ({
          role: m.role,
          content:
            m.content.length > 500
              ? m.content.slice(0, 500) + '...'
              : m.content,
          createdAt: m.createdAt,
        }));

      return {
        chatID: (chat as ChatDocument)._id.toString(),
        title: chat.title,
        matches,
        score: (chat as unknown as { score: number }).score,
      };
    });
  }

  async remove(chatID: string, userID: string): Promise<void> {
    const chat = await this.chatModel.findById(chatID).exec();

    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatID} not found`);
    }

    if (chat.userID !== userID) {
      throw new ForbiddenException('You do not have access to this chat');
    }

    await this.chatModel.findByIdAndDelete(chatID).exec();
  }
}
