import { ApiProperty } from '@nestjs/swagger';
import { VerifyEmailRequestDto } from '@halal-dine/contracts';

export class VerifyEmailDto implements VerifyEmailRequestDto {
  @ApiProperty({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description: 'Verification token from the email verification link',
    maxLength: 512,
  })
  token!: string;
}
