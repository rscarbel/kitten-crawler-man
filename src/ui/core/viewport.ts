/**
 * The numbers that decide how big the UI is drawn and which layout it takes:
 * UI scale, density, size class and safe-area insets. Nothing else in the UI
 * owns a breakpoint.
 *
 * Importable in node: every DOM read is guarded and falls back to a desktop
 * pointer with no insets.
 */

import { settings, type UiSize } from '../../core/Settings';
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import type { Density } from '../theme/tokens';
import { inset, type Insets, type Rect } from './geom';

/** Size-class thresholds, in UI units (CSS pixels ÷ UI scale). */
export const SIZE_CLASS_BREAKPOINTS = {
  compactBelowWidth: 640,
  compactBelowHeight: 440,
  wideFromWidth: 1280,
} as const;

/**
 * `compact` is a phone: wide panels become bottom sheets. `regular` and `wide`
 * centre panels as cards.
 */
export type SizeClass = 'compact' | 'regular' | 'wide';

export type SafeAreaInsets = Readonly<Required<Insets>>;

export const NO_INSETS: SafeAreaInsets = { t: 0, r: 0, b: 0, l: 0 };

/**
 * The scale each density starts from before the player's UI size applies.
 * Touch targets already grow through `theme.size`, so both start at 1.
 */
export const DENSITY_BASE_SCALE: Readonly<Record<Density, number>> = { pointer: 1, touch: 1 };

/** The player's UI size setting as a multiplier. */
export const UI_SIZE_SCALE: Readonly<Record<UiSize, number>> = {
  small: 0.875,
  medium: 1,
  large: 1.125,
};

/** CSS pixels per UI unit: `densityBase × uiSize`. Divide CSS coordinates by it to get UI units. */
export function uiScaleFor(density: Density, uiSize: UiSize): number {
  return DENSITY_BASE_SCALE[density] * UI_SIZE_SCALE[uiSize];
}

/** The size class of a viewport measured in UI units. */
export function sizeClassFor(width: number, height: number): SizeClass {
  if (
    width < SIZE_CLASS_BREAKPOINTS.compactBelowWidth ||
    height < SIZE_CLASS_BREAKPOINTS.compactBelowHeight
  ) {
    return 'compact';
  }
  return width >= SIZE_CLASS_BREAKPOINTS.wideFromWidth ? 'wide' : 'regular';
}

/** Everything the viewport is resolved from; supplied by the host so `UiRoot` stays DOM-free. */
export interface ViewportInput {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly density: Density;
  readonly uiSize: UiSize;
  /** In CSS pixels. */
  readonly safeArea: SafeAreaInsets;
}

/** The resolved viewport for one frame. Rects are in UI units. */
export interface UiViewport {
  readonly uiScale: number;
  readonly density: Density;
  readonly size: SizeClass;
  /** The whole canvas. Scrims and full-screen blocks cover this. */
  readonly screen: Rect;
  /** The canvas minus the safe-area insets. Content is laid out in this. */
  readonly safe: Rect;
}

/**
 * The smallest screen the HUD is laid out for, in UI units: a small phone,
 * its long side and its short side, either way up. The UI is never scaled up
 * past the size that still gives the screen this much room, so the player's
 * UI size can't crowd a small phone past what its layout fits.
 */
export const MIN_LAYOUT_VIEWPORT = { long: 568, short: 320 } as const;

/** `uiScaleFor`, capped so the screen keeps at least {@link MIN_LAYOUT_VIEWPORT} of room. */
export function clampedUiScale(input: ViewportInput): number {
  const requested = uiScaleFor(input.density, input.uiSize);
  const longSide = Math.max(input.cssWidth, input.cssHeight);
  const shortSide = Math.min(input.cssWidth, input.cssHeight);
  const fitsLong = longSide / MIN_LAYOUT_VIEWPORT.long;
  const fitsShort = shortSide / MIN_LAYOUT_VIEWPORT.short;
  return Math.max(MIN_UI_SCALE, Math.min(requested, fitsLong, fitsShort));
}

/** Below this the UI is unreadable however small the screen; a smaller screen simply runs out of room. */
const MIN_UI_SCALE = 0.75;

export function resolveViewport(input: ViewportInput): UiViewport {
  const uiScale = clampedUiScale(input);
  const screen: Rect = { x: 0, y: 0, w: input.cssWidth / uiScale, h: input.cssHeight / uiScale };
  const safe = inset(screen, {
    t: input.safeArea.t / uiScale,
    r: input.safeArea.r / uiScale,
    b: input.safeArea.b / uiScale,
    l: input.safeArea.l / uiScale,
  });
  return {
    uiScale,
    density: input.density,
    size: sizeClassFor(safe.w, safe.h),
    screen,
    safe,
  };
}

const COARSE_POINTER_QUERY = '(pointer: coarse)';

let detectedDensity: Density | null = null;

/** `touch` when the primary pointer is a finger. Decided once per page load. */
export function detectDensity(): Density {
  if (detectedDensity !== null) return detectedDensity;
  const coarse =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COARSE_POINTER_QUERY).matches;
  detectedDensity = coarse ? 'touch' : 'pointer';
  return detectedDensity;
}

/** Matches the `#safe-area-probe` rule in `main.css`, which pads the element by `env(safe-area-inset-*)`. */
const SAFE_AREA_PROBE_ID = 'safe-area-probe';

function safeAreaProbe(): HTMLElement | null {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return null;
  const existing = document.getElementById(SAFE_AREA_PROBE_ID);
  if (existing !== null) return existing;
  const probe = document.createElement('div');
  probe.id = SAFE_AREA_PROBE_ID;
  probe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(probe);
  return probe;
}

function pixels(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The device's safe-area insets in CSS pixels, read from the probe's computed padding. */
export function readSafeAreaInsets(): SafeAreaInsets {
  const probe = safeAreaProbe();
  if (probe === null) return NO_INSETS;
  const style = getComputedStyle(probe);
  return {
    t: pixels(style.paddingTop),
    r: pixels(style.paddingRight),
    b: pixels(style.paddingBottom),
    l: pixels(style.paddingLeft),
  };
}

let insetsCache: { width: number; height: number; insets: SafeAreaInsets } | null = null;

/**
 * The live viewport input for the running game. Safe-area insets are re-read
 * only when the canvas size changes (a rotation), since a computed-style read
 * every frame is not free.
 */
export function browserViewportInput(): ViewportInput {
  const cssWidth = viewportWidth();
  const cssHeight = viewportHeight();
  if (insetsCache?.width !== cssWidth || insetsCache.height !== cssHeight) {
    insetsCache = { width: cssWidth, height: cssHeight, insets: readSafeAreaInsets() };
  }
  return {
    cssWidth,
    cssHeight,
    density: detectDensity(),
    uiSize: settings.uiSize,
    safeArea: insetsCache.insets,
  };
}
