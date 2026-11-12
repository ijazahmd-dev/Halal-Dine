import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { UserRole, UserStatus } from '@halal-dine/contracts';
import { RegisterUserInput } from '@halal-dine/validation';
import { PrismaService } from '../../database/prisma.service';
import { UserResponseDto } from './dto/user-response.dto';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordService } from './services/password.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly emailVerificationService: EmailVerificationService,
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
