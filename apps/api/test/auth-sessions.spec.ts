import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as crypto from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { SessionCleanupService } from '../src/modules/auth/services/session-cleanup.service';
import { SessionService } from '../src/modules/auth/services/session.service';
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

function extractCookieValue(setCookieHeaders: string[], cookieName: string): string | null {
  const prefix = `${cookieName}=`;
  const matching = setCookieHeaders.find((header) => header.startsWith(prefix));
  if (!matching) {
    return null;
  }
  const firstSegment = matching.split(';')[0]?.trim() ?? '';
  return decodeURIComponent(firstSegment.slice(prefix.length));
}

function isCookieClearedHeader(setCookieHeaders: string[], cookieName: string): boolean {
  const prefix = `${cookieName}=`;
  const matching = setCookieHeaders.find((header) => header.startsWith(prefix));
  if (!matching) {
    return false;
  }
  const value = extractCookieValue(setCookieHeaders, cookieName);
  return (
    value === '' &&
    (matching.includes('Expires=Thu, 01 Jan 1970') || matching.includes('Max-Age=0'))
  );
}

async function runTests() {
  console.log(
    '\n--- Starting Halal Dine Refresh Rotation, Reuse & Session Management Test Suite ---\n',
  );

  const testDbUrl = await ensureIsolatedTestDatabase();
  assert(testDbUrl.includes('_test'), 'Tests isolated to *_test database (protects dev database)');

  const origRegLimit = process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  const origVerifyLimit = process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  const origLoginLimit = process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  const origRefreshLimit = process.env.AUTH_REFRESH_THROTTLE_LIMIT;

  process.env.AUTH_REGISTER_THROTTLE_LIMIT = '80';
  process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = '80';
  process.env.AUTH_LOGIN_THROTTLE_LIMIT = '80';
  process.env.AUTH_REFRESH_THROTTLE_LIMIT = '120';

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

  const testPort = 3093;
  await app.listen(testPort);
  const baseUrl = `http://localhost:${testPort}/${apiPrefix}`;

  const prisma = app.get(PrismaService);
  const mailService = app.get(MailService);
  const jwtService = app.get(JwtService);
  const configService = app.get(ConfigService);
  const sessionService = app.get(SessionService);
  const cleanupService = app.get(SessionCleanupService);

  const userAEmail = 'session_user_a@halaldine.com';
  const userBEmail = 'session_user_b@halaldine.com';
  const statusUserEmail = 'session_status_user@halaldine.com';
  const testPassword = 'StrongP@ssw0rd2026!';
  const allowedOrigin = 'http://localhost:3000';
  const refreshCookieName =
    configService.get<string>('REFRESH_COOKIE_NAME') || 'halal_dine_refresh_token';
  const csrfCookieName =
    configService.get<string>('REFRESH_CSRF_COOKIE_NAME') || 'halal_dine_csrf_token';

  const testEmails = [userAEmail, userBEmail, statusUserEmail];
  await prisma.user.deleteMany({ where: { email: { in: testEmails } } });

  const capturedTokens = new Map<string, string>();
  const originalSend = mailService.sendVerificationEmail.bind(mailService);
  mailService.sendVerificationEmail = async (params: SendVerificationEmailParams) => {
    capturedTokens.set(params.to, params.rawToken);
    return originalSend(params);
  };

  async function registerAndVerify(email: string, name: string): Promise<string> {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: testPassword }),
    });
    const regBody = (await regRes.json()) as { id: string };
    if (regRes.status !== 201) {
      throw new Error(`Registration setup failed (${email}): ${regRes.status}`);
    }
    const verifyToken = capturedTokens.get(email);
    if (!verifyToken) {
      throw new Error(`Missing verification token for ${email}`);
    }
    const verRes = await fetch(`${baseUrl}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    if (verRes.status !== 200) {
      throw new Error(`Verification setup failed (${email}): ${verRes.status}`);
    }
    return regBody.id;
  }

  async function mobileLogin(email: string, deviceInfo = 'Mobile Test Device') {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'mobile',
        'User-Agent': 'HalalDine-Mobile-Test/1.0',
      },
      body: JSON.stringify({ email, password: testPassword, deviceInfo }),
    });
    const body = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
    const decoded = await jwtService.verifyAsync<{ sub: string; sid: string; jti: string }>(
      body.accessToken,
      {
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        issuer: configService.get<string>('JWT_ISSUER') || 'halal-dine-api',
        audience: configService.get<string>('JWT_AUDIENCE') || 'halal-dine-clients',
        algorithms: ['HS256'],
      },
    );
    return { res, body, sid: decoded.sid, jti: decoded.jti };
  }

  async function webLogin(email: string, deviceInfo = 'Chrome Desktop') {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'web',
        'User-Agent': 'Mozilla/5.0 HalalDine-Web-Test',
      },
      body: JSON.stringify({ email, password: testPassword, deviceInfo }),
    });
    const body = (await res.json()) as { accessToken: string; refreshToken?: string };
    const cookies = getSetCookieHeaders(res);
    const refreshCookie = extractCookieValue(cookies, refreshCookieName) ?? '';
    const csrfCookie = extractCookieValue(cookies, csrfCookieName) ?? '';
    const decoded = await jwtService.verifyAsync<{ sub: string; sid: string; jti: string }>(
      body.accessToken,
      {
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        issuer: configService.get<string>('JWT_ISSUER') || 'halal-dine-api',
        audience: configService.get<string>('JWT_AUDIENCE') || 'halal-dine-clients',
        algorithms: ['HS256'],
      },
    );
    return { res, body, cookies, refreshCookie, csrfCookie, sid: decoded.sid };
  }

  try {
    const userAId = await registerAndVerify(userAEmail, 'Session User A');
    const userBId = await registerAndVerify(userBEmail, 'Session User B');
    const statusUserId = await registerAndVerify(statusUserEmail, 'Status User');

    // 1. Mobile Refresh, Token Rotation, Access Token Renewal & Metadata Checks
    console.log('\n1. Testing Mobile Refresh Token Rotation & Session Continuity...');
    const mLogin = await mobileLogin(userAEmail, 'Pixel 9 Pro');
    const t0 = mLogin.body.refreshToken;
    const sessionBefore = await prisma.userSession.findUnique({ where: { id: mLogin.sid } });
    assert(sessionBefore !== null, 'Initial session exists before refresh');

    await new Promise((resolve) => setTimeout(resolve, 25));

    const badPayloadRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: t0, unexpected: 'bad' }),
    });
    assert(badPayloadRes.status === 400, 'Refresh rejects unknown payload fields with 400');

    const badClientRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'tablet' },
      body: JSON.stringify({ refreshToken: t0 }),
    });
    assert(badClientRes.status === 400, 'Refresh rejects invalid X-Client-Type with 400');

    const unknownTokenRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: 'f'.repeat(64) }),
    });
    const unknownTokenBody = (await unknownTokenRes.json()) as { message?: string };
    assert(
      unknownTokenRes.status === 401 &&
        unknownTokenBody.message === 'Invalid or expired refresh token',
      'Unknown refresh token rejected with generic 401',
    );

    const refresh1Res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: t0 }),
    });
    const refresh1Body = (await refresh1Res.json()) as {
      accessToken: string;
      tokenType: string;
      expiresIn: number;
      refreshToken?: string;
    };
    const t1 = refresh1Body.refreshToken ?? '';
    const decodedR1 = await jwtService.verifyAsync<{ sub: string; sid: string; jti: string }>(
      refresh1Body.accessToken,
      {
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        issuer: configService.get<string>('JWT_ISSUER') || 'halal-dine-api',
        audience: configService.get<string>('JWT_AUDIENCE') || 'halal-dine-clients',
        algorithms: ['HS256'],
      },
    );
    const sessionAfter1 = await prisma.userSession.findUnique({ where: { id: mLogin.sid } });
    const rotatedRecordT0 = await prisma.rotatedRefreshToken.findUnique({
      where: { tokenHash: sha256(t0) },
    });

    assert(
      refresh1Res.status === 200 &&
        getSetCookieHeaders(refresh1Res).length === 0 &&
        refresh1Body.tokenType === 'Bearer' &&
        refresh1Body.expiresIn === 900 &&
        t1.length >= 64 &&
        t1 !== t0,
      'Mobile refresh succeeds (200), returns rotated refreshToken in JSON, and sets no cookies',
    );
    assert(
      decodedR1.sub === userAId && decodedR1.sid === mLogin.sid && decodedR1.jti !== mLogin.jti,
      'Renewed JWT preserves sub and session ID (sid) while rotating jti',
    );
    assert(
      sessionAfter1 !== null &&
        sessionAfter1.refreshTokenHash === sha256(t1) &&
        sessionAfter1.refreshTokenHash !== t1 &&
        sessionAfter1.refreshTokenHash !== sha256(t0) &&
        sessionAfter1.expiresAt.getTime() > (sessionBefore?.expiresAt.getTime() ?? 0) &&
        sessionAfter1.lastUsedAt.getTime() > (sessionBefore?.lastUsedAt.getTime() ?? 0),
      'Session stores only new SHA-256 hash, extends expiresAt, and advances lastUsedAt',
    );
    assert(
      rotatedRecordT0 !== null &&
        rotatedRecordT0.sessionId === mLogin.sid &&
        rotatedRecordT0.expiresAt.getTime() > Date.now() + 20 * 24 * 60 * 60 * 1000,
      'RotatedRefreshToken stores SHA-256 hash of T0 with full detection-retention expiry',
    );

    // Rotate T1 -> T2 so T0 is >1 generation behind, proving deep history tracking works
    const refresh2Res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: t1 }),
    });
    const refresh2Body = (await refresh2Res.json()) as { refreshToken: string };
    const t2 = refresh2Body.refreshToken;
    assert(
      refresh2Res.status === 200 && t2 !== t1 && t2 !== t0,
      'Sequential rotation T1 -> T2 succeeds cleanly',
    );

    // 2. Concurrent Refresh Safety (CAS)
    console.log('\n2. Testing Concurrent Refresh Concurrency Control...');
    const [concA, concB] = await Promise.all([
      sessionService.rotateRefreshToken({ rawRefreshToken: t2 }).then(
        (ok) => ({ ok: true as const, res: ok }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
      sessionService.rotateRefreshToken({ rawRefreshToken: t2 }).then(
        (ok) => ({ ok: true as const, res: ok }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
    ]);
    const concSuccesses = [concA, concB].filter((item) => item.ok);
    const concFailures = [concA, concB].filter((item) => !item.ok);
    const t3 = concSuccesses[0]?.ok ? concSuccesses[0].res.rawRefreshToken : '';
    assert(
      concSuccesses.length === 1 && concFailures.length === 1 && t3.length >= 64,
      'Overlapping concurrent rotation lets strictly 1 caller succeed and rejects the other',
    );

    // Verify winner T3 remains completely valid (simultaneous race did NOT revoke the session)
    const afterConcurrentHttpRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: t3 }),
    });
    const afterConcurrentHttpBody = (await afterConcurrentHttpRes.json()) as {
      refreshToken: string;
      accessToken: string;
    };
    const t4 = afterConcurrentHttpBody.refreshToken;
    assert(
      afterConcurrentHttpRes.status === 200 && t4.length >= 64,
      'Winner token T3 from simultaneous race remains active and refreshes T3 -> T4 cleanly',
    );

    // HTTP-level concurrency test on another session (guarantees at most 1 HTTP 200)
    const httpRaceLogin = await mobileLogin(userAEmail, 'Race Device');
    const [httpR1, httpR2] = await Promise.all([
      fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
        body: JSON.stringify({ refreshToken: httpRaceLogin.body.refreshToken }),
      }),
      fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
        body: JSON.stringify({ refreshToken: httpRaceLogin.body.refreshToken }),
      }),
    ]);
    const httpStatuses = [httpR1.status, httpR2.status].sort();
    assert(
      httpStatuses[0] === 200 && httpStatuses[1] === 401,
      'Concurrent HTTP refresh requests yield strictly one 200 and one 401',
      `Statuses: ${httpStatuses.join(', ')}`,
    );

    // 3. Reuse Detection & Selective Session Revocation
    console.log('\n3. Testing Refresh Token Reuse Detection & Selective Session Revocation...');
    // User A creates an unrelated active session before reuse occurs on mLogin.sid
    const unrelatedLogin = await mobileLogin(userAEmail, 'Unrelated iPad');

    // Replay ancestor T0 against mLogin.sid (current token is T4)
    const reuseRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: t0 }),
    });
    const reuseBody = (await reuseRes.json()) as { message?: string };

    const compromisedSessionDb = await prisma.userSession.findUnique({ where: { id: mLogin.sid } });
    const reuseAuditLog = await prisma.auditLog.findFirst({
      where: {
        userId: userAId,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        entityId: mLogin.sid,
      },
      orderBy: { createdAt: 'desc' },
    });
    const auditLogSerialized = JSON.stringify(reuseAuditLog ?? {});

    assert(
      reuseRes.status === 401 && reuseBody.message === 'Invalid or expired refresh token',
      'Reused rotated token returns generic 401 indistinguishable from unknown/expired tokens',
    );
    assert(
      compromisedSessionDb !== null && compromisedSessionDb.revokedAt !== null,
      'Reuse detection identifies and revokes the compromised session',
    );
    assert(
      reuseAuditLog !== null &&
        reuseAuditLog.entityName === 'UserSession' &&
        !auditLogSerialized.includes(t0) &&
        !auditLogSerialized.includes(t4) &&
        !auditLogSerialized.includes(sha256(t0)),
      'Security AuditLog records reuse event without storing raw tokens or token hashes',
    );

    // Current valid token T4 on that compromised session must now be unusable
    const postCompromiseT4Res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: t4 }),
    });
    assert(
      postCompromiseT4Res.status === 401,
      'Previously active token T4 for the compromised session is rejected after reuse revocation',
    );

    // Unrelated session for the SAME user must stay active and refresh cleanly
    const unrelatedRefreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: unrelatedLogin.body.refreshToken }),
    });
    const unrelatedRefreshBody = (await unrelatedRefreshRes.json()) as { refreshToken: string };
    assert(
      unrelatedRefreshRes.status === 200 && unrelatedRefreshBody.refreshToken.length >= 64,
      'Unrelated active sessions of the same user remain unaffected after one session compromise',
    );

    // 4. Expired & User Eligibility Rejection on Refresh
    console.log('\n4. Testing Expired Sessions & Suspended/Deactivated/Unverified Rejections...');
    const expiryLogin = await mobileLogin(statusUserEmail, 'Expiry Test Device');
    await prisma.userSession.update({
      where: { id: expiryLogin.sid },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expiredRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: expiryLogin.body.refreshToken }),
    });
    assert(expiredRes.status === 401, 'Expired refresh session rejected with 401');

    const statusLogin = await mobileLogin(statusUserEmail, 'Status Test Device');
    await prisma.user.update({ where: { id: statusUserId }, data: { status: 'SUSPENDED' } });
    const suspendedRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: statusLogin.body.refreshToken }),
    });
    await prisma.user.update({ where: { id: statusUserId }, data: { status: 'DEACTIVATED' } });
    const deactivatedRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: statusLogin.body.refreshToken }),
    });
    await prisma.user.update({
      where: { id: statusUserId },
      data: { status: 'ACTIVE', isEmailVerified: false },
    });
    const unverifiedRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: statusLogin.body.refreshToken }),
    });
    assert(
      suspendedRefresh.status === 403 &&
        deactivatedRefresh.status === 403 &&
        unverifiedRefresh.status === 403,
      'Suspended, deactivated, and unverified accounts are rejected (403) on refresh without rotating tokens',
    );

    // 5. Web Cookie Delivery, CSRF Protection & Cookie Clearing
    console.log('\n5. Testing Web Cookie Delivery, CSRF / Origin Validation & Cookie Clearing...');
    const wLogin = await webLogin(userAEmail, 'Firefox Desktop');
    assert(
      wLogin.res.status === 200 &&
        !('refreshToken' in wLogin.body) &&
        wLogin.refreshCookie.length >= 64 &&
        wLogin.csrfCookie.length >= 64,
      'Web login issues HttpOnly refresh cookie + readable CSRF cookie and omits refreshToken from JSON',
    );

    const webCookieHeader = `${refreshCookieName}=${wLogin.refreshCookie}; ${csrfCookieName}=${wLogin.csrfCookie}`;

    const noOriginWebRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: webCookieHeader,
        'X-CSRF-Token': wLogin.csrfCookie,
      },
      body: JSON.stringify({}),
    });
    const badOriginWebRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.attacker.example',
        Cookie: webCookieHeader,
        'X-CSRF-Token': wLogin.csrfCookie,
      },
      body: JSON.stringify({}),
    });
    const badCsrfWebRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Cookie: webCookieHeader,
        'X-CSRF-Token': 'wrong_csrf_token',
      },
      body: JSON.stringify({}),
    });
    assert(
      noOriginWebRefresh.status === 403 &&
        badOriginWebRefresh.status === 403 &&
        badCsrfWebRefresh.status === 403 &&
        getSetCookieHeaders(badCsrfWebRefresh).length === 0,
      'Web refresh enforces Origin allowlisting and double-submit X-CSRF-Token (403 without clearing legitimate cookies)',
    );

    const validWebRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Cookie: webCookieHeader,
        'X-CSRF-Token': wLogin.csrfCookie,
      },
      body: JSON.stringify({}),
    });
    const validWebRefreshBody = (await validWebRefresh.json()) as {
      accessToken: string;
      refreshToken?: string;
    };
    const validWebCookies = getSetCookieHeaders(validWebRefresh);
    const rotatedWebRefreshCookie = extractCookieValue(validWebCookies, refreshCookieName) ?? '';
    const rotatedWebCsrfCookie = extractCookieValue(validWebCookies, csrfCookieName) ?? '';
    assert(
      validWebRefresh.status === 200 &&
        !('refreshToken' in validWebRefreshBody) &&
        rotatedWebRefreshCookie.length >= 64 &&
        rotatedWebRefreshCookie !== wLogin.refreshCookie &&
        rotatedWebCsrfCookie.length >= 64 &&
        rotatedWebCsrfCookie !== wLogin.csrfCookie,
      'Valid web refresh rotates HttpOnly refresh cookie and CSRF cookie while omitting refreshToken from JSON',
    );

    // Replaying old pre-rotation web cookie clears poisoned browser cookies cleanly
    const failedWebRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Cookie: `${refreshCookieName}=${wLogin.refreshCookie}; ${csrfCookieName}=${rotatedWebCsrfCookie}`,
        'X-CSRF-Token': rotatedWebCsrfCookie,
      },
      body: JSON.stringify({}),
    });
    const failedWebCookies = getSetCookieHeaders(failedWebRefresh);
    assert(
      failedWebRefresh.status === 401 &&
        isCookieClearedHeader(failedWebCookies, refreshCookieName) &&
        isCookieClearedHeader(failedWebCookies, csrfCookieName),
      'Failed/reused web refresh (with valid CSRF) clears web refresh and CSRF cookies',
    );

    // 6. Session Listing, Individual Revocation & Cross-User Authorization
    console.log('\n6. Testing Active Session Listing & Individual Revocation...');
    const listLogin1 = await mobileLogin(userAEmail, 'Work Laptop');
    const listLogin2 = await mobileLogin(userAEmail, 'Personal Phone');
    const userBLogin = await mobileLogin(userBEmail, 'User B Phone');

    const sessionsRes = await fetch(`${baseUrl}/auth/sessions`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${listLogin1.body.accessToken}` },
    });
    const sessionsBody = (await sessionsRes.json()) as {
      sessions: Array<Record<string, unknown>>;
    };
    const currentEntry = sessionsBody.sessions.find((s) => s.id === listLogin1.sid);
    const otherEntry = sessionsBody.sessions.find((s) => s.id === listLogin2.sid);
    const serializedSessions = JSON.stringify(sessionsBody);

    assert(
      sessionsRes.status === 200 &&
        currentEntry?.isCurrent === true &&
        otherEntry?.isCurrent === false &&
        typeof currentEntry?.deviceInfo === 'string' &&
        typeof currentEntry?.lastUsedAt === 'string' &&
        typeof currentEntry?.expiresAt === 'string' &&
        typeof currentEntry?.createdAt === 'string' &&
        !serializedSessions.includes('refreshTokenHash') &&
        !serializedSessions.includes(listLogin1.body.refreshToken),
      'GET /api/auth/sessions lists safe metadata, accurate isCurrent flag, and excludes hashes/tokens',
    );

    const badParamRevoke = await fetch(`${baseUrl}/auth/sessions/not-a-uuid`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${listLogin1.body.accessToken}` },
    });
    assert(badParamRevoke.status === 400, 'Non-UUID sessionId returns 400 Bad Request');

    const crossUserRevoke = await fetch(`${baseUrl}/auth/sessions/${userBLogin.sid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${listLogin1.body.accessToken}` },
    });
    assert(
      crossUserRevoke.status === 404,
      'Cross-user session revocation is prevented (returns 404 Not Found)',
    );

    const revokeTargetRes = await fetch(`${baseUrl}/auth/sessions/${listLogin2.sid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${listLogin1.body.accessToken}` },
    });
    const revokedTargetRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: listLogin2.body.refreshToken }),
    });
    assert(
      revokeTargetRes.status === 200 && revokedTargetRefresh.status === 401,
      'Individual session revocation invalidates target session refresh immediately',
    );

    // 7. Logout (Web + Mobile + Idempotency) & Logout-All
    console.log('\n7. Testing Logout (Web Cookie Clearing, Idempotency) & Logout-All...');
    const webLogoutLogin = await webLogin(userAEmail, 'Safari macOS');
    const webLogoutCookies = `${refreshCookieName}=${webLogoutLogin.refreshCookie}; ${csrfCookieName}=${webLogoutLogin.csrfCookie}`;

    const webLogoutBadCsrf = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${webLogoutLogin.body.accessToken}`,
        Origin: allowedOrigin,
        Cookie: webLogoutCookies,
        'X-CSRF-Token': 'mismatched',
      },
    });
    assert(webLogoutBadCsrf.status === 403, 'Web logout rejects invalid CSRF token with 403');

    const webLogoutOk = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${webLogoutLogin.body.accessToken}`,
        Origin: allowedOrigin,
        Cookie: webLogoutCookies,
        'X-CSRF-Token': webLogoutLogin.csrfCookie,
      },
    });
    const webLogoutSetCookies = getSetCookieHeaders(webLogoutOk);
    const webLogoutRepeat = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${webLogoutLogin.body.accessToken}`,
        Origin: allowedOrigin,
        Cookie: webLogoutCookies,
        'X-CSRF-Token': webLogoutLogin.csrfCookie,
      },
    });
    const refreshAfterLogout = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: webLogoutLogin.refreshCookie }),
    });
    const sessionsWithRevokedJwt = await fetch(`${baseUrl}/auth/sessions`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${webLogoutLogin.body.accessToken}` },
    });
    assert(
      webLogoutOk.status === 200 &&
        isCookieClearedHeader(webLogoutSetCookies, refreshCookieName) &&
        isCookieClearedHeader(webLogoutSetCookies, csrfCookieName) &&
        webLogoutRepeat.status === 200 &&
        refreshAfterLogout.status === 401 &&
        sessionsWithRevokedJwt.status === 401,
      'Logout revokes session, clears web cookies, stays idempotent on repeat, and blocks subsequent refresh/session calls',
    );

    const mobileLogoutAllExtra = await mobileLogin(userAEmail, 'Tablet Extra');
    const logoutAllRes = await fetch(`${baseUrl}/auth/logout-all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${listLogin1.body.accessToken}`,
        'X-Client-Type': 'mobile',
      },
    });
    const afterAllRefresh1 = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: listLogin1.body.refreshToken }),
    });
    const afterAllRefresh2 = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
      body: JSON.stringify({ refreshToken: mobileLogoutAllExtra.body.refreshToken }),
    });
    const userBSessionsAfterAll = await fetch(`${baseUrl}/auth/sessions`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${userBLogin.body.accessToken}` },
    });
    assert(
      logoutAllRes.status === 200 &&
        afterAllRefresh1.status === 401 &&
        afterAllRefresh2.status === 401 &&
        userBSessionsAfterAll.status === 200,
      'Logout-all revokes all of User A active sessions without affecting User B sessions',
    );

    // 8. Batched Retention-Safe Cleanup Checks
    console.log('\n8. Testing Scheduled Retention Cleanup & History Preservation...');
    const now = new Date();
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const futureDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const pastDate = new Date(now.getTime() - 1000);

    // Session past cleanup retention BUT with un-expired rotated token history MUST NOT be cascade-deleted
    const protectedOldSession = await prisma.userSession.create({
      data: {
        userId: userAId,
        refreshTokenHash: sha256(`cleanup_protected_${Date.now()}`),
        expiresAt: fortyDaysAgo,
        lastUsedAt: fortyDaysAgo,
        rotatedTokens: {
          create: {
            tokenHash: sha256(`cleanup_history_active_${Date.now()}`),
            expiresAt: futureDate,
          },
        },
      },
    });
    // Session past cleanup retention with expired rotated history MUST be cleaned up cleanly
    const purgeableOldSession = await prisma.userSession.create({
      data: {
        userId: userAId,
        refreshTokenHash: sha256(`cleanup_purgeable_${Date.now()}`),
        expiresAt: fortyDaysAgo,
        revokedAt: fortyDaysAgo,
        lastUsedAt: fortyDaysAgo,
        rotatedTokens: {
          create: {
            tokenHash: sha256(`cleanup_history_expired_${Date.now()}`),
            expiresAt: pastDate,
          },
        },
      },
    });
    const activeSessionStillValid = await prisma.userSession.findUnique({
      where: { id: userBLogin.sid },
    });

    const cleanupReport = await cleanupService.runCleanup(now);
    const protectedAfterCleanup = await prisma.userSession.findUnique({
      where: { id: protectedOldSession.id },
      include: { rotatedTokens: true },
    });
    const purgeableAfterCleanup = await prisma.userSession.findUnique({
      where: { id: purgeableOldSession.id },
    });
    const activeAfterCleanup = await prisma.userSession.findUnique({
      where: { id: userBLogin.sid },
    });

    assert(
      cleanupReport.deletedRotatedTokens >= 1 &&
        cleanupReport.deletedSessions >= 1 &&
        protectedAfterCleanup !== null &&
        protectedAfterCleanup.rotatedTokens.length === 1 &&
        purgeableAfterCleanup === null &&
        activeSessionStillValid !== null &&
        activeAfterCleanup !== null,
      'Retention cleanup deletes expired records in batches while preserving active sessions and retained rotated-token history',
    );

    // 9. Swagger Documentation Check
    console.log('\n9. Testing Swagger Documentation for Refresh, Logout & Session Endpoints...');
    const docsRes = await fetch(`http://localhost:${testPort}/api/docs-json`);
    const docsJson = (await docsRes.json()) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    assert(
      docsRes.status === 200 &&
        docsJson.paths?.['/api/auth/refresh']?.post !== undefined &&
        docsJson.paths?.['/api/auth/logout']?.post !== undefined &&
        docsJson.paths?.['/api/auth/logout-all']?.post !== undefined &&
        docsJson.paths?.['/api/auth/sessions']?.get !== undefined &&
        docsJson.paths?.['/api/auth/sessions/{sessionId}']?.delete !== undefined,
      'Swagger documents /refresh, /logout, /logout-all, /sessions, and /sessions/{sessionId}',
    );
  } finally {
    await prisma.auditLog.deleteMany({
      where: {
        user: { email: { in: testEmails } },
      },
    });
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    await app.close();
  }

  // 10. Dedicated Refresh Rate Limit Enforcement Check
  console.log('\n10. Testing Default Refresh Rate Limit Enforcement...');
  if (origRegLimit !== undefined) process.env.AUTH_REGISTER_THROTTLE_LIMIT = origRegLimit;
  else delete process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  if (origVerifyLimit !== undefined) process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT = origVerifyLimit;
  else delete process.env.AUTH_VERIFY_EMAIL_THROTTLE_LIMIT;
  if (origLoginLimit !== undefined) process.env.AUTH_LOGIN_THROTTLE_LIMIT = origLoginLimit;
  else delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
  if (origRefreshLimit !== undefined) process.env.AUTH_REFRESH_THROTTLE_LIMIT = origRefreshLimit;
  else delete process.env.AUTH_REFRESH_THROTTLE_LIMIT;

  const rlApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(rlApp, { enableLoggingInterceptor: false });
  await rlApp.listen(3092);

  try {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const r = await fetch('http://localhost:3092/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' },
        body: JSON.stringify({ refreshToken: 'a'.repeat(64) }),
      });
      statuses.push(r.status);
    }
    assert(
      statuses.slice(0, 20).every((s) => s === 401),
      'First 20 refresh requests pass throttler (401 invalid token)',
      `Statuses: ${statuses.slice(0, 20).join(', ')}`,
    );
    assert(
      statuses[20] === 429,
      '21st refresh request returns 429 Too Many Requests',
      `Status: ${statuses[20]}`,
    );
  } finally {
    await rlApp.close();
  }

  console.log('\n--- Auth Sessions & Refresh Rotation Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during auth sessions test run:', err);
  process.exit(1);
});
