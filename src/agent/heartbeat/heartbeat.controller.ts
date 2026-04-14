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
import { HeartbeatService } from './heartbeat.service';

class CreateHeartbeatDto {
  agentId: string;
  intervalMinutes?: number;
  activeHours?: { start: number; end: number; timezone?: string };
  checklist?: string[];
  maxTokens?: number;
  enabled?: boolean;
}

class UpdateHeartbeatDto {
  intervalMinutes?: number;
  activeHours?: { start: number; end: number; timezone?: string };
  checklist?: string[];
  maxTokens?: number;
  enabled?: boolean;
}

@Controller('heartbeats')
export class HeartbeatController {
  constructor(private readonly heartbeatService: HeartbeatService) {}

  @Post()
  async create(@Body() dto: CreateHeartbeatDto) {
    return this.heartbeatService.create(dto);
  }

  @Get()
  async findAll() {
    return this.heartbeatService.findAll();
  }

  @Get(':agentId')
  async findOne(@Param('agentId') agentId: string) {
    const config = await this.heartbeatService.findByAgent(agentId);
    if (!config) {
      throw new NotFoundException(
        `Heartbeat config for agent "${agentId}" not found`,
      );
    }
    return config;
  }

  @Put(':agentId')
  async update(
    @Param('agentId') agentId: string,
    @Body() dto: UpdateHeartbeatDto,
  ) {
    const config = await this.heartbeatService.update(agentId, dto);
    if (!config) {
      throw new NotFoundException(
        `Heartbeat config for agent "${agentId}" not found`,
      );
    }
    return config;
  }

  @Delete(':agentId')
  async remove(@Param('agentId') agentId: string) {
    const deleted = await this.heartbeatService.remove(agentId);
    if (!deleted) {
      throw new NotFoundException(
        `Heartbeat config for agent "${agentId}" not found`,
      );
    }
    return { deleted: true };
  }
}
