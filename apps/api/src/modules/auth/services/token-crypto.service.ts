import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

export interface GeneratedOpaqueToken {
  rawToken: string;
  tokenHash: string;
}

@Injectable()
export class TokenCryptoService {
  /**
   * Generates a cryptographically secure random opaque token and its SHA-256 digest.
   * Only `tokenHash` should ever be persisted; `rawToken` is strictly for single delivery.
   */
  generateOpaqueToken(byteLength = 32): GeneratedOpaqueToken {
    const rawToken = crypto.randomBytes(byteLength).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    return { rawToken, tokenHash };
  }

  /**
   * Computes a deterministic SHA-256 hex digest for an opaque token.
   */
  hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Performs constant-time comparison for opaque strings such as double-submit CSRF tokens.
   */
  constantTimeEquals(left: string, right: string): boolean {
    if (!left || !right || left.length !== right.length) {
      return false;
    }
    const leftBuf = Buffer.from(left, 'utf8');
    const rightBuf = Buffer.from(right, 'utf8');
    if (leftBuf.length !== rightBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(leftBuf, rightBuf);
  }
}
