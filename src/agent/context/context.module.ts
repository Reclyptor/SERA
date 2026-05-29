import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContextOrchestrationService } from './context-orchestration.service';
import { CompactingEngineService } from './engine/compacting-engine.service';
import { SummarizerService } from './engine/summarizer.service';
import { CONTEXT_ENGINE } from './engine/context-engine.interface';
import { TokenCounterService } from './tokens/token-counter.service';
import { ModelContextWindowService } from './tokens/model-context-window.service';
import { ToolResultDeduplicatorService } from './pruning/tool-result-deduplicator.service';
import { ToolArgTruncatorService } from './pruning/tool-arg-truncator.service';
import { ImagePrunerService } from './pruning/image-pruner.service';
import { ToolResultRendererService } from './pruning/tool-result-renderer.service';
import { CompressionPolicyService } from './policy/compression-policy.service';
import { ContextEventEmitterService } from './events/context-event-emitter.service';
import { SecretRedactorService } from './redaction/secret-redactor.service';
import { SummaryStoreService } from './persistence/summary-store.service';
import { ContextReferencePreprocessorService } from './preprocessing/context-reference-preprocessor.service';
import { FileReferenceResolver } from './preprocessing/reference-resolvers/file.resolver';
import { DiffReferenceResolver } from './preprocessing/reference-resolvers/diff.resolver';
import { UrlReferenceResolver } from './preprocessing/reference-resolvers/url.resolver';
import {
  ContextState,
  ContextStateSchema,
} from './persistence/context-state.schema';
import { ModelModule } from '../model/model.module';
import { PromptsModule } from '../../prompts/prompts.module';
import { ToolsModule } from '../tools/tools.module';
import { StreamingModule } from '../streaming/streaming.module';

@Module({
  imports: [
    forwardRef(() => ModelModule),
    PromptsModule,
    forwardRef(() => ToolsModule),
    StreamingModule,
    MongooseModule.forFeature([
      { name: ContextState.name, schema: ContextStateSchema },
    ]),
  ],
  providers: [
    ContextOrchestrationService,
    CompactingEngineService,
    SummarizerService,
    { provide: CONTEXT_ENGINE, useExisting: CompactingEngineService },
    TokenCounterService,
    ModelContextWindowService,
    ToolResultDeduplicatorService,
    ToolArgTruncatorService,
    ImagePrunerService,
    ToolResultRendererService,
    CompressionPolicyService,
    ContextEventEmitterService,
    SecretRedactorService,
    SummaryStoreService,
    FileReferenceResolver,
    DiffReferenceResolver,
    UrlReferenceResolver,
    ContextReferencePreprocessorService,
  ],
  exports: [
    ContextOrchestrationService,
    CompactingEngineService,
    SummarizerService,
    CONTEXT_ENGINE,
    TokenCounterService,
    ModelContextWindowService,
    ToolResultDeduplicatorService,
    ToolArgTruncatorService,
    ImagePrunerService,
    ToolResultRendererService,
    CompressionPolicyService,
    ContextEventEmitterService,
    SecretRedactorService,
    SummaryStoreService,
    ContextReferencePreprocessorService,
  ],
})
export class ContextModule {}
