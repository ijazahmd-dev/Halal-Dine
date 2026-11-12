import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { parsePositiveInt } from '../../../common/utils/env.util';
import { PrismaService } from '../../../database/prisma.service';

export interface CleanupExecutionReport {
  deletedRotatedTokens: number;
  deletedSessions: number;
  deletedEmailTokens: number;
  deletedPasswordResetTokens: number;
}

const SESSION_CLEANUP_JOB_NAME = 'auth-session-retention-cleanup';
const MAX_BATCHES_PER_RUN = 20;

@Injectable()
export class SessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const cronExpression = this.configService.get<string>('SESSION_CLEANUP_CRON', '0 */6 * * *');
    if (this.schedulerRegistry.doesExist('cron', SESSION_CLEANUP_JOB_NAME)) {
      this.schedulerRegistry.deleteCronJob(SESSION_CLEANUP_JOB_NAME);
    }

    const job = new CronJob(cronExpression, () => {
      void this.runCleanup();
    });
    this.schedulerRegistry.addCronJob(SESSION_CLEANUP_JOB_NAME, job);
    job.start();
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('cron', SESSION_CLEANUP_JOB_NAME)) {
      const job = this.schedulerRegistry.getCronJob(SESSION_CLEANUP_JOB_NAME);
      job.stop();
      this.schedulerRegistry.deleteCronJob(SESSION_CLEANUP_JOB_NAME);
    }
  }

  /**
   * Executes batched retention-safe cleanup:
   * 1. Deletes RotatedRefreshToken records only after their detection-retention expiry passes.
   * 2. Deletes expired/revoked UserSession records only after session retention passes AND
   *    no child RotatedRefreshToken still remains within its detection-retention window.
   * 3. Deletes expired/used EmailVerificationToken and PasswordResetToken records past retention.
   */
  async runCleanup(referenceNow: Date = new Date()): Promise<CleanupExecutionReport> {
    if (this.isRunning) {
      return {
        deletedRotatedTokens: 0,
        deletedSessions: 0,
        deletedEmailTokens: 0,
        deletedPasswordResetTokens: 0,
      };
    }

    this.isRunning = true;
    const batchSize = parsePositiveInt(
      String(this.configService.get('SESSION_CLEANUP_BATCH_SIZE') ?? ''),
      500,
    );
    const sessionRetentionDays = parsePositiveInt(
      String(this.configService.get('SESSION_CLEANUP_RETENTION_DAYS') ?? ''),
      30,
    );
    const emailTokenRetentionDays = parsePositiveInt(
      String(this.configService.get('EMAIL_TOKEN_CLEANUP_RETENTION_DAYS') ?? ''),
      7,
    );
    const passwordResetRetentionDays = parsePositiveInt(
      String(this.configService.get('PASSWORD_RESET_CLEANUP_RETENTION_DAYS') ?? ''),
      7,
    );

    const sessionCutoff = new Date(
      referenceNow.getTime() - sessionRetentionDays * 24 * 60 * 60 * 1000,
    );
    const emailTokenCutoff = new Date(
      referenceNow.getTime() - emailTokenRetentionDays * 24 * 60 * 60 * 1000,
    );
    const passwordResetCutoff = new Date(
      referenceNow.getTime() - passwordResetRetentionDays * 24 * 60 * 60 * 1000,
    );

    try {
      const deletedRotatedTokens = await this.executeBatchDelete(
        (take) =>
          this.prisma.rotatedRefreshToken.findMany({
            where: { expiresAt: { lt: referenceNow } },
            select: { id: true },
            orderBy: { expiresAt: 'asc' },
            take,
          }),
        (ids) =>
          this.prisma.rotatedRefreshToken
            .deleteMany({ where: { id: { in: ids } } })
            .then((r) => r.count),
        batchSize,
      );

      const deletedSessions = await this.executeBatchDelete(
        (take) =>
          this.prisma.userSession.findMany({
            where: {
              OR: [
                { expiresAt: { lt: sessionCutoff } },
                {
                  AND: [{ revokedAt: { not: null } }, { revokedAt: { lt: sessionCutoff } }],
                },
              ],
              // Never cascade-delete a session while any rotated token remains inside detection retention
              rotatedTokens: {
                none: {
                  expiresAt: { gt: referenceNow },
                },
              },
            },
            select: { id: true },
            orderBy: { expiresAt: 'asc' },
            take,
          }),
        (ids) =>
          this.prisma.userSession.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
        batchSize,
      );

      const deletedEmailTokens = await this.executeBatchDelete(
        (take) =>
          this.prisma.emailVerificationToken.findMany({
            where: {
              OR: [
                { expiresAt: { lt: emailTokenCutoff } },
                {
                  AND: [{ usedAt: { not: null } }, { usedAt: { lt: emailTokenCutoff } }],
                },
              ],
            },
            select: { id: true },
            orderBy: { expiresAt: 'asc' },
            take,
          }),
        (ids) =>
          this.prisma.emailVerificationToken
            .deleteMany({ where: { id: { in: ids } } })
            .then((r) => r.count),
        batchSize,
      );

      const deletedPasswordResetTokens = await this.executeBatchDelete(
        (take) =>
          this.prisma.passwordResetToken.findMany({
            where: {
              OR: [
                { expiresAt: { lt: passwordResetCutoff } },
                {
                  AND: [{ usedAt: { not: null } }, { usedAt: { lt: passwordResetCutoff } }],
                },
              ],
            },
            select: { id: true },
            orderBy: { expiresAt: 'asc' },
            take,
          }),
        (ids) =>
          this.prisma.passwordResetToken
            .deleteMany({ where: { id: { in: ids } } })
            .then((r) => r.count),
        batchSize,
      );

      if (
        deletedRotatedTokens > 0 ||
        deletedSessions > 0 ||
        deletedEmailTokens > 0 ||
        deletedPasswordResetTokens > 0
      ) {
        this.logger.log(
          `Cleanup completed: rotatedTokens=${deletedRotatedTokens}, sessions=${deletedSessions}, emailTokens=${deletedEmailTokens}, passwordResetTokens=${deletedPasswordResetTokens}`,
        );
      }

      return {
        deletedRotatedTokens,
        deletedSessions,
        deletedEmailTokens,
        deletedPasswordResetTokens,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Session retention cleanup encountered an error (${reason})`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        deletedRotatedTokens: 0,
        deletedSessions: 0,
        deletedEmailTokens: 0,
        deletedPasswordResetTokens: 0,
      };
    } finally {
      this.isRunning = false;
    }
  }

  private async executeBatchDelete(
    fetchBatchIds: (take: number) => Promise<Array<{ id: string }>>,
    deleteByIds: (ids: string[]) => Promise<number>,
    batchSize: number,
  ): Promise<number> {
    let totalDeleted = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const rows = await fetchBatchIds(batchSize);
      if (rows.length === 0) {
        break;
      }

      totalDeleted += await deleteByIds(rows.map((row) => row.id));

      if (rows.length < batchSize) {
        break;
      }
    }

    return totalDeleted;
  }
}
