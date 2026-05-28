import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';
import { Prompt, PromptSchema } from './prompt.schema';
import { PromptSyncStrategy } from './prompt-sync.strategy';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Prompt.name, schema: PromptSchema }]),
  ],
  controllers: [PromptsController],
  providers: [PromptsService, PromptSyncStrategy],
  exports: [PromptsService],
})
export class PromptsModule {}
