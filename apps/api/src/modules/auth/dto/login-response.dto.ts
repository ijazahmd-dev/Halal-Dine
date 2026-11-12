import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoginResponseDto as ILoginResponseDto } from '@halal-dine/contracts';
import { UserResponseDto } from './user-response.dto';

export class LoginResponseDto implements ILoginResponseDto {
  @ApiProperty({
    example: '<jwt-access-token>',
    description: 'Short-lived signed HS256 JWT access token (default 15 minutes)',
  })
  accessToken!: string;

  @ApiProperty({
    example: 'Bearer',
    description: 'Authorization header token scheme',
  })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: 900,
    description: 'Access token lifetime in seconds',
  })
  expiresIn!: number;

  @ApiPropertyOptional({
    example: '<opaque-refresh-token-mobile-only>',
    description:
      'Opaque refresh token returned in JSON strictly for X-Client-Type: mobile clients. Web clients receive the refresh token exclusively via HttpOnly cookie.',
  })
  refreshToken?: string;

  @ApiProperty({
    type: UserResponseDto,
    description: 'Authenticated user representation without sensitive fields',
  })
  user!: UserResponseDto;
}
