import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { PromptsService } from './prompts.service';

@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  list() {
    return this.promptsService.list();
  }

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    const content = await this.promptsService.get(slug);
    if (content === null) {
      throw new NotFoundException(`Prompt "${slug}" not found`);
    }
    return { slug, content };
  }

  @Put(':slug')
  upsert(
    @Param('slug') slug: string,
    @Body() body: { content: string; metadata?: Record<string, unknown> },
  ) {
    return this.promptsService.upsert(slug, body.content, body.metadata);
  }

  @Delete(':slug')
  async delete(@Param('slug') slug: string) {
    const deleted = await this.promptsService.delete(slug);
    if (!deleted) {
      throw new NotFoundException(`Prompt "${slug}" not found`);
    }
    return { deleted: true };
  }
}
