// User & Auth
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  ADMIN = 'ADMIN',
  VERIFIER = 'VERIFIER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export enum OwnerRole {
  PRIMARY_OWNER = 'PRIMARY_OWNER',
  MANAGER = 'MANAGER',
}

// Halal Statuses as defined in PROJECT_CONTEXT.md
export enum HalalVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  RESTAURANT_CLAIMS_HALAL = 'RESTAURANT_CLAIMS_HALAL',
  VERIFICATION_PENDING = 'VERIFICATION_PENDING',
  VERIFIED_HALAL = 'VERIFIED_HALAL',
  VERIFICATION_EXPIRED = 'VERIFICATION_EXPIRED',
  REPORT_UNDER_REVIEW = 'REPORT_UNDER_REVIEW',
}

// Ownership Claim Statuses
export enum ClaimStatus {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  MORE_INFO_NEEDED = 'MORE_INFO_NEEDED',
}

// Verification Case Statuses
export enum VerificationCaseStatus {
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

// Common DTO interfaces
export interface HealthStatusResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  environment: string;
  database: {
    status: 'up' | 'down';
    latencyMs?: number;
  };
  version: string;
}

export interface UserSummaryDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isEmailVerified: boolean;
  createdAt: string;
}

export interface UserResponseDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequestDto {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export interface VerifyEmailRequestDto {
  token: string;
}

export interface ResendVerificationRequestDto {
  email: string;
}

export interface MessageResponseDto {
  message: string;
}

export interface CoordinatesDto {
  latitude: number;
  longitude: number;
}

export interface RestaurantSummaryDto {
  id: string;
  slug: string;
  name: string;
  description?: string;
  address: string;
  city: string;
  district: string;
  state: string;
  postalCode?: string;
  location: CoordinatesDto;
  distanceMeters?: number;
  halalStatus: HalalVerificationStatus;
  isClaimed: boolean;
  coverImageUrl?: string;
  rating?: number;
  reviewCount?: number;
}
