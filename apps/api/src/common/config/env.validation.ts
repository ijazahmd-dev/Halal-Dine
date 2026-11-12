import { z } from '@halal-dine/validation';

const TRUST_PROXY_KEYWORDS = new Set(['false', 'loopback', 'linklocal', 'uniquelocal']);
const IPV4_OR_CIDR_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/;

export function isValidTrustProxyValue(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'true') {
    return false;
  }
  if (TRUST_PROXY_KEYWORDS.has(trimmed)) {
    return true;
  }
  if (/^\d+$/.test(trimmed)) {
    const hops = Number(trimmed);
    return Number.isInteger(hops) && hops >= 0 && hops <= 10;
  }
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .every(
      (part) =>
        part.length > 0 &&
        (TRUST_PROXY_KEYWORDS.has(part.toLowerCase()) || IPV4_OR_CIDR_REGEX.test(part)),
    );
}

export function resolveExpressTrustProxy(
  raw: string | undefined,
): boolean | number | string | string[] {
  const trimmed = (raw ?? 'false').trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'false' || lower === '0') {
    return false;
  }
  if (/^\d+$/.test(lower)) {
    return Number(lower);
  }
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return trimmed;
}

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const optionalPositiveInt = (defaultVal: number, maxVal = 86_400_000) =>
  z.preprocess(
    (val) => (val === '' || val === undefined ? defaultVal : val),
    z.coerce
      .number({ invalid_type_error: 'Must be a valid number' })
      .int('Must be an integer')
      .min(1, 'Must be at least 1')
      .max(maxVal, `Must not exceed ${maxVal}`),
  );

const optionalNonEmpty = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().trim().min(1, 'Must not be empty').optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'], {
        message: 'Must be development, test, or production',
      })
      .default('development'),
    PORT: optionalPositiveInt(3001, 65535),
    API_PREFIX: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? 'api' : val),
      z.string().trim().min(1).default('api'),
    ),

    DATABASE_URL: z
      .string({ required_error: 'Required' })
      .trim()
      .refine(
        (val) => val.startsWith('postgresql://') || val.startsWith('postgres://'),
        'Must be a valid PostgreSQL connection string',
      ),

    CORS_ORIGIN: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().trim().optional(),
    ),
    TRUST_PROXY: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? 'false' : val),
      z
        .string()
        .trim()
        .default('false')
        .refine(
          isValidTrustProxyValue,
          'Must be false, a hop count (0-10), or a trusted proxy preset/IP/CIDR (true is disallowed)',
        ),
    ),

    // Mail & Email Verification
    EMAIL_PROVIDER: z
      .enum(['smtp', 'console', 'disabled'], {
        message: 'Must be smtp, console, or disabled',
      })
      .default('console'),
    EMAIL_FROM: optionalNonEmpty,
    EMAIL_VERIFICATION_URL_BASE: optionalNonEmpty,
    EMAIL_VERIFICATION_EXPIRY_HOURS: optionalPositiveInt(24, 168),

    SMTP_HOST: optionalNonEmpty,
    SMTP_PORT: optionalPositiveInt(587, 65535),
    SMTP_SECURE: z
      .enum(['true', 'false'], {
        message: 'Must be true or false',
      })
      .default('false'),
    SMTP_USER: optionalNonEmpty,
    SMTP_PASS: optionalNonEmpty,

    // Rate Limiting
    THROTTLE_TTL_MS: optionalPositiveInt(60000),
    THROTTLE_LIMIT: optionalPositiveInt(60),
    AUTH_REGISTER_THROTTLE_LIMIT: optionalPositiveInt(5),
    AUTH_REGISTER_THROTTLE_TTL_MS: optionalPositiveInt(60000),
    AUTH_VERIFY_EMAIL_THROTTLE_LIMIT: optionalPositiveInt(10),
    AUTH_VERIFY_EMAIL_THROTTLE_TTL_MS: optionalPositiveInt(60000),
    RESEND_VERIFICATION_THROTTLE_LIMIT: optionalPositiveInt(3),
    RESEND_VERIFICATION_THROTTLE_TTL_MS: optionalPositiveInt(60000),

    // Prepared JWT Configuration (Task 4)
    JWT_SECRET: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().min(32, 'Must be at least 32 characters').optional(),
    ),
    JWT_ACCESS_TOKEN_EXPIRY: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z
        .string()
        .trim()
        .regex(/^\d+(s|m|h|d)$/, 'Must be a duration string such as 15m or 1h')
        .optional(),
    ),
    JWT_ISSUER: optionalNonEmpty,
    JWT_AUDIENCE: optionalNonEmpty,
  })
  .superRefine((env, ctx) => {
    const isProd = env.NODE_ENV === 'production';

    // CORS validation: wildcard '*' is strictly disallowed alongside credentials
    const rawCors = env.CORS_ORIGIN ?? (isProd ? undefined : 'http://localhost:3000');
    if (!rawCors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'Required in production',
      });
    } else {
      const origins = parseCorsOrigins(rawCors);
      if (origins.length === 0 || origins.some((o) => o === '*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'Wildcard "*" is not permitted with credentialed CORS requests',
        });
      } else if (!origins.every(isValidHttpUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'All origins must be valid HTTP or HTTPS URLs',
        });
      }
    }

    // SMTP provider requirements
    if (env.EMAIL_PROVIDER === 'smtp') {
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_HOST'],
          message: 'Required when EMAIL_PROVIDER is smtp',
        });
      }
      if (!env.EMAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'Required when EMAIL_PROVIDER is smtp',
        });
      }
      if (!env.EMAIL_VERIFICATION_URL_BASE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_VERIFICATION_URL_BASE'],
          message: 'Required when EMAIL_PROVIDER is smtp',
        });
      }
      if ((env.SMTP_USER && !env.SMTP_PASS) || (!env.SMTP_USER && env.SMTP_PASS)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [env.SMTP_USER ? 'SMTP_PASS' : 'SMTP_USER'],
          message: 'SMTP_USER and SMTP_PASS must both be provided together',
        });
      }
      if (isProd && (!env.SMTP_USER || !env.SMTP_PASS)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_USER'],
          message: 'SMTP authentication credentials are required in production',
        });
      }
    }

    if (env.EMAIL_VERIFICATION_URL_BASE && !isValidHttpUrl(env.EMAIL_VERIFICATION_URL_BASE)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_VERIFICATION_URL_BASE'],
        message: 'Must be a valid HTTP or HTTPS URL',
      });
    }

    // Production JWT checks (prepared for Task 4; no hardcoded fallback secret)
    if (isProd) {
      for (const key of [
        'JWT_SECRET',
        'JWT_ACCESS_TOKEN_EXPIRY',
        'JWT_ISSUER',
        'JWT_AUDIENCE',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'Required in production',
          });
        }
      }
    }
  });

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Validates environment configuration at startup without exposing raw secret or config values.
 */
export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const safeIssues = result.error.issues.map((issue) => {
      const key = issue.path.length > 0 ? issue.path.join('.') : 'ENV';
      return `${key}: ${issue.message}`;
    });
    throw new Error(`Invalid environment configuration -> ${safeIssues.join('; ')}`);
  }

  return {
    ...result.data,
    CORS_ORIGIN:
      result.data.CORS_ORIGIN ??
      (result.data.NODE_ENV === 'production' ? '' : 'http://localhost:3000'),
    EMAIL_FROM: result.data.EMAIL_FROM ?? 'Halal Dine <noreply@halaldine.in>',
    EMAIL_VERIFICATION_URL_BASE:
      result.data.EMAIL_VERIFICATION_URL_BASE ?? 'http://localhost:3000/verify-email',
    JWT_ACCESS_TOKEN_EXPIRY: result.data.JWT_ACCESS_TOKEN_EXPIRY ?? '15m',
    JWT_ISSUER: result.data.JWT_ISSUER ?? 'halal-dine-api',
    JWT_AUDIENCE: result.data.JWT_AUDIENCE ?? 'halal-dine-clients',
  };
}
