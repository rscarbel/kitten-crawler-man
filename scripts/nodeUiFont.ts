/**
 * Registers the UI typeface with node-canvas on import, so every harness that
 * draws UI sets its text in the face the game ships.
 *
 * node-canvas only honours a registration made before the canvas it draws on
 * is created, so this runs as an import side effect: the shared harness helpers
 * (`nodeGameContext`, `nodeCanvasGlobals`, `browserShim`, `previewOut`) import
 * it, and ES module evaluation runs it before any harness body.
 *
 * The static weights are registered rather than the variable woff2 the browser
 * loads: node-canvas cannot parse woff2, and given the variable TTF it draws
 * every weight at the default instance.
 */

import { registerFont } from 'canvas';
import { fileURLToPath } from 'node:url';

import { UI_FONT_FAMILY } from '../src/ui/theme/fonts.js';

const STATIC_FONT_DIR = fileURLToPath(new URL('../src/fonts/static/', import.meta.url));

/** Each static instance shipped for node, by the CSS weight it answers to. */
const STATIC_WEIGHTS = [
  { file: 'Inter-Regular.ttf', weight: '400' },
  { file: 'Inter-Medium.ttf', weight: '500' },
  { file: 'Inter-SemiBold.ttf', weight: '600' },
  { file: 'Inter-Bold.ttf', weight: '700' },
  { file: 'Inter-ExtraBold.ttf', weight: '800' },
] as const;

let registered = false;

/** Idempotent; safe to call from every helper that might run first. */
export function registerUiFontForNode(): void {
  if (registered) return;
  registered = true;
  for (const { file, weight } of STATIC_WEIGHTS) {
    registerFont(`${STATIC_FONT_DIR}${file}`, { family: UI_FONT_FAMILY, weight });
  }
}

registerUiFontForNode();
