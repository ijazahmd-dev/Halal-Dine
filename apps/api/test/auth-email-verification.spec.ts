import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as crypto from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { EmailVerificationService } from '../src/modules/auth/services/email-verification.service';
import {
  EmailDeliveryError,
  MailService,
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
  console.log('\n--- Starting Halal Dine Email Verification Test Suite ---\n');

  const testDbUrl = await ensureIsolatedTestDatabase();
  assert(testDbUrl.includes('_test'), 'Tests isolated to *_test database (protects dev database)');

  const testDbUrl = await ensureIsolatedTestDatabase();
  assert(
    testDbUrl.includes('_test'),
    'Tests isolated to *_test database (protects dev database)',
  );

  const origVerifyLimit = process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  const origResendLimit = process.env.RESEND_VERIFICATION_THROTTLE_LIMIT;
  const origRegLimit = process.env.AUTH_REGISTER_THROTTLE_LIMIT;

  // Allow enough requests in functional test phase; rate limits are explicitly verified below
  process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = '30';
  process.env.RESEND_VERIFICATION_THROTTLE_LIMIT = '30';
  process.env.AUTH_REGISTER_THROTTLE_LIMIT = '30';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  const { apiPrefix } = configureApp(app, { enableLoggingInterceptor: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Halal Dine API')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const testPort = 3098;
  await app.listen(testPort);
  const baseUrl = `http://localhost:${testPort}/${apiPrefix}`;

  const prisma = app.get(PrismaService);
  const mailService = app.get(MailService);
  const emailVerificationService = app.get(EmailVerificationService);

  const testEmails = [
    'verify_user1@halaldine.com',
    'verify_concurrent@halaldine.com',
    'verify_mailfail@halaldine.com',
    'verify_ratelimit@halaldine.com',
  ];

  // Clean up prior test artifacts
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });

  // Capture emails sent via MailService
  const sentEmails: SendVerificationEmailParams[] = [];
  let shouldFailEmailDelivery = false;

  const originalSend = mailService.sendVerificationEmail.bind(mailService);
  mailService.sendVerificationEmail = async (params: SendVerificationEmailParams) => {
    sentEmails.push(params);
    if (shouldFailEmailDelivery) {
      throw new EmailDeliveryError('Simulated SMTP connection error');
    }
    return originalSend(params);
  };

  try {
    // 1. Registration & Token Creation
    console.log('\n1. Testing Token Generation, Hashing & Email Dispatch on Registration...');
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Verify Test User',
        email: 'verify_user1@halaldine.com',
        password: 'StrongP@ssw0rd2026!',
      }),
    });
    const regData = await regRes.json();
    assert(regRes.status === 201, 'User registration returns 201');
    assert(sentEmails.length === 1, 'Initial verification email dispatched');

    const firstEmail = sentEmails[0]!;
    assert(
      typeof firstEmail.rawToken === 'string' && firstEmail.rawToken.length >= 64,
      'Cryptographically secure raw token generated (>= 64 hex chars)',
    );
    assert(firstEmail.expiryHours === 24, 'Default expiry is 24 hours');

    const tokenRow1 = await prisma.emailVerificationToken.findFirst({
      where: { userId: regData.id },
    });
    assert(tokenRow1 !== null, 'EmailVerificationToken persisted in DB');
    assert(
      tokenRow1?.tokenHash === sha256(firstEmail.rawToken),
      'DB stores SHA-256 hash of raw token (not plaintext)',
    );
    assert(tokenRow1?.usedAt === null, 'New token has usedAt = null');

    // 2. Invalid Token & Unknown Field Rejection
    console.log('\n2. Testing Invalid Token & Unknown Field Rejection...');
    const invalidRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '0'.repeat(64) }),
    });
    assert(invalidRes.status === 400, 'Invalid unknown token rejected with 400');

    const emptyRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '   ' }),
    });
    assert(emptyRes.status === 400, 'Blank token rejected with 400');

    const strictVerifyRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '0'.repeat(64), role: 'ADMIN' }),
    });
    assert(strictVerifyRes.status === 400, 'Unknown field on verify-email rejected with 400');

    const strictResendRes = await fetch(`${baseUrl}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'verify_user1@halaldine.com', isAdmin: true }),
    });
    assert(
      strictResendRes.status === 400,
      'Unknown field on resend-verification rejected with 400',
    );

    // 3. Expired Token Rejection
    console.log('\n3. Testing Expired Token Rejection...');
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    await prisma.emailVerificationToken.create({
      data: {
        userId: regData.id,
        tokenHash: sha256(expiredRawToken),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const expiredRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expiredRawToken }),
    });
    const expiredBody = await expiredRes.json();
    assert(expiredRes.status === 400, 'Expired token rejected with 400');
    assert(
      typeof expiredBody.message === 'string' &&
        expiredBody.message.toLowerCase().includes('expired'),
      'Error message indicates expired token',
    );

    // 4. Resend Verification + Invalidate Previous Tokens + Anti-Enumeration
    console.log('\n4. Testing Resend Verification, Token Invalidation & Anti-Enumeration...');
    const resendExistingRes = await fetch(`${baseUrl}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  VERIFY_USER1@HalalDine.com  ' }),
    });
    const resendExistingBody = await resendExistingRes.json();
    assert(resendExistingRes.status === 200, 'Resend for unverified user returns 200 OK');
    assert(!('token' in resendExistingBody), 'Resend response never exposes token');
    assert(sentEmails.length === 2, 'New verification email dispatched on resend');

    const refreshedTokenRow1 = await prisma.emailVerificationToken.findUnique({
      where: { id: tokenRow1!.id },
    });
    assert(
      refreshedTokenRow1?.usedAt !== null,
      'Previous unused token invalidated (usedAt set) upon resend',
    );

    const oldTokenUseRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: firstEmail.rawToken }),
    });
    assert(
      oldTokenUseRes.status === 400,
      'Previously invalidated token rejected with 400 after resend',
    );

    const resendUnknownRes = await fetch(`${baseUrl}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent_person@halaldine.com' }),
    });
    const resendUnknownBody = await resendUnknownRes.json();
    assert(
      resendUnknownRes.status === 200,
      'Resend for unknown email returns 200 OK (anti-enumeration)',
    );
    assert(
      resendUnknownBody.message === resendExistingBody.message,
      'Response message is identical whether email exists or not',
    );
    assert(sentEmails.length === 2, 'No email dispatched for non-existent user');

    // 5. Successful Verification
    console.log('\n5. Testing Successful Email Verification...');
    const latestEmail = sentEmails[1]!;
    const verifyOkRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: latestEmail.rawToken }),
    });
    const verifyOkBody = await verifyOkRes.json();
    assert(verifyOkRes.status === 200, 'Valid verification token returns 200 OK');
    assert(
      !('token' in verifyOkBody) && !('passwordHash' in verifyOkBody),
      'Response contains no sensitive data',
    );

    const verifiedUser = await prisma.user.findUnique({ where: { id: regData.id } });
    assert(verifiedUser?.isEmailVerified === true, 'User.isEmailVerified updated to true');
    assert(verifiedUser?.emailVerifiedAt !== null, 'User.emailVerifiedAt timestamp set');

    const consumedTokenRow = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(latestEmail.rawToken) },
    });
    assert(consumedTokenRow?.usedAt !== null, 'Consumed token marked with usedAt timestamp');

    // 6. Token Reuse Rejection
    console.log('\n6. Testing Token Reuse Rejection...');
    const reuseRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: latestEmail.rawToken }),
    });
    assert(reuseRes.status === 400, 'Reusing consumed token rejected with 400');

    const resendVerifiedRes = await fetch(`${baseUrl}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'verify_user1@halaldine.com' }),
    });
    const resendVerifiedBody = await resendVerifiedRes.json();
    assert(resendVerifiedRes.status === 200, 'Resend for verified user returns uniform 200 OK');
    assert(
      resendVerifiedBody.message === resendExistingBody.message,
      'Response message identical for already-verified user',
    );
    assert(sentEmails.length === 2, 'No new email dispatched for already-verified user');

    // 7. Concurrent Duplicate Verification Requests (Atomicity & Race Protection)
    console.log('\n7. Testing Concurrent Duplicate Verification Requests...');
    const countBeforeConc = sentEmails.length;
    await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Concurrent User',
        email: 'verify_concurrent@halaldine.com',
        password: 'StrongP@ssw0rd2026!',
      }),
    });
    const concToken = sentEmails[countBeforeConc]!.rawToken;
    const concResponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: concToken }),
        }),
      ),
    );
    const okCount = concResponses.filter((r) => r.status === 200).length;
    const failCount = concResponses.filter((r) => r.status === 400).length;
    assert(
      okCount === 1,
      'Exactly 1 concurrent verification request succeeds (200)',
      `ok=${okCount}`,
    );
    assert(
      failCount === 4,
      'Remaining 4 concurrent duplicate requests fail (400)',
      `fail=${failCount}`,
    );

    // 8. Email Delivery Failure Handling
    console.log('\n8. Testing Email Delivery Failure Handling...');
    shouldFailEmailDelivery = true;

    const failRegRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mail Fail User',
        email: 'verify_mailfail@halaldine.com',
        password: 'StrongP@ssw0rd2026!',
      }),
    });
    const failRegBody = await failRegRes.json();
    assert(
      failRegRes.status === 201,
      'Registration succeeds safely even if email provider fails temporarily (201)',
    );
    assert(failRegBody.isEmailVerified === false, 'Account remains unverified when email fails');

    let resendCaughtSafely = true;
    let resendResultMsg = '';
    try {
      const res = await emailVerificationService.resendVerification({
        email: 'verify_mailfail@halaldine.com',
      });
      resendResultMsg = res.message;
    } catch {
      resendCaughtSafely = false;
    }
    assert(
      resendCaughtSafely === true && resendResultMsg.length > 0,
      'Resend handles email delivery failure safely without crashing or leaking account existence',
    );

    shouldFailEmailDelivery = false;
    const failingConfigService = new ConfigService({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '',
    });
    const strictMailService = new MailService(failingConfigService);
    let threwSafeMailError = false;
    try {
      await strictMailService.sendVerificationEmail({
        userId: 'user-id-test',
        to: 'test@example.com',
        name: 'Test',
        rawToken: 'SECRET_RAW_TOKEN_MUST_NOT_LEAK',
        expiryHours: 24,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      threwSafeMailError =
        err instanceof EmailDeliveryError && !msg.includes('SECRET_RAW_TOKEN_MUST_NOT_LEAK');
    }
    assert(
      threwSafeMailError === true,
      'MailService throws EmailDeliveryError on SMTP failure without leaking raw tokens',
    );

    // 9. Swagger Documentation Check
    console.log('\n9. Testing Swagger Documentation for Email Verification Endpoints...');
    const verifyDoc = document.paths['/api/auth/verify-email'];
    const resendDoc = document.paths['/api/auth/resend-verification'];
    assert(verifyDoc?.post !== undefined, 'Swagger documents POST /api/auth/verify-email');
    assert(verifyDoc?.post?.responses?.['200'] !== undefined, 'verify-email documents 200 OK');
    assert(
      verifyDoc?.post?.responses?.['400'] !== undefined,
      'verify-email documents 400 Bad Request',
    );
    assert(
      verifyDoc?.post?.responses?.['429'] !== undefined,
      'verify-email documents 429 Too Many Requests',
    );
    assert(resendDoc?.post !== undefined, 'Swagger documents POST /api/auth/resend-verification');
    assert(
      resendDoc?.post?.responses?.['200'] !== undefined,
      'resend-verification documents 200 OK',
    );
    assert(
      resendDoc?.post?.responses?.['429'] !== undefined,
      'resend-verification documents 429 Too Many Requests',
    );

    // 10. Cascade Deletion Verification
    console.log('\n10. Cleaning Up Test Data & Verifying Cascade Delete...');
    const createdUserIds = (
      await prisma.user.findMany({
        where: { email: { in: testEmails } },
        select: { id: true },
      })
    ).map((u) => u.id);

    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    const orphanTokens = await prisma.emailVerificationToken.count({
      where: { userId: { in: createdUserIds } },
    });
    assert(orphanTokens === 0, 'Deleting users cascade-deletes all EmailVerificationToken records');
  } finally {
    await app.close();
  }

  // 11. Deterministic Rate-Limiting Checks on Isolated Instance (using default limits)
  console.log('\n11. Testing Default Rate Limits for Verify & Resend Endpoints...');
  if (origVerifyLimit !== undefined) process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = origVerifyLimit;
  else delete process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  if (origResendLimit !== undefined)
    process.env.RESEND_VERIFICATION_THROTTLE_LIMIT = origResendLimit;
  else delete process.env.RESEND_VERIFICATION_THROTTLE_LIMIT;
  if (origRegLimit !== undefined) process.env.AUTH_REGISTER_THROTTLE_LIMIT = origRegLimit;
  else delete process.env.AUTH_REGISTER_THROTTLE_LIMIT;

  const rlApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(rlApp, { enableLoggingInterceptor: false });
  await rlApp.listen(3096);

  try {
    const resendStatuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await fetch('http://localhost:3096/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'verify_ratelimit@halaldine.com' }),
      });
      resendStatuses.push(r.status);
    }
    assert(
      resendStatuses.slice(0, 3).every((s) => s === 200),
      'First 3 resend-verification requests succeed (200)',
      `Statuses: ${resendStatuses.join(', ')}`,
    );
    assert(
      resendStatuses[3] === 429,
      '4th resend-verification request returns 429 Too Many Requests',
      `Status: ${resendStatuses[3]}`,
    );

    const verifyStatuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await fetch('http://localhost:3096/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '0'.repeat(64) }),
      });
      verifyStatuses.push(r.status);
    }
    assert(
      verifyStatuses.slice(0, 10).every((s) => s === 400),
      'First 10 verify-email requests pass throttler (400 invalid token)',
      `Statuses: ${verifyStatuses.join(', ')}`,
    );
    assert(
      verifyStatuses[10] === 429,
      '11th verify-email request returns 429 Too Many Requests',
      `Status: ${verifyStatuses[10]}`,
    );
  } finally {
    await rlApp.close();
  }

  console.log('\n--- Email Verification Test Verification Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during email verification test run:', err);
  process.exit(1);
});
