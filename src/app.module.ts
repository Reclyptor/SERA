import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { SessionAuthGuard } from './auth/session.guard';
import { RedisModule } from './redis/redis.module';
import { ChatsModule } from './chats/chats.module';
import { PromptsModule } from './prompts/prompts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    AuthModule,
    AgentModule,
    ChatsModule,
    PromptsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
  ],
})
export class AppModule {}
