import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { parseDurationToSeconds } from '../../common/utils/env.util';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { PasswordService } from './services/password.service';
import { SessionCleanupService } from './services/session-cleanup.service';
import { SessionService } from './services/session.service';
import { TokenCryptoService } from './services/token-crypto.service';

@Module({
  imports: [
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.getOrThrow<string>('JWT_SECRET');
        const expiresIn = parseDurationToSeconds(
          configService.get<string>('JWT_ACCESS_TOKEN_EXPIRY', '15m'),
          900,
        );
        const issuer = configService.get<string>('JWT_ISSUER', 'halal-dine-api');
        const audience = configService.get<string>('JWT_AUDIENCE', 'halal-dine-clients');

        return {
          secret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn,
            issuer,
            audience,
          },
          verifyOptions: {
            algorithms: ['HS256'],
            issuer,
            audience,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenCryptoService,
    EmailVerificationService,
    PasswordResetService,
    SessionService,
    SessionCleanupService,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    PasswordService,
    TokenCryptoService,
    EmailVerificationService,
    PasswordResetService,
    SessionService,
    SessionCleanupService,
    JwtAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}
