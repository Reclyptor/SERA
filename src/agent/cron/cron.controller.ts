import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { CronSchedulerService } from './cron-scheduler.service';

interface CreateCronDto {
  agentID: string;
  schedule: string;
  command: string;
  description?: string;
  enabled?: boolean;
  script?: string;
  contextFromJobID?: string;
}

interface UpdateCronDto {
  schedule?: string;
  command?: string;
  description?: string;
  enabled?: boolean;
  script?: string;
  contextFromJobID?: string;
}

@Controller('crons')
export class CronController {
  constructor(private readonly cronService: CronSchedulerService) {}

  @Post()
  async create(@Body() dto: CreateCronDto) {
    return this.cronService.create(dto);
  }

  @Get()
  async findAll(@Query('agentID') agentID?: string) {
    return this.cronService.findAll(agentID);
  }

  @Get(':jobID')
  async findOne(@Param('jobID') jobID: string) {
    const job = await this.cronService.findByID(jobID);
    if (!job) {
      throw new NotFoundException(`Cron job "${jobID}" not found`);
    }
    return job;
  }

  @Put(':jobID')
  async update(@Param('jobID') jobID: string, @Body() dto: UpdateCronDto) {
    const job = await this.cronService.update(jobID, dto);
    if (!job) {
      throw new NotFoundException(`Cron job "${jobID}" not found`);
    }
    return job;
  }

  @Delete(':jobID')
  async remove(@Param('jobID') jobID: string) {
    const deleted = await this.cronService.remove(jobID);
    if (!deleted) {
      throw new NotFoundException(`Cron job "${jobID}" not found`);
    }
    return { deleted: true };
  }
}
