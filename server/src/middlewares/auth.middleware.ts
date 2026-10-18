import { Request, Response, NextFunction } from 'express';
import { TokenService, JwtPayload } from '../services/token.service';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Access token missing' });
    return;
  }

  try {
    const payload = TokenService.verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (error: any) {
    res.status(401).json({ success: false, message: 'Invalid or expired access token' });
  }
};
