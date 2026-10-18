import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import { PasswordService } from '../services/password.service';
import { TokenService } from '../services/token.service';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { env } from '../config/env';

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  path: '/',
};

const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const parseResult = registerSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { email, password, name } = parseResult.data;

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        res.status(409).json({ success: false, message: 'Email is already registered' });
        return;
      }

      const passwordHash = await PasswordService.hashPassword(password);

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
        },
      });

      const accessToken = TokenService.generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      const refreshToken = await TokenService.createRefreshToken(user.id);

      res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
      res.cookie('accessToken', accessToken, ACCESS_COOKIE_OPTIONS);

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        accessToken,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const parseResult = loginSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { email, password } = parseResult.data;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      const isValid = await PasswordService.verifyPassword(user.passwordHash, password);
      if (!isValid) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      const accessToken = TokenService.generateAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      const refreshToken = await TokenService.createRefreshToken(user.id);

      res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
      res.cookie('accessToken', accessToken, ACCESS_COOKIE_OPTIONS);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        accessToken,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
  }

  static async refresh(req: Request, res: Response): Promise<void> {
    try {
      const rawRefreshToken = req.cookies.refreshToken || req.body.refreshToken;
      if (!rawRefreshToken) {
        res.status(401).json({ success: false, message: 'Refresh token cookie missing' });
        return;
      }

      const { newAccessToken, newRefreshToken } = await TokenService.rotateRefreshToken(rawRefreshToken);

      res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS);
      res.cookie('accessToken', newAccessToken, ACCESS_COOKIE_OPTIONS);

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        accessToken: newAccessToken,
      });
    } catch (error: any) {
      res.clearCookie('refreshToken', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('accessToken', CLEAR_COOKIE_OPTIONS);
      res.status(401).json({ success: false, message: error.message || 'Invalid refresh token' });
    }
  }

  static async logout(req: Request, res: Response): Promise<void> {
    try {
      const rawRefreshToken = req.cookies.refreshToken || req.body.refreshToken;
      if (rawRefreshToken) {
        await TokenService.revokeRefreshToken(rawRefreshToken);
      }
      res.clearCookie('refreshToken', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('accessToken', CLEAR_COOKIE_OPTIONS);
      res.status(200).json({ success: true, message: 'Logout successful' });
    } catch (error: any) {
      res.clearCookie('refreshToken', CLEAR_COOKIE_OPTIONS);
      res.clearCookie('accessToken', CLEAR_COOKIE_OPTIONS);
      res.status(500).json({ success: false, message: error.message || 'Logout failed' });
    }
  }


  static async me(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      res.status(200).json({ success: true, user });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch user profile' });
    }
  }
}
