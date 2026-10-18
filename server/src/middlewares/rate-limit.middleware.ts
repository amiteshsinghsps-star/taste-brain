import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  count: number;
  resetTime: number;
}

const attemptsMap = new Map<string, RateLimitStore>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of attemptsMap.entries()) {
    if (now > record.resetTime) {
      attemptsMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

/**
 * Creates an in-memory Rate Limiting middleware for brute-force defense.
 * @param maxAttempts Max allowed requests in timeframe
 * @param windowMs Timeframe window in milliseconds (default 15 minutes)
 */
export function createRateLimiter(maxAttempts = 15, windowMs = 15 * 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
    const now = Date.now();

    let record = attemptsMap.get(clientIp);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      attemptsMap.set(clientIp, record);
      next();
      return;
    }

    record.count += 1;

    if (record.count > maxAttempts) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec.toString());
      res.status(429).json({
        success: false,
        message: `Too many authentication attempts from this IP. Please try again in ${Math.ceil(retryAfterSec / 60)} minutes.`,
      });
      return;
    }

    next();
  };
}

export const authRateLimiter = createRateLimiter(15, 15 * 60 * 1000); // 15 attempts per 15 min
export const apiRateLimiter = createRateLimiter(100, 1 * 60 * 1000);   // 100 requests per 1 min
