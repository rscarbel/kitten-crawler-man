/**
 * The browser globals the game's own modules reach for, backed by `node-canvas`.
 *
 * A generator that bakes a painter which itself blits an existing sprite — the
 * market stall stacks the game's real crate and barrel PNGs on its counter via
 * `drawSpriteKey` — has to run `SpriteLoader.loadSprites` first, and that builds
 * an `Image` per sheet. `allocCanvas`'s fallback path wants
 * `document.createElement('canvas')`, and every sheet that finishes loading asks
 * `window.devicePixelRatio` whether this device is poor enough to halve it.
 * Those three shims are the whole compatibility layer; `performance.now` is
 * already a Node global.
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
  window?: unknown;
}

/**
 * The pixel ratio the shimmed `window` reports.
 *
 * A generator must bake at the sheet's authored resolution, and `SpriteLoader`
 * halves a sheet it decides the device is too poor for. Reporting a Retina
 * ratio is not a fib about the machine running the bake — it is the display the
 * sheets are authored for, and it is the one answer that keeps a re-bake
 * pixel-identical to the art the game ships.
 */
const BAKE_DEVICE_PIXEL_RATIO = 2;

/**
 * Installs the shims and loads every sheet in the manifest, so painters that
 * blit existing sprites bake the real art rather than nothing.
 */
export async function loadGameSpritesInNode(): Promise<void> {
  installCanvasGlobals();
  await loadSprites(IMAGE_BASE);
}

/**
 * The shims alone, for a harness that draws but loads no sheets.
 *
 * A runtime painter that only allocates scratch surfaces — the flame stamps are
 * the case — needs `document.createElement('canvas')` to exist and nothing
 * else. Preloading the manifest for it would cost the whole sprite budget to
 * bake a handful of gradients.
 */
export function installCanvasGlobals(): void {
  const globals: CanvasGlobals = globalThis;
  globals.Image = Image;
  globals.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`sprite generator cannot create <${tag}>`);
      return createCanvas(1, 1);
    },
  };
  globals.window = { devicePixelRatio: BAKE_DEVICE_PIXEL_RATIO };
}
