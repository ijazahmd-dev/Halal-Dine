import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import {
  EmailDeliveryError,
  MailService,
  SendPasswordChangedEmailParams,
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

function getSetCookieHeaders(res: Response): string[] {
  const headersAny = res.headers as unknown as {
    getSetCookie?: () => string[];
    get: (name: string) => string | null;
  };
  if (typeof headersAny.getSetCookie === 'function') {
    return headersAny.getSetCookie();
  }
  const single = headersAny.get('set-cookie');
  return single ? [single] : [];
}

function isCookieCleared(setCookieHeaders: string[], cookieName: string): boolean {
  const prefix = `${cookieName}=`;
  const matching = setCookieHeaders.find((h) => h.startsWith(prefix));
  if (!matching) return false;
  return (
    matching.startsWith(`${cookieName}=;`) &&
    (matching.includes('Expires=Thu, 01 Jan 1970') || matching.includes('Max-Age=0'))
  );
}

async function runTests() {
  console.log('\n--- Starting Halal Dine Change Password Test Suite ---\n');

  const testDbUrl = await ensureIsolatedTestDatabase();
  assert(testDbUrl.includes('_test'), 'Tests isolated to *_test database (protects dev database)');

  const origRegLimit = process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  const origVerifyLimit = process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  const origLoginLimit = process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  const origChangePassLimit = process.env.AUTH_CHANGE_PASSWORD_THROTTLE_LIMIT;

  process.env.AUTH_REGISTER_THROTTLE_LIMIT = '80';
  process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = '80';
  process.env.AUTH_LOGIN_THROTTLE_LIMIT = '80';
  process.env.AUTH_CHANGE_PASSWORD_THROTTLE_LIMIT = '50';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  const { apiPrefix } = configureApp(app, { enableLoggingInterceptor: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Halal Dine API')
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const testPort = 3089;
  await app.listen(testPort);
  const baseUrl = `http://localhost:${testPort}/${apiPrefix}`;

  const prisma = app.get(PrismaService);
  const mailService = app.get(MailService);

  const primaryUserEmail = 'change_pw_primary@halaldine.com';
  const secondaryUserEmail = 'change_pw_secondary@halaldine.com';
  const initialPassword = 'OldStrongP@ssword2026!';
  const newPassword = 'NewStrongP@ssword2026!';
  const thirdPassword = 'ThirdStrongP@ssword2026!';

  const testEmails = [primaryUserEmail, secondaryUserEmail];
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });

  const verifyTokens = new Map<string, string>();
  const sentChangedEmails: SendPasswordChangedEmailParams[] = [];
  let failChangedMail = false;

  const origSendVerify = mailService.sendVerificationEmail.bind(mailService);
  const origSendChanged = mailService.sendPasswordChangedEmail.bind(mailService);

  mailService.sendVerificationEmail = async (params: SendVerificationEmailParams) => {
    verifyTokens.set(params.to, params.rawToken);
    return origSendVerify(params);
  };
  mailService.sendPasswordChangedEmail = async (params: SendPasswordChangedEmailParams) => {
    sentChangedEmails.push(params);
    if (failChangedMail) {
      throw new EmailDeliveryError('Simulated SMTP notification outage');
    }
    return origSendChanged(params);
  };

  async function registerAndVerify(email: string, name: string): Promise<string> {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: initialPassword }),
    });
    const regBody = (await regRes.json()) as { id: string };
    const token = verifyTokens.get(email);
    if (!token) throw new Error(`Missing verification token for ${email}`);
    await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
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
    const primaryUserId = await registerAndVerify(primaryUserEmail, 'Primary User');
    await registerAndVerify(secondaryUserEmail, 'Secondary User');

    // Create multiple sessions for primary user and an active session for secondary user
    const mobileSession1 = await loginMobile(primaryUserEmail, initialPassword, 'Mobile 1');
    const mobileSession2 = await loginMobile(primaryUserEmail, initialPassword, 'Mobile 2');
    const secondarySession = await loginMobile(secondaryUserEmail, initialPassword, 'Other User');

    // 1. Authentication & Validation Failures
    console.log('\n1. Testing Authentication & Zod Validation Enforcement...');
    const unauthRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: initialPassword, newPassword }),
    });
    const badJwtRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.jwt.token',
      },
      body: JSON.stringify({ currentPassword: initialPassword, newPassword }),
    });
    assert(
      unauthRes.status === 401 && badJwtRes.status === 401,
      'Missing or invalid Bearer token rejected with 401 Unauthorized',
    );

    const weakNewPwRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobileSession1.body.accessToken}`,
      },
      body: JSON.stringify({ currentPassword: initialPassword, newPassword: 'weak' }),
    });
    const samePwRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobileSession1.body.accessToken}`,
      },
      body: JSON.stringify({ currentPassword: initialPassword, newPassword: initialPassword }),
    });
    const extraFieldRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobileSession1.body.accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword,
        extra: 'rejected',
      }),
    });
    assert(
      weakNewPwRes.status === 400 && samePwRes.status === 400 && extraFieldRes.status === 400,
      'Rejects weak new password, identical password, and unexpected fields with 400 Bad Request',
    );

    const wrongCurrentRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobileSession1.body.accessToken}`,
      },
      body: JSON.stringify({ currentPassword: 'IncorrectCurrent@999', newPassword }),
    });
    assert(
      wrongCurrentRes.status === 400,
      'Incorrect current password rejected with 400 Bad Request',
    );

    // 2. Successful Change Password, Session Revocation & Web Cookie Clearing
    console.log('\n2. Testing Successful Change Password & Cross-Device Session Revocation...');
    const changeSuccessRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mobileSession1.body.accessToken}`,
        'X-Client-Type': 'web',
      },
      body: JSON.stringify({ currentPassword: initialPassword, newPassword }),
    });
    const changeSuccessBody = (await changeSuccessRes.json()) as Record<string, unknown>;
    const changeCookies = getSetCookieHeaders(changeSuccessRes);

    const activeSessionsAfter = await prisma.userSession.count({
      where: { userId: primaryUserId, revokedAt: null },
    });
    const auditEntry = await prisma.auditLog.findFirst({
      where: { userId: primaryUserId, action: 'PASSWORD_CHANGED' },
      orderBy: { createdAt: 'desc' },
    });

    assert(
      changeSuccessRes.status === 200 &&
        !('accessToken' in changeSuccessBody) &&
        !('refreshToken' in changeSuccessBody) &&
        isCookieCleared(changeCookies, 'halal_dine_refresh_token') &&
        isCookieCleared(changeCookies, 'halal_dine_csrf_token') &&
        activeSessionsAfter === 0 &&
        auditEntry !== null &&
        sentChangedEmails.some((m) => m.userId === primaryUserId),
      'Change password succeeds (200), clears cookies, revokes all sessions, logs audit event, and notifies user',
    );

    // Old sessions & refresh tokens must fail; secondary user unaffected
    const oldRefresh1 = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: mobileSession1.body.refreshToken }),
    });
    const oldRefresh2 = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: mobileSession2.body.refreshToken }),
    });
    const oldJwtSessionEndpoint = await fetch(`${baseUrl}/auth/sessions`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${mobileSession1.body.accessToken}` },
    });
    const otherUserRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: secondarySession.body.refreshToken }),
    });
    assert(
      oldRefresh1.status === 401 &&
        oldRefresh2.status === 401 &&
        oldJwtSessionEndpoint.status === 401 &&
        otherUserRefresh.status === 200,
      'Revokes all old refresh tokens and sessions for user while keeping other users active',
    );

    // Old password rejected, new password authenticates cleanly
    const oldPwLogin = await loginMobile(primaryUserEmail, initialPassword);
    const newPwLogin = await loginMobile(primaryUserEmail, newPassword);
    assert(
      oldPwLogin.status === 401 && newPwLogin.status === 200,
      'Old password fails login (401) and new password logs in successfully (200)',
    );

    // 3. Notification Failure Must Not Roll Back Successful Password Change
    console.log('\n3. Testing Notification Email Failure Resilience...');
    failChangedMail = true;
    const mailFailChangeRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newPwLogin.body.accessToken}`,
        'X-Client-Type': 'mobile',
      },
      body: JSON.stringify({ currentPassword: newPassword, newPassword: thirdPassword }),
    });
    failChangedMail = false;

    const thirdPwLogin = await loginMobile(primaryUserEmail, thirdPassword);
    assert(
      mailFailChangeRes.status === 200 && thirdPwLogin.status === 200,
      'Password change succeeds even when notification email fails, allowing login with newest password',
    );

    // 4. Log Hygiene & Swagger Check
    console.log('\n4. Testing Log Safety & Swagger Documentation...');
    const combinedLogs = loggedMessages.join('\n');
    const docsRes = await fetch(`http://localhost:${testPort}/api/docs-json`);
    const docsJson = (await docsRes.json()) as {
      paths?: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    const changeDoc = docsJson.paths?.['/api/auth/change-password']?.post;

    assert(
      !combinedLogs.includes(initialPassword) &&
        !combinedLogs.includes(newPassword) &&
        !combinedLogs.includes(thirdPassword),
      'Application logs never leak plaintext passwords',
    );
    assert(
      docsRes.status === 200 &&
        changeDoc?.responses?.['200'] !== undefined &&
        changeDoc?.responses?.['400'] !== undefined &&
        changeDoc?.responses?.['401'] !== undefined &&
        changeDoc?.responses?.['429'] !== undefined,
      'Swagger documents /api/auth/change-password with 200/400/401/429 responses',
    );
  } finally {
    Logger.prototype.log = origLoggerLog;
    Logger.prototype.warn = origLoggerWarn;
    Logger.prototype.error = origLoggerError;
    await prisma.auditLog.deleteMany({ where: { user: { email: { in: testEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  }

  // 5. Rate Limiting Enforcement (default 5 requests/min -> 6th returns 429)
  console.log('\n5. Testing Default Rate Limit for Change Password...');
  if (origRegLimit !== undefined) process.env.AUTH_REGISTER_THROTTLE_LIMIT = origRegLimit;
  else delete process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  if (origVerifyLimit !== undefined) process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = origVerifyLimit;
  else delete process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  if (origLoginLimit !== undefined) process.env.AUTH_LOGIN_THROTTLE_LIMIT = origLoginLimit;
  else delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  if (origChangePassLimit !== undefined) {
    process.env.AUTH_CHANGE_PASSWORD_THROTTLE_LIMIT = origChangePassLimit;
  } else {
    delete process.env.AUTH_CHANGE_PASSWORD_THROTTLE_LIMIT;
  }

  const rlApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(rlApp, { enableLoggingInterceptor: false });
  await rlApp.listen(3088);

  try {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch('http://localhost:3088/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'Old', newPassword: 'NewStrong@Password1' }),
      });
      statuses.push(r.status);
    }
    assert(
      statuses.slice(0, 5).every((s) => s === 401) && statuses[5] === 429,
      'Change-password throttles after 5 requests/min (6th returns 429)',
      `Statuses: ${statuses.join(', ')}`,
    );
  } finally {
    await rlApp.close();
  }

  console.log('\n--- Auth Change Password Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during change password test run:', err);
  process.exit(1);
});
