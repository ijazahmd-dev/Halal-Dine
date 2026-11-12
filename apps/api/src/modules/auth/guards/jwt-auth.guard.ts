import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@halal-dine/contracts';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import {
  ALLOW_REVOKED_SESSION_KEY,
  AuthenticatedAuthContext,
} from '../decorators/current-auth.decorator';

interface JwtAccessPayload {
  sub?: unknown;
  sid?: unknown;
  jti?: unknown;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { auth?: AuthenticatedAuthContext }>();

    const rawAuthHeader = request.headers.authorization;
    const token = this.extractBearerToken(rawAuthHeader);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: JwtAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        issuer: this.configService.get<string>('JWT_ISSUER', 'halal-dine-api'),
        audience: this.configService.get<string>('JWT_AUDIENCE', 'halal-dine-clients'),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.jti !== 'string' ||
      !payload.sub ||
      !payload.sid ||
      !payload.jti
    ) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const allowRevokedSession =
      this.reflector.getAllAndOverride<boolean>(ALLOW_REVOKED_SESSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            status: true,
            isEmailVerified: true,
          },
        },
      },
    });

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const now = new Date();
    if (!allowRevokedSession && (session.revokedAt !== null || session.expiresAt <= now)) {
      throw new UnauthorizedException('Session has been revoked or expired');
    }

    if (session.user.status !== UserStatus.ACTIVE || !session.user.isEmailVerified) {
      throw new ForbiddenException('Account is not eligible for authentication');
    }

    request.auth = {
      userId: payload.sub,
      sessionId: payload.sid,
      jti: payload.jti,
    };

    return true;
  }

  private extractBearerToken(headerValue: string | string[] | undefined): string | null {
    if (typeof headerValue !== 'string') {
      return null;
    }
    const [scheme, token, ...rest] = headerValue.trim().split(/\s+/);
    if (!scheme || !token || rest.length > 0 || scheme.toLowerCase() !== 'bearer') {
      return null;
    }
    return token;
  }
}
