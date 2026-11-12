import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as crypto from 'node:crypto';
import { AuthClientType, UserRole, UserStatus } from '@halal-dine/contracts';
import { ChangePasswordInput, LoginUserInput, RegisterUserInput } from '@halal-dine/validation';
import { parseDurationToSeconds } from '../../common/utils/env.util';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginResponseDto } from './dto/login-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';

export interface LoginContext {
  input: LoginUserInput;
  clientType: AuthClientType;
  userAgent?: string;
  ipAddress?: string;
}

export interface LoginExecutionResult {
  response: LoginResponseDto;
  rawRefreshToken: string;
  expiresAt: Date;
}

export interface RefreshContext {
  rawRefreshToken: string;
  clientType: AuthClientType;
  userAgent?: string;
  ipAddress?: string;
}

export interface RefreshExecutionResult {
  response: RefreshResponseDto;
  rawRefreshToken: string;
  expiresAt: Date;
}

export interface ChangePasswordContext {
  userId: string;
  input: ChangePasswordInput;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly sessionService: SessionService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Registers a new user account with Argon2id password hashing, active customer status,
   * and atomically creates an initial email verification token.
   */
  async register(input: RegisterUserInput): Promise<UserResponseDto> {
    const email = input.email;
    const phone = input.phone ?? null;

    // 1. Pre-check for duplicate email or phone
    const existingEmail = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingEmail) {
      throw new ConflictException('An account with this email address already exists');
    }

    if (phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone },
        select: { id: true },
      });

      if (existingPhone) {
        throw new ConflictException('An account with this phone number already exists');
      }
    }

    // 2. Hash password using centralized PasswordService (Argon2id)
    const passwordHash = await this.passwordService.hash(input.password);

    // 3. Create User record and initial EmailVerificationToken atomically in a transaction
    let result: { user: User; rawToken: string; expiryHours: number };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.name,
            email,
            phone,
            passwordHash,
            role: UserRole.CUSTOMER,
            status: UserStatus.ACTIVE,
            isEmailVerified: false,
            isPhoneVerified: false,
          },
        });

        const issued = await this.emailVerificationService.createTokenInTransaction(tx, user.id);

        return {
          user,
          rawToken: issued.rawToken,
          expiryHours: issued.expiryHours,
        };
      });

      this.logger.log(`User registered successfully: [${result.user.id}]`);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[] | string) || [];
        const targetStr = Array.isArray(target) ? target.join(',') : String(target);

        if (targetStr.includes('email')) {
          throw new ConflictException('An account with this email address already exists');
        }
        if (targetStr.includes('phone')) {
          throw new ConflictException('An account with this phone number already exists');
        }
        throw new ConflictException('A user with these unique credentials already exists');
      }

      const safeSummary =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? `${error.name} (${error.code})`
          : error instanceof Error
            ? error.message
            : 'Unknown error';
      this.logger.error(
        `Unexpected error during user registration: ${safeSummary}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to complete user registration');
    }

    // 4. Dispatch verification email safely outside DB transaction
    await this.emailVerificationService.dispatchVerificationEmail({
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      rawToken: result.rawToken,
      expiryHours: result.expiryHours,
    });

    // 5. Return safe user representation (strictly excluding passwordHash and verification tokens)
    return this.toUserResponseDto(result.user);
  }

  /**
   * Authenticates a user, verifies account eligibility, creates an initial UserSession,
   * updates lastLoginAt atomically, and issues a short-lived JWT access token.
   */
  async login(context: LoginContext): Promise<LoginExecutionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: context.input.email },
    });

    if (!user) {
      await this.passwordService.verifyAgainstDummy(context.input.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await this.passwordService.verify(
      user.passwordHash,
      context.input.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Account eligibility checks strictly occur AFTER password verification to avoid enumeration
    this.sessionService.assertUserEligible(user.status as UserStatus, user.isEmailVerified);

    // Atomically persist initial UserSession and update User.lastLoginAt
    const created = await this.sessionService.createInitialSession({
      userId: user.id,
      deviceInfo: context.input.deviceInfo,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    const { accessToken, expiresIn } = await this.issueAccessToken(
      created.user.id,
      created.session.id,
    );

    this.logger.log(
      `User authenticated: [${created.user.id}] session=[${created.session.id}] client=[${context.clientType}]`,
    );

    const response: LoginResponseDto = {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      ...(context.clientType === 'mobile' ? { refreshToken: created.rawRefreshToken } : {}),
      user: this.toUserResponseDto(created.user),
    };

    return {
      response,
      rawRefreshToken: created.rawRefreshToken,
      expiresAt: created.expiresAt,
    };
  }

  /**
   * Validates and atomically rotates a refresh token, enforces reuse detection and eligibility,
   * and issues a renewed short-lived JWT access token bound to the existing session.
   */
  async refresh(context: RefreshContext): Promise<RefreshExecutionResult> {
    const rotated = await this.sessionService.rotateRefreshToken({
      rawRefreshToken: context.rawRefreshToken,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    const { accessToken, expiresIn } = await this.issueAccessToken(
      rotated.userId,
      rotated.sessionId,
    );

    const response: RefreshResponseDto = {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      ...(context.clientType === 'mobile' ? { refreshToken: rotated.rawRefreshToken } : {}),
    };

    return {
      response,
      rawRefreshToken: rotated.rawRefreshToken,
      expiresAt: rotated.expiresAt,
    };
  }

  /**
   * Changes the password for an authenticated user after verifying the current password,
   * atomically revoking all active sessions across devices, and sending a post-commit notification.
   */
  async changePassword(context: ChangePasswordContext): Promise<MessageResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        passwordHash: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not eligible or could not be found');
    }

    const isCurrentPasswordValid = await this.passwordService.verify(
      user.passwordHash,
      context.input.currentPassword,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (context.input.currentPassword === context.input.newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const isSameAsExisting = await this.passwordService.verify(
      user.passwordHash,
      context.input.newPassword,
    );

    if (isSameAsExisting) {
      throw new BadRequestException('New password must be different from current password');
    }

    const newPasswordHash = await this.passwordService.hash(context.input.newPassword);
    const sanitizedIp = context.ipAddress ? context.ipAddress.trim().slice(0, 45) || null : null;

    await this.prisma.$transaction(async (tx) => {
      const txNow = new Date();

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash },
      });

      await this.sessionService.revokeAllUserSessionsInTransaction(tx, user.id);

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'PASSWORD_CHANGED',
          entityName: 'User',
          entityId: user.id,
          ipAddress: sanitizedIp,
          details: {
            changedAt: txNow.toISOString(),
            revocationOutcome: 'ALL_SESSIONS_REVOKED',
          },
        },
      });
    });

    this.logger.log(`Password changed successfully for user [${user.id}]`);

    // Dispatch notification after transaction commits; email failure must not roll back change
    try {
      await this.mailService.sendPasswordChangedEmail({
        userId: user.id,
        to: user.email,
        name: user.name,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownDeliveryError';
      this.logger.error(
        `Password changed notification delivery failed for user [${user.id}] (${reason})`,
      );
    }

    return {
      message: 'Password changed successfully. Please sign in again with your new password.',
    };
  }

  private async issueAccessToken(
    userId: string,
    sessionId: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const accessToken = await this.jwtService.signAsync({
      sub: userId,
      sid: sessionId,
      jti: crypto.randomUUID(),
    });

    const expiresIn = parseDurationToSeconds(
      this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRY', '15m'),
      900,
    );

    return { accessToken, expiresIn };
  }

  private toUserResponseDto(user: User): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role as UserRole,
      status: user.status as UserStatus,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
