import { ApiProperty } from '@nestjs/swagger';
import { ChangePasswordRequestDto } from '@halal-dine/contracts';

export class ChangePasswordDto implements ChangePasswordRequestDto {
  @ApiProperty({
    example: 'OldPassword@123',
    description: 'Current account password for verification',
    minLength: 1,
    maxLength: 100,
  })
  currentPassword!: string;

  @ApiProperty({
    example: 'NewStrongP@ssword2026!',
    description:
      'New password (min 8 chars, must include uppercase, lowercase, digit, and special char; must differ from current password)',
    minLength: 8,
    maxLength: 100,
  })
  newPassword!: string;
}
