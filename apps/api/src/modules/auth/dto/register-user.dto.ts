import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegisterRequestDto } from '@halal-dine/contracts';

export class RegisterUserDto implements RegisterRequestDto {
  @ApiProperty({
    example: 'Mohammed Shafeeq',
    description: 'Full name of the user',
    minLength: 2,
    maxLength: 100,
  })
  name!: string;

  @ApiProperty({
    example: 'shafeeq@example.com',
    description: 'Valid, unique email address',
    maxLength: 255,
  })
  email!: string;

  @ApiProperty({
    example: 'P@ssw0rd123!',
    description:
      'Strong password: at least 8 characters with at least one uppercase letter, one lowercase letter, one digit, and one special character',
    minLength: 8,
    maxLength: 100,
  })
  password!: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Optional contact phone number in international format',
  })
  phone?: string;
}
