import {
  Controller,
  Get,
  Delete,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { MemoryService } from './memory.service';
import { CurrentUser } from '../../auth/user.decorator';
import type { SessionUser } from '../../auth/session.strategy';
import type { MemoryRecord } from './memory.types';

type MemoryResponse = {
  id: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

/**
 * Drives the Manage → Memories tab in SERAUI. Routes are scoped to
 * the authenticated user via `@CurrentUser()`; the underlying service
 * + backend additionally enforce ownership on every read and delete.
 */
@Controller('memories')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  private serialize(record: MemoryRecord): MemoryResponse {
    return {
      id: record.id,
      content: record.content,
      tags: record.tags,
      metadata: record.metadata,
      createdAt: record.createdAt.toISOString(),
    };
  }

  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<MemoryResponse[]> {
    const records = await this.memoryService.getAll(user.sub);
    return records.map((record) => this.serialize(record));
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
