import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db.js';
import { HTTP_STATUS } from '../httpStatus.js';
import { authedUser, isRecord, requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function savedData(row: unknown): unknown {
  if (!isRecord(row) || typeof row.data !== 'string') return null;
  const parsed: unknown = JSON.parse(row.data);
  return parsed;
}

router.get('/', (req: Request, res: Response) => {
  const { id } = authedUser(req);
  const row: unknown = db.prepare('SELECT data FROM kcw_progress WHERE user_id = ?').get(id);
  res.json({ data: savedData(row) });
});

router.post('/', (req: Request, res: Response) => {
  const { id } = authedUser(req);
  const body: unknown = req.body;
  const data = isRecord(body) ? body.data : undefined;

  if (!isRecord(data)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'data must be an object' });
    return;
  }

  db.prepare(
    `
    INSERT INTO kcw_progress (user_id, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE
      SET data = excluded.data,
          updated_at = excluded.updated_at
  `,
  ).run(id, JSON.stringify(data));

  res.json({ ok: true });
});

router.delete('/', (req: Request, res: Response) => {
  const { id } = authedUser(req);
  db.prepare('DELETE FROM kcw_progress WHERE user_id = ?').run(id);
  res.json({ ok: true });
});

export default router;
