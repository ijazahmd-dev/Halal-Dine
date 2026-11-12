import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';

function loadBaseDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const candidateEnvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];

  for (const envPath of candidateEnvPaths) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
      if (match?.[1]) {
        return match[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  throw new Error('DATABASE_URL or TEST_DATABASE_URL must be configured to run API tests');
}

function resolveApiDir(): string {
  let current = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(current, 'prisma', 'schema.prisma'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

export async function ensureIsolatedTestDatabase(): Promise<string> {
  const baseUrl = loadBaseDatabaseUrl();
  const parsed = new URL(baseUrl);
  const currentDbName = parsed.pathname.replace(/^\//, '');

  const testDbName = process.env.TEST_DATABASE_URL
    ? currentDbName
    : currentDbName.endsWith('_test')
      ? currentDbName
      : `${currentDbName}_test`;

  if (!testDbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive test suite against non-test database "${testDbName}". Suffix test DB name with "_test".`,
    );
  }

  parsed.pathname = `/${testDbName}`;
  const testDbUrl = parsed.toString();

  // Connect to maintenance "postgres" database to ensure isolated test DB exists
  const adminUrl = new URL(testDbUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  const adminClient = new PrismaClient({
    datasources: { db: { url: adminUrl.toString() } },
  });

  try {
    const existing = await adminClient.$queryRawUnsafe<Array<{ exists: number }>>(
      `SELECT 1 AS exists FROM pg_database WHERE datname = '${testDbName.replace(/'/g, "''")}'`,
    );
    if (existing.length === 0) {
      await adminClient.$executeRawUnsafe(`CREATE DATABASE "${testDbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminClient.$disconnect();
  }

  // Ensure PostGIS extension exists on the test DB (safe no-op if inherited from template1)
  const testAdminClient = new PrismaClient({
    datasources: { db: { url: testDbUrl } },
  });
  try {
    await testAdminClient.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS postgis;');
  } finally {
    await testAdminClient.$disconnect();
  }

  // Apply all Prisma migrations to the isolated test DB
  const apiDir = resolveApiDir();
  const prismaBin = path.resolve(apiDir, 'node_modules/.bin/prisma');
  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = testDbUrl;
  return testDbUrl;
}
