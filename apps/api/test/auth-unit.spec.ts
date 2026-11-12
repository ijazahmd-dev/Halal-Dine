import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  parseCorsOrigins,
  resolveExpressTrustProxy,
  validateEnv,
} from '../src/common/config/env.validation';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { TokenCryptoService } from '../src/modules/auth/services/token-crypto.service';
import { EmailDeliveryError, MailService } from '../src/modules/mail/mail.service';

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

async function runUnitTests() {
  console.log('\n--- Starting Halal Dine Auth Unit Test Suite ---\n');

  // 1. PasswordService tests
  console.log('1. Testing PasswordService...');
  const passwordService = new PasswordService();
  const hash = await passwordService.hash('StrongP@ss2026!');
  assert(hash.startsWith('$argon2id$'), 'Hashes password using Argon2id');
  assert(
    (await passwordService.verify(hash, 'StrongP@ss2026!')) === true,
    'Verifies matching password cleanly',
  );
  assert(
    (await passwordService.verify(hash, 'WrongPassword!')) === false,
    'Rejects incorrect password cleanly',
  );
  assert(
    (await passwordService.verify('not-a-valid-argon2-hash', 'anything')) === false,
    'Handles malformed hash safely without throwing',
  );

  // 2. TokenCryptoService tests
  console.log('\n2. Testing TokenCryptoService...');
  const tokenCrypto = new TokenCryptoService();
  const tokenA = tokenCrypto.generateOpaqueToken(32);
  const tokenB = tokenCrypto.generateOpaqueToken(32);
  assert(
    tokenA.rawToken.length === 64 && /^[a-f0-9]{64}$/.test(tokenA.rawToken),
    'Generates 256-bit hex opaque token',
  );
  assert(tokenA.rawToken !== tokenB.rawToken, 'Generates distinct random tokens per call');
  assert(
    tokenA.tokenHash === tokenCrypto.hashToken(tokenA.rawToken) &&
      tokenA.tokenHash !== tokenA.rawToken,
    'SHA-256 hash matches deterministically and differs from raw token',
  );

  // 3. MailService transport lifecycle & template tests
  console.log('\n3. Testing MailService (Console, Disabled, Pooled SMTP)...');
  const consoleMailService = new MailService(
    new ConfigService({
      EMAIL_PROVIDER: 'console',
      EMAIL_VERIFICATION_URL_BASE: 'not-a-url-if-unused',
    }),
  );
  await consoleMailService.onModuleInit();
  await consoleMailService.sendVerificationEmail({
    userId: 'u-1',
    to: 'user@example.com',
    name: 'Test',
    rawToken: 'raw-token',
    expiryHours: 24,
  });
  assert(
    true,
    'Console provider succeeds without building verification URL or requiring valid base URL',
  );

  const disabledMailService = new MailService(
    new ConfigService({
      EMAIL_PROVIDER: 'disabled',
      EMAIL_VERIFICATION_URL_BASE: 'not-a-url-if-unused',
    }),
  );
  await disabledMailService.onModuleInit();
  await disabledMailService.sendVerificationEmail({
    userId: 'u-2',
    to: 'user@example.com',
    name: 'Test',
    rawToken: 'raw-token',
    expiryHours: 24,
  });
  assert(true, 'Disabled provider skips cleanly without URL building');

  // Test pooled SMTP transporter reuse & lifecycle using nodemailer mock
  let createTransportCalls = 0;
  let verifyCalls = 0;
  let sendMailCalls = 0;
  let closeCalls = 0;
  let capturedTransportConfig: Record<string, unknown> | undefined;
  const capturedMailPayloads: Array<Record<string, unknown>> = [];

  const originalCreateTransport = nodemailer.createTransport;
  (nodemailer as unknown as { createTransport: unknown }).createTransport = (
    cfg: Record<string, unknown>,
  ) => {
    createTransportCalls += 1;
    capturedTransportConfig = cfg;
    return {
      verify: async () => {
        verifyCalls += 1;
        return true;
      },
      sendMail: async (mail: Record<string, unknown>) => {
        sendMailCalls += 1;
        capturedMailPayloads.push(mail);
        return { messageId: 'mock-id' };
      },
      close: () => {
        closeCalls += 1;
      },
    };
  };

  try {
    const smtpMailService = new MailService(
      new ConfigService({
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'mailer',
        SMTP_PASS: 'super-secret-pass',
        EMAIL_FROM: 'Halal Dine <noreply@halaldine.in>',
        EMAIL_VERIFICATION_URL_BASE: 'https://halaldine.in/verify-email',
      }),
    );

    await smtpMailService.onModuleInit();
    await smtpMailService.sendVerificationEmail({
      userId: 'u-3',
      to: 'a@example.com',
      name: 'Alice <script>',
      rawToken: 'tok-1',
      expiryHours: 24,
    });
    await smtpMailService.sendVerificationEmail({
      userId: 'u-4',
      to: 'b@example.com',
      name: 'Bob',
      rawToken: 'tok-2',
      expiryHours: 24,
    });
    smtpMailService.onModuleDestroy();

    assert(
      createTransportCalls === 1,
      'SMTP transporter initialized once and reused across sends',
      `createTransportCalls=${createTransportCalls}`,
    );
    assert(verifyCalls === 1, 'SMTP transporter verified once during onModuleInit');
    assert(sendMailCalls === 2, 'Two emails sent via pooled transporter');
    assert(closeCalls === 1, 'SMTP transporter closed cleanly onModuleDestroy');
    assert(capturedTransportConfig?.pool === true, 'Nodemailer connection pooling enabled');
    assert(
      typeof capturedMailPayloads[0]?.html === 'string' &&
        capturedMailPayloads[0].html.includes('Alice &lt;script&gt;') &&
        capturedMailPayloads[0].html.includes('https://halaldine.in/verify-email?token=tok-1') &&
        typeof capturedMailPayloads[1]?.html === 'string' &&
        capturedMailPayloads[1].html.includes('https://halaldine.in/verify-email?token=tok-2'),
      'Template escapes HTML in name and includes verification link',
    );
  } finally {
    (nodemailer as unknown as { createTransport: unknown }).createTransport =
      originalCreateTransport;
  }

  // Test SMTP startup failure handling
  (nodemailer as unknown as { createTransport: unknown }).createTransport = () => ({
    verify: async () => {
      throw new Error('ECONNREFUSED');
    },
    sendMail: async () => ({}),
    close: () => {},
  });
  try {
    const brokenSmtpMail = new MailService(
      new ConfigService({
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.unreachable.local',
      }),
    );
    let startupThrew = false;
    try {
      await brokenSmtpMail.onModuleInit();
    } catch (err) {
      startupThrew = err instanceof EmailDeliveryError;
    }
    assert(startupThrew === true, 'MailService throws EmailDeliveryError when SMTP verify fails');
  } finally {
    (nodemailer as unknown as { createTransport: unknown }).createTransport =
      originalCreateTransport;
  }

  // 4. Environment Validation tests
  console.log('\n4. Testing Startup Environment Validation (env.validation.ts)...');
  const validDev = validateEnv({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/halal_dine?schema=public',
  });
  assert(
    validDev.NODE_ENV === 'development' &&
      validDev.PORT === 3001 &&
      validDev.CORS_ORIGIN === 'http://localhost:3000' &&
      validDev.TRUST_PROXY === 'false',
    'Applies secure development defaults cleanly',
  );

  // Reject wildcard CORS
  let rejectedWildcard = false;
  try {
    validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/halal_dine',
      CORS_ORIGIN: '*',
    });
  } catch {
    rejectedWildcard = true;
  }
  assert(rejectedWildcard === true, 'Rejects wildcard "*" CORS_ORIGIN alongside credentials');

  // Reject TRUST_PROXY=true
  let rejectedUnsafeProxy = false;
  try {
    validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/halal_dine',
      TRUST_PROXY: 'true',
    });
  } catch {
    rejectedUnsafeProxy = true;
  }
  assert(rejectedUnsafeProxy === true, 'Rejects blind TRUST_PROXY=true');
  assert(resolveExpressTrustProxy('1') === 1, 'Resolves numeric hop TRUST_PROXY=1');
  assert(
    resolveExpressTrustProxy('loopback') === 'loopback',
    'Resolves trusted preset TRUST_PROXY=loopback',
  );
  assert(
    parseCorsOrigins('https://halaldine.in, https://admin.halaldine.in').length === 2,
    'Parses comma-separated CORS origins cleanly',
  );

  // Production checks: requires JWT_SECRET (min 32), explicit CORS_ORIGIN, SMTP creds when smtp
  let prodMissingJwtFailed = false;
  let secretLeakedInError = false;
  try {
    validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:MY_SECRET_DB_PASSWORD@localhost:5433/halal_dine',
      CORS_ORIGIN: 'https://halaldine.in',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      EMAIL_FROM: 'noreply@halaldine.in',
      EMAIL_VERIFICATION_URL_BASE: 'https://halaldine.in/verify-email',
      JWT_SECRET: 'TOO_SHORT_LEAK_TOKEN_TEST',
      JWT_ACCESS_TOKEN_EXPIRY: '15m',
      JWT_ISSUER: 'halal-dine-api',
      JWT_AUDIENCE: 'halal-dine-clients',
    });
  } catch (err) {
    prodMissingJwtFailed = true;
    const msg = err instanceof Error ? err.message : '';
    secretLeakedInError =
      msg.includes('TOO_SHORT_LEAK_TOKEN_TEST') || msg.includes('MY_SECRET_DB_PASSWORD');
  }
  assert(
    prodMissingJwtFailed === true,
    'Rejects invalid production configuration (short JWT_SECRET & missing SMTP auth)',
  );
  assert(
    secretLeakedInError === false,
    'Validation error message never exposes environment variable values',
  );

  const validProd = validateEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://postgres:pass@db.internal:5432/halal_dine',
    CORS_ORIGIN: 'https://halaldine.in,https://admin.halaldine.in',
    TRUST_PROXY: '1',
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.resend.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'resend',
    SMTP_PASS: 're_secret_key',
    EMAIL_FROM: 'Halal Dine <noreply@halaldine.in>',
    EMAIL_VERIFICATION_URL_BASE: 'https://halaldine.in/verify-email',
    JWT_SECRET: 'a_very_long_production_jwt_secret_key_at_least_32_bytes',
    JWT_ACCESS_TOKEN_EXPIRY: '15m',
    JWT_ISSUER: 'halal-dine-api',
    JWT_AUDIENCE: 'halal-dine-clients',
  });
  assert(
    validProd.NODE_ENV === 'production' && validProd.SMTP_PORT === 465,
    'Accepts valid full production configuration',
  );

  console.log('\n--- Auth Unit Test Verification Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runUnitTests().catch((err) => {
  console.error('Fatal error during unit test run:', err);
  process.exit(1);
});
