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
import { CreateHeartbeatDto, UpdateHeartbeatDto } from './heartbeat.dto';

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

  @Get(':agentID')
  async findOne(@Param('agentID') agentID: string) {
    const config = await this.heartbeatService.findByAgent(agentID);
    if (!config) {
      throw new NotFoundException(
        `Heartbeat config for agent "${agentID}" not found`,
      );
    }
    return config;
  }

  @Put(':agentID')
  async update(
    @Param('agentID') agentID: string,
    @Body() dto: UpdateHeartbeatDto,
  ) {
    const config = await this.heartbeatService.update(agentID, dto);
    if (!config) {
      throw new NotFoundException(
        `Heartbeat config for agent "${agentID}" not found`,
      );
    }
    return config;
  }

  @Delete(':agentID')
  async remove(@Param('agentID') agentID: string) {
    const deleted = await this.heartbeatService.remove(agentID);
    if (!deleted) {
      throw new NotFoundException(
        `Heartbeat config for agent "${agentID}" not found`,
      );
    }
    return { deleted: true };
  }
}
