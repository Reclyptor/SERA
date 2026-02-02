import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StateStore } from './state.store';
import { StateService } from './state.service';
import { Thread, ThreadSchema } from './schemas/thread.schema';
import { Run, RunSchema } from './schemas/run.schema';
import { AgentState, AgentStateSchema } from './schemas/agent-state.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Thread.name, schema: ThreadSchema },
      { name: Run.name, schema: RunSchema },
      { name: AgentState.name, schema: AgentStateSchema },
    ]),
  ],
  providers: [StateStore, StateService],
  exports: [StateService, StateStore],
})
export class StateModule {}
