import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [SecurityModule],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
