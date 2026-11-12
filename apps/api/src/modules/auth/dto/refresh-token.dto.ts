import { ApiPropertyOptional } from '@nestjs/swagger';
import { RefreshTokenRequestDto } from '@halal-dine/contracts';

export class RefreshTokenDto implements RefreshTokenRequestDto {
  @ApiPropertyOptional({
    example: '<opaque-refresh-token-mobile-only>',
    description:
      'Opaque refresh token passed in the JSON request body for X-Client-Type: mobile clients. Web clients omit this field and send the HttpOnly refresh cookie.',
    maxLength: 512,
  })
  refreshToken?: string;
}
