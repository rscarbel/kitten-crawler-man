import jwt from 'jsonwebtoken';
import type { CookieOptions, Request, Response, NextFunction } from 'express';
import db from '../db.js';
import { HTTP_STATUS } from '../httpStatus.js';

const SECRET =
  process.env.JWT_SECRET ??
  (() => {
    throw new Error('JWT_SECRET is not set in environment');
  })();

const SESSION_DAYS = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const SESSION_MAX_AGE_MS =
  SESSION_DAYS * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

export interface AuthUser {
  id: number;
  username: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrows a database row or token payload to the user fields every session carries. */
export function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value) && typeof value.id === 'number' && typeof value.username === 'string';
}

/** The signed-in user `requireAuth` attached to each request it let through. */
const authedUsers = new WeakMap<Request, AuthUser>();

/**
 * The user `requireAuth` authenticated for this request. Throws when called
 * on a route that is not behind `requireAuth`, which is a wiring mistake.
 */
export function authedUser(req: Request): AuthUser {
  const user = authedUsers.get(req);
  if (user === undefined) throw new Error('authedUser() called on a route without requireAuth');
  return user;
}

function sessionToken(req: Request): string | null {
  const cookies: unknown = req.cookies;
  if (!isRecord(cookies)) return null;
  const token = cookies.token;
  return typeof token === 'string' && token !== '' ? token : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = sessionToken(req);
  if (token === null) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = jwt.verify(token, SECRET);
    if (!isAuthUser(payload)) throw new Error('session token has no user');
    const row: unknown = db.prepare('SELECT id, username FROM users WHERE id = ?').get(payload.id);
    if (!isAuthUser(row)) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid or expired session' });
      return;
    }
    authedUsers.set(req, { id: row.id, username: row.username });
    next();
  } catch {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid or expired session' });
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username }, SECRET, {
    expiresIn: `${SESSION_DAYS}d`,
  });
}

export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
};

export function setAuthCookie(res: Response, user: AuthUser): void {
  res.cookie('token', signToken(user), { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_MS });
}
