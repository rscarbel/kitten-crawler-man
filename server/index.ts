import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './routes/auth.js';
import progressRouter from './routes/progress.js';
import { aiTokenRouter } from './routes/aiToken.js';
import { aiSigningKey } from './aiSigningKey.js';
import { servePublicOnly } from './publicFiles.js';

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

// Ahead of the static root so nothing on disk can shadow the JWKS.
app.use(aiTokenRouter(PORT));

// The static root is the repo root, so only allowlisted game files are ever served from it.
app.use(servePublicOnly(express.static(ROOT, { dotfiles: 'deny' })));

app.use('/api/auth', authRouter);
app.use('/api/progress', progressRouter);

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// Loaded at boot so a first run generates its key now and a malformed one fails here.
aiSigningKey();

app.listen(PORT, () => {
  console.log(`Game server running at http://localhost:${PORT}`);
});
