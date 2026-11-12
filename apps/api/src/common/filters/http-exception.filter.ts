import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from '@halal-dine/validation';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let clientMessage: string | string[] = 'Internal server error';
    let serverLogDetail = 'Unexpected error';

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      clientMessage = exception.errors.map((err) =>
        err.path.length > 0 ? `${err.path.join('.')}: ${err.message}` : err.message,
      );
      serverLogDetail = JSON.stringify(clientMessage);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let extracted: string | string[] = exception.message;
      if (typeof exceptionResponse === 'string') {
        extracted = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        extracted = (exceptionResponse as { message: string | string[] }).message;
      }

      serverLogDetail = typeof extracted === 'string' ? extracted : JSON.stringify(extracted);
      // Never expose internal exception messages for 5xx responses
      clientMessage = status >= 500 ? 'Internal server error' : extracted;
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      clientMessage = 'Internal server error';
      serverLogDetail = this.getSafeErrorSummary(exception);
    }

    const errorPayload = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: clientMessage,
    };

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} - Status: ${status} - ${serverLogDetail}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[${request.method}] ${request.url} - Status: ${status} - Warning: ${serverLogDetail}`,
      );
    }

    response.status(status).json(errorPayload);
  }

  private getSafeErrorSummary(error: Error): string {
    const errorName = error.name || 'Error';
    // Avoid logging Prisma query payloads that may contain personal data, tokens, or password hashes
    if (errorName.startsWith('PrismaClient')) {
      const code =
        'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? ` (code: ${(error as { code: string }).code})`
          : '';
      return `${errorName}${code}`;
    }
    return `${errorName}: ${error.message}`;
  }
}
