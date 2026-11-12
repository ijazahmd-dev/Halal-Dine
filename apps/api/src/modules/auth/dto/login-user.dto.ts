import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoginRequestDto } from '@halal-dine/contracts';

export class LoginUserDto implements LoginRequestDto {
  @ApiProperty({
    example: 'shafeeq@example.com',
    description: 'Registered account email address',
    maxLength: 255,
  })
  email!: string;

  @ApiProperty({
    example: 'StrongP@ssw0rd2026!',
    description: 'Account password',
    minLength: 1,
    maxLength: 100,
  })
  password!: string;

  @ApiPropertyOptional({
    example: 'Pixel 8 / Android 15',
    description: 'Optional human-readable client device description recorded on the session',
    maxLength: 255,
  })
  deviceInfo?: string;
}
