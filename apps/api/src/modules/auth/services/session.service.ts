import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, User, UserSession } from '@prisma/client';
import type { CookieOptions, Request } from 'express';
import { UserSessionDto, UserStatus } from '@halal-dine/contracts';
import { parseCorsOrigins } from '../../../common/config/env.validation';
import { parsePositiveInt } from '../../../common/utils/env.util';
import { PrismaService } from '../../../database/prisma.service';
import { TokenCryptoService } from './token-crypto.service';

export interface CreateInitialSessionParams {
  userId: string;
  deviceInfo?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface CreatedSessionResult {
  session: UserSession;
  user: User;
  rawRefreshToken: string;
  expiresAt: Date;
}

export interface RotateRefreshTokenParams {
  rawRefreshToken: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface RotatedSessionResult {
  sessionId: string;
  userId: string;
  rawRefreshToken: string;
  expiresAt: Date;
}

export interface RefreshCookieDescriptor {
  name: string;
  options: CookieOptions;
}

interface RotatedRecordWithSession {
  id: string;
  sessionId: string;
  rotatedAt: Date;
  session: {
    id: string;
    userId: string;
    revokedAt: Date | null;
  };
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly tokenCryptoService: TokenCryptoService,
  ) {}

  /**
   * Atomically persists a new UserSession (storing only the SHA-256 refresh-token hash)
   * and updates User.lastLoginAt within a single database transaction.
   */
  async createInitialSession(params: CreateInitialSessionParams): Promise<CreatedSessionResult> {
    const { rawToken, tokenHash } = this.tokenCryptoService.generateOpaqueToken(32);
    const expiryDays = this.getRefreshExpiryDays();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const deviceInfo = this.sanitizeMetadata(params.deviceInfo, 255);
    const userAgent = this.sanitizeMetadata(params.userAgent, 512);
    const ipAddress = this.sanitizeMetadata(params.ipAddress, 45);

    try {
      const { session, user } = await this.prisma.$transaction(async (tx) => {
        const createdSession = await tx.userSession.create({
          data: {
            userId: params.userId,
            refreshTokenHash: tokenHash,
            deviceInfo,
            userAgent,
            ipAddress,
            lastUsedAt: now,
            expiresAt,
          },
        });

        const updatedUser = await tx.user.update({
          where: { id: params.userId },
          data: { lastLoginAt: now },
        });

        return { session: createdSession, user: updatedUser };
      });

      return {
        session,
        user,
        rawRefreshToken: rawToken,
        expiresAt,
      };
    } catch (error) {
      const safeSummary = this.formatSafeErrorSummary(error);
      this.logger.error(
        `Failed to create authentication session for user [${params.userId}]: ${safeSummary}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to create authentication session');
    }
  }

  /**
   * Validates, rotates, and records refresh-token history atomically.
   * Rejects overlapping concurrent callers via conditional CAS without prematurely revoking
   * the winning session, while immediately revoking compromised sessions when an already-committed
   * rotated token hash is replayed.
   */
  async rotateRefreshToken(params: RotateRefreshTokenParams): Promise<RotatedSessionResult> {
    const presentedHash = this.tokenCryptoService.hashToken(params.rawRefreshToken);

    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: presentedHash },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            isEmailVerified: true,
          },
        },
      },
    });

    if (!session) {
      const rotatedRecord = await this.prisma.rotatedRefreshToken.findUnique({
        where: { tokenHash: presentedHash },
        include: {
          session: {
            select: {
              id: true,
              userId: true,
              revokedAt: true,
            },
          },
        },
      });

      if (rotatedRecord) {
        await this.handleRefreshTokenReuse(rotatedRecord, params.ipAddress, params.userAgent);
      }

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const now = new Date();
    if (session.revokedAt !== null || session.expiresAt <= now) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    this.assertUserEligible(session.user.status as UserStatus, session.user.isEmailVerified);

    const { rawToken: newRawToken, tokenHash: newTokenHash } =
      this.tokenCryptoService.generateOpaqueToken(32);
    const expiryDays = this.getRefreshExpiryDays();
    const rotatedRetentionDays = this.getRotatedTokenRetentionDays();
    const newExpiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
    const rotatedExpiresAt = new Date(
      Math.max(
        session.expiresAt.getTime(),
        now.getTime() + rotatedRetentionDays * 24 * 60 * 60 * 1000,
      ),
    );

    const sanitizedUa = this.sanitizeMetadata(params.userAgent, 512);
    const sanitizedIp = this.sanitizeMetadata(params.ipAddress, 45);

    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional CAS guarantees at most one concurrent caller can rotate a given token hash
      const casResult = await tx.userSession.updateMany({
        where: {
          id: session.id,
          refreshTokenHash: presentedHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          refreshTokenHash: newTokenHash,
          expiresAt: newExpiresAt,
          lastUsedAt: now,
          ...(sanitizedUa !== null ? { userAgent: sanitizedUa } : {}),
          ...(sanitizedIp !== null ? { ipAddress: sanitizedIp } : {}),
        },
      });

      if (casResult.count !== 1) {
        return false;
      }

      await tx.rotatedRefreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: presentedHash,
          rotatedAt: now,
          expiresAt: rotatedExpiresAt,
        },
      });

      return true;
    });

    if (!rotated) {
      this.logger.warn(
        `Concurrent refresh race rejected for session [${session.id}] without revoking active token`,
      );
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return {
      sessionId: session.id,
      userId: session.userId,
      rawRefreshToken: newRawToken,
      expiresAt: newExpiresAt,
    };
  }

  /**
   * Idempotently revokes the caller's current session and invalidates its active token hash.
   */
  async revokeCurrentSession(userId: string, sessionId: string): Promise<void> {
    const now = new Date();
    const replacementHash = this.tokenCryptoService.generateOpaqueToken(32).tokenHash;

    await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        refreshTokenHash: replacementHash,
      },
    });
  }

  /**
   * Atomically revokes every active session belonging to the user while invalidating
   * all active refresh-token hashes without affecting other users.
   */
  async revokeAllUserSessions(userId: string): Promise<number> {
    return this.prisma.$transaction((tx) => this.revokeAllUserSessionsInTransaction(tx, userId));
  }

  /**
   * Revokes every active session belonging to the user inside an existing caller transaction
   * (used by password reset and logout-all without duplicating session revocation logic).
   */
  async revokeAllUserSessionsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    const now = new Date();
    const activeSessions = await tx.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      select: { id: true },
    });

    let revokedCount = 0;
    for (const activeSession of activeSessions) {
      const replacementHash = this.tokenCryptoService.generateOpaqueToken(32).tokenHash;
      const result = await tx.userSession.updateMany({
        where: {
          id: activeSession.id,
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          refreshTokenHash: replacementHash,
        },
      });
      revokedCount += result.count;
    }

    return revokedCount;
  }

  /**
   * Lists safe metadata for the user's active, non-revoked, non-expired sessions.
   */
  async listActiveSessions(userId: string, currentSessionId: string): Promise<UserSessionDto[]> {
    const now = new Date();
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        deviceInfo: true,
        userAgent: true,
        ipAddress: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      deviceInfo: session.deviceInfo,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      isCurrent: session.id === currentSessionId,
    }));
  }

  /**
   * Revokes a single session owned by the authenticated user.
   * Throws 404 for unknown or cross-user session IDs to avoid leaking session existence.
   */
  async revokeIndividualSession(userId: string, targetSessionId: string): Promise<void> {
    const session = await this.prisma.userSession.findFirst({
      where: {
        id: targetSessionId,
        userId,
      },
      select: {
        id: true,
        revokedAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.revokedAt === null) {
      await this.revokeCurrentSession(userId, targetSessionId);
    }
  }

  /**
   * Generates a double-submit CSRF token for web cookie sessions.
   */
  generateCsrfToken(): string {
    return this.tokenCryptoService.generateOpaqueToken(32).rawToken;
  }

  /**
   * Enforces origin allowlisting and double-submit CSRF verification for web cookie requests.
   */
  validateWebCsrf(req: Request): void {
    const allowedOrigins = parseCorsOrigins(
      this.configService.get<string>('CORS_ORIGIN', 'http://localhost:3000'),
    );
    const requestOrigin = this.extractRequestOrigin(req);

    if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
      throw new ForbiddenException('CSRF origin validation failed');
    }

    const csrfCookieName = this.getCsrfCookieName();
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const cookieToken =
      typeof cookies?.[csrfCookieName] === 'string' ? cookies[csrfCookieName] : '';
    const headerToken = req.get('x-csrf-token')?.trim() ?? '';

    if (!cookieToken || !headerToken) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }

    if (!this.tokenCryptoService.constantTimeEquals(cookieToken, headerToken)) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }
  }

  getRefreshCookieName(): string {
    return this.configService.get<string>('REFRESH_COOKIE_NAME', 'halal_dine_refresh_token');
  }

  getCsrfCookieName(): string {
    return this.configService.get<string>('REFRESH_CSRF_COOKIE_NAME', 'halal_dine_csrf_token');
  }

  /**
   * Builds Express HttpOnly cookie configuration for web refresh-token delivery.
   */
  getRefreshCookieConfig(expiresAt: Date): RefreshCookieDescriptor {
    return {
      name: this.getRefreshCookieName(),
      options: this.buildCookieOptions(
        true,
        this.configService.get<string>('REFRESH_COOKIE_PATH', '/api/auth'),
        expiresAt,
      ),
    };
  }

  getRefreshClearCookieConfig(): RefreshCookieDescriptor {
    return {
      name: this.getRefreshCookieName(),
      options: this.buildCookieOptions(
        true,
        this.configService.get<string>('REFRESH_COOKIE_PATH', '/api/auth'),
      ),
    };
  }

  getCsrfCookieConfig(expiresAt: Date): RefreshCookieDescriptor {
    return {
      name: this.getCsrfCookieName(),
      options: this.buildCookieOptions(false, '/', expiresAt),
    };
  }

  getCsrfClearCookieConfig(): RefreshCookieDescriptor {
    return {
      name: this.getCsrfCookieName(),
      options: this.buildCookieOptions(false, '/'),
    };
  }

  private async handleRefreshTokenReuse(
    rotatedRecord: RotatedRecordWithSession,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const now = new Date();
    const replacementHash = this.tokenCryptoService.generateOpaqueToken(32).tokenHash;
    const sanitizedIp = this.sanitizeMetadata(ipAddress, 45);
    const sanitizedUa = this.sanitizeMetadata(userAgent, 256);

    await this.prisma.$transaction(async (tx) => {
      if (rotatedRecord.session.revokedAt === null) {
        await tx.userSession.updateMany({
          where: {
            id: rotatedRecord.sessionId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            refreshTokenHash: replacementHash,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: rotatedRecord.session.userId,
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          entityName: 'UserSession',
          entityId: rotatedRecord.sessionId,
          ipAddress: sanitizedIp,
          details: {
            rotatedTokenId: rotatedRecord.id,
            rotatedAt: rotatedRecord.rotatedAt.toISOString(),
            detectedAt: now.toISOString(),
            alreadyRevoked: rotatedRecord.session.revokedAt !== null,
            userAgent: sanitizedUa,
            outcome: 'SESSION_REVOKED',
          },
        },
      });
    });

    this.logger.warn(
      `Refresh token reuse detected: revoked session [${rotatedRecord.sessionId}] for user [${rotatedRecord.session.userId}]`,
    );
  }

  assertUserEligible(status: UserStatus, isEmailVerified: boolean): void {
    if (status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Your account has been suspended. Please contact support.');
    }

    if (status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException('Your account has been deactivated. Please contact support.');
    }

    if (status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your account is not eligible to sign in.');
    }

    if (!isEmailVerified) {
      throw new ForbiddenException('Email verification is required before signing in.');
    }
  }

  private buildCookieOptions(httpOnly: boolean, path: string, expires?: Date): CookieOptions {
    const isProduction = this.configService.get<string>('NODE_ENV', 'development') === 'production';
    const domain = this.configService.get<string>('REFRESH_COOKIE_DOMAIN');
    const sameSite = this.configService.get<'lax' | 'strict' | 'none'>(
      'REFRESH_COOKIE_SAME_SITE',
      'lax',
    );

    return {
      httpOnly,
      secure: isProduction || sameSite === 'none',
      sameSite,
      path,
      ...(expires ? { expires } : {}),
      ...(domain ? { domain } : {}),
    };
  }

  private extractRequestOrigin(req: Request): string | null {
    const originHeader = req.get('origin')?.trim();
    if (originHeader) {
      try {
        return new URL(originHeader).origin;
      } catch {
        return null;
      }
    }

    const refererHeader = req.get('referer')?.trim();
    if (refererHeader) {
      try {
        return new URL(refererHeader).origin;
      } catch {
        return null;
      }
    }

    return null;
  }

  private getRefreshExpiryDays(): number {
    return parsePositiveInt(String(this.configService.get('REFRESH_TOKEN_EXPIRY_DAYS') ?? ''), 7);
  }

  private getRotatedTokenRetentionDays(): number {
    return parsePositiveInt(
      String(this.configService.get('ROTATED_TOKEN_RETENTION_DAYS') ?? ''),
      30,
    );
  }

  private formatSafeErrorSummary(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return `${error.name} (${error.code})`;
    }
    return error instanceof Error ? error.name : 'UnknownError';
  }

  private sanitizeMetadata(value: string | undefined, maxLength: number): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed.slice(0, maxLength);
  }
}
