import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req: AuthedRequest, res: Response) => {
  const { id } = req.user;
  const row = db.prepare('SELECT data FROM progress WHERE user_id = ?').get(id) as
    { data: string } | undefined;

  res.json({ data: row ? (JSON.parse(row.data) as unknown) : null });
});

router.post('/', (req: AuthedRequest, res: Response) => {
  const { id } = req.user;
  const { data } = req.body as { data?: unknown };

  if (!data || typeof data !== 'object') {
    res.status(400).json({ error: 'data must be an object' });
    return;
  }

  db.prepare(
    `
    INSERT INTO progress (user_id, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE
      SET data = excluded.data,
          updated_at = excluded.updated_at
  `,
  ).run(id, JSON.stringify(data));

  res.json({ ok: true });
});

router.delete('/', (req: AuthedRequest, res: Response) => {
  const { id } = req.user;
  db.prepare('DELETE FROM progress WHERE user_id = ?').run(id);
  res.json({ ok: true });
});

export default router;
