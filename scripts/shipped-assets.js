/**
 * Single source of truth for which files belong in a build.
 *
 * `src/images` and `src/audio` are working directories: they hold the runtime
 * assets, but also sprite manifests that get inlined into the bundle at build
 * time, TypeScript modules, editor cruft, and source art that generator scripts
 * sampled from but the game never loads. Shipping the whole tree wastes
 * megabytes of download and pre-cache, so every consumer of the build output
 * (service worker, offline ZIP, GitHub Pages site) asks this module which files
 * the game actually references.
 *
 * A file ships only if something reachable at runtime names it: a sprite
 * manifest `path`, SOUND_MANIFEST, a path literal in `src/**\/*.ts`, or a
 * reference from the HTML/CSS/PWA-manifest entry points.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Files served at the site root, alongside the bundle. */
export const CORE_FILES = ['index.html', 'main.css', 'manifest.json', 'sw.js', 'dist/bundle.js'];

/** Text files scanned for asset path literals, in addition to every `src/**\/*.ts`. */
const ENTRY_POINT_FILES = ['index.html', 'main.css', 'manifest.json', 'download/index.html'];

const IMAGE_EXTENSIONS = /\.(png|jpe?g|ico)$/i;
const AUDIO_EXTENSIONS = /\.mp3$/i;

const IMAGE_PATH_LITERAL = /src\/images\/[\w\-./]+?\.(?:png|jpe?g|ico)/gi;
const AUDIO_PATH_LITERAL = /src\/audio\/[\w\-./]+?\.mp3/gi;

/** Recursively walk a directory, returning ROOT-relative POSIX paths. */
function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(path.relative(ROOT, fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

function readTextFile(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

/**
 * Sprite manifests store paths relative to `src/images/` because SpriteLoader
 * prepends that base at load time.
 */
function collectSpriteManifestPaths() {
  const SPRITE_MANIFEST_BASE = 'src/images/';
  const referenced = new Set();

  for (const manifestFile of walkDir(path.join(ROOT, 'src/images'))) {
    if (path.basename(manifestFile) !== 'manifest.json') continue;

    const entries = JSON.parse(readTextFile(manifestFile));
    for (const entry of Object.values(entries)) {
      if (typeof entry?.path === 'string') {
        referenced.add(`${SPRITE_MANIFEST_BASE}${entry.path}`);
      }
    }
  }
  return referenced;
}

function collectPathLiterals() {
  const referenced = new Set();
  const sourceFiles = [
    ...walkDir(path.join(ROOT, 'src')).filter((f) => f.endsWith('.ts')),
    ...ENTRY_POINT_FILES,
  ];

  for (const sourceFile of sourceFiles) {
    const text = readTextFile(sourceFile);
    for (const match of text.matchAll(IMAGE_PATH_LITERAL)) referenced.add(match[0]);
    for (const match of text.matchAll(AUDIO_PATH_LITERAL)) referenced.add(match[0]);
  }
  return referenced;
}

/**
 * Resolve which asset files the game actually loads.
 *
 * @returns {{ images: string[], audio: string[], excluded: string[], missing: string[] }}
 *   ROOT-relative POSIX paths. `excluded` is on disk but unreferenced;
 *   `missing` is referenced but absent, which means a broken build.
 */
export function collectShippedAssets() {
  const referenced = new Set([...collectSpriteManifestPaths(), ...collectPathLiterals()]);

  const onDisk = [
    ...walkDir(path.join(ROOT, 'src/images')),
    ...walkDir(path.join(ROOT, 'src/audio')),
  ];
  const assetsOnDisk = onDisk.filter((f) => IMAGE_EXTENSIONS.test(f) || AUDIO_EXTENSIONS.test(f));
  const onDiskSet = new Set(assetsOnDisk);

  const shipped = assetsOnDisk.filter((f) => referenced.has(f)).sort();

  return {
    images: shipped.filter((f) => IMAGE_EXTENSIONS.test(f)),
    audio: shipped.filter((f) => AUDIO_EXTENSIONS.test(f)),
    excluded: assetsOnDisk.filter((f) => !referenced.has(f)).sort(),
    missing: [...referenced].filter((f) => !onDiskSet.has(f)).sort(),
  };
}

/** Byte size of a ROOT-relative file, or 0 when it does not exist. */
export function fileSize(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  return fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
}

/** Logs which assets were left out of the build, and fails loudly on missing ones. */
export function reportAssetSelection({ images, audio, excluded, missing }) {
  const BYTES_PER_MB = 1024 * 1024;
  const excludedBytes = excluded.reduce((total, f) => total + fileSize(f), 0);

  console.log(`Assets: ${images.length} images, ${audio.length} audio referenced by the game.`);

  if (excluded.length > 0) {
    console.log(
      `Excluded ${excluded.length} unreferenced file(s) ` +
        `(${(excludedBytes / BYTES_PER_MB).toFixed(1)} MB):`,
    );
    for (const file of excluded) console.log(`  - ${file}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Referenced assets are missing from disk:\n${missing.map((f) => `  - ${f}`).join('\n')}`,
    );
  }
}

export { ROOT };
