import { z, ZodSchema, ZodError } from 'zod';
import { HalalVerificationStatus } from '@halal-dine/contracts';

export { z, ZodSchema, ZodError };

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const nearbySearchQuerySchema = paginationQuerySchema.extend({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().min(100).max(50000).default(5000),
  halalStatus: z.nativeEnum(HalalVerificationStatus).optional(),
  district: z.string().optional(),
  query: z.string().trim().optional(),
});

export const registerUserSchema = z
  .object({
    name: z
      .string({ required_error: 'Name is required' })
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name must not exceed 100 characters'),
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .email('Invalid email address')
      .max(255, 'Email must not exceed 255 characters'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(8, 'Password must be at least 8 characters')
      .max(100, 'Password must not exceed 100 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    phone: z.preprocess(
      (val) => {
        if (val === undefined || val === null) return undefined;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length === 0 ? undefined : trimmed;
        }
        return val;
      },
      z
        .string({ invalid_type_error: 'Phone number must be a string' })
        .regex(/^\+?[1-9]\d{7,14}$/, 'Phone number must be a valid format (e.g. +919876543210)')
        .optional(),
    ),
  })
  .strict();

export const loginUserSchema = z
  .object({
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .email('Invalid email address')
      .max(255, 'Email must not exceed 255 characters'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password is required')
      .max(100, 'Password must not exceed 100 characters'),
  })
  .strict();

export const verifyEmailSchema = z
  .object({
    token: z
      .string({ required_error: 'Verification token is required' })
      .trim()
      .min(1, 'Verification token is required')
      .max(512, 'Invalid verification token format'),
  })
  .strict();

export const resendVerificationSchema = z
  .object({
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .email('Invalid email address')
      .max(255, 'Email must not exceed 255 characters'),
  })
  .strict();

export type CoordinatesInput = z.infer<typeof coordinatesSchema>;
export type NearbySearchQueryInput = z.infer<typeof nearbySearchQuerySchema>;
export type RegisterUserInput = z.infer<typeof registerUserSchema>;
export type LoginUserInput = z.infer<typeof loginUserSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
