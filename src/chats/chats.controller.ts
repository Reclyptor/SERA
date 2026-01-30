import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { UpdateChatDto } from './dto/update-chat.dto';
import { CurrentUser } from '../auth/user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() createChatDto: CreateChatDto,
  ) {
    return this.chatsService.create(user.sub, createChatDto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.chatsService.findAllByUser(user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.chatsService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() updateChatDto: UpdateChatDto,
  ) {
    return this.chatsService.update(id, user.sub, updateChatDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.chatsService.remove(id, user.sub);
  }
}
