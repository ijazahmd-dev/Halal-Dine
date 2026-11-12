import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthenticatedAuthContext {
  userId: string;
  sessionId: string;
  jti: string;
}

export const ALLOW_REVOKED_SESSION_KEY = 'allow_revoked_session';

/**
 * Allows idempotent endpoints (such as POST /api/auth/logout) to execute
 * when the bearer JWT signature is valid even if the session was already revoked.
 */
export const AllowRevokedSession = () => SetMetadata(ALLOW_REVOKED_SESSION_KEY, true);

/**
 * Extracts verified user/session identity attached by JwtAuthGuard.
 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAuthContext => {
    const request = ctx.switchToHttp().getRequest<{ auth: AuthenticatedAuthContext }>();
    return request.auth;
  },
);
