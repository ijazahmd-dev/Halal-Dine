import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { UserStatus } from '@halal-dine/contracts';
import { ResendVerificationInput, VerifyEmailInput } from '@halal-dine/validation';
import { parsePositiveInt } from '../../../common/utils/env.util';
import { PrismaService } from '../../../database/prisma.service';
import { MailService } from '../../mail/mail.service';
import { MessageResponseDto } from '../dto/message-response.dto';
import { TokenCryptoService } from './token-crypto.service';

export interface IssuedVerificationToken {
  rawToken: string;
  expiryHours: number;
}

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly tokenCryptoService: TokenCryptoService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Generates a verification token, stores its SHA-256 hash inside the caller's Prisma transaction,
   * and returns the raw token and configured expiration hours for post-commit dispatch.
   */
  async createTokenInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<IssuedVerificationToken> {
    const { rawToken, tokenHash } = this.tokenCryptoService.generateOpaqueToken(32);
    const expiryHours = this.getVerificationExpiryHours();
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    await tx.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return { rawToken, expiryHours };
  }

  /**
   * Dispatches a verification email safely outside database transactions.
   * Delivery errors are logged cleanly without exposing tokens or failing account flows.
   */
  async dispatchVerificationEmail(params: {
    userId: string;
    email: string;
    name: string;
    rawToken: string;
    expiryHours: number;
  }): Promise<void> {
    try {
      await this.mailService.sendVerificationEmail({
        userId: params.userId,
        to: params.email,
        name: params.name,
        rawToken: params.rawToken,
        expiryHours: params.expiryHours,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown delivery error';
      this.logger.error(
        `Verification email delivery failed for user [${params.userId}]: ${reason}`,
      );
    }
  }

  /**
   * Validates, atomically consumes an email verification token, invalidates sibling tokens,
   * and marks the user's email address as verified inside a single database transaction.
   */
  async verifyEmail(input: VerifyEmailInput): Promise<MessageResponseDto> {
    const tokenHash = this.tokenCryptoService.hashToken(input.token);

    const verifiedUserId = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const tokenRecord = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              status: true,
              isEmailVerified: true,
              emailVerifiedAt: true,
            },
          },
        },
      });

      if (!tokenRecord) {
        throw new BadRequestException('Invalid verification token');
      }

      if (tokenRecord.usedAt !== null) {
        throw new BadRequestException('Verification token has already been used');
      }

      if (tokenRecord.expiresAt <= now) {
        throw new BadRequestException('Verification token has expired');
      }

      if (tokenRecord.user.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('Account is not eligible for email verification');
      }

      // Atomic compare-and-set guard prevents concurrent duplicate requests from consuming the same token
      const consumeResult = await tx.emailVerificationToken.updateMany({
        where: {
          id: tokenRecord.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (consumeResult.count !== 1) {
        throw new BadRequestException(
          'Verification token is invalid, expired, or has already been used',
        );
      }

      // Invalidate any other remaining unused tokens belonging to this user
      await tx.emailVerificationToken.updateMany({
        where: {
          userId: tokenRecord.userId,
          usedAt: null,
        },
        data: { usedAt: now },
      });

      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          isEmailVerified: true,
          emailVerifiedAt: tokenRecord.user.emailVerifiedAt ?? now,
        },
      });

      return tokenRecord.userId;
    });

    this.logger.log(`Email verified successfully for user [${verifiedUserId}]`);

    return {
      message: 'Email address verified successfully.',
    };
  }

  /**
   * Invalidates previous unused tokens, issues a fresh verification token, and sends a new link
   * if an active, unverified account matches the normalized email.
   * Always returns an identical generic message to prevent account enumeration.
   */
  async resendVerification(input: ResendVerificationInput): Promise<MessageResponseDto> {
    const genericResponse: MessageResponseDto = {
      message:
        'If an account with that email exists and is not yet verified, a verification link has been sent.',
    };

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        isEmailVerified: true,
      },
    });

    // Avoid revealing whether the email exists, is already verified, or is suspended/deactivated
    if (!user || user.isEmailVerified || user.status !== UserStatus.ACTIVE) {
      return genericResponse;
    }

    const issued = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Invalidate all previous unused tokens for this user
      await tx.emailVerificationToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
        data: { usedAt: now },
      });

      return this.createTokenInTransaction(tx, user.id);
    });

    await this.dispatchVerificationEmail({
      userId: user.id,
      email: user.email,
      name: user.name,
      rawToken: issued.rawToken,
      expiryHours: issued.expiryHours,
    });

    return genericResponse;
  }

  private getVerificationExpiryHours(): number {
    return parsePositiveInt(this.configService.get<string>('EMAIL_VERIFICATION_EXPIRY_HOURS'), 24);
  }
}
