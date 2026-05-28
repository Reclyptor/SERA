import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SessionStrategy } from './session.strategy';
import { SessionAuthGuard } from './session.guard';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'session' })],
  providers: [SessionStrategy, SessionAuthGuard],
})
export class AuthModule {}
