/**
 * The browser globals the game's own modules reach for, backed by `node-canvas`.
 *
 * A generator that bakes a painter which itself blits an existing sprite — the
 * market stall stacks the game's real crate and barrel PNGs on its counter via
 * `drawSpriteKey` — has to run `SpriteLoader.loadSprites` first, and that builds
 * an `Image` per sheet. `allocCanvas`'s fallback path wants
 * `document.createElement('canvas')`. Those two shims are the whole
 * compatibility layer; `performance.now` is already a Node global.
 *
 * Without this, a painter's sprite blits are silently skipped — `drawSpriteKey`
 * returns early on an unloaded key — and the missing crates would be baked into
 * the sheet permanently with nothing logged to say so.
 */

import { Image, createCanvas } from 'canvas';

import { loadSprites } from '../src/core/SpriteLoader.js';

/** Where `SpriteLoader` resolves manifest paths against, from the repo root. */
const IMAGE_BASE = 'src/images/';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
}

/**
 * Installs the shims and loads every sheet in the manifest, so painters that
 * blit existing sprites bake the real art rather than nothing.
 */
export async function loadGameSpritesInNode(): Promise<void> {
  const globals: CanvasGlobals = globalThis;
  globals.Image = Image;
  globals.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`sprite generator cannot create <${tag}>`);
      return createCanvas(1, 1);
    },
  };
  await loadSprites(IMAGE_BASE);
}
