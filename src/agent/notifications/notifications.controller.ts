import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NotificationsService } from './notifications.service';
import type { SessionUser } from '../../auth/session.strategy';

@Controller('agent')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Always-on per-user SSE stream of `chat.updated` events (§30.11.3). SERAUI
   * keeps one open for live unread badges. Keyed by the session user; a fresh
   * connect tails new events only (`$`), a reconnect resumes from Last-Event-ID.
   */
  @Get('events')
  events(@Req() req: Request, @Res() res: Response): void {
    const userID = (req as Request & { user?: SessionUser }).user?.sub;
    if (!userID) {
      res.status(401).end();
      return;
    }

    const headerLastEventID = req.headers['last-event-id'];
    const lastEventID = Array.isArray(headerLastEventID)
      ? headerLastEventID[0]
      : headerLastEventID;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const subscription = this.notifications
      .createStream(userID, typeof lastEventID === 'string' ? lastEventID : '$')
      .subscribe({
        next: (frame) => {
          if (frame.kind === 'comment') {
            res.write(`: ${frame.text}\n\n`);
          } else {
            res.write(`id: ${frame.id}\ndata: ${frame.data}\n\n`);
          }
        },
        error: () => res.end(),
        complete: () => res.end(),
      });

    req.on('close', () => subscription.unsubscribe());
  }
}
