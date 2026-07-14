import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  HeartbeatConfig,
  HeartbeatConfigSchema,
} from '../heartbeat/heartbeat.schema';
import { ReachOutService } from './reachout.service';
import { ChatsModule } from '../../chats/chats.module';
import { StateModule } from '../state/state.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PresenceModule } from '../presence/presence.module';
import { NtfyModule } from '../ntfy/ntfy.module';
import { ProactiveModule } from '../proactive/proactive.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HeartbeatConfig.name, schema: HeartbeatConfigSchema },
    ]),
    ChatsModule,
    StateModule,
    NotificationsModule,
    PresenceModule,
    NtfyModule,
    ProactiveModule,
  ],
  providers: [ReachOutService],
  exports: [ReachOutService],
})
export class ReachoutModule {}
