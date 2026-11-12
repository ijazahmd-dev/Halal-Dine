import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefreshResponseDto as IRefreshResponseDto } from '@halal-dine/contracts';

export class RefreshResponseDto implements IRefreshResponseDto {
  @ApiProperty({
    example: '<jwt-access-token>',
    description: 'Newly issued short-lived HS256 JWT access token associated with the same session',
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
    example: '<rotated-opaque-refresh-token-mobile-only>',
    description:
      'Newly rotated opaque refresh token returned in JSON strictly for X-Client-Type: mobile clients. Web clients receive the rotated refresh token via HttpOnly cookie.',
  })
  refreshToken?: string;
}
