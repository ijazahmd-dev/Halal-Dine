import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { renderVerificationEmailTemplate } from './email-templates';

export type EmailProviderType = 'smtp' | 'console' | 'disabled';

export interface SendVerificationEmailParams {
  userId: string;
  to: string;
  name: string;
  rawToken: string;
  expiryHours: number;
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

    try {
      const transporter = this.getOrCreateTransporter();
      const verificationUrl = this.buildVerificationUrl(params.rawToken);
      const template = renderVerificationEmailTemplate({
        name: params.name,
        verificationUrl,
        expiryHours: params.expiryHours,
      });
      const from = this.configService.get<string>(
        'EMAIL_FROM',
        'Halal Dine <noreply@halaldine.in>',
      );

      await transporter.sendMail({
        from,
        to: params.to,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });

      this.logger.log(`Verification email dispatched via SMTP for user [${params.userId}]`);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Failed to dispatch verification email for user [${params.userId}] (${errorName})`,
      );
      throw new EmailDeliveryError('Failed to deliver verification email');
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

  private buildVerificationUrl(rawToken: string): string {
    const baseUrl = this.configService.get<string>(
      'EMAIL_VERIFICATION_URL_BASE',
      'http://localhost:3000/verify-email',
    );
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
