import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Chat, ChatDocument } from './schemas/chat.schema';
import { CreateChatDto } from './dto/create-chat.dto';
import { UpdateChatDto } from './dto/update-chat.dto';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);
  private readonly anthropic: Anthropic;

  constructor(
    @InjectModel(Chat.name) private chatModel: Model<ChatDocument>,
    private readonly configService: ConfigService,
  ) {
    this.anthropic = new Anthropic();
  }

  async generateTitle(firstMessage: string): Promise<string> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-haiku-latest',
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
      return firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '');
    }
  }

  async create(userID: string, createChatDto: CreateChatDto): Promise<Chat> {
    const firstUserMessage = createChatDto.messages.find(
      (m) => m.role === 'user',
    );
    const title = firstUserMessage
      ? await this.generateTitle(firstUserMessage.content)
      : 'New Chat';

    const chat = new this.chatModel({
      userID,
      title,
      messages: createChatDto.messages,
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

    // Map messages, ensuring createdAt has a default value
    chat.messages = updateChatDto.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt ?? new Date(),
    }));
    return chat.save();
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
