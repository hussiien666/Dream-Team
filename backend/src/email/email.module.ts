import {
  Module,
  Controller,
  Post,
  Req,
  HttpCode,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { EmailService } from './email.service.js';
import { ResendProvider } from './resend.provider.js';
import { SmtpProvider } from './smtp.provider.js';
import { GmailProvider } from './gmail.provider.js';
import { NotificationsService } from './notifications.service.js';
@Controller('email')
class EmailWebhookController {
  constructor(
    private readonly provider: ResendProvider,
    private readonly email: EmailService,
  ) {}
  @Post('resend/webhook')
  @HttpCode(204)
  async webhook(@Req() req: RawBodyRequest<Request>) {
    if (!process.env.RESEND_WEBHOOK_SECRET)
      throw new ServiceUnavailableException(
        'Email webhooks are not configured.',
      );
    let value: unknown;
    const id = req.header('svix-id') ?? '';
    try {
      if (!req.rawBody) throw new Error();
      value = this.provider.verify(req.rawBody.toString('utf8'), {
        id,
        timestamp: req.header('svix-timestamp') ?? '',
        signature: req.header('svix-signature') ?? '',
      });
    } catch {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    await this.email.webhook(id, value);
  }
}
@Module({
  controllers: [EmailWebhookController],
  providers: [EmailService, ResendProvider, SmtpProvider, GmailProvider, NotificationsService],
  exports: [EmailService, NotificationsService],
})
export class EmailModule {}
