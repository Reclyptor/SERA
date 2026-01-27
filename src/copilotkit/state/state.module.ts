import { Module } from '@nestjs/common';
import { StateStore } from './state.store';
import { StateService } from './state.service';

@Module({
  providers: [StateStore, StateService],
  exports: [StateService, StateStore],
})
export class StateModule {}
