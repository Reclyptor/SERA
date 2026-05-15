import {
  Controller,
  Get,
  Delete,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { MemoryService, type MemoryEntry } from './memory.service';
import { CurrentUser } from '../../auth/user.decorator';
import type { SessionUser } from '../../auth/session.strategy';

type MemoryResponse = {
  id: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

@Controller('memories')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  private serialize(entry: MemoryEntry): MemoryResponse {
    return {
      id: entry.id,
      content: entry.content,
      tags: entry.tags,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<MemoryResponse[]> {
    const entries = await this.memoryService.getAll(user.sub);
    return entries.map((entry) => this.serialize(entry));
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    const deleted = await this.memoryService.delete(user.sub, id);
    if (!deleted) {
      throw new NotFoundException(`Memory "${id}" not found`);
    }
    return { deleted: true };
  }
}
