/**
 * Packages the game into a self-contained ZIP that users can download and
 * run locally. The ZIP includes Mac and Windows launcher scripts that start
 * a local Python HTTP server (required because the audio engine uses fetch()).
 *
 * Usage: npm run build:zip
 *        (runs `npm run build` first to ensure sw.js and dist/bundle.js are fresh)
 *
 * Output: dist/kitten-crawler-man.zip
 *         Upload this file to S3 alongside the rest of the site so the
 *         download page can link to it.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Launcher scripts ────────────────────────────────────────────────────────

const MAC_SCRIPT = `#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Kitten Crawler Man..."
python3 -m http.server 8080 &
SERVER_PID=$!
sleep 1
open "http://localhost:8080"
echo "Game is running at http://localhost:8080"
echo "Close this window to stop the server."
wait $SERVER_PID
`;

const WIN_SCRIPT = `@echo off
cd /d "%~dp0"
echo Starting Kitten Crawler Man...
start /B python -m http.server 8080
timeout /t 2 /nobreak >nul
start http://localhost:8080
echo Game is running at http://localhost:8080
pause
`;

const README = `KITTEN CRAWLER MAN — Offline Edition
======================================

HOW TO PLAY
-----------

Mac:
  Double-click "start.command"
  If macOS blocks it, right-click → Open → Open

Windows:
  Double-click "start.bat"

Linux:
  Run: python3 -m http.server 8080
  Then open: http://localhost:8080

The game will open in your default browser.
To stop, close the terminal window that appeared.

REQUIREMENTS
------------
  • Python 3  (pre-installed on Mac/most Linux; get it at python.org for Windows)
  • A modern browser (Chrome, Firefox, Safari, or Edge)

NOTE: Python is needed because the game's audio engine uses browser fetch(),
which browsers block when opening files directly. The local server works around this.

CONTROLS
--------
  WASD / Arrow keys  — Move
  Space              — Attack (human melee) / Magic missile (cat)
  1–5                — Hotbar items
  I                  — Inventory
  G                  — Skills
  M                  — Minimap
  Tab                — Switch between characters
  Esc                — Pause menu

Enjoy!
`;

// ── Write temp files ─────────────────────────────────────────────────────────

const macScriptPath = path.join(ROOT, 'start.command');
const winScriptPath = path.join(ROOT, 'start.bat');
const readmePath = path.join(ROOT, 'README.txt');

fs.writeFileSync(macScriptPath, MAC_SCRIPT, { mode: 0o755 });
fs.writeFileSync(winScriptPath, WIN_SCRIPT);
fs.writeFileSync(readmePath, README);

// ── Create ZIP ───────────────────────────────────────────────────────────────

const outZip = 'dist/kitten-crawler-man.zip';

// Remove any stale ZIP so we get a clean archive.
if (fs.existsSync(path.join(ROOT, outZip))) {
  fs.unlinkSync(path.join(ROOT, outZip));
}

console.log('Creating ZIP...');

try {
  execSync(
    [
      'zip -r',
      outZip,
      'index.html',
      'main.css',
      'manifest.json',
      'sw.js',
      'dist/bundle.js',
      'src/images',
      'src/audio',
      'start.command',
      'start.bat',
      'README.txt',
      // Exclude TypeScript source files that ended up under src/audio
      '--exclude "src/audio/*.ts"',
    ].join(' '),
    { cwd: ROOT, stdio: 'inherit' },
  );
} finally {
  fs.unlinkSync(macScriptPath);
  fs.unlinkSync(winScriptPath);
  fs.unlinkSync(readmePath);
}

const zipSizeBytes = fs.statSync(path.join(ROOT, outZip)).size;
const zipSizeMb = (zipSizeBytes / 1024 / 1024).toFixed(1);
console.log(`\nCreated ${outZip} (${zipSizeMb} MB)`);
console.log('Upload dist/kitten-crawler-man.zip to your S3 bucket alongside the rest of the site.');
