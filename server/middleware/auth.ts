import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const SECRET = process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET is not set in environment'); })();

export interface AuthUser {
  id: number;
  username: string;
}

export type AuthedRequest = Request & { user: AuthUser };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token: string | undefined = (req as Request & { cookies: Record<string, string> }).cookies?.token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = jwt.verify(token, SECRET) as unknown as AuthUser;
    (req as AuthedRequest).user = { id: payload.id, username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '7d' });
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
} as const;

export function setAuthCookie(res: Response, user: AuthUser): void {
  res.cookie('token', signToken(user), COOKIE_OPTS);
}
