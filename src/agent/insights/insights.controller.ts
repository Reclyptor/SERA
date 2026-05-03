import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { InsightsService } from './insights.service';
import type { SessionUser } from '../../auth/session.strategy';

@Controller('insights')
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('usage')
  async getAggregate(
    @Req() req: Request,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const userID = (req as Request & { user?: SessionUser }).user?.sub;
    if (!userID) return { error: 'Unauthorized' };

    return this.insightsService.getAggregate(userID, {
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
    });
  }

  @Get('run/:runID')
  async getRunUsage(@Param('runID') runID: string) {
    return this.insightsService.getRunUsage(runID);
  }

  @Get('tools')
  async getTopTools(@Req() req: Request, @Query('limit') limit?: string) {
    const userID = (req as Request & { user?: SessionUser }).user?.sub;
    if (!userID) return { error: 'Unauthorized' };

    return this.insightsService.getTopTools(
      userID,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
