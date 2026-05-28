import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Skill, SkillSchema } from './skill.schema';
import { SkillsService } from './skills.service';
import { SkillsController } from './skills.controller';
import { SecurityModule } from '../security/security.module';
import { SkillCuratorService } from './skill-curator.service';
import { SkillReviewService } from './skill-review.service';
import { SkillsMatcher } from './skills-matcher.service';
import { SkillSyncStrategy } from './skill-sync.strategy';
import { ModelModule } from '../model/model.module';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [
    ConfigModule,
    SecurityModule,
    ModelModule,
    ToolsModule,
    MongooseModule.forFeature([{ name: Skill.name, schema: SkillSchema }]),
  ],
  controllers: [SkillsController],
  providers: [
    SkillsService,
    SkillCuratorService,
    SkillReviewService,
    SkillsMatcher,
    SkillSyncStrategy,
  ],
  exports: [SkillsService, SkillReviewService, SkillsMatcher],
})
export class SkillsModule {}
