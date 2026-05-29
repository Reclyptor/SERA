import { Module, forwardRef } from '@nestjs/common';
import { ContextOrchestrationService } from './context-orchestration.service';
import { CompactingEngineService } from './engine/compacting-engine.service';
import { CONTEXT_ENGINE } from './engine/context-engine.interface';
import { TokenCounterService } from './tokens/token-counter.service';
import { ModelContextWindowService } from './tokens/model-context-window.service';
import { ToolResultDeduplicatorService } from './pruning/tool-result-deduplicator.service';
import { ToolArgTruncatorService } from './pruning/tool-arg-truncator.service';
import { ImagePrunerService } from './pruning/image-pruner.service';
import { ToolResultRendererService } from './pruning/tool-result-renderer.service';
import { ModelModule } from '../model/model.module';
import { PromptsModule } from '../../prompts/prompts.module';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [
    forwardRef(() => ModelModule),
    PromptsModule,
    forwardRef(() => ToolsModule),
  ],
  providers: [
    ContextOrchestrationService,
    CompactingEngineService,
    { provide: CONTEXT_ENGINE, useExisting: CompactingEngineService },
    TokenCounterService,
    ModelContextWindowService,
    ToolResultDeduplicatorService,
    ToolArgTruncatorService,
    ImagePrunerService,
    ToolResultRendererService,
  ],
  exports: [
    ContextOrchestrationService,
    CompactingEngineService,
    CONTEXT_ENGINE,
    TokenCounterService,
    ModelContextWindowService,
    ToolResultDeduplicatorService,
    ToolArgTruncatorService,
    ImagePrunerService,
    ToolResultRendererService,
  ],
})
export class ContextModule {}
