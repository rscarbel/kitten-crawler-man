/**
 * The UI typeface: Inter, bundled under `src/fonts/` (SIL Open Font License,
 * see `src/fonts/OFL.txt`).
 *
 * The browser loads the variable woff2 through `FontFace` behind the loading
 * screen. Render scripts register the static weights with node-canvas under the
 * same family name, so review PNGs set text in the same face as the game.
 */

/** The family name the face is registered under, in the browser and in node. */
export const UI_FONT_FAMILY = 'Inter UI';

/**
 * The stack every UI string uses. Until (or unless) the face loads, canvas
 * text resolves to the system face instead.
 */
export const UI_FONT_STACK = `"${UI_FONT_FAMILY}", system-ui, sans-serif`;

/**
 * The stack for text that is meant to read as a machine talking (the System
 * AI). Which speakers use it is decided in `src/dialog/speakers.ts`.
 */
export const TERMINAL_FONT_STACK = 'ui-monospace, Menlo, Consolas, monospace';

/**
 * The stack for labels painted into the game world (nameplates, combat
 * numbers, structure captions). They keep the game's pixel-era monospace so
 * they read as part of the art rather than as UI chrome.
 */
export const WORLD_FONT_STACK = 'monospace';

/** Page-relative URL of the bundled variable font; also what the service worker precaches. */
export const UI_FONT_URL = 'src/fonts/InterVariable.woff2';

/** The weight axis the variable font covers. */
const UI_FONT_WEIGHT_RANGE = '100 900';

/**
 * How long boot waits for the face before giving up and drawing in
 * `system-ui`. A slow connection should not hold the game hostage for a
 * typeface; if the face arrives later it is still installed and takes over.
 */
export const FONT_LOAD_TIMEOUT_MS = 3000;

export type UiFontStatus = 'loaded' | 'fallback';

let loadPromise: Promise<UiFontStatus> | null = null;

const digitCellCache = new Map<string, number>();

/** Caches of measured widths elsewhere, cleared with this module's own when the face arrives. */
const fontLoadListeners = new Set<() => void>();

/** Calls `forget` when the UI face finishes loading: widths measured with the fallback are wrong for it. */
export function onUiFontLoaded(forget: () => void): void {
  fontLoadListeners.add(forget);
}

function delay(ms: number): Promise<'fallback'> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve('fallback');
    }, ms);
  });
}

async function loadFace(): Promise<UiFontStatus> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return 'fallback';
  const face = new FontFace(UI_FONT_FAMILY, `url(${UI_FONT_URL})`, {
    weight: UI_FONT_WEIGHT_RANGE,
    style: 'normal',
  });
  try {
    await face.load();
    document.fonts.add(face);
    // Widths measured while the fallback face was drawing are wrong for Inter.
    digitCellCache.clear();
    for (const forget of fontLoadListeners) forget();
    return 'loaded';
  } catch {
    return 'fallback';
  }
}

/**
 * Loads the UI face once. Resolves `'loaded'` when it is ready to draw with,
 * or `'fallback'` after {@link FONT_LOAD_TIMEOUT_MS} or on failure. Never
 * rejects, so boot can await it alongside sprite loading.
 */
export function loadUiFont(): Promise<UiFontStatus> {
  loadPromise ??= Promise.race([loadFace(), delay(FONT_LOAD_TIMEOUT_MS)]);
  return loadPromise;
}

/** Every glyph a tabular number can contain. */
export const TABULAR_DIGITS = '0123456789';

/**
 * Width of the widest digit in `font`, measured once per font string.
 *
 * Numbers that change every frame set each digit centred in a cell this wide,
 * so a timer ticking from 19 to 20 does not shuffle its neighbours.
 */
export function digitCellWidth(ctx: CanvasRenderingContext2D, font: string): number {
  const cached = digitCellCache.get(font);
  if (cached !== undefined) return cached;
  ctx.save();
  ctx.font = font;
  let widest = 0;
  for (const digit of TABULAR_DIGITS) widest = Math.max(widest, ctx.measureText(digit).width);
  ctx.restore();
  digitCellCache.set(font, widest);
  return widest;
}
