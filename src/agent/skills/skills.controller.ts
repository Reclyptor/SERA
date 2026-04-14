import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { SkillsService } from './skills.service';
import { CreateSkillDto, UpdateSkillDto } from './skills.dto';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Post()
  async create(@Body() dto: CreateSkillDto) {
    return this.skillsService.create(dto);
  }

  @Get()
  async findAll() {
    return this.skillsService.findAll();
  }

  @Get(':skillId')
  async findOne(@Param('skillId') skillId: string) {
    const skill = await this.skillsService.findById(skillId);
    if (!skill) {
      throw new NotFoundException(`Skill "${skillId}" not found`);
    }
    return skill;
  }

  @Put(':skillId')
  async update(
    @Param('skillId') skillId: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.skillsService.update(skillId, dto);
  }

  @Delete(':skillId')
  async remove(@Param('skillId') skillId: string) {
    const deleted = await this.skillsService.remove(skillId);
    if (!deleted) {
      throw new NotFoundException(`Skill "${skillId}" not found`);
    }
    return { deleted: true };
  }
}
