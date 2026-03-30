import { Module } from '@nestjs/common';
import { ActionsRegistry } from './actions.registry';
import { ActionsService } from './actions.service';

@Module({
  providers: [ActionsRegistry, ActionsService],
  exports: [ActionsService, ActionsRegistry],
})
export class ActionsModule {}
