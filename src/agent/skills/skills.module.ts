import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Skill, SkillSchema } from './skill.schema';
import { SkillsService } from './skills.service';
import { SkillsController } from './skills.controller';
import { SecurityModule } from '../security/security.module';
import { SkillCuratorService } from './skill-curator.service';

@Module({
  imports: [
    ConfigModule,
    SecurityModule,
    MongooseModule.forFeature([{ name: Skill.name, schema: SkillSchema }]),
  ],
  controllers: [SkillsController],
  providers: [SkillsService, SkillCuratorService],
  exports: [SkillsService],
})
export class SkillsModule {}
