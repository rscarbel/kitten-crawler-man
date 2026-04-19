import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import db from '../db.js';
import { requireAuth, setAuthCookie } from '../middleware/auth.js';
import type { AuthedRequest } from '../middleware/auth.js';

const router = Router();

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, _ or -)' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    const row = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username')
      .get(username, hash) as { id: number; username: string };

    setAuthCookie(res, row);
    res.status(201).json({ id: row.id, username: row.username });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'That username is already taken' });
    } else {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; password_hash: string } | undefined;

  // Use constant-time compare even on "user not found" to prevent user enumeration
  const hash = user?.password_hash ?? '$2a$12$invalidhashpadding00000000000000000000000000000000000';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  setAuthCookie(res, { id: user.id, username: user.username });
  res.json({ id: user.id, username: user.username });
});

router.post('/logout', (_req, res: Response) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const { id, username } = (req as AuthedRequest).user;
  res.json({ id, username });
});

export default router;
