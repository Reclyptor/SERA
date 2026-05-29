import { Module, forwardRef } from '@nestjs/common';
import { ContextCompressorService } from './context-compressor.service';
import { TokenCounterService } from './tokens/token-counter.service';
import { ModelContextWindowService } from './tokens/model-context-window.service';
import { ModelModule } from '../model/model.module';
import { PromptsModule } from '../../prompts/prompts.module';

@Module({
  imports: [forwardRef(() => ModelModule), PromptsModule],
  providers: [
    ContextCompressorService,
    TokenCounterService,
    ModelContextWindowService,
  ],
  exports: [
    ContextCompressorService,
    TokenCounterService,
    ModelContextWindowService,
  ],
})
export class ContextModule {}
