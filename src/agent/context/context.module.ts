import { Module, forwardRef } from '@nestjs/common';
import { ContextCompressorService } from './context-compressor.service';
import { ModelModule } from '../model/model.module';

@Module({
  imports: [forwardRef(() => ModelModule)],
  providers: [ContextCompressorService],
  exports: [ContextCompressorService],
})
export class ContextModule {}
