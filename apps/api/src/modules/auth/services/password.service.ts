import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB memory cost
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 parallel threads
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Hashes a plaintext password using the centralized Argon2id configuration.
   */
  async hash(plainPassword: string): Promise<string> {
    try {
      return await argon2.hash(plainPassword, ARGON2ID_OPTIONS);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`Password hashing failed (${reason})`);
      throw new InternalServerErrorException('Failed to process password');
    }
  }

  /**
   * Verifies a plaintext password against an existing Argon2id hash.
   * Returns false safely on malformed hashes or verification errors without throwing secrets.
   */
  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    if (!passwordHash || !plainPassword) {
      return false;
    }

    try {
      return await argon2.verify(passwordHash, plainPassword);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Password verification rejected due to hash/verify error (${reason})`);
      return false;
    }
  }
}
