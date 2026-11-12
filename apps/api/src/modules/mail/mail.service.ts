import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  RenderedEmailTemplate,
  renderPasswordChangedEmailTemplate,
  renderPasswordResetEmailTemplate,
  renderVerificationEmailTemplate,
} from './email-templates';

export type EmailProviderType = 'smtp' | 'console' | 'disabled';

export interface SendVerificationEmailParams {
  userId: string;
  to: string;
  name: string;
  rawToken: string;
  expiryHours: number;
}

export interface SendPasswordResetEmailParams {
  userId: string;
  to: string;
  name: string;
  rawToken: string;
  expiryMinutes: number;
}

export interface SendPasswordChangedEmailParams {
  userId: string;
  to: string;
  name: string;
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.getProvider() !== 'smtp') {
      return;
    }

    try {
      const transporter = this.createSmtpTransporter();
      await transporter.verify();
      this.transporter = transporter;
      this.logger.log('Pooled SMTP transporter initialized and verified successfully');
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`SMTP transporter startup verification failed (${errorName})`);
      throw new EmailDeliveryError('SMTP transporter initialization failed');
    }
  }

  onModuleDestroy(): void {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
  }

  /**
   * Dispatches an account email-verification message using the configured provider.
   * Never logs raw verification tokens, verification URLs, email content, or SMTP credentials.
   */
  async sendVerificationEmail(params: SendVerificationEmailParams): Promise<void> {
    const provider = this.getProvider();

    if (provider === 'disabled') {
      this.logger.debug(
        `Email dispatch disabled; skipped verification email for user [${params.userId}]`,
      );
      return;
    }

    if (provider === 'console') {
      // Security: Never build verification URLs or log raw tokens in console mode.
      this.logger.log(
        `[MailService:console] Verification email prepared for user [${params.userId}] (expires in ${params.expiryHours}h; token omitted from logs)`,
      );
      return;
    }

    const verificationUrl = this.buildTokenUrl(
      'EMAIL_VERIFICATION_URL_BASE',
      'http://localhost:3000/verify-email',
      params.rawToken,
    );
    const template = renderVerificationEmailTemplate({
      name: params.name,
      verificationUrl,
      expiryHours: params.expiryHours,
    });

    await this.deliverSmtpTemplate({
      userId: params.userId,
      to: params.to,
      template,
      successLog: `Verification email dispatched via SMTP for user [${params.userId}]`,
      errorLogContext: 'verification email',
      failureMessage: 'Failed to deliver verification email',
    });
  }

  /**
   * Dispatches a password-reset email containing a single-use reset link.
   * Never logs raw reset tokens, reset URLs, email addresses, or SMTP credentials.
   */
  async sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<void> {
    const provider = this.getProvider();

    if (provider === 'disabled') {
      this.logger.debug(
        `Email dispatch disabled; skipped password reset email for user [${params.userId}]`,
      );
      return;
    }

    if (provider === 'console') {
      // Security: Never build reset URLs or log raw tokens in console mode.
      this.logger.log(
        `[MailService:console] Password reset email prepared for user [${params.userId}] (expires in ${params.expiryMinutes}m; token omitted from logs)`,
      );
      return;
    }

    const resetUrl = this.buildTokenUrl(
      'PASSWORD_RESET_URL_BASE',
      'http://localhost:3000/reset-password',
      params.rawToken,
    );
    const template = renderPasswordResetEmailTemplate({
      name: params.name,
      resetUrl,
      expiryMinutes: params.expiryMinutes,
    });

    await this.deliverSmtpTemplate({
      userId: params.userId,
      to: params.to,
      template,
      successLog: `Password reset email dispatched via SMTP for user [${params.userId}]`,
      errorLogContext: 'password reset email',
      failureMessage: 'Failed to deliver password reset email',
    });
  }

  /**
   * Dispatches a confirmation notification after a user password change or reset succeeds.
   */
  async sendPasswordChangedEmail(params: SendPasswordChangedEmailParams): Promise<void> {
    const provider = this.getProvider();

    if (provider === 'disabled') {
      this.logger.debug(
        `Email dispatch disabled; skipped password changed notification for user [${params.userId}]`,
      );
      return;
    }

    if (provider === 'console') {
      this.logger.log(
        `[MailService:console] Password changed notification prepared for user [${params.userId}]`,
      );
      return;
    }

    const template = renderPasswordChangedEmailTemplate({ name: params.name });

    await this.deliverSmtpTemplate({
      userId: params.userId,
      to: params.to,
      template,
      successLog: `Password changed notification dispatched via SMTP for user [${params.userId}]`,
      errorLogContext: 'password changed notification',
      failureMessage: 'Failed to deliver password changed notification',
    });
  }

  private async deliverSmtpTemplate(params: {
    userId: string;
    to: string;
    template: RenderedEmailTemplate;
    successLog: string;
    errorLogContext: string;
    failureMessage: string;
  }): Promise<void> {
    try {
      const transporter = this.getOrCreateTransporter();
      const from = this.configService.get<string>(
        'EMAIL_FROM',
        'Halal Dine <noreply@halaldine.in>',
      );

      await transporter.sendMail({
        from,
        to: params.to,
        subject: params.template.subject,
        text: params.template.text,
        html: params.template.html,
      });

      this.logger.log(params.successLog);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Failed to dispatch ${params.errorLogContext} for user [${params.userId}] (${errorName})`,
      );
      throw new EmailDeliveryError(params.failureMessage);
    }
  }

  private getProvider(): EmailProviderType {
    const raw = (this.configService.get<string>('EMAIL_PROVIDER', 'console') || 'console')
      .trim()
      .toLowerCase();

    if (raw === 'smtp' || raw === 'console' || raw === 'disabled') {
      return raw;
    }

    this.logger.warn(`Unknown EMAIL_PROVIDER "${raw}"; defaulting to console`);
    return 'console';
  }

  private getOrCreateTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = this.createSmtpTransporter();
    }
    return this.transporter;
  }

  private buildTokenUrl(envKey: string, defaultBaseUrl: string, rawToken: string): string {
    const baseUrl = this.configService.get<string>(envKey, defaultBaseUrl);
    const url = new URL(baseUrl);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }

  private createSmtpTransporter(): Transporter {
    const host = this.configService.get<string>('SMTP_HOST')?.trim();
    if (!host) {
      throw new EmailDeliveryError('SMTP_HOST is required when EMAIL_PROVIDER is set to smtp');
    }

    const rawPort = this.configService.get<string>('SMTP_PORT', '587');
    const port = Number(rawPort);
    const secureRaw = this.configService.get<string>('SMTP_SECURE', 'false');
    const secure = String(secureRaw).trim().toLowerCase() === 'true';

    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASS');

    return nodemailer.createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
  }
}
