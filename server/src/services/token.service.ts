import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../db/client';
import { env } from '../config/env';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export class TokenService {
  /**
   * Generates short-lived Access Token (JWT)
   */
  static generateAccessToken(payload: JwtPayload): string {
    const options: SignOptions = {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
    };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET as Secret, options);
  }

  /**
   * Verifies Access Token (JWT)
   */
  static verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, env.JWT_ACCESS_SECRET as Secret) as JwtPayload;
  }

  /**
   * Generates secure random Refresh Token, hashes it with SHA-256 for DB storage,
   * saves it to DB, and returns the raw token to set in HTTP-only cookie.
   */
  static async createRefreshToken(userId: string): Promise<string> {
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return rawRefreshToken;
  }

  /**
   * Rotates Refresh Token: verifies current token, revokes it, issues a brand new one.
   */
  static async rotateRefreshToken(rawRefreshToken: string): Promise<{ newAccessToken: string; newRefreshToken: string; userId: string }> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new Error('Invalid refresh token');
    }

    if (storedToken.isRevoked) {
      // Security measure: reuse detection -> revoke ALL tokens for this user!
      await prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId },
        data: { isRevoked: true },
      });
      throw new Error('Refresh token reuse detected. All sessions revoked.');
    }

    if (new Date() > storedToken.expiresAt) {
      throw new Error('Refresh token expired');
    }

    // Generate new raw refresh token
    const newRawRefreshToken = crypto.randomBytes(40).toString('hex');
    const newTokenHash = this.hashToken(newRawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Revoke old token and create new token atomically
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: {
          isRevoked: true,
          replacedByToken: newTokenHash,
        },
      }),
      prisma.refreshToken.create({
        data: {
          userId: storedToken.userId,
          tokenHash: newTokenHash,
          expiresAt,
        },
      }),
    ]);

    const newAccessToken = this.generateAccessToken({
      userId: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role,
    });

    return {
      newAccessToken,
      newRefreshToken: newRawRefreshToken,
      userId: storedToken.userId,
    };
  }

  /**
   * Revokes a refresh token (Logout)
   */
  static async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { isRevoked: true },
    });
  }

  /**
   * Hashes raw token using SHA-256
   */
  private static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
