import { Module } from '@nestjs/common';
import { DreamingService } from './dreaming.service';
import { IntentionsModule } from '../intentions/intentions.module';
import { MemoryModule } from '../memory/memory.module';
import { ModelModule } from '../model/model.module';

@Module({
  imports: [IntentionsModule, MemoryModule, ModelModule],
  providers: [DreamingService],
  exports: [DreamingService],
})
export class DreamingModule {}
