/**
 * Assembles the deployable static site into `_site/`, containing only the
 * files the game loads at runtime — no sprite manifests (they are inlined into
 * the bundle), no TypeScript sources, no editor cruft, no unreferenced art.
 *
 * Usage: npm run build:site   (runs `npm run build` first)
 *        Consumed by .github/workflows/deploy.yml
 */

import fs from 'fs';
import path from 'path';
import {
  ROOT,
  CORE_FILES,
  collectShippedAssets,
  fileSize,
  reportAssetSelection,
} from './shipped-assets.js';

const SITE_DIR = path.join(ROOT, '_site');

/** Pages served at their own URL in addition to the game itself. */
const EXTRA_PAGES = ['download/index.html'];

const BYTES_PER_MB = 1024 * 1024;

function copyInto(relativePath) {
  const source = path.join(ROOT, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Cannot assemble site: ${relativePath} is missing. Run \`npm run build\`.`);
  }
  const destination = path.join(SITE_DIR, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const assets = collectShippedAssets();
reportAssetSelection(assets);

fs.rmSync(SITE_DIR, { recursive: true, force: true });

const siteFiles = [...CORE_FILES, ...EXTRA_PAGES, ...assets.images, ...assets.audio];
for (const file of siteFiles) copyInto(file);

const totalBytes = siteFiles.reduce((total, file) => total + fileSize(file), 0);
console.log(
  `Assembled _site/ — ${siteFiles.length} files, ${(totalBytes / BYTES_PER_MB).toFixed(1)} MB`,
);
