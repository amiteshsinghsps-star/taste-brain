import argon2 from 'argon2';
import crypto from 'crypto';

export class PasswordService {
  /**
   * Hashes plain text password with a unique salt using Argon2id algorithm.
   */
  static async hashPassword(password: string): Promise<string> {
    try {
      return await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16, // 64 MB
        timeCost: 3,
        parallelism: 1,
      });
    } catch (error) {
      // Fallback crypto-pbkdf2 if native argon2 binary is missing in host environment
      return this.fallbackHash(password);
    }
  }

  /**
   * Verifies plain text password against stored hashed password (Argon2 or fallback PBKDF2).
   */
  static async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      if (hash.startsWith('pbkdf2$')) {
        return this.verifyFallbackHash(hash, password);
      }
      return await argon2.verify(hash, password);
    } catch (error) {
      if (hash.startsWith('pbkdf2$')) {
        return this.verifyFallbackHash(hash, password);
      }
      return false;
    }
  }

  private static fallbackHash(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `pbkdf2$${salt}$${hash}`;
  }

  private static verifyFallbackHash(storedHash: string, password: string): boolean {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const originalHash = parts[2];
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(originalHash), Buffer.from(hash));
  }
}
