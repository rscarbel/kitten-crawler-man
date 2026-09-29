/**
 * How readable the Big Top's hazards are against the floor around them, and
 * how bright the floor the crawlers walk on is — measured on the tent as the
 * scene draws it.
 *
 * The metric is WCAG's contrast ratio, `(L_hi + 0.05) / (L_lo + 0.05)`, taken
 * between two means of per-pixel relative luminance: every pixel of a tile
 * showing the hazard state, against every pixel of the ring of walkable floor
 * around it (tiles within {@link RING_RADIUS_TILES}, excluding any tile of the
 * same hazard family, so a warning is never scored against a neighbouring cell
 * of the same sweep). A ratio of 1 means the warning is invisible in luminance
 * alone; the ratio is symmetric, so a dark mark on light floor counts the same
 * as a light mark on dark floor.
 *
 * A lit tent is compared against the same tent drawn full-bright in the same
 * run: a mood pass may change the floor, but never how well a hazard stands
 * out of it. Contrast against the ring cannot see a dark laid evenly over a
 * hazard and its floor, so {@link measureHazardFidelity} scores each hazard
 * pixel against itself as well.
 */

import type { Canvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import type { GameMap } from '../src/map/GameMap.js';
import type { MazeTile } from '../src/map/bigTopMazeLayout.js';
import type { ForcedHazard, HazardState, TentView } from './bigTopInteriorHarness.js';

const CHANNELS_PER_PIXEL = 4;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const CHANNEL_MAX = 255;

/** sRGB transfer-function constants, as WCAG 2 defines relative luminance. */
const SRGB_LINEAR_KNEE = 0.03928;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
/** WCAG's flare term: keeps the ratio finite against pure black. */
const CONTRAST_FLARE = 0.05;

/** How far out the ring of surrounding floor reaches, in tiles, Chebyshev distance. */
export const RING_RADIUS_TILES = 2;

function linearChannel(value: number): number {
  const c = value / CHANNEL_MAX;
  return c <= SRGB_LINEAR_KNEE
    ? c / SRGB_LINEAR_SLOPE
    : ((c + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_SCALE) ** SRGB_GAMMA;
}

/** Linearised lookup, so a whole-tent measurement is not 12 million `**` calls. */
const LINEAR_BY_CHANNEL = Array.from({ length: CHANNEL_MAX + 1 }, (_, value) =>
  linearChannel(value),
);

function linearAt(value: number | undefined): number {
  return LINEAR_BY_CHANNEL[value ?? 0] ?? 0;
}

/** WCAG relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(red: number, green: number, blue: number): number {
  return LUMA_RED * linearAt(red) + LUMA_GREEN * linearAt(green) + LUMA_BLUE * linearAt(blue);
}

export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + CONTRAST_FLARE) / (lo + CONTRAST_FLARE);
}

/** A rendered frame's pixels, and where in the world they sit. */
export interface FramePixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly view: TentView;
  readonly scale: number;
}

export function framePixels(canvas: Canvas, view: TentView, scale: number): FramePixels {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  return { data, width: canvas.width, height: canvas.height, view, scale };
}

type PixelVisitor = (red: number, green: number, blue: number) => void;

/**
 * Visits every pixel of one tile. False, visiting nothing, when any of the
 * tile falls outside the frame — a partial tile is not the tile.
 */
function visitTile(frame: FramePixels, tile: MazeTile, visit: PixelVisitor): boolean {
  const size = TILE_SIZE * frame.scale;
  const left = (tile.x * TILE_SIZE - frame.view.camX) * frame.scale;
  const top = (tile.y * TILE_SIZE - frame.view.camY) * frame.scale;
  if (left < 0 || top < 0 || left + size > frame.width || top + size > frame.height) return false;
  for (let y = top; y < top + size; y++) {
    for (let x = left; x < left + size; x++) {
      const index = (y * frame.width + x) * CHANNELS_PER_PIXEL;
      visit(
        frame.data[index] ?? 0,
        frame.data[index + GREEN_OFFSET] ?? 0,
        frame.data[index + BLUE_OFFSET] ?? 0,
      );
    }
  }
  return true;
}

/** Mean relative luminance of every pixel of one tile, or null when it is not all in frame. */
export function tileLuminance(frame: FramePixels, tile: MazeTile): number | null {
  let total = 0;
  let count = 0;
  const inFrame = visitTile(frame, tile, (red, green, blue) => {
    total += relativeLuminance(red, green, blue);
    count++;
  });
  return inFrame && count > 0 ? total / count : null;
}

/**
 * How busy one tile's pixels are: the mean luminance step between each pixel
 * and its right and lower neighbours inside the tile. Flat paint scores near
 * zero; stripes, grain and props score high. Null when the tile is not all in
 * frame.
 */
export function tileTexture(frame: FramePixels, tile: MazeTile): number | null {
  const size = TILE_SIZE * frame.scale;
  const left = (tile.x * TILE_SIZE - frame.view.camX) * frame.scale;
  const top = (tile.y * TILE_SIZE - frame.view.camY) * frame.scale;
  if (left < 0 || top < 0 || left + size > frame.width || top + size > frame.height) return null;
  const luminanceAt = (x: number, y: number): number => {
    const index = (y * frame.width + x) * CHANNELS_PER_PIXEL;
    return relativeLuminance(
      frame.data[index] ?? 0,
      frame.data[index + GREEN_OFFSET] ?? 0,
      frame.data[index + BLUE_OFFSET] ?? 0,
    );
  };
  let total = 0;
  let steps = 0;
  for (let y = top; y < top + size; y++) {
    for (let x = left; x < left + size; x++) {
      const here = luminanceAt(x, y);
      if (x + 1 < left + size) {
        total += Math.abs(luminanceAt(x + 1, y) - here);
        steps++;
      }
      if (y + 1 < top + size) {
        total += Math.abs(luminanceAt(x, y + 1) - here);
        steps++;
      }
    }
  }
  return steps === 0 ? null : total / steps;
}

interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function colourDistance(red: number, green: number, blue: number, from: Rgb): number {
  return Math.hypot(red - from.red, green - from.green, blue - from.blue);
}

export interface HazardTileContrast {
  readonly tile: MazeTile;
  readonly hazardLuminance: number;
  readonly ringLuminance: number;
  readonly ringTiles: number;
  /** WCAG contrast ratio of the tile's mean luminance against the ring's. */
  readonly contrast: number;
  /**
   * How much further the tile's pixels stray from the ring's mean colour than
   * the ring's own pixels do, in sRGB units (0–441). Luminance alone misses a
   * warning drawn as a hue — an orange ring on tan sawdust scores a contrast
   * ratio near 1 — so this is the second half of "can the player see it".
   * Subtracting the ring's own spread keeps a busy floor texture from counting
   * as signal.
   */
  readonly salience: number;
}

export interface HazardContrastReport {
  readonly state: HazardState;
  readonly samples: ReadonlyArray<HazardTileContrast>;
  /** Tiles showing the state that could not be scored: off frame, or no floor around them. */
  readonly unmeasured: ReadonlyArray<MazeTile>;
  readonly minContrast: number;
  readonly medianContrast: number;
  readonly minSalience: number;
  readonly medianSalience: number;
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length % 2 === 1) return sorted[middle] ?? Number.NaN;
  return ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2;
}

const tileKey = (tile: MazeTile): string => `${tile.x},${tile.y}`;

function ringAround(
  frame: FramePixels,
  map: GameMap,
  tile: MazeTile,
  family: ReadonlySet<string>,
): MazeTile[] {
  const ring: MazeTile[] = [];
  for (let dy = -RING_RADIUS_TILES; dy <= RING_RADIUS_TILES; dy++) {
    for (let dx = -RING_RADIUS_TILES; dx <= RING_RADIUS_TILES; dx++) {
      const neighbour = { x: tile.x + dx, y: tile.y + dy };
      if (family.has(tileKey(neighbour)) || !map.isWalkable(neighbour.x, neighbour.y)) continue;
      if (tileLuminance(frame, neighbour) === null) continue;
      ring.push(neighbour);
    }
  }
  return ring;
}

function scoreTile(
  frame: FramePixels,
  tile: MazeTile,
  ring: ReadonlyArray<MazeTile>,
): HazardTileContrast | null {
  let ringLuminanceTotal = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let ringPixels = 0;
  for (const neighbour of ring) {
    visitTile(frame, neighbour, (r, g, b) => {
      ringLuminanceTotal += relativeLuminance(r, g, b);
      red += r;
      green += g;
      blue += b;
      ringPixels++;
    });
  }
  const hazardLuminance = tileLuminance(frame, tile);
  if (hazardLuminance === null || ringPixels === 0) return null;
  const ringMean: Rgb = {
    red: red / ringPixels,
    green: green / ringPixels,
    blue: blue / ringPixels,
  };

  let ringSpread = 0;
  for (const neighbour of ring) {
    visitTile(frame, neighbour, (r, g, b) => {
      ringSpread += colourDistance(r, g, b, ringMean);
    });
  }
  let tileSpread = 0;
  let tilePixels = 0;
  visitTile(frame, tile, (r, g, b) => {
    tileSpread += colourDistance(r, g, b, ringMean);
    tilePixels++;
  });

  const ringLuminance = ringLuminanceTotal / ringPixels;
  return {
    tile,
    hazardLuminance,
    ringLuminance,
    ringTiles: ring.length,
    contrast: contrastRatio(hazardLuminance, ringLuminance),
    salience: tileSpread / tilePixels - ringSpread / ringPixels,
  };
}

/** Scores every tile showing `hazard` against its ring of surrounding floor. */
export function measureHazardContrast(
  frame: FramePixels,
  map: GameMap,
  hazard: ForcedHazard,
): HazardContrastReport {
  const family = new Set(hazard.family.map(tileKey));
  const samples: HazardTileContrast[] = [];
  const unmeasured: MazeTile[] = [];
  for (const tile of hazard.tiles) {
    const sample = scoreTile(frame, tile, ringAround(frame, map, tile, family));
    if (sample === null) unmeasured.push(tile);
    else samples.push(sample);
  }
  const contrasts = samples.map((sample) => sample.contrast);
  const saliences = samples.map((sample) => sample.salience);
  return {
    state: hazard.state,
    samples,
    unmeasured,
    minContrast: contrasts.length === 0 ? Number.NaN : Math.min(...contrasts),
    medianContrast: median(contrasts),
    minSalience: saliences.length === 0 ? Number.NaN : Math.min(...saliences),
    medianSalience: median(saliences),
  };
}

export interface LuminanceSpread {
  readonly tiles: number;
  readonly min: number;
  readonly p5: number;
  readonly p10: number;
  readonly median: number;
  readonly mean: number;
}

const TWENTIETH = 0.05;
const TENTH = 0.1;

export function spreadOf(values: ReadonlyArray<number>): LuminanceSpread {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    tiles: sorted.length,
    min: sorted[0] ?? Number.NaN,
    p5: sorted[Math.floor(sorted.length * TWENTIETH)] ?? Number.NaN,
    p10: sorted[Math.floor(sorted.length * TENTH)] ?? Number.NaN,
    median: median(sorted),
    mean: sorted.length === 0 ? Number.NaN : total / sorted.length,
  };
}

/**
 * Per-tile luminance of the sawdust in a band of rows: every walkable tile
 * whose tile type is the tent's floor. The flaps the party came in by are a
 * doorway rather than floor and dark by design, and are left out by that rule
 * rather than by coordinates.
 */
export function measureFloorInRows(
  frame: FramePixels,
  map: GameMap,
  rows: { readonly y0: number; readonly y1: number },
  floorType: number,
): LuminanceSpread {
  const floor: number[] = [];
  for (let y = rows.y0; y <= rows.y1; y++) {
    const row = map.structure[y] ?? [];
    row.forEach((tile, x) => {
      if (tile.type !== floorType || !map.isWalkable(x, y)) return;
      const luminance = tileLuminance(frame, { x, y });
      if (luminance !== null) floor.push(luminance);
    });
  }
  return spreadOf(floor);
}

/**
 * Per-tile luminance of every walkable tile and every solid one in a frame of
 * the whole tent, for "the floor stays readable" and "the mass stays darker".
 */
export function measureTentLuminance(
  frame: FramePixels,
  map: GameMap,
): { floor: LuminanceSpread; solid: LuminanceSpread } {
  const floor: number[] = [];
  const solid: number[] = [];
  map.structure.forEach((row, y) => {
    row.forEach((_, x) => {
      const luminance = tileLuminance(frame, { x, y });
      if (luminance === null) return;
      (map.isWalkable(x, y) ? floor : solid).push(luminance);
    });
  });
  return { floor: spreadOf(floor), solid: spreadOf(solid) };
}

// ── Fidelity: the hazard as painted ──────────────────────────────────────────

/**
 * A pixel belongs to a hazard when the hazard moved it at least this far from
 * its bare stage in the full-bright frame, in sRGB units (0–441): where the
 * warning or the flame dominates the pixel, rather than feathering out over
 * the floor.
 */
export const HAZARD_PIXEL_SIGNAL_MIN = 48;

export interface HazardFidelityReport {
  readonly state: HazardState;
  /** Hazard pixels measured, across every tile showing the state. */
  readonly pixels: number;
  /** Mean distance those pixels were moved by the hazard, full-bright. */
  readonly meanSignal: number;
  /** Mean distance those pixels moved between full-bright and the frame measured. */
  readonly meanDrift: number;
  /**
   * How much of the hazard's own look reaches the frame: 1 less the drift as a
   * share of the signal. A warning drawn over the stage lights keeps its
   * colour wherever it is opaque and scores near 1; the same warning drawn
   * beneath them is darkened and tinted with the act's dark, and scores well
   * under.
   */
  readonly fidelity: number;
}

/**
 * Scores how far the pixels a hazard paints keep their full-bright colour in
 * `frame`. Unlike contrast against the ring of floor, which a dark laid over
 * the hazard and its floor alike leaves untouched, this compares each hazard
 * pixel with itself, so it sees a warning drawn under the mask.
 *
 * `fullBright` and `fullBrightBare` are the same frame drawn without stage
 * lights, with and without the maze's hazard layers.
 */
export function measureHazardFidelity(
  frame: FramePixels,
  fullBright: FramePixels,
  fullBrightBare: FramePixels,
  hazard: ForcedHazard,
): HazardFidelityReport {
  let pixels = 0;
  let signal = 0;
  let drift = 0;
  const pixelAt = (source: FramePixels, index: number): Rgb => ({
    red: source.data[index] ?? 0,
    green: source.data[index + GREEN_OFFSET] ?? 0,
    blue: source.data[index + BLUE_OFFSET] ?? 0,
  });
  for (const tile of hazard.tiles) {
    const size = TILE_SIZE * frame.scale;
    const left = (tile.x * TILE_SIZE - frame.view.camX) * frame.scale;
    const top = (tile.y * TILE_SIZE - frame.view.camY) * frame.scale;
    if (left < 0 || top < 0 || left + size > frame.width || top + size > frame.height) continue;
    for (let y = top; y < top + size; y++) {
      for (let x = left; x < left + size; x++) {
        const index = (y * frame.width + x) * CHANNELS_PER_PIXEL;
        const painted = pixelAt(fullBright, index);
        const bare = pixelAt(fullBrightBare, index);
        const moved = colourDistance(painted.red, painted.green, painted.blue, bare);
        if (moved < HAZARD_PIXEL_SIGNAL_MIN) continue;
        const shown = pixelAt(frame, index);
        pixels++;
        signal += moved;
        drift += colourDistance(shown.red, shown.green, shown.blue, painted);
      }
    }
  }
  return {
    state: hazard.state,
    pixels,
    meanSignal: pixels === 0 ? Number.NaN : signal / pixels,
    meanDrift: pixels === 0 ? Number.NaN : drift / pixels,
    fidelity: signal === 0 ? Number.NaN : 1 - drift / signal,
  };
}
