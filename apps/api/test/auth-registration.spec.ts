import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { loginUserSchema, registerUserSchema } from '@halal-dine/validation';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
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

async function runTests() {
  console.log('\n--- Starting Halal Dine Registration API Verification Suite ---\n');

  const testDbUrl = await ensureIsolatedTestDatabase();
  assert(testDbUrl.includes('_test'), 'Tests isolated to *_test database (protects dev database)');

  // Allow enough requests for the functional test suite before testing strict rate limiting separately
  const originalRegLimit = process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  const originalTrustProxy = process.env.TRUST_PROXY;
  process.env.AUTH_REGISTER_THROTTLE_LIMIT = '30';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  const { apiPrefix } = configureApp(app, { enableLoggingInterceptor: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Halal Dine API')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const testPort = 3099;
  await app.listen(testPort);
  const baseUrl = `http://localhost:${testPort}/${apiPrefix}`;

  const prisma = app.get(PrismaService);
  const testEmails = [
    'test_shafeeq@halaldine.com',
    'mixed.case@halaldine.com',
    'nophone@halaldine.com',
    'blankphone@halaldine.com',
    'whitespacephone@halaldine.com',
  ];

  // Clean up any previous test records
  await prisma.user.deleteMany({
    where: { email: { in: testEmails } },
  });

  try {
    // 1. Happy Path Registration + Helmet & CORS Security Headers
    console.log('\n1. Testing Happy Path Registration & HTTP Security Middleware...');
    const regPayload = {
      name: 'Mohammed Shafeeq',
      email: 'test_shafeeq@halaldine.com',
      password: 'StrongP@ssw0rd2026!',
      phone: '+919876543210',
    };

    const res1 = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify(regPayload),
    });

    const data1 = await res1.json();
    assert(res1.status === 201, 'Status is 201 Created', `Got ${res1.status}`);
    assert(
      res1.headers.get('x-content-type-options') === 'nosniff',
      'Helmet sets X-Content-Type-Options: nosniff',
    );
    assert(
      res1.headers.get('access-control-allow-origin') === 'http://localhost:3000' &&
        res1.headers.get('access-control-allow-credentials') === 'true',
      'CORS allows configured trusted origin with credentials',
    );
    assert(data1.name === 'Mohammed Shafeeq', 'Name matches input');
    assert(data1.email === 'test_shafeeq@halaldine.com', 'Email matches input');
    assert(data1.phone === '+919876543210', 'Phone matches input');
    assert(data1.role === 'CUSTOMER', 'Role defaults to CUSTOMER');
    assert(data1.status === 'ACTIVE', 'Status defaults to ACTIVE');
    assert(data1.isEmailVerified === false, 'isEmailVerified is false');
    assert(data1.isPhoneVerified === false, 'isPhoneVerified is false');
    assert(!('passwordHash' in data1), 'Response strictly omits passwordHash');
    assert(!('password' in data1), 'Response strictly omits plaintext password');
    assert(typeof data1.id === 'string' && data1.id.length > 10, 'Valid UUID id returned');

    // Untrusted CORS Origin check
    const untrustedCorsRes = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { Origin: 'https://untrusted-attacker.example.com' },
    });
    assert(
      untrustedCorsRes.headers.get('access-control-allow-origin') === null,
      'CORS does not allow untrusted origin',
    );

    // Verify Password Hashing in Database
    const dbUser = await prisma.user.findUnique({ where: { id: data1.id } });
    assert(dbUser !== null, 'User exists in database');
    assert(
      dbUser?.passwordHash.startsWith('$argon2id$') === true,
      'Password hashed with Argon2id',
      `Hash: ${dbUser?.passwordHash.substring(0, 29)}...`,
    );
    const passwordValid = await argon2.verify(dbUser!.passwordHash, 'StrongP@ssw0rd2026!');
    assert(passwordValid === true, 'Argon2id hash verifies against raw password');

    // 2. Email Normalization (trim & lowercase)
    console.log('\n2. Testing Email Normalization (trim and lowercase)...');
    const resNorm = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mixed Case User',
        email: '   MIXED.Case@HalalDine.COM   ',
        password: 'ValidP@ssw0rd123!',
      }),
    });
    const dataNorm = await resNorm.json();
    assert(resNorm.status === 201, 'Normalized email registration succeeds with 201');
    assert(
      dataNorm.email === 'mixed.case@halaldine.com',
      'Email stored and returned in trimmed lowercase format',
      `Got: ${dataNorm.email}`,
    );

    // 3. Optional / Blank / Whitespace Phone Handling
    console.log('\n3. Testing Registration with Omitted, Empty & Whitespace Phone...');
    const resNoPhone = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'No Phone User',
        email: 'nophone@halaldine.com',
        password: 'ValidP@ssw0rd123!',
      }),
    });
    const dataNoPhone = await resNoPhone.json();
    assert(resNoPhone.status === 201, 'Registration without phone succeeds with 201');
    assert(dataNoPhone.phone === null, 'Phone is null when omitted');

    const resBlankPhone = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Blank Phone User',
        email: 'blankphone@halaldine.com',
        password: 'ValidP@ssw0rd123!',
        phone: '',
      }),
    });
    const dataBlankPhone = await resBlankPhone.json();
    assert(resBlankPhone.status === 201, 'Registration with empty phone string succeeds with 201');
    assert(dataBlankPhone.phone === null, 'Empty phone string persisted as null');

    const resWhitespacePhone = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Whitespace Phone User',
        email: 'whitespacephone@halaldine.com',
        password: 'ValidP@ssw0rd123!',
        phone: '   ',
      }),
    });
    const dataWhitespacePhone = await resWhitespacePhone.json();
    assert(
      resWhitespacePhone.status === 201,
      'Registration with whitespace-only phone succeeds with 201',
    );
    assert(dataWhitespacePhone.phone === null, 'Whitespace-only phone persisted as null');

    const directParsedPhone = registerUserSchema.parse({
      name: 'Direct User',
      email: 'direct@example.com',
      password: 'ValidP@ssw0rd123!',
      phone: '   ',
    });
    assert(
      directParsedPhone.phone === undefined,
      'registerUserSchema transforms whitespace-only phone directly to undefined',
    );

    const parsedLogin = loginUserSchema.parse({
      email: '  LOGIN.User@HalalDine.COM ',
      password: 'AnyPassword',
    });
    assert(
      parsedLogin.email === 'login.user@halaldine.com',
      'loginUserSchema trims and lowercases email',
    );

    // 4. Duplicate Email Rejection
    console.log('\n4. Testing Duplicate Email Rejection...');
    const resDupEmail = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Another User',
        email: 'test_shafeeq@halaldine.com',
        password: 'AnotherP@ssw0rd123!',
      }),
    });
    const dataDupEmail = await resDupEmail.json();
    assert(resDupEmail.status === 409, 'Duplicate email rejected with 409 Conflict');
    assert(
      typeof dataDupEmail.message === 'string' &&
        dataDupEmail.message.toLowerCase().includes('email'),
      'Conflict error mentions email',
      JSON.stringify(dataDupEmail.message),
    );

    // 5. Duplicate Phone Rejection
    console.log('\n5. Testing Duplicate Phone Rejection...');
    const resDupPhone = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Different Email User',
        email: 'different_email@halaldine.com',
        password: 'DifferentP@ssw0rd123!',
        phone: '+919876543210',
      }),
    });
    const dataDupPhone = await resDupPhone.json();
    assert(resDupPhone.status === 409, 'Duplicate phone rejected with 409 Conflict');
    assert(
      typeof dataDupPhone.message === 'string' &&
        dataDupPhone.message.toLowerCase().includes('phone'),
      'Conflict error mentions phone',
      JSON.stringify(dataDupPhone.message),
    );

    // 6. Password Strength, Input Validation & Unknown Field Rejection
    console.log('\n6. Testing Password Strength, Phone Format & Unknown Field Rejection...');

    const resUnknownField = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Privilege Escalation Attempt',
        email: 'attacker@halaldine.com',
        password: 'ValidP@ssw0rd123!',
        role: 'ADMIN',
      }),
    });
    assert(
      resUnknownField.status === 400,
      'Rejects unknown fields such as role: ADMIN (400 Bad Request)',
    );

    const resInvalidPhone = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid Phone',
        email: 'badphone@example.com',
        password: 'ValidP@ssw0rd123!',
        phone: '12345',
      }),
    });
    assert(resInvalidPhone.status === 400, 'Rejects invalid phone format (400)');

    const resShort = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        email: 'shortpass@example.com',
        password: 'Pass1!',
      }),
    });
    assert(resShort.status === 400, 'Rejects password shorter than 8 chars (400)');

    const resNoUpper = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        email: 'noupper@example.com',
        password: 'password123!',
      }),
    });
    assert(resNoUpper.status === 400, 'Rejects password without uppercase letter (400)');

    const resNoNum = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        email: 'nonum@example.com',
        password: 'Password!',
      }),
    });
    assert(resNoNum.status === 400, 'Rejects password without digit (400)');

    const resNoSpec = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        email: 'nospec@example.com',
        password: 'Password123',
      }),
    });
    assert(resNoSpec.status === 400, 'Rejects password without special character (400)');

    const resBadEmail = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        email: 'not-an-email',
        password: 'ValidP@ssw0rd123!',
      }),
    });
    assert(resBadEmail.status === 400, 'Rejects invalid email format (400)');

    const resShortName = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A',
        email: 'valid@example.com',
        password: 'ValidP@ssw0rd123!',
      }),
    });
    assert(resShortName.status === 400, 'Rejects name shorter than 2 chars (400)');

    // 7. Global Exception Filter 500 Sanitization Check
    console.log('\n7. Testing Global Exception Filter 500 Sanitization...');
    const authService = app.get(AuthService);
    const originalRegister = authService.register.bind(authService);
    authService.register = async () => {
      throw new Error('SENSITIVE_INTERNAL_DB_URI_OR_SECRET');
    };
    const res500 = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Crash Test',
        email: 'crash@halaldine.com',
        password: 'ValidP@ssw0rd123!',
      }),
    });
    const body500 = await res500.json();
    authService.register = originalRegister;
    assert(res500.status === 500, 'Unexpected service exception returns 500');
    assert(
      body500.message === 'Internal server error' &&
        !JSON.stringify(body500).includes('SENSITIVE_INTERNAL_DB_URI_OR_SECRET'),
      'HTTP 500 hides raw internal error message and returns generic message',
      `Got: ${JSON.stringify(body500)}`,
    );

    // 8. Swagger Documentation Verification
    console.log('\n8. Testing Swagger Documentation Integration...');
    const swaggerDoc = document.paths['/api/auth/register'];
    assert(swaggerDoc !== undefined, 'Swagger paths include /api/auth/register');
    assert(swaggerDoc?.post !== undefined, 'Swagger includes POST /api/auth/register');
    assert(swaggerDoc?.post?.responses?.['201'] !== undefined, 'Swagger documents 201 response');
    assert(swaggerDoc?.post?.responses?.['400'] !== undefined, 'Swagger documents 400 response');
    assert(swaggerDoc?.post?.responses?.['409'] !== undefined, 'Swagger documents 409 response');
    assert(swaggerDoc?.post?.responses?.['429'] !== undefined, 'Swagger documents 429 response');

    // Clean up test users created
    console.log('\n9. Cleaning Up Test Data...');
    await prisma.user.deleteMany({
      where: { email: { in: testEmails } },
    });
    console.log('  ✓ Test users purged from test database');
  } finally {
    await app.close();
  }

  // 10. Dedicated Registration Rate Limiting & Proxy Awareness Check (default limit = 5)
  console.log('\n10. Testing Registration Rate Limiting & Trust Proxy IP Extraction...');
  if (originalRegLimit !== undefined) {
    process.env.AUTH_REGISTER_THROTTLE_LIMIT = originalRegLimit;
  } else {
    delete process.env.AUTH_REGISTER_THROTTLE_LIMIT;
  }
  process.env.TRUST_PROXY = '1';

  const rlApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  rlApp.get(ConfigService).set('TRUST_PROXY', '1');
  configureApp(rlApp, { enableLoggingInterceptor: false });
  await rlApp.listen(3097);

  try {
    const clientAStatuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch('http://localhost:3097/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({ name: 'A' }),
      });
      clientAStatuses.push(r.status);
    }
    assert(
      clientAStatuses.slice(0, 5).every((s) => s === 400),
      'First 5 registration requests from client IP 203.0.113.10 pass throttler',
      `Statuses: ${clientAStatuses.join(', ')}`,
    );
    assert(
      clientAStatuses[5] === 429,
      '6th registration request from client IP 203.0.113.10 triggers 429',
      `Status: ${clientAStatuses[5]}`,
    );

    // Different client IP behind proxy still has its own fresh quota
    const clientBRes = await fetch('http://localhost:3097/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.11',
      },
      body: JSON.stringify({ name: 'A' }),
    });
    assert(
      clientBRes.status === 400,
      'Distinct client IP 203.0.113.11 behind proxy has independent throttle quota',
      `Status: ${clientBRes.status}`,
    );
  } finally {
    if (originalTrustProxy !== undefined) {
      process.env.TRUST_PROXY = originalTrustProxy;
    } else {
      delete process.env.TRUST_PROXY;
    }
    await rlApp.close();
  }

  // Summary
  console.log('\n--- Test Verification Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total tests: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
