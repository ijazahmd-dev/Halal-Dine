import { ApiProperty } from '@nestjs/swagger';
import { ForgotPasswordRequestDto } from '@halal-dine/contracts';

export class ForgotPasswordDto implements ForgotPasswordRequestDto {
  @ApiProperty({
    example: 'shafeeq@example.com',
    description: 'Registered account email address',
    maxLength: 255,
  })
  email!: string;
}
