import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message =
        typeof res === 'string' ? res : (res as any).message ?? message;
    } else if (exception instanceof Error) {
      const code = (exception as Error & { code?: unknown }).code;

      this.logger.error(
        JSON.stringify({
          event: 'request.failed',
          type: exception.name,
          code:
            typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
              ? code
              : undefined,
          frames: exception.stack
            ?.split('\n')
            .filter((line) => /^\s*at\s/.test(line))
            .slice(0, 10),
        }),
      );
    }

    response.status(status).json({
      statusCode: status,
      message: Array.isArray(message) ? message.join('; ') : message,
      timestamp: new Date().toISOString(),
    });
  }
}