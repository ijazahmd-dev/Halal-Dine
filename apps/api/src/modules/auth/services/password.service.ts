import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB memory cost
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 parallel threads
} as const;

// Non-secret dummy Argon2id digest matching ARGON2ID_OPTIONS to equalize login timing when a user is not found
const DUMMY_ARGON2ID_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$wszRPxbbayVEgeePchPLug$2juNMQ4lRcOjql5qxJrpuhr5uHpq//sSssmO8ykmL9w';

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

  /**
   * Executes an Argon2id verification against a dummy digest when no user record exists,
   * mitigating timing side-channels that could distinguish unknown emails from wrong passwords.
   */
  async verifyAgainstDummy(plainPassword: string): Promise<void> {
    await this.verify(DUMMY_ARGON2ID_HASH, plainPassword);
  }
}
