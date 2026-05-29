import { Module, forwardRef } from '@nestjs/common';
import { ContextCompressorService } from './context-compressor.service';
import { ContextOrchestrationService } from './context-orchestration.service';
import { CompactingEngineService } from './engine/compacting-engine.service';
import { CONTEXT_ENGINE } from './engine/context-engine.interface';
import { TokenCounterService } from './tokens/token-counter.service';
import { ModelContextWindowService } from './tokens/model-context-window.service';
import { ModelModule } from '../model/model.module';
import { PromptsModule } from '../../prompts/prompts.module';

@Module({
  imports: [forwardRef(() => ModelModule), PromptsModule],
  providers: [
    ContextCompressorService,
    ContextOrchestrationService,
    CompactingEngineService,
    { provide: CONTEXT_ENGINE, useExisting: CompactingEngineService },
    TokenCounterService,
    ModelContextWindowService,
  ],
  exports: [
    ContextCompressorService,
    ContextOrchestrationService,
    CompactingEngineService,
    CONTEXT_ENGINE,
    TokenCounterService,
    ModelContextWindowService,
  ],
})
export class ContextModule {}
