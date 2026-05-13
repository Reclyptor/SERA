import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import type { Prompt } from './prompt.schema';
import { PromptsService } from './prompts.service';

type PromptSummaryResponse = Pick<
  Prompt,
  | 'slug'
  | 'extends'
  | 'seedHash'
  | 'description'
  | 'metadata'
  | 'createdAt'
  | 'updatedAt'
>;

type PromptResponse = PromptSummaryResponse & Pick<Prompt, 'content'>;

@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  private serializePromptSummary(
    prompt: PromptSummaryResponse,
  ): PromptSummaryResponse {
    return {
      slug: prompt.slug,
      extends: prompt.extends,
      seedHash: prompt.seedHash,
      description: prompt.description,
      metadata: prompt.metadata,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
    };
  }

  private serializePrompt(prompt: Prompt): PromptResponse {
    return {
      ...this.serializePromptSummary(prompt),
      content: prompt.content,
    };
  }

  @Post('sync')
  sync() {
    return this.promptsService.syncFromGitHub();
  }

  @Get()
  async list(): Promise<PromptSummaryResponse[]> {
    const prompts = await this.promptsService.list();
    return prompts.map((prompt) => this.serializePromptSummary(prompt));
  }

  @Get(':slug')
  async get(@Param('slug') slug: string): Promise<PromptResponse> {
    const prompt = await this.promptsService.getDocument(slug);
    if (!prompt) {
      throw new NotFoundException(`Prompt "${slug}" not found`);
    }
    return this.serializePrompt(prompt);
  }

  @Put(':slug')
  async upsert(
    @Param('slug') slug: string,
    @Body()
    body: {
      content: string;
      extends?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<PromptResponse> {
    const prompt = await this.promptsService.upsert(slug, body);
    return this.serializePrompt(prompt);
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
