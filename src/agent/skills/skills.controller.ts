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

  @Post('sync')
  sync() {
    return this.skillsService.syncFromGitHub();
  }

  @Post()
  async create(@Body() dto: CreateSkillDto) {
    return this.skillsService.create(dto);
  }

  @Get()
  async findAll() {
    return this.skillsService.findAll();
  }

  @Get(':name')
  async findOne(@Param('name') name: string) {
    const skill = await this.skillsService.findByName(name);
    if (!skill) {
      throw new NotFoundException(`Skill "${name}" not found`);
    }
    return skill;
  }

  @Put(':name')
  async update(
    @Param('name') name: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.skillsService.update(name, dto);
  }

  @Delete(':name')
  async remove(@Param('name') name: string) {
    const deleted = await this.skillsService.remove(name);
    if (!deleted) {
      throw new NotFoundException(`Skill "${name}" not found`);
    }
    return { deleted: true };
  }
}
