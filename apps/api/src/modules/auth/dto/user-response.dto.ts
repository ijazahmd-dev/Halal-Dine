import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus, UserResponseDto as IUserResponseDto } from '@halal-dine/contracts';

export class UserResponseDto implements IUserResponseDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Unique user identifier (UUID v4)',
  })
  id!: string;

  @ApiProperty({
    example: 'Mohammed Shafeeq',
    description: 'Full name of the user',
  })
  name!: string;

  @ApiProperty({
    example: 'shafeeq@example.com',
    description: 'Normalized user email address',
  })
  email!: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    nullable: true,
    description: 'User phone number if provided',
  })
  phone!: string | null;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.CUSTOMER,
    description: 'Global system role (CUSTOMER, ADMIN, or VERIFIER)',
  })
  role!: UserRole;

  @ApiProperty({
    enum: UserStatus,
    example: UserStatus.ACTIVE,
    description: 'Current account lifecycle status (ACTIVE, SUSPENDED, DEACTIVATED)',
  })
  status!: UserStatus;

  @ApiProperty({
    example: false,
    description: 'Whether user email address has been verified',
  })
  isEmailVerified!: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether user phone number has been verified',
  })
  isPhoneVerified!: boolean;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'URL to avatar image if uploaded',
  })
  avatarUrl!: string | null;

  @ApiProperty({
    example: '2026-11-11T12:00:00.000Z',
    description: 'ISO-8601 timestamp of record creation',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-11-11T12:00:00.000Z',
    description: 'ISO-8601 timestamp of last record update',
  })
  updatedAt!: string;
}
