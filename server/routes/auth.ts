import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import db from '../db.js';
import { HTTP_STATUS } from '../httpStatus.js';
import {
  SESSION_COOKIE_OPTIONS,
  authedUser,
  isAuthUser,
  isRecord,
  requireAuth,
  setAuthCookie,
} from '../middleware/auth.js';

const router = Router();

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 6;
const BCRYPT_COST = 12;
/**
 * Compared against when the username does not exist, so a miss costs the same
 * bcrypt work as a wrong password and response time does not reveal which.
 */
const DUMMY_PASSWORD_HASH = '$2a$12$invalidhashpadding00000000000000000000000000000000000';

interface Credentials {
  username: string;
  password: string;
}

function readCredentials(body: unknown): Credentials | null {
  if (!isRecord(body)) return null;
  const { username, password } = body;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (username === '' || password === '') return null;
  return { username, password };
}

function isUniqueViolation(err: unknown): boolean {
  return isRecord(err) && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

router.post('/register', async (req: Request, res: Response) => {
  const credentials = readCredentials(req.body);
  if (credentials === null) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Username and password are required' });
    return;
  }
  const { username, password } = credentials;
  if (!USERNAME_RE.test(username)) {
    res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json({ error: 'Username must be 3–32 characters (letters, numbers, _ or -)' });
    return;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const row: unknown = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username')
      .get(username, hash);
    if (!isAuthUser(row)) throw new Error('insert returned no user');

    setAuthCookie(res, row);
    res.status(HTTP_STATUS.CREATED).json({ id: row.id, username: row.username });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      res.status(HTTP_STATUS.CONFLICT).json({ error: 'That username is already taken' });
    } else {
      console.error('Register error:', err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Server error' });
    }
  }
});

function readUserWithHash(row: unknown): { id: number; username: string; hash: string } | null {
  if (!isAuthUser(row) || !isRecord(row)) return null;
  const hash = row.password_hash;
  return typeof hash === 'string' ? { id: row.id, username: row.username, hash } : null;
}

router.post('/login', async (req: Request, res: Response) => {
  const credentials = readCredentials(req.body);
  if (credentials === null) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Username and password are required' });
    return;
  }

  const row: unknown = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(credentials.username);
  const user = readUserWithHash(row);

  const ok = await bcrypt.compare(credentials.password, user?.hash ?? DUMMY_PASSWORD_HASH);

  if (user === null || !ok) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid username or password' });
    return;
  }

  setAuthCookie(res, { id: user.id, username: user.username });
  res.json({ id: user.id, username: user.username });
});

router.post('/logout', (_req, res: Response) => {
  res.clearCookie('token', SESSION_COOKIE_OPTIONS);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const { id, username } = authedUser(req);
  res.json({ id, username });
});

export default router;
