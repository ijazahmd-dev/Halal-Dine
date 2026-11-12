import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as crypto from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { MailService, SendVerificationEmailParams } from '../src/modules/mail/mail.service';
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

function extractCookieValue(setCookieHeader: string, cookieName: string): string | null {
  const prefix = `${cookieName}=`;
  const firstSegment = setCookieHeader.split(';')[0]?.trim() ?? '';
  if (!firstSegment.startsWith(prefix)) {
    return null;
  }
  return decodeURIComponent(firstSegment.slice(prefix.length));
}

async function runTests() {
  console.log('\n--- Starting Halal Dine Auth Login & Initial Session Test Suite ---\n');

  const testDbUrl = await ensureIsolatedTestDatabase();
  assert(testDbUrl.includes('_test'), 'Tests isolated to *_test database (protects dev database)');

  const origRegLimit = process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  const origVerifyLimit = process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  const origLoginLimit = process.env.AUTH_LOGIN_THROTTLE_LIMIT;

  process.env.AUTH_REGISTER_THROTTLE_LIMIT = '50';
  process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = '50';
  process.env.AUTH_LOGIN_THROTTLE_LIMIT = '50';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  const { apiPrefix } = configureApp(app, { enableLoggingInterceptor: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Halal Dine API')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const testPort = 3095;
  await app.listen(testPort);
  const baseUrl = `http://localhost:${testPort}/${apiPrefix}`;

  const prisma = app.get(PrismaService);
  const mailService = app.get(MailService);
  const jwtService = app.get(JwtService);
  const configService = app.get(ConfigService);

  const activeEmail = 'login_active@halaldine.com';
  const unverifiedEmail = 'login_unverified@halaldine.com';
  const suspendedEmail = 'login_suspended@halaldine.com';
  const deactivatedEmail = 'login_deactivated@halaldine.com';
  const rateLimitEmail = 'login_ratelimit@halaldine.com';
  const testPassword = 'StrongP@ssw0rd2026!';

  const testEmails = [
    activeEmail,
    unverifiedEmail,
    suspendedEmail,
    deactivatedEmail,
    rateLimitEmail,
  ];

  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });

  const capturedTokens = new Map<string, string>();
  const originalSend = mailService.sendVerificationEmail.bind(mailService);
  mailService.sendVerificationEmail = async (params: SendVerificationEmailParams) => {
    capturedTokens.set(params.to, params.rawToken);
    return originalSend(params);
  };

  async function registerAndVerify(email: string, name: string, verify = true) {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: testPassword }),
    });
    const regBody = (await regRes.json()) as { id: string; email: string };
    if (regRes.status !== 201) {
      throw new Error(`Failed setup registration for ${email}: HTTP ${regRes.status}`);
    }

    if (verify) {
      const token = capturedTokens.get(email);
      if (!token) {
        throw new Error(`No verification token captured for ${email}`);
      }
      const verRes = await fetch(`${baseUrl}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (verRes.status !== 200) {
        throw new Error(`Failed setup verification for ${email}: HTTP ${verRes.status}`);
      }
    }
    return regBody;
  }

  try {
    const activeUser = await registerAndVerify(activeEmail, 'Login Active User', true);
    const unverifiedUser = await registerAndVerify(unverifiedEmail, 'Login Unverified User', false);
    const suspendedUser = await registerAndVerify(suspendedEmail, 'Login Suspended User', true);
    await prisma.user.update({
      where: { id: suspendedUser.id },
      data: { status: 'SUSPENDED' },
    });
    const deactivatedUser = await registerAndVerify(
      deactivatedEmail,
      'Login Deactivated User',
      true,
    );
    await prisma.user.update({
      where: { id: deactivatedUser.id },
      data: { status: 'DEACTIVATED' },
    });

    // 1. Validation & Client Type Header checks
    console.log('\n1. Testing Validation & X-Client-Type Header Enforcement...');
    const badPayloadRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        password: '',
        extraField: 'rejected',
      }),
    });
    assert(badPayloadRes.status === 400, 'Invalid payload / unknown fields rejected with 400');

    const badClientRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'desktop',
      },
      body: JSON.stringify({ email: activeEmail, password: testPassword }),
    });
    assert(badClientRes.status === 400, 'Invalid X-Client-Type header rejected with 400');

    // 2. Generic 401 & Timing/Enumeration Protection
    console.log('\n2. Testing Invalid Credentials & Non-Existent Email (Generic 401)...');
    const wrongPassRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: activeEmail, password: 'WrongPassword123!' }),
    });
    const wrongPassBody = (await wrongPassRes.json()) as { message?: string };

    const unknownEmailRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'does_not_exist@halaldine.com', password: testPassword }),
    });
    const unknownEmailBody = (await unknownEmailRes.json()) as { message?: string };

    assert(wrongPassRes.status === 401, 'Wrong password returns 401 Unauthorized');
    assert(unknownEmailRes.status === 401, 'Non-existent email returns 401 Unauthorized');
    assert(
      wrongPassBody.message === 'Invalid email or password' &&
        unknownEmailBody.message === wrongPassBody.message,
      '401 error message is generic and identical for wrong password and non-existent email',
    );
    assert(
      getSetCookieHeaders(wrongPassRes).length === 0 &&
        getSetCookieHeaders(unknownEmailRes).length === 0,
      'No cookies set on failed 401 login',
    );

    // Password verification must happen BEFORE eligibility status checks
    const unverifiedWrongPass = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: unverifiedEmail, password: 'WrongPassword123!' }),
    });
    const suspendedWrongPass = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: suspendedEmail, password: 'WrongPassword123!' }),
    });
    assert(
      unverifiedWrongPass.status === 401 && suspendedWrongPass.status === 401,
      'Unverified/suspended accounts with wrong password return 401 before eligibility checks',
    );

    // 3. Post-Password Eligibility Enforcement (403)
    console.log('\n3. Testing Post-Password Eligibility Checks (403)...');
    const unverifiedRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: unverifiedEmail, password: testPassword }),
    });
    const unverifiedBody = (await unverifiedRes.json()) as { message?: string };
    assert(
      unverifiedRes.status === 403 &&
        (unverifiedBody.message ?? '').toLowerCase().includes('verif'),
      'Unverified email with valid password returns 403 requiring verification',
    );

    const suspendedRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: suspendedEmail, password: testPassword }),
    });
    assert(
      suspendedRes.status === 403,
      'SUSPENDED account with valid password returns 403 Forbidden',
    );

    const deactivatedRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: deactivatedEmail, password: testPassword }),
    });
    assert(
      deactivatedRes.status === 403,
      'DEACTIVATED account with valid password returns 403 Forbidden',
    );

    const ineligibleSessionCount = await prisma.userSession.count({
      where: {
        userId: { in: [unverifiedUser.id, suspendedUser.id, deactivatedUser.id] },
      },
    });
    const ineligibleUsersDb = await prisma.user.findMany({
      where: {
        id: { in: [unverifiedUser.id, suspendedUser.id, deactivatedUser.id] },
      },
      select: { lastLoginAt: true },
    });
    assert(
      ineligibleSessionCount === 0 && ineligibleUsersDb.every((u) => u.lastLoginAt === null),
      'No sessions created and lastLoginAt unchanged for ineligible accounts',
    );

    // 4. Mobile Login (Email Normalization, JWT Claims, Session Persistence & JSON Refresh Token)
    console.log('\n4. Testing Mobile Login, Email Normalization, JWT Claims & Session Creation...');
    const mobileLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'mobile',
        'User-Agent': 'HalalDine-Android-Test/1.0',
      },
      body: JSON.stringify({
        email: '  LOGIN_ACTIVE@HalalDine.com  ',
        password: testPassword,
        deviceInfo: 'Pixel 9 Pro',
      }),
    });
    const mobileLoginBody = (await mobileLoginRes.json()) as {
      accessToken: string;
      refreshToken?: string;
      tokenType: string;
      expiresIn: number;
      user: {
        id: string;
        email: string;
        updatedAt: string;
        passwordHash?: string;
      };
    };

    assert(mobileLoginRes.status === 200, 'Normalized mobile login succeeds with HTTP 200');
    assert(getSetCookieHeaders(mobileLoginRes).length === 0, 'Mobile login sets no refresh cookie');
    assert(
      typeof mobileLoginBody.refreshToken === 'string' && mobileLoginBody.refreshToken.length >= 64,
      'Mobile login returns raw refreshToken in JSON body',
    );
    assert(
      mobileLoginBody.tokenType === 'Bearer' && mobileLoginBody.expiresIn === 900,
      'Login response returns tokenType="Bearer" and expiresIn=900',
    );
    assert(
      mobileLoginBody.user?.id === activeUser.id &&
        mobileLoginBody.user?.email === activeEmail &&
        !('passwordHash' in mobileLoginBody.user),
      'Response user payload matches normalized account and omits passwordHash',
    );

    const decodedHeaderPart = mobileLoginBody.accessToken.split('.')[0] ?? '';
    const jwtHeader = JSON.parse(Buffer.from(decodedHeaderPart, 'base64url').toString('utf8')) as {
      alg?: string;
    };
    const verifiedClaims = await jwtService.verifyAsync<{
      sub: string;
      sid: string;
      jti: string;
      iss: string;
      aud: string;
      iat: number;
      exp: number;
    }>(mobileLoginBody.accessToken, {
      secret: configService.getOrThrow<string>('JWT_SECRET'),
      issuer: configService.get<string>('JWT_ISSUER') || 'halal-dine-api',
      audience: configService.get<string>('JWT_AUDIENCE') || 'halal-dine-clients',
      algorithms: ['HS256'],
    });

    assert(
      jwtHeader.alg === 'HS256' &&
        verifiedClaims.sub === activeUser.id &&
        typeof verifiedClaims.sid === 'string' &&
        verifiedClaims.sid.length > 0 &&
        typeof verifiedClaims.jti === 'string' &&
        verifiedClaims.jti.length > 0 &&
        verifiedClaims.exp - verifiedClaims.iat === 900,
      'JWT access token verified with HS256 and contains sub, sid, jti, iss, aud, iat, exp (15m)',
    );

    const mobileSession = await prisma.userSession.findUnique({
      where: { id: verifiedClaims.sid },
    });
    const refreshedUserAfterMobile = await prisma.user.findUnique({
      where: { id: activeUser.id },
      select: { lastLoginAt: true, updatedAt: true },
    });
    const expectedRefreshHash = sha256(mobileLoginBody.refreshToken ?? '');
    const sessionDurationDays = mobileSession
      ? (mobileSession.expiresAt.getTime() - mobileSession.createdAt.getTime()) /
        (24 * 60 * 60 * 1000)
      : 0;

    assert(
      mobileSession !== null &&
        mobileSession.userId === activeUser.id &&
        mobileSession.refreshTokenHash === expectedRefreshHash &&
        mobileSession.refreshTokenHash !== mobileLoginBody.refreshToken &&
        mobileSession.deviceInfo === 'Pixel 9 Pro' &&
        (mobileSession.userAgent ?? '').includes('HalalDine-Android-Test') &&
        typeof mobileSession.ipAddress === 'string' &&
        mobileSession.ipAddress.length > 0 &&
        mobileSession.revokedAt === null &&
        Math.abs(sessionDurationDays - 7) < 0.01,
      'UserSession persisted with SHA-256 refreshTokenHash, metadata, ~7d expiry, revokedAt=null',
    );
    assert(
      refreshedUserAfterMobile?.lastLoginAt instanceof Date &&
        mobileLoginBody.user.updatedAt === refreshedUserAfterMobile.updatedAt.toISOString(),
      'User.lastLoginAt atomically updated on successful login',
    );

    // 5. Web Login (Default Omitted Header & Explicit Web Header, HttpOnly Cookie, Omitted Body Field)
    console.log('\n5. Testing Web Login (HttpOnly Cookie & Body Omission)...');
    const webLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 HalalDine-Web-Test',
      },
      body: JSON.stringify({
        email: activeEmail,
        password: testPassword,
      }),
    });
    const webLoginBody = (await webLoginRes.json()) as Record<string, unknown>;
    const webCookies = getSetCookieHeaders(webLoginRes);
    const cookieName =
      configService.get<string>('REFRESH_COOKIE_NAME') || 'halal_dine_refresh_token';
    const refreshCookieHeader = webCookies.find((c) => c.startsWith(`${cookieName}=`)) ?? '';
    const webRawRefreshToken = extractCookieValue(refreshCookieHeader, cookieName);

    assert(webLoginRes.status === 200, 'Web login (default omitted X-Client-Type) returns 200');
    assert(
      !Object.prototype.hasOwnProperty.call(webLoginBody, 'refreshToken'),
      'Web login omits refreshToken from JSON response body',
    );
    assert(
      refreshCookieHeader.includes('HttpOnly') &&
        refreshCookieHeader.includes('Path=/api/auth') &&
        refreshCookieHeader.includes('SameSite=Lax') &&
        !refreshCookieHeader.includes('Secure') &&
        typeof webRawRefreshToken === 'string' &&
        webRawRefreshToken.length >= 64,
      'Web login sets HttpOnly, SameSite=Lax, Path=/api/auth refresh cookie (without Secure in dev)',
    );

    const webSession = webRawRefreshToken
      ? await prisma.userSession.findUnique({
          where: { refreshTokenHash: sha256(webRawRefreshToken) },
        })
      : null;
    assert(
      webSession !== null && webSession.userId === activeUser.id,
      'Web cookie raw refresh token matches SHA-256 UserSession.refreshTokenHash in DB',
    );

    // Verify production Secure cookie behavior
    const origNodeEnv = configService.get<string>('NODE_ENV');
    configService.set('NODE_ENV', 'production');
    try {
      const prodWebRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Type': 'web',
        },
        body: JSON.stringify({ email: activeEmail, password: testPassword }),
      });
      const prodCookies = getSetCookieHeaders(prodWebRes);
      const prodCookieHeader = prodCookies.find((c) => c.startsWith(`${cookieName}=`)) ?? '';
      assert(
        prodWebRes.status === 200 &&
          prodCookieHeader.includes('HttpOnly') &&
          prodCookieHeader.includes('Secure'),
        'Web login sets Secure cookie attribute when NODE_ENV=production',
      );
    } finally {
      configService.set('NODE_ENV', origNodeEnv ?? 'development');
    }

    // 6. Atomic Transaction Failure Rollback Check
    console.log('\n6. Testing Transaction Atomicity on Session Creation Failure...');
    const userBeforeFail = await prisma.user.findUnique({
      where: { id: activeUser.id },
      select: { lastLoginAt: true },
    });
    const sessionCountBeforeFail = await prisma.userSession.count({
      where: { userId: activeUser.id },
    });

    const origTx = prisma.$transaction.bind(prisma);
    prisma.$transaction = (async (fnOrPromises: unknown) => {
      if (typeof fnOrPromises === 'function') {
        return origTx(async (tx) => {
          await (fnOrPromises as (client: typeof tx) => Promise<unknown>)(tx);
          throw new Error('Simulated DB commit failure');
        });
      }
      throw new Error('Unexpected array transaction');
    }) as typeof prisma.$transaction;

    try {
      const txFailRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Type': 'mobile',
        },
        body: JSON.stringify({ email: activeEmail, password: testPassword }),
      });
      const txFailText = await txFailRes.text();
      assert(
        txFailRes.status === 500 &&
          !txFailText.includes('Simulated DB commit failure') &&
          !txFailText.includes('accessToken') &&
          getSetCookieHeaders(txFailRes).length === 0,
        'Failed session transaction returns sanitized 500 with no tokens or cookies',
      );
    } finally {
      prisma.$transaction = origTx;
    }

    const userAfterFail = await prisma.user.findUnique({
      where: { id: activeUser.id },
      select: { lastLoginAt: true },
    });
    const sessionCountAfterFail = await prisma.userSession.count({
      where: { userId: activeUser.id },
    });
    assert(
      sessionCountAfterFail === sessionCountBeforeFail &&
        userAfterFail?.lastLoginAt?.getTime() === userBeforeFail?.lastLoginAt?.getTime(),
      'Transaction rollback leaves UserSession count and User.lastLoginAt completely unchanged',
    );

    // 7. Swagger Documentation Verification
    console.log('\n7. Testing Swagger Documentation for /api/auth/login...');
    const docsRes = await fetch(`http://localhost:${testPort}/api/docs-json`);
    const docsJson = (await docsRes.json()) as {
      paths?: Record<
        string,
        {
          post?: {
            responses?: Record<string, unknown>;
            parameters?: Array<{ name?: string; in?: string }>;
          };
        }
      >;
    };
    const loginOp = docsJson.paths?.['/api/auth/login']?.post;
    const hasClientHeader =
      loginOp?.parameters?.some(
        (p) => p.in === 'header' && p.name?.toLowerCase() === 'x-client-type',
      ) ?? false;
    const docsString = JSON.stringify(loginOp ?? {});

    assert(
      docsRes.status === 200 &&
        loginOp !== undefined &&
        loginOp.responses?.['200'] !== undefined &&
        loginOp.responses?.['400'] !== undefined &&
        loginOp.responses?.['401'] !== undefined &&
        loginOp.responses?.['403'] !== undefined &&
        loginOp.responses?.['429'] !== undefined &&
        hasClientHeader &&
        !docsString.includes(activeUser.id),
      'Swagger documents /api/auth/login with X-Client-Type, 200/400/401/403/429 responses and no real secrets',
    );
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  }

  // 8. Dedicated Rate Limit Enforcement Check (default limit=5/min -> 6th returns 429)
  console.log('\n8. Testing Default Login Rate Limit Enforcement...');
  if (origRegLimit !== undefined) process.env.AUTH_REGISTER_THROTTLE_LIMIT = origRegLimit;
  else delete process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  if (origVerifyLimit !== undefined) process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = origVerifyLimit;
  else delete process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  if (origLoginLimit !== undefined) process.env.AUTH_LOGIN_THROTTLE_LIMIT = origLoginLimit;
  else delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;

  const rlApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(rlApp, { enableLoggingInterceptor: false });
  await rlApp.listen(3094);

  try {
    const loginStatuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch('http://localhost:3094/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: rateLimitEmail, password: 'WrongPassword123!' }),
      });
      loginStatuses.push(r.status);
    }
    assert(
      loginStatuses.slice(0, 5).every((s) => s === 401),
      'First 5 login attempts pass throttler and return 401',
      `Statuses: ${loginStatuses.join(', ')}`,
    );
    assert(
      loginStatuses[5] === 429,
      '6th login attempt returns 429 Too Many Requests',
      `Status: ${loginStatuses[5]}`,
    );
  } finally {
    await rlApp.close();
  }

  console.log('\n--- Auth Login Test Verification Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during login test run:', err);
  process.exit(1);
});
