/**
 * Player tokens for the AI server. A signed-in player's browser asks this
 * server (same origin, session cookie) for a short-lived token, and presents
 * it to the AI server, which trusts this server's published JWKS. No AI
 * credential ever reaches the browser, and a logged-out player gets no token,
 * so plays without the AI.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AI_TOKEN_ALGORITHM, aiSigningKey } from '../aiSigningKey.js';
import { HTTP_STATUS } from '../httpStatus.js';
import { authedUser, requireAuth } from '../middleware/auth.js';

/** How long a player token lasts; the browser renews it before then. */
export const AI_TOKEN_TTL_SECONDS = 600;

/** The issuer stamped in every token: this server's public origin, where its JWKS lives. */
export function tokenIssuer(port: number): string {
  const configured = process.env.PUBLIC_URL?.trim();
  return configured !== undefined && configured !== ''
    ? configured.replace(/\/+$/, '')
    : `http://localhost:${port}`;
}

function aiAppId(): string | null {
  const configured = process.env.AI_APP_ID?.trim();
  return configured !== undefined && configured !== '' ? configured : null;
}

export function aiTokenRouter(port: number): Router {
  const router = Router();

  router.get('/api/ai-token', requireAuth, (req: Request, res: Response) => {
    const audience = aiAppId();
    if (audience === null) {
      res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ error: 'AI is not configured' });
      return;
    }
    const user = authedUser(req);
    const key = aiSigningKey();
    const token = jwt.sign({ name: user.username }, key.privateKey, {
      algorithm: AI_TOKEN_ALGORITHM,
      keyid: key.kid,
      subject: String(user.id),
      audience,
      issuer: tokenIssuer(port),
      expiresIn: AI_TOKEN_TTL_SECONDS,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ token, token_type: 'Bearer', expires_in: AI_TOKEN_TTL_SECONDS });
  });

  router.get('/.well-known/jwks.json', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ keys: [aiSigningKey().jwk] });
  });

  return router;
}
