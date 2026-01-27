import { Module } from '@nestjs/common';
import { EventsEmitter } from './events.emitter';
import { EventsService } from './events.service';
import { StateModule } from '../state';

@Module({
  imports: [StateModule],
  providers: [EventsEmitter, EventsService],
  exports: [EventsService, EventsEmitter],
})
export class EventsModule {}
