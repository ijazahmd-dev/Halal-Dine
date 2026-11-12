import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  Paramtype,
  PipeTransform,
} from '@nestjs/common';
import { ZodError, ZodSchema } from '@halal-dine/validation';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodSchema,
    private readonly targetType: Paramtype = 'body',
  ) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== this.targetType) {
      return value;
    }

    const result = this.schema.safeParse(value);

    if (!result.success) {
      const error = result.error as ZodError;
      const messages = error.errors.map((err) =>
        err.path.length > 0 ? `${err.path.join('.')}: ${err.message}` : err.message,
      );
      throw new BadRequestException(messages);
    }

    return result.data;
  }
}
