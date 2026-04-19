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
    const prompt = await this.promptsService.getDocument(slug);
    if (!prompt) {
      throw new NotFoundException(`Prompt "${slug}" not found`);
    }
    return {
      slug: prompt.slug,
      extends: prompt.extends,
      content: prompt.content,
      description: prompt.description,
      metadata: prompt.metadata,
    };
  }

  @Put(':slug')
  upsert(
    @Param('slug') slug: string,
    @Body()
    body: {
      content: string;
      extends?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.promptsService.upsert(slug, body);
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
