import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@halal-dine/contracts';
import { ForgotPasswordInput, ResetPasswordInput } from '@halal-dine/validation';
import { parsePositiveInt } from '../../../common/utils/env.util';
import { PrismaService } from '../../../database/prisma.service';
import { MailService } from '../../mail/mail.service';
import { MessageResponseDto } from '../dto/message-response.dto';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenCryptoService } from './token-crypto.service';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly tokenCryptoService: TokenCryptoService,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Issues a password-reset token for an active account (verified or unverified email),
   * invalidating previous unused tokens, enforcing per-email abuse limits, and returning
   * an identical generic response regardless of account existence or status.
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<MessageResponseDto> {
    const genericResponse: MessageResponseDto = {
      message: 'If an account exists for this email, password reset instructions will be sent.',
    };

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
      },
    });

    // Never reveal whether the email exists or whether the account is suspended/deactivated.
    // Note: Email verification is NOT required here because mailbox possession verifies control.
    if (!user || user.status !== UserStatus.ACTIVE) {
      return genericResponse;
    }

    // Per-email abuse guard protects targeted inboxes even across rotating client IPs
    // without leaking account existence via differentiated responses.
    const emailLimit = parsePositiveInt(
      String(this.configService.get('AUTH_FORGOT_PASSWORD_EMAIL_LIMIT') ?? ''),
      3,
    );
    const windowMinutes = parsePositiveInt(
      String(this.configService.get('AUTH_FORGOT_PASSWORD_EMAIL_WINDOW_MINUTES') ?? ''),
      15,
    );
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

    const recentRequestCount = await this.prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        createdAt: { gt: windowStart },
      },
    });

    if (recentRequestCount >= emailLimit) {
      this.logger.warn(
        `Per-email password reset limit reached for user [${user.id}]; suppressing extra email without leaking existence`,
      );
      return genericResponse;
    }

    const expiryMinutes = this.getResetExpiryMinutes();
    const { rawToken, tokenHash } = this.tokenCryptoService.generateOpaqueToken(32);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

      // Ensure only the newest reset token remains valid
      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
        data: { usedAt: now },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    try {
      await this.mailService.sendPasswordResetEmail({
        userId: user.id,
        to: user.email,
        name: user.name,
        rawToken,
        expiryMinutes,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownDeliveryError';
      this.logger.error(`Password reset email delivery failed for user [${user.id}] (${reason})`);
    }

    return genericResponse;
  }

  /**
   * Validates and atomically consumes a single-use password-reset token, updates the Argon2id
   * password hash, invalidates sibling reset tokens, revokes all active user sessions, logs an
   * audit event, and dispatches a post-commit password-changed notification.
   */
  async resetPassword(input: ResetPasswordInput, ipAddress?: string): Promise<MessageResponseDto> {
    const tokenHash = this.tokenCryptoService.hashToken(input.token);
    const now = new Date();

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
      },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt !== null ||
      tokenRecord.expiresAt <= now ||
      tokenRecord.user.status !== UserStatus.ACTIVE
    ) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const newPasswordHash = await this.passwordService.hash(input.newPassword);
    const sanitizedIp = ipAddress ? ipAddress.trim().slice(0, 45) || null : null;

    await this.prisma.$transaction(async (tx) => {
      const txNow = new Date();

      // Atomic compare-and-set prevents two concurrent requests from consuming the same token
      const consumeResult = await tx.passwordResetToken.updateMany({
        where: {
          id: tokenRecord.id,
          usedAt: null,
          expiresAt: { gt: txNow },
        },
        data: { usedAt: txNow },
      });

      if (consumeResult.count !== 1) {
        throw new BadRequestException('Invalid or expired password reset token');
      }

      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: { passwordHash: newPasswordHash },
      });

      await tx.passwordResetToken.updateMany({
        where: {
          userId: tokenRecord.userId,
          usedAt: null,
        },
        data: { usedAt: txNow },
      });

      await this.sessionService.revokeAllUserSessionsInTransaction(tx, tokenRecord.userId);

      await tx.auditLog.create({
        data: {
          userId: tokenRecord.userId,
          action: 'PASSWORD_RESET_COMPLETED',
          entityName: 'User',
          entityId: tokenRecord.userId,
          ipAddress: sanitizedIp,
          details: {
            resetTokenId: tokenRecord.id,
            completedAt: txNow.toISOString(),
          },
        },
      });
    });

    this.logger.log(`Password reset completed successfully for user [${tokenRecord.userId}]`);

    // Dispatch notification after transaction commits; delivery failure must never undo the reset
    try {
      await this.mailService.sendPasswordChangedEmail({
        userId: tokenRecord.userId,
        to: tokenRecord.user.email,
        name: tokenRecord.user.name,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownDeliveryError';
      this.logger.error(
        `Password changed notification failed for user [${tokenRecord.userId}] (${reason})`,
      );
    }

    return {
      message: 'Password has been reset successfully. Please sign in with your new password.',
    };
  }

  private getResetExpiryMinutes(): number {
    return parsePositiveInt(
      String(this.configService.get('PASSWORD_RESET_TOKEN_EXPIRY_MINUTES') ?? ''),
      30,
    );
  }
}
