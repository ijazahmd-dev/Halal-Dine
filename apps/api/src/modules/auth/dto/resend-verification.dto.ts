import { ApiProperty } from '@nestjs/swagger';
import { ResendVerificationRequestDto } from '@halal-dine/contracts';

export class ResendVerificationDto implements ResendVerificationRequestDto {
  @ApiProperty({
    example: 'shafeeq@example.com',
    description: 'Email address associated with the unverified account',
    maxLength: 255,
  })
  email!: string;
}
