import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordService } from './services/password.service';
import { TokenCryptoService } from './services/token-crypto.service';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenCryptoService, EmailVerificationService],
  exports: [AuthService, PasswordService, TokenCryptoService, EmailVerificationService],
})
export class AuthModule {}
