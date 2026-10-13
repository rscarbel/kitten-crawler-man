import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './routes/auth.js';
import progressRouter from './routes/progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3000;
/**
 * The largest request body accepted. A save is one JSON body, and express's
 * 100 KB default is within reach of a deep bag, after which every save would
 * be refused.
 */
const JSON_BODY_LIMIT = '4mb';

const app = express();

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(cookieParser());

// Serve compiled frontend assets
app.use(express.static(ROOT));

app.use('/api/auth', authRouter);
app.use('/api/progress', progressRouter);

// Catch-all: serve index.html for any non-API GET (SPA fallback)
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Game server running at http://localhost:${PORT}`);
});
