import { Module, forwardRef } from '@nestjs/common';
import { ActionsRegistry } from './actions.registry';
import { ActionsService } from './actions.service';
import { ActionsBootstrapService } from './actions-bootstrap.service';
import { MemoryModule } from '../memory/memory.module';
import { NtfyModule } from '../ntfy/ntfy.module';
import { StateModule } from '../state/state.module';
import { StreamingModule } from '../streaming/streaming.module';

@Module({
  imports: [
    MemoryModule,
    NtfyModule,
    StateModule,
    forwardRef(() => StreamingModule),
  ],
  providers: [ActionsRegistry, ActionsService, ActionsBootstrapService],
  exports: [ActionsService, ActionsRegistry],
})
export class ActionsModule {}
