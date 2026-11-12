import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthClientType } from '@halal-dine/contracts';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginUserSchema,
  refreshTokenSchema,
  registerUserSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  sessionIdParamSchema,
  verifyEmailSchema,
} from '@halal-dine/validation';
import type { SessionIdParamInput } from '@halal-dine/validation';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { parsePositiveInt } from '../../common/utils/env.util';
import { AuthService } from './auth.service';
import {
  AllowRevokedSession,
  type AuthenticatedAuthContext,
  CurrentAuth,
} from './decorators/current-auth.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionListResponseDto } from './dto/session-list-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { SessionService } from './services/session.service';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly sessionService: SessionService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.AUTH_REGISTER_THROTTLE_LIMIT, 5),
      ttl: () => parsePositiveInt(process.env.AUTH_REGISTER_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Register a new customer account',
    description:
      'Creates a new user account with Argon2id password hashing, active customer status, and unverified credentials, and dispatches a verification email. Rejects duplicate emails and duplicate phone numbers.',
  })
  @ApiBody({ type: RegisterUserDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'User registered successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed (e.g. invalid email format, weak password, unknown fields)',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Email or phone number already in use',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for registration requests',
  })
  async register(
    @Body(new ZodValidationPipe(registerUserSchema)) registerUserDto: RegisterUserDto,
  ): Promise<UserResponseDto> {
    return this.authService.register(registerUserDto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT, 10),
      ttl: () => parsePositiveInt(process.env.AUTH_VERIFY_EMAIL_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Verify user email address',
    description:
      'Validates the verification token hash, rejects invalid/expired/used tokens, marks the token consumed, and activates email verification atomically.',
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Email address verified successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid, expired, or previously used verification token',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for email verification requests',
  })
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) verifyEmailDto: VerifyEmailDto,
  ): Promise<MessageResponseDto> {
    return this.emailVerificationService.verifyEmail(verifyEmailDto);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.RESEND_VERIFICATION_THROTTLE_LIMIT, 3),
      ttl: () => parsePositiveInt(process.env.RESEND_VERIFICATION_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Resend email verification link',
    description:
      'Invalidates previous unused verification tokens and sends a new verification link if an active unverified account matches the email. Always returns a uniform response to prevent email enumeration.',
  })
  @ApiBody({ type: ResendVerificationDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Acknowledgment message returned regardless of email existence',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid email address format',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for verification email resend requests',
  })
  async resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema))
    resendVerificationDto: ResendVerificationDto,
  ): Promise<MessageResponseDto> {
    return this.emailVerificationService.resendVerification(resendVerificationDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.AUTH_LOGIN_THROTTLE_LIMIT, 5),
      ttl: () => parsePositiveInt(process.env.AUTH_LOGIN_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Authenticate user and establish an initial session',
    description:
      'Verifies user email and password, enforces account eligibility (verified email and active status), creates an initial persistent session, and returns a short-lived HS256 JWT access token. Web clients receive the refresh token in an HttpOnly cookie (omitted from JSON); mobile clients (X-Client-Type: mobile) receive the refresh token in the JSON body.',
  })
  @ApiHeader({
    name: 'X-Client-Type',
    required: false,
    description:
      'Delivery transport preference ("web" or "mobile", defaults to "web"). Never used for authorization.',
    schema: {
      type: 'string',
      enum: ['web', 'mobile'],
      default: 'web',
    },
  })
  @ApiBody({ type: LoginUserDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Login successful; returns access token and user profile',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed or invalid X-Client-Type header',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid email or password',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Email address not verified or account suspended/deactivated',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for login requests',
  })
  async login(
    @Body(new ZodValidationPipe(loginUserSchema)) loginUserDto: LoginUserDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const clientType = this.resolveClientType(req.headers['x-client-type']);
    const result = await this.authService.login({
      input: loginUserDto,
      clientType,
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });

    if (clientType === 'web') {
      this.setWebSessionCookies(res, result.rawRefreshToken, result.expiresAt);
    }

    return result.response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.AUTH_REFRESH_THROTTLE_LIMIT, 20),
      ttl: () => parsePositiveInt(process.env.AUTH_REFRESH_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Rotate refresh token and renew JWT access token',
    description:
      'Validates the supplied refresh token (HttpOnly cookie + double-submit CSRF verification for web clients, or JSON body for mobile clients), enforces account eligibility and token reuse detection, atomically rotates the refresh token, and returns a renewed HS256 access token bound to the same session.',
  })
  @ApiHeader({
    name: 'X-Client-Type',
    required: false,
    description: 'Delivery transport preference ("web" or "mobile", defaults to "web").',
    schema: { type: 'string', enum: ['web', 'mobile'], default: 'web' },
  })
  @ApiHeader({
    name: 'X-CSRF-Token',
    required: false,
    description: 'Double-submit CSRF token matching the CSRF cookie (required for web clients).',
  })
  @ApiBody({ type: RefreshTokenDto, required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Refresh successful; returns renewed access token and rotated refresh token',
    type: RefreshResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Malformed payload or invalid X-Client-Type header',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing, invalid, expired, revoked, or reused refresh token',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'CSRF validation failed or user account ineligible',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for refresh requests',
  })
  async refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) refreshTokenDto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponseDto> {
    const clientType = this.resolveClientType(req.headers['x-client-type']);

    if (clientType === 'web') {
      // Enforce origin allowlist and double-submit CSRF token before reading/rotating session cookie
      this.sessionService.validateWebCsrf(req);

      const cookies = req.cookies as Record<string, unknown> | undefined;
      const cookieName = this.sessionService.getRefreshCookieName();
      const rawCookieToken = typeof cookies?.[cookieName] === 'string' ? cookies[cookieName] : '';
      const rawRefreshToken = rawCookieToken.trim();

      if (!rawRefreshToken) {
        this.clearWebSessionCookies(res);
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      try {
        const result = await this.authService.refresh({
          rawRefreshToken,
          clientType: 'web',
          userAgent: req.get('user-agent'),
          ipAddress: req.ip,
        });
        this.setWebSessionCookies(res, result.rawRefreshToken, result.expiresAt);
        return result.response;
      } catch (error) {
        if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
          this.clearWebSessionCookies(res);
        }
        throw error;
      }
    }

    const rawRefreshToken = refreshTokenDto.refreshToken?.trim() ?? '';
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const result = await this.authService.refresh({
      rawRefreshToken,
      clientType: 'mobile',
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });

    return result.response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @AllowRevokedSession()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Log out current authenticated session',
    description:
      'Idempotently revokes the caller current session, invalidates its active refresh-token hash, and clears web refresh/CSRF cookies when X-Client-Type is web.',
  })
  @ApiHeader({
    name: 'X-Client-Type',
    required: false,
    description: 'Delivery transport ("web" or "mobile", defaults to "web").',
    schema: { type: 'string', enum: ['web', 'mobile'], default: 'web' },
  })
  @ApiHeader({
    name: 'X-CSRF-Token',
    required: false,
    description: 'Double-submit CSRF token matching the CSRF cookie (required for web clients).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Session logged out cleanly',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid Bearer access token',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'CSRF validation failed or account ineligible',
  })
  async logout(
    @CurrentAuth() auth: AuthenticatedAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const clientType = this.resolveClientType(req.headers['x-client-type']);
    if (clientType === 'web') {
      this.sessionService.validateWebCsrf(req);
    }

    await this.sessionService.revokeCurrentSession(auth.userId, auth.sessionId);

    if (clientType === 'web') {
      this.clearWebSessionCookies(res);
    }

    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Log out from all active sessions',
    description:
      'Atomically revokes every active session belonging to the authenticated user, invalidates all associated refresh-token hashes, and clears web cookies if applicable. Existing short-lived JWT access tokens expire naturally, while session-backed endpoints reject revoked sessions immediately.',
  })
  @ApiHeader({
    name: 'X-Client-Type',
    required: false,
    description: 'Delivery transport ("web" or "mobile", defaults to "web").',
    schema: { type: 'string', enum: ['web', 'mobile'], default: 'web' },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All active sessions revoked',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid, expired, or revoked access token session',
  })
  async logoutAll(
    @CurrentAuth() auth: AuthenticatedAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const clientType = this.resolveClientType(req.headers['x-client-type']);
    await this.sessionService.revokeAllUserSessions(auth.userId);

    if (clientType === 'web') {
      this.clearWebSessionCookies(res);
    }

    return { message: 'Logged out from all active sessions successfully' };
  }

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'List active sessions for the authenticated user',
    description:
      'Returns safe metadata for all non-revoked, non-expired sessions owned by the caller without exposing token hashes or cryptographic secrets.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active sessions retrieved successfully',
    type: SessionListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid, expired, or revoked access token session',
  })
  async listSessions(
    @CurrentAuth() auth: AuthenticatedAuthContext,
  ): Promise<SessionListResponseDto> {
    const sessions = await this.sessionService.listActiveSessions(auth.userId, auth.sessionId);
    return { sessions };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({
    name: 'sessionId',
    description: 'UUID of the session to revoke (must belong to the authenticated user)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiHeader({
    name: 'X-Client-Type',
    required: false,
    description: 'Delivery transport ("web" or "mobile", defaults to "web").',
    schema: { type: 'string', enum: ['web', 'mobile'], default: 'web' },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Target session revoked successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid sessionId UUID format',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid, expired, or revoked access token session',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Session not found for this account',
  })
  async revokeSession(
    @CurrentAuth() auth: AuthenticatedAuthContext,
    @Param(new ZodValidationPipe(sessionIdParamSchema, 'param')) params: SessionIdParamInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    await this.sessionService.revokeIndividualSession(auth.userId, params.sessionId);

    const clientType = this.resolveClientType(req.headers['x-client-type']);
    if (clientType === 'web' && params.sessionId === auth.sessionId) {
      this.clearWebSessionCookies(res);
    }

    return { message: 'Session revoked successfully' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.AUTH_FORGOT_PASSWORD_THROTTLE_LIMIT, 3),
      ttl: () => parsePositiveInt(process.env.AUTH_FORGOT_PASSWORD_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Request password reset instructions',
    description:
      'Shared endpoint for both web and mobile clients. Normalizes the email, issues a single-use SHA-256 hashed reset token for active accounts (verified or unverified), invalidates previous unused reset tokens, and dispatches a password reset email without revealing account existence or status.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Uniform acknowledgment returned regardless of account existence or status',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid email format or unexpected payload fields',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for password reset requests',
  })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) forgotPasswordDto: ForgotPasswordDto,
  ): Promise<MessageResponseDto> {
    return this.passwordResetService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.AUTH_RESET_PASSWORD_THROTTLE_LIMIT, 5),
      ttl: () => parsePositiveInt(process.env.AUTH_RESET_PASSWORD_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Complete password reset with single-use token',
    description:
      'Shared endpoint for both web and mobile clients. Validates password strength and reset token hash, atomically consumes the token, updates Argon2id password hash, invalidates outstanding reset tokens, revokes all active sessions across devices, and sends a post-commit confirmation email.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password reset completed; user must sign in again across devices',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid/expired/used reset token or weak password',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for password reset completion requests',
  })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) resetPasswordDto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    return this.passwordResetService.resetPassword(resetPasswordDto, req.ip);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({
    default: {
      limit: () => parsePositiveInt(process.env.AUTH_CHANGE_PASSWORD_THROTTLE_LIMIT, 5),
      ttl: () => parsePositiveInt(process.env.AUTH_CHANGE_PASSWORD_THROTTLE_TTL_MS, 60000),
    },
  })
  @ApiOperation({
    summary: 'Change password for the currently authenticated user',
    description:
      'Requires valid JWT authentication. Verifies current password, validates new password policy, rejects reuse of the current password, updates the Argon2id hash, atomically revokes all user sessions across devices, clears web cookies if applicable, and dispatches a confirmation email.',
  })
  @ApiHeader({
    name: 'X-Client-Type',
    required: false,
    description: 'Delivery transport ("web" or "mobile", defaults to "web").',
    schema: { type: 'string', enum: ['web', 'mobile'], default: 'web' },
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password changed successfully; all sessions revoked across devices',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Validation failed, current password is incorrect, or new password matches current password',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing, invalid, expired, or revoked Bearer access token',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded for password change requests',
  })
  async changePassword(
    @CurrentAuth() auth: AuthenticatedAuthContext,
    @Body(new ZodValidationPipe(changePasswordSchema)) changePasswordDto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const response = await this.authService.changePassword({
      userId: auth.userId,
      input: changePasswordDto,
      ipAddress: req.ip,
    });

    const clientType = this.resolveClientType(req.headers['x-client-type']);
    if (clientType === 'web') {
      this.clearWebSessionCookies(res);
    }

    return response;
  }

  private setWebSessionCookies(res: Response, rawRefreshToken: string, expiresAt: Date): void {
    const refreshCookie = this.sessionService.getRefreshCookieConfig(expiresAt);
    const csrfCookie = this.sessionService.getCsrfCookieConfig(expiresAt);
    const csrfToken = this.sessionService.generateCsrfToken();

    res.cookie(refreshCookie.name, rawRefreshToken, refreshCookie.options);
    res.cookie(csrfCookie.name, csrfToken, csrfCookie.options);
  }

  private clearWebSessionCookies(res: Response): void {
    const refreshClear = this.sessionService.getRefreshClearCookieConfig();
    const csrfClear = this.sessionService.getCsrfClearCookieConfig();

    res.clearCookie(refreshClear.name, refreshClear.options);
    res.clearCookie(csrfClear.name, csrfClear.options);
  }

  private resolveClientType(headerValue: string | string[] | undefined): AuthClientType {
    if (headerValue === undefined) {
      return 'web';
    }

    if (Array.isArray(headerValue)) {
      throw new BadRequestException('Invalid X-Client-Type header; expected "web" or "mobile"');
    }

    const normalized = headerValue.trim().toLowerCase();
    if (!normalized || normalized === 'web') {
      return 'web';
    }
    if (normalized === 'mobile') {
      return 'mobile';
    }

    throw new BadRequestException('Invalid X-Client-Type header; expected "web" or "mobile"');
  }
}
