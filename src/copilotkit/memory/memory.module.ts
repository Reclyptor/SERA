import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MemoryService } from './memory.service';
import { Memory, MemorySchema } from './schemas/memory.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Memory.name, schema: MemorySchema },
    ]),
  ],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
