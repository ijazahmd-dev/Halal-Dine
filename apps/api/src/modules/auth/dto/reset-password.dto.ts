import { ApiProperty } from '@nestjs/swagger';
import { ResetPasswordRequestDto } from '@halal-dine/contracts';

export class ResetPasswordDto implements ResetPasswordRequestDto {
  @ApiProperty({
    example: '<opaque-password-reset-token>',
    description: 'Single-use password reset token delivered via email reset link',
    maxLength: 512,
  })
  token!: string;

  @ApiProperty({
    example: 'NewStrongP@ssword2026!',
    description:
      'New password (min 8 chars, must include uppercase, lowercase, digit, and special char)',
    minLength: 8,
    maxLength: 100,
  })
  newPassword!: string;
}
