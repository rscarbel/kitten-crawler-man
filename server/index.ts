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

const app = express();

app.use(express.json());
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
