#!/usr/bin/env tsx
/**
 * Headless gate on what the game server will hand a browser from its static
 * root (`server/publicFiles.ts`). The root is the repo itself, so everything
 * that is not the game's entry files, art, audio or fonts must be refused,
 * however the path is spelled: the database (any case, percent-encoded, its
 * WAL files), `.env`, signing keys, `node_modules`, server source, old build
 * output and traversal.
 *
 * Run: npm run verify:server-static
 */
import { isPublicPath } from '../server/publicFiles';

let checksRun = 0;
let checksFailed = 0;

function check(condition: boolean, description: string): void {
  checksRun++;
  if (condition) return;
  checksFailed++;
  console.log(`  FAIL ${description}`);
}

const SERVED = [
  '/',
  '/index.html',
  '/main.css',
  '/manifest.json',
  '/sw.js',
  '/dist/bundle.js',
  '/robots.txt',
  '/download/',
  '/src/images/website/favicon.ico',
  '/src/images/website/favicon-32.png',
  '/src/audio/events/achievement_unlocked.mp3',
  '/src/fonts/OFL.txt',
];

const REFUSED = [
  '/game.db',
  '/GAME.DB',
  '/game%2Edb',
  '/game.db-wal',
  '/game.db-shm',
  '/data/game.db',
  '/.env',
  '/.env.example',
  '/.keys/ai-player-token-es256.pem',
  '/%2Ekeys/ai-player-token-es256.pem',
  '/node_modules/express/package.json',
  '/server/index.ts',
  '/server/middleware/auth.ts',
  '/_site/dist/bundle.js',
  '/dist/kitten-crawler-man.zip',
  '/package.json',
  '/src/game.ts',
  '/src/audio/AudioManager.ts',
  '/src/images/../../server/index.ts',
  '/src/images/%2E%2E/%2E%2E/.env',
  '/src/images/x.png%00.ts',
  '/INDEX.HTML',
  '/%E0%A4%A',
];

for (const path of SERVED) check(isPublicPath(path), `${path} is served`);
for (const path of REFUSED) check(!isPublicPath(path), `${path} is refused`);

if (checksFailed > 0) {
  console.log(`\nFAIL ${checksFailed} of ${checksRun} checks`);
  process.exitCode = 1;
} else {
  console.log(`${checksRun} checks passed`);
}
