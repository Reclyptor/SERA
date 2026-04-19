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

  @Get(':skillID')
  async findOne(@Param('skillID') skillID: string) {
    const skill = await this.skillsService.findByID(skillID);
    if (!skill) {
      throw new NotFoundException(`Skill "${skillID}" not found`);
    }
    return skill;
  }

  @Put(':skillID')
  async update(
    @Param('skillID') skillID: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.skillsService.update(skillID, dto);
  }

  @Delete(':skillID')
  async remove(@Param('skillID') skillID: string) {
    const deleted = await this.skillsService.remove(skillID);
    if (!deleted) {
      throw new NotFoundException(`Skill "${skillID}" not found`);
    }
    return { deleted: true };
  }
}
