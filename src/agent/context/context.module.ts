import { Module, forwardRef } from '@nestjs/common';
import { ContextCompressorService } from './context-compressor.service';
import { ModelModule } from '../model/model.module';
import { PromptsModule } from '../../prompts/prompts.module';

@Module({
  imports: [forwardRef(() => ModelModule), PromptsModule],
  providers: [ContextCompressorService],
  exports: [ContextCompressorService],
})
export class ContextModule {}
