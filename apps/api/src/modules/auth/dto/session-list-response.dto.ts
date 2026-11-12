import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SessionListResponseDto as ISessionListResponseDto,
  UserSessionDto as IUserSessionDto,
} from '@halal-dine/contracts';

export class UserSessionDto implements IUserSessionDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Unique session identifier (UUID v4)',
  })
  id!: string;

  @ApiPropertyOptional({
    example: 'Pixel 9 Pro',
    nullable: true,
    description: 'Human-readable client device description if supplied at login',
  })
  deviceInfo!: string | null;

  @ApiPropertyOptional({
    example: 'Mozilla/5.0',
    nullable: true,
    description: 'Recorded User-Agent metadata for the session',
  })
  userAgent!: string | null;

  @ApiPropertyOptional({
    example: '203.0.113.10',
    nullable: true,
    description: 'Recorded client IP address for the session',
  })
  ipAddress!: string | null;

  @ApiProperty({
    example: '2026-11-12T15:30:00.000Z',
    description: 'ISO-8601 timestamp of the most recent login or token refresh',
  })
  lastUsedAt!: string;

  @ApiProperty({
    example: '2026-11-19T15:30:00.000Z',
    description: 'ISO-8601 timestamp when this session expires unless refreshed',
  })
  expiresAt!: string;

  @ApiProperty({
    example: '2026-11-12T15:00:00.000Z',
    description: 'ISO-8601 timestamp when this session was initially created',
  })
  createdAt!: string;

  @ApiProperty({
    example: true,
    description: 'Whether this entry represents the caller current authenticated session',
  })
  isCurrent!: boolean;
}

export class SessionListResponseDto implements ISessionListResponseDto {
  @ApiProperty({
    type: [UserSessionDto],
    description: 'Active non-revoked sessions belonging to the authenticated user',
  })
  sessions!: UserSessionDto[];
}
