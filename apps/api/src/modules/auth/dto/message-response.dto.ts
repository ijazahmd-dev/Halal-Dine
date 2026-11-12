import { ApiProperty } from '@nestjs/swagger';
import { MessageResponseDto as IMessageResponseDto } from '@halal-dine/contracts';

export class MessageResponseDto implements IMessageResponseDto {
  @ApiProperty({
    example: 'Email verified successfully.',
    description: 'Safe informational message without exposing tokens or sensitive account details',
  })
  message!: string;
}
