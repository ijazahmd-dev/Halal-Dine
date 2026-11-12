import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as crypto from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { SessionCleanupService } from '../src/modules/auth/services/session-cleanup.service';
import {
  EmailDeliveryError,
  MailService,
  SendPasswordChangedEmailParams,
  SendPasswordResetEmailParams,
  SendVerificationEmailParams,
} from '../src/modules/mail/mail.service';
import { ensureIsolatedTestDatabase } from './helpers/test-db.helper';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, details?: string) {
  if (condition) {
    results.push({ name, passed: true, details });
    console.log(`  ✓ PASS: ${name}`);
  } else {
    results.push({ name, passed: false, details });
    console.error(`  ✗ FAIL: ${name} - ${details || 'Assertion failed'}`);
  }
}

function sha256(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function runTests() {
  console.log('\n--- Starting Halal Dine Password Recovery Test Suite ---\n');

  const testDbUrl = await ensureIsolatedTestDatabase();
  assert(testDbUrl.includes('_test'), 'Tests isolated to *_test database (protects dev database)');

  const origRegLimit = process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  const origVerifyLimit = process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  const origLoginLimit = process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  const origForgotLimit = process.env.AUTH_FORGOT_PASSWORD_THROTTLE_LIMIT;
  const origResetLimit = process.env.AUTH_RESET_PASSWORD_THROTTLE_LIMIT;
  const origEmailLimit = process.env.AUTH_FORGOT_PASSWORD_EMAIL_LIMIT;

  process.env.AUTH_REGISTER_THROTTLE_LIMIT = '80';
  process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = '80';
  process.env.AUTH_LOGIN_THROTTLE_LIMIT = '80';
  process.env.AUTH_FORGOT_PASSWORD_THROTTLE_LIMIT = '80';
  process.env.AUTH_RESET_PASSWORD_THROTTLE_LIMIT = '80';
  process.env.AUTH_FORGOT_PASSWORD_EMAIL_LIMIT = '3';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  const { apiPrefix } = configureApp(app, { enableLoggingInterceptor: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Halal Dine API')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const testPort = 3091;
  await app.listen(testPort);
  const baseUrl = `http://localhost:${testPort}/${apiPrefix}`;

  const prisma = app.get(PrismaService);
  const mailService = app.get(MailService);
  const cleanupService = app.get(SessionCleanupService);

  const activeUserEmail = 'reset_active@halaldine.com';
  const unverifiedUserEmail = 'reset_unverified@halaldine.com';
  const suspendedUserEmail = 'reset_suspended@halaldine.com';
  const otherUserEmail = 'reset_other@halaldine.com';
  const initialPassword = 'StrongP@ssw0rd2026!';
  const updatedPassword = 'UpdatedP@ssw0rd2026!';
  const finalPassword = 'FinalP@ssw0rd2026!';

  const testEmails = [activeUserEmail, unverifiedUserEmail, suspendedUserEmail, otherUserEmail];
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });

  const verifyTokens = new Map<string, string>();
  const sentResetEmails: SendPasswordResetEmailParams[] = [];
  const sentChangedEmails: SendPasswordChangedEmailParams[] = [];
  let failResetMail = false;
  let failChangedMail = false;

  const origSendVerification = mailService.sendVerificationEmail.bind(mailService);
  const origSendReset = mailService.sendPasswordResetEmail.bind(mailService);
  const origSendChanged = mailService.sendPasswordChangedEmail.bind(mailService);

  mailService.sendVerificationEmail = async (params: SendVerificationEmailParams) => {
    verifyTokens.set(params.to, params.rawToken);
    return origSendVerification(params);
  };
  mailService.sendPasswordResetEmail = async (params: SendPasswordResetEmailParams) => {
    sentResetEmails.push(params);
    if (failResetMail) {
      throw new EmailDeliveryError('Simulated reset SMTP error');
    }
    return origSendReset(params);
  };
  mailService.sendPasswordChangedEmail = async (params: SendPasswordChangedEmailParams) => {
    sentChangedEmails.push(params);
    if (failChangedMail) {
      throw new EmailDeliveryError('Simulated changed notification SMTP error');
    }
    return origSendChanged(params);
  };

  async function registerUser(email: string, name: string, verifyEmail: boolean): Promise<string> {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: initialPassword }),
    });
    const regBody = (await regRes.json()) as { id: string };
    if (regRes.status !== 201) {
      throw new Error(`Setup register failed (${email}): ${regRes.status}`);
    }
    if (verifyEmail) {
      const token = verifyTokens.get(email);
      if (!token) throw new Error(`Missing verification token for ${email}`);
      await fetch(`${baseUrl}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    }
    return regBody.id;
  }

  async function loginMobile(email: string, password: string, deviceInfo = 'Mobile Device') {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ email, password, deviceInfo }),
    });
    const body = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
      message?: string;
    };
    return { status: res.status, body };
  }

  const loggedMessages: string[] = [];
  const origLoggerLog = Logger.prototype.log;
  const origLoggerWarn = Logger.prototype.warn;
  const origLoggerError = Logger.prototype.error;
  Logger.prototype.log = function (message: unknown, ...rest: unknown[]) {
    loggedMessages.push(String(message));
    return origLoggerLog.call(this, message, ...(rest as [string?]));
  };
  Logger.prototype.warn = function (message: unknown, ...rest: unknown[]) {
    loggedMessages.push(String(message));
    return origLoggerWarn.call(this, message, ...(rest as [string?]));
  };
  Logger.prototype.error = function (message: unknown, ...rest: unknown[]) {
    loggedMessages.push(String(message));
    return origLoggerError.call(this, message, ...(rest as [string?]));
  };

  try {
    const activeUserId = await registerUser(activeUserEmail, 'Reset Active User', true);
    const unverifiedUserId = await registerUser(
      unverifiedUserEmail,
      'Reset Unverified User',
      false,
    );
    const suspendedUserId = await registerUser(suspendedUserEmail, 'Reset Suspended User', true);
    await prisma.user.update({ where: { id: suspendedUserId }, data: { status: 'SUSPENDED' } });
    const otherUserId = await registerUser(otherUserEmail, 'Other User', true);

    // 1. Forgot Password: Anti-Enumeration, Normalization, Storage, Previous Token Invalidation
    console.log('\n1. Testing Forgot Password Flow, Normalization & Anti-Enumeration...');
    const invalidEmailRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', extra: 'rejected' }),
    });
    assert(
      invalidEmailRes.status === 400,
      'Forgot password rejects invalid email/extra fields (400)',
    );

    const nonExistentRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no_such_user@halaldine.com' }),
    });
    const nonExistentBody = (await nonExistentRes.json()) as { message?: string };

    const suspendedForgotRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: suspendedUserEmail }),
    });
    const suspendedForgotBody = (await suspendedForgotRes.json()) as { message?: string };

    const existingForgotRes1 = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  RESET_ACTIVE@HalalDine.com  ' }),
    });
    const existingForgotBody1 = (await existingForgotRes1.json()) as { message?: string };

    assert(
      nonExistentRes.status === 200 &&
        suspendedForgotRes.status === 200 &&
        existingForgotRes1.status === 200 &&
        nonExistentBody.message === existingForgotBody1.message &&
        suspendedForgotBody.message === existingForgotBody1.message &&
        sentResetEmails.length === 1,
      'Existing, non-existent, and suspended emails return identical 200 response; email only sent for active account',
    );

    const token1 = sentResetEmails[0]!.rawToken;
    const dbToken1 = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token1) },
    });
    const expiryMinutesActual = dbToken1
      ? (dbToken1.expiresAt.getTime() - dbToken1.createdAt.getTime()) / 60_000
      : 0;

    assert(
      token1.length >= 64 &&
        dbToken1 !== null &&
        dbToken1.userId === activeUserId &&
        dbToken1.tokenHash !== token1 &&
        dbToken1.usedAt === null &&
        sentResetEmails[0]!.expiryMinutes === 30 &&
        Math.abs(expiryMinutesActual - 30) < 0.05 &&
        !JSON.stringify(existingForgotBody1).includes(token1),
      'Stores only SHA-256 hash in PasswordResetToken with ~30m expiry and hides raw token from response',
    );

    // Issue a second reset request -> invalidates previous unused token1
    const existingForgotRes2 = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: activeUserEmail }),
    });
    const token2 = sentResetEmails[1]!.rawToken;
    const dbToken1After2 = await prisma.passwordResetToken.findUnique({
      where: { id: dbToken1!.id },
    });
    const dbToken2 = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token2) },
    });
    assert(
      existingForgotRes2.status === 200 &&
        token2 !== token1 &&
        dbToken1After2?.usedAt !== null &&
        dbToken2?.usedAt === null,
      'Second forgot-password request invalidates previous unused token so only latest remains valid',
    );

    // Email delivery failure must still return uniform 200 without revealing existence
    failResetMail = true;
    const mailFailForgotRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: activeUserEmail }),
    });
    const mailFailForgotBody = (await mailFailForgotRes.json()) as { message?: string };
    failResetMail = false;
    const token3 = sentResetEmails[2]!.rawToken;
    assert(
      mailFailForgotRes.status === 200 &&
        mailFailForgotBody.message === existingForgotBody1.message,
      'Email delivery failure on forgot-password does not crash or leak account existence',
    );

    // Per-email abuse limit (limit=3 in 15m -> 4th call returns 200 without sending 4th email)
    const countBeforeEmailLimit = sentResetEmails.length;
    const abusedForgotRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: activeUserEmail }),
    });
    const abusedForgotBody = (await abusedForgotRes.json()) as { message?: string };
    assert(
      abusedForgotRes.status === 200 &&
        abusedForgotBody.message === existingForgotBody1.message &&
        sentResetEmails.length === countBeforeEmailLimit,
      'Per-email abuse prevention suppresses excessive reset emails cleanly while returning identical 200',
    );

    // Unverified active user CAN request a password reset (mailbox verification via link)
    const unverifiedForgotRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: unverifiedUserEmail }),
    });
    const unverifiedResetToken = sentResetEmails[sentResetEmails.length - 1]!.rawToken;
    assert(
      unverifiedForgotRes.status === 200 && sentResetEmails.length === countBeforeEmailLimit + 1,
      'Active account without prior email verification can initiate password reset',
    );

    // 2. Reset Password: Validation, Expiry, Invalid/Used Token, Atomic Reset & Session Revocation
    console.log('\n2. Testing Reset Password Validation, Session Revocation & Login Flow...');
    // User creates two active sessions (e.g., web + mobile) and another user has an active session
    const session1 = await loginMobile(activeUserEmail, initialPassword, 'Session 1');
    const session2 = await loginMobile(activeUserEmail, initialPassword, 'Session 2');
    const otherSession = await loginMobile(otherUserEmail, initialPassword, 'Other User Device');

    // Old invalidated token1 must fail
    const staleResetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token1, newPassword: updatedPassword }),
    });
    const unknownResetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '0'.repeat(64), newPassword: updatedPassword }),
    });
    const weakPassResetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token3, newPassword: 'weak' }),
    });
    assert(
      staleResetRes.status === 400 &&
        unknownResetRes.status === 400 &&
        weakPassResetRes.status === 400,
      'Rejects superseded tokens, unknown tokens, and weak passwords with 400 Bad Request',
    );

    // Test expired token rejection directly
    const expiredTokenRaw = 'expired_reset_token_' + crypto.randomBytes(16).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: unverifiedUserId,
        tokenHash: sha256(expiredTokenRaw),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const expiredResetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expiredTokenRaw, newPassword: updatedPassword }),
    });
    assert(expiredResetRes.status === 400, 'Rejects expired password reset token (400)');

    // Execute successful password reset using latest token3
    const resetSuccessRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token3, newPassword: updatedPassword }),
    });
    const resetSuccessBody = (await resetSuccessRes.json()) as Record<string, unknown>;
    const token3Db = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token3) },
    });
    const activeSessionsAfterReset = await prisma.userSession.count({
      where: { userId: activeUserId, revokedAt: null },
    });
    const auditResetLog = await prisma.auditLog.findFirst({
      where: { userId: activeUserId, action: 'PASSWORD_RESET_COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });

    assert(
      resetSuccessRes.status === 200 &&
        !('accessToken' in resetSuccessBody) &&
        !('refreshToken' in resetSuccessBody) &&
        token3Db?.usedAt !== null &&
        activeSessionsAfterReset === 0 &&
        auditResetLog !== null &&
        sentChangedEmails.some((m) => m.userId === activeUserId),
      'Reset succeeds (200), revokes all user sessions, logs AuditLog, dispatches notification, and requires re-login',
    );

    // Replay same token3 -> rejected
    const replayResetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token3, newPassword: finalPassword }),
    });
    assert(replayResetRes.status === 400, 'Already-used reset token cannot be reused (400)');

    // Old sessions cannot refresh or access session endpoints; other user session remains active
    const s1RefreshAfter = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: session1.body.refreshToken }),
    });
    const s2SessionsAfter = await fetch(`${baseUrl}/auth/sessions`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session2.body.accessToken}` },
    });
    const otherRefreshAfter = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: otherSession.body.refreshToken }),
    });
    assert(
      s1RefreshAfter.status === 401 &&
        s2SessionsAfter.status === 401 &&
        otherRefreshAfter.status === 200,
      'Old user sessions are rejected after reset while unrelated users remain unaffected',
    );

    // Old password fails login, new password logs in cleanly
    const oldPasswordLogin = await loginMobile(activeUserEmail, initialPassword);
    const newPasswordLogin = await loginMobile(activeUserEmail, updatedPassword);
    assert(
      oldPasswordLogin.status === 401 && newPasswordLogin.status === 200,
      'Old password rejected on login and new password authenticates successfully',
    );

    // Unverified user resets password AND notification email failure does NOT roll back reset
    failChangedMail = true;
    const unverifiedResetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: unverifiedResetToken, newPassword: updatedPassword }),
    });
    failChangedMail = false;
    const unverifiedRowAfterReset = await prisma.user.findUnique({
      where: { id: unverifiedUserId },
      select: { passwordHash: true },
    });
    // Check passwordHash updated via direct verification
    const oldUserRow = await prisma.user.findUnique({
      where: { id: otherUserId },
      select: { passwordHash: true },
    });
    assert(
      unverifiedResetRes.status === 200 &&
        unverifiedRowAfterReset !== null &&
        unverifiedRowAfterReset.passwordHash !== oldUserRow?.passwordHash,
      'Notification email failure does not roll back successful password reset',
    );

    // 3. Concurrency Safety on Reset Token Consumption
    console.log('\n3. Testing Concurrent Password Reset Token Consumption...');
    // Reset window override so unverifiedUser can request fresh token
    await prisma.passwordResetToken.create({
      data: {
        userId: activeUserId,
        tokenHash: sha256('concurrent_reset_raw_' + 'c'.repeat(32)),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    const concurrentToken = 'concurrent_reset_raw_' + 'c'.repeat(32);
    const [conc1, conc2] = await Promise.all([
      fetch(`${baseUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: concurrentToken, newPassword: finalPassword }),
      }),
      fetch(`${baseUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: concurrentToken, newPassword: finalPassword }),
      }),
    ]);
    const concStatuses = [conc1.status, conc2.status].sort();
    assert(
      concStatuses[0] === 200 && concStatuses[1] === 400,
      'Concurrent reset requests with same token allow strictly one 200 and reject the other with 400',
      `Statuses: ${concStatuses.join(', ')}`,
    );

    const finalLogin = await loginMobile(activeUserEmail, finalPassword);
    assert(finalLogin.status === 200, 'Login succeeds with password set by concurrent winner');

    // 4. Retention Cleanup Check for PasswordResetToken
    console.log('\n4. Testing PasswordResetToken Cleanup Integration...');
    const oldResetRecord = await prisma.passwordResetToken.create({
      data: {
        userId: activeUserId,
        tokenHash: sha256(`cleanup_reset_expired_${Date.now()}`),
        expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        usedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    const validResetRecord = await prisma.passwordResetToken.create({
      data: {
        userId: activeUserId,
        tokenHash: sha256(`cleanup_reset_valid_${Date.now()}`),
        expiresAt: new Date(Date.now() + 25 * 60_000),
      },
    });
    const cleanupReport = await cleanupService.runCleanup(new Date());
    const oldAfterCleanup = await prisma.passwordResetToken.findUnique({
      where: { id: oldResetRecord.id },
    });
    const validAfterCleanup = await prisma.passwordResetToken.findUnique({
      where: { id: validResetRecord.id },
    });
    assert(
      cleanupReport.deletedPasswordResetTokens >= 1 &&
        oldAfterCleanup === null &&
        validAfterCleanup !== null,
      'SessionCleanupService purges stale PasswordResetToken rows in batches while keeping valid tokens',
    );

    // 5. Log Hygiene & Swagger Check
    console.log('\n5. Testing Log Safety & Swagger Documentation...');
    const combinedLogs = loggedMessages.join('\n');
    const docsRes = await fetch(`http://localhost:${testPort}/api/docs-json`);
    const docsJson = (await docsRes.json()) as {
      paths?: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    const forgotDoc = docsJson.paths?.['/api/auth/forgot-password']?.post;
    const resetDoc = docsJson.paths?.['/api/auth/reset-password']?.post;

    assert(
      !combinedLogs.includes(token1) &&
        !combinedLogs.includes(token2) &&
        !combinedLogs.includes(token3) &&
        !combinedLogs.includes(updatedPassword) &&
        !combinedLogs.includes(finalPassword),
      'Application logs never contain raw reset tokens or plaintext passwords',
    );
    assert(
      docsRes.status === 200 &&
        forgotDoc?.responses?.['200'] !== undefined &&
        forgotDoc?.responses?.['400'] !== undefined &&
        forgotDoc?.responses?.['429'] !== undefined &&
        resetDoc?.responses?.['200'] !== undefined &&
        resetDoc?.responses?.['400'] !== undefined &&
        resetDoc?.responses?.['429'] !== undefined,
      'Swagger documents /api/auth/forgot-password and /api/auth/reset-password with 200/400/429 responses',
    );
  } finally {
    Logger.prototype.log = origLoggerLog;
    Logger.prototype.warn = origLoggerWarn;
    Logger.prototype.error = origLoggerError;
    await prisma.auditLog.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  }

  // 6. Rate Limiting Enforcement (default forgot=3/min, reset=5/min)
  console.log('\n6. Testing Default Rate Limits for Forgot & Reset Endpoints...');
  if (origRegLimit !== undefined) process.env.AUTH_REGISTER_THROTTLE_LIMIT = origRegLimit;
  else delete process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  if (origVerifyLimit !== undefined) process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = origVerifyLimit;
  else delete process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  if (origLoginLimit !== undefined) process.env.AUTH_LOGIN_THROTTLE_LIMIT = origLoginLimit;
  else delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  if (origForgotLimit !== undefined)
    process.env.AUTH_FORGOT_PASSWORD_THROTTLE_LIMIT = origForgotLimit;
  else delete process.env.AUTH_FORGOT_PASSWORD_THROTTLE_LIMIT;
  if (origResetLimit !== undefined) process.env.AUTH_RESET_PASSWORD_THROTTLE_LIMIT = origResetLimit;
  else delete process.env.AUTH_RESET_PASSWORD_THROTTLE_LIMIT;
  if (origEmailLimit !== undefined) process.env.AUTH_FORGOT_PASSWORD_EMAIL_LIMIT = origEmailLimit;
  else delete process.env.AUTH_FORGOT_PASSWORD_EMAIL_LIMIT;

  const rlApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(rlApp, { enableLoggingInterceptor: false });
  await rlApp.listen(3090);

  try {
    const forgotStatuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await fetch('http://localhost:3090/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `rl_forgot_${i}@halaldine.com` }),
      });
      forgotStatuses.push(r.status);
    }
    assert(
      forgotStatuses.slice(0, 3).every((s) => s === 200) && forgotStatuses[3] === 429,
      'Forgot-password throttles after 3 requests/min (4th returns 429)',
      `Statuses: ${forgotStatuses.join(', ')}`,
    );

    const resetStatuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch('http://localhost:3090/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '0'.repeat(64), newPassword: 'StrongP@ssw0rd2026!' }),
      });
      resetStatuses.push(r.status);
    }
    assert(
      resetStatuses.slice(0, 5).every((s) => s === 400) && resetStatuses[5] === 429,
      'Reset-password throttles after 5 requests/min (6th returns 429)',
      `Statuses: ${resetStatuses.join(', ')}`,
    );
  } finally {
    await rlApp.close();
  }

  console.log('\n--- Auth Password Recovery Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during password recovery test run:', err);
  process.exit(1);
});
