import { Controller, Get } from '@nestjs/common';
import { Public } from './auth';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
