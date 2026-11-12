import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  registerUserSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from '@halal-dine/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { parsePositiveInt } from '../../common/utils/env.util';
import { AuthService } from './auth.service';
import { MessageResponseDto } from './dto/message-response.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailVerificationService } from './services/email-verification.service';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
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
}
