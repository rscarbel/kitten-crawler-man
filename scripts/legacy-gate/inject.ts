#!/usr/bin/env tsx
/**
 * Adds the password gate to a build of the frozen Kitten Crawler Man site, the
 * old game kept at ryanscarbel.com/kitten-crawler-man/. That is why the old
 * name appears here: this script and its gate only ever touch that build.
 *
 * Given the assembled `_site/` of the frozen commit, it:
 * - replaces the page's bundle tag with `gate.html`, which loads the bundle
 *   once the passphrase is given
 * - narrows the old service worker's activate cleanup to the caches that site
 *   created, so it never deletes the caches of the game deployed beside it on
 *   the same origin
 *
 * Each edit must match its target exactly once, so pointing this at any build
 * but the one it was written for fails instead of shipping an ungated page.
 *
 * Run: npx tsx scripts/legacy-gate/inject.ts <site dir>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE_FRAGMENT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gate.html');

const BUNDLE_TAG = '<script src="dist/bundle.js" defer></script>';
const BODY_END = '</body>';

/**
 * The old worker names every cache `v<timestamp>` and deletes all others; the
 * narrowed filter deletes only caches with that shape.
 */
const OLD_CACHE_CLEANUP = 'keys.filter((k) => k !== CACHE_NAME)';
const NARROWED_CACHE_CLEANUP = 'keys.filter((k) => /^v\\d+$/.test(k) && k !== CACHE_NAME)';

interface Edit {
  readonly description: string;
  readonly find: string;
  readonly replace: string;
}

function occurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

function applyEdits(filePath: string, edits: readonly Edit[]): void {
  let text = readFileSync(filePath, 'utf8');
  for (const edit of edits) {
    const found = occurrences(text, edit.find);
    if (found !== 1) {
      throw new Error(
        `${filePath}: expected exactly one ${edit.description}, found ${String(found)}`,
      );
    }
    text = text.replace(edit.find, () => edit.replace);
  }
  writeFileSync(filePath, text);
}

function injectLegacyGate(siteDir: string): void {
  const gate = readFileSync(GATE_FRAGMENT_PATH, 'utf8');
  applyEdits(path.join(siteDir, 'index.html'), [
    { description: 'bundle script tag', find: BUNDLE_TAG, replace: '' },
    { description: 'closing body tag', find: BODY_END, replace: `${gate}${BODY_END}` },
  ]);
  applyEdits(path.join(siteDir, 'sw.js'), [
    {
      description: 'service worker cache cleanup',
      find: OLD_CACHE_CLEANUP,
      replace: NARROWED_CACHE_CLEANUP,
    },
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const siteDir = process.argv[2];
  if (siteDir === undefined) {
    console.error('Usage: npx tsx scripts/legacy-gate/inject.ts <site dir>');
    process.exit(1);
  }
  injectLegacyGate(siteDir);
  console.log(`Legacy gate injected into ${siteDir}`);
}
