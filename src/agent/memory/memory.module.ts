import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { SecurityModule } from '../security/security.module';
import { PromptsModule } from '../../prompts/prompts.module';

@Module({
  imports: [SecurityModule, PromptsModule],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
