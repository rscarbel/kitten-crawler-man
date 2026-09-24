/**
 * The fairies' art gates.
 *
 * Every invariant here is measured against cells painted from the kinds'
 * `FigureDef`s exactly as the runtime cache bakes them, or against the pose
 * stream itself where no pixels are needed. Failures accumulate rather than
 * throwing one at a time, so one run reports everything that is wrong; a gate
 * whose filtered loop examined nothing fails loudly rather than passing.
 *
 *   npm run gates:fairy        the gates alone
 *   npm run render:fairy       the gates, then the review sheets
 */

import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { paintFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import {
  DETAIL_MIN_FIGURE_PX,
  FAIRY_FIGURE_HEIGHT_TILES,
  GROUND_Y,
  fairyBodyMeasure,
} from '../src/sprites/art/fairyArt.js';
import {
  FAIRY_VIEWS,
  TILE_SCALE,
  fairyFigureOf,
  fairyPoseOf,
  fairyStateName,
} from '../src/sprites/art/fairyFigure.js';
import {
  FAIRY_HOVER_FPS,
  FAIRY_HOVER_LIFT_TILES,
  FAIRY_COMMON_ROWS,
  FAIRY_KINDS,
  type FairyKind,
  fairyHoverFps,
  fairyRowFrames,
  fairyRowSpec,
  fairyRowsOf,
} from '../src/sprites/art/fairyTiming.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import { fairyCrownBelowTileTopTiles, fairySpriteStatesOf } from '../src/sprites/fairySprite.js';
import { HP_BAR_HEIGHT, HP_BAR_Y_OFFSET } from '../src/Player.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const PERCENT = 100;
const CHANNEL_MAX = 255;
/** Decimal places in a reported measurement. */
const REPORT_DECIMALS = 3;
/** Two floats this close are the same wing phase. */
const PHASE_EPSILON = 1e-9;
/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_DENSITY = IN_GAME_TILE / TILE_SCALE;
/** The figure paints in tile units about the tile's centre. */
const TILE_CENTRE_SHARE = 0.5;
/**
 * Solid ink: body and wings. Above the glow's core and the ground shadow,
 * both of which are translucent on purpose and would otherwise be measured as
 * the creature.
 */
const SOLID_ALPHA = 190;
/** The cache's global ceiling, which every painted figure in the game shares. */
const GLOBAL_CACHE_MEGABYTES = 96;
/** One fairy's share of that ceiling with all five kinds on one floor. */
const MAX_SHARE_OF_GLOBAL_CACHE = 0.25;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Pixels ───────────────────────────────────────────────────────────────────

interface Cell {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const cellCache = new Map<string, Cell>();

/** One cell at a density, as the cache would bake it for that tile size. */
function cellOf(kind: FairyKind, state: string, frame: number, density: number): Cell {
  const key = `${kind}.${state}[${frame}]@${density}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const canvas = paintFigureCell(fairyFigureOf(kind), state, frame, density);
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  const cell = { width, height, data };
  cellCache.set(key, cell);
  return cell;
}

function alphaAt(cell: Cell, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= cell.width || y >= cell.height) return 0;
  return cell.data[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET];
}

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function solidBox(cell: Cell): Box | null {
  let minX = cell.width;
  let minY = cell.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < SOLID_ALPHA) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** The ground line's row in a cell painted at `density`. */
function groundRow(kind: FairyKind, density: number): number {
  const figure = fairyFigureOf(kind);
  return (figure.tileY + TILE_SCALE / 2 + GROUND_Y * TILE_SCALE) * density;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;

function rgbOf(hex: string): [number, number, number] {
  const channel = (index: number): number =>
    parseInt(hex.slice(1 + index * HEX_PAIR, 1 + (index + 1) * HEX_PAIR), HEX_RADIX);
  return [channel(0), channel(1), channel(2)];
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * G1 — every declared state paints every declared frame, nothing paints
 * against the cell edge, and the cell is not mostly empty.
 */
function gateStructure(): void {
  for (const kind of FAIRY_KINDS) {
    for (const failure of figureStructuralFailures(fairyFigureOf(kind))) fail('G1', failure);
  }
}

// ── G2 runtime state names ───────────────────────────────────────────────────

/** G2 — every state the sprite wrapper can ask for is one the figure paints. */
function gateRuntimeStates(): void {
  for (const kind of FAIRY_KINDS) {
    for (const failure of missingStateFailures(
      fairyFigureOf(kind),
      fairySpriteStatesOf(kind),
      `fairySpriteStatesOf('${kind}')`,
    )) {
      fail('G2', failure);
    }
  }
}

// ── G3 size is read by heads ─────────────────────────────────────────────────

const MIN_HEADS_TALL = 3;
const MAX_HEADS_TALL = 3.5;
const HEIGHT_TOLERANCE_TILES = 0.05;

/**
 * G3 — the fairy is three to three and a half heads tall, and about the height
 * it is meant to be. Size is read by counting heads: at the repo's ordinary
 * five the same body reads as a small person, not a fairy.
 */
function gateHeadsTall(): void {
  const { heightTiles, headTiles } = fairyBodyMeasure();
  const heads = heightTiles / headTiles;
  if (heads < MIN_HEADS_TALL || heads > MAX_HEADS_TALL) {
    fail(
      'G3',
      `the fairy is ${heads.toFixed(2)} heads tall, outside ${MIN_HEADS_TALL}–${MAX_HEADS_TALL}`,
    );
  }
  if (Math.abs(heightTiles - FAIRY_FIGURE_HEIGHT_TILES) > HEIGHT_TOLERANCE_TILES) {
    fail(
      'G3',
      `the body measures ${heightTiles.toFixed(REPORT_DECIMALS)} tiles crown to toe against the ` +
        `${FAIRY_FIGURE_HEIGHT_TILES} it is declared`,
    );
  }
}

// ── G4 wings are the silhouette ──────────────────────────────────────────────

/**
 * With every wing cut to a stub the five kinds measure 0.38–0.50 as wide as
 * they are tall (the shroud, the skirt and the flung arms account for the
 * spread), and with their wings 0.68 and up through the whole beat. The floor
 * sits between the two: it is the wings that make the silhouette wide.
 */
const MIN_HOVER_WIDTH_OVER_HEIGHT = 0.6;

/** G4 — from the front and from behind, the wings make the silhouette wide. */
function gateWingsDominate(): void {
  let measured = 0;
  for (const kind of FAIRY_KINDS) {
    for (const view of ['front', 'away'] as const) {
      const state = fairyStateName('hover', view);
      for (let frame = 0; frame < fairyRowFrames('hover'); frame++) {
        const box = solidBox(cellOf(kind, state, frame, 1));
        if (box === null) {
          fail('G4', `${kind}.${state}[${frame}] paints no solid ink`);
          continue;
        }
        measured++;
        const ratio = (box.maxX - box.minX + 1) / (box.maxY - box.minY + 1);
        if (ratio >= MIN_HOVER_WIDTH_OVER_HEIGHT) continue;
        fail(
          'G4',
          `${kind}.${state}[${frame}] is ${ratio.toFixed(2)} as wide as it is tall ` +
            `(at least ${MIN_HOVER_WIDTH_OVER_HEIGHT}) — the wings no longer carry the silhouette`,
        );
      }
    }
  }
  failUnlessMeasured('G4', measured, 'hover frames');
}

// ── G5 the wingbeat is sampled, and loops ────────────────────────────────────

/** Under this many frames per beat the down- and up-strokes alias into a twitch. */
const MIN_FRAMES_PER_WINGBEAT = 6;
/** A loop's seam, as a share of its median frame-to-frame change. */
const LOOP_SEAM_FLOOR = 0.3;
const LOOP_SEAM_CEILING = 1.6;

function coverageDelta(a: Cell, b: Cell): number {
  let differing = 0;
  for (let i = ALPHA_OFFSET; i < a.data.length; i += CHANNELS) {
    if (a.data[i] >= SOLID_ALPHA !== b.data[i] >= SOLID_ALPHA) differing++;
  }
  return differing;
}

/**
 * G5 — the hover row gives the wingbeat at least six pictures, advances the
 * beat by exactly one frame's share each frame, closes its loop without a
 * held frame or a jump, and plays no faster than the game can show.
 */
function gateWingbeat(): void {
  const frames = fairyRowFrames('hover');
  if (frames < MIN_FRAMES_PER_WINGBEAT) {
    fail('G5', `hover has ${frames} frames per wingbeat, under ${MIN_FRAMES_PER_WINGBEAT}`);
  }
  for (const kind of FAIRY_KINDS) {
    const fps = fairyHoverFps(kind);
    if (!(fps > 0 && fps <= FAIRY_HOVER_FPS)) {
      fail(
        'G5',
        `${kind} hovers at ${fps} fps, outside (0, ${FAIRY_HOVER_FPS}] — past the ceiling the ` +
          'row is skipped rather than played',
      );
    }
    for (let frame = 0; frame < frames; frame++) {
      const phase = fairyPoseOf(kind, 'hover', frame).wingPhase;
      const expected = frame / frames;
      if (Math.abs(phase - expected) > PHASE_EPSILON) {
        fail(
          'G5',
          `${kind}.hover[${frame}] is at wing phase ${phase.toFixed(REPORT_DECIMALS)}, not ${expected.toFixed(REPORT_DECIMALS)}`,
        );
      }
    }
  }
  let loops = 0;
  for (const kind of FAIRY_KINDS) {
    for (const view of FAIRY_VIEWS) {
      const state = fairyStateName('hover', view);
      const cells = Array.from({ length: frames }, (_unused, frame) =>
        cellOf(kind, state, frame, 1),
      );
      const steps = cells.slice(1).map((cell, index) => coverageDelta(cells[index], cell));
      const seam = coverageDelta(cells[frames - 1], cells[0]);
      const typical = median(steps);
      loops++;
      if (typical === 0) {
        fail('G5', `${kind}.${state} never changes from frame to frame`);
        continue;
      }
      const share = seam / typical;
      if (share < LOOP_SEAM_FLOOR || share > LOOP_SEAM_CEILING) {
        fail(
          'G5',
          `${kind}.${state} closes its loop with a ${seam}px seam against a median step of ` +
            `${typical}px (${share.toFixed(2)}×, band ${LOOP_SEAM_FLOOR}–${LOOP_SEAM_CEILING}×)`,
        );
      }
    }
  }
  failUnlessMeasured('G5', loops, 'hover loops');
}

// ── G6 every frame is a picture ──────────────────────────────────────────────

/** G6 — no row paints the same picture twice, which is a row with fewer frames than it declares. */
function gateDistinctFrames(): void {
  for (const kind of FAIRY_KINDS) {
    const figure = fairyFigureOf(kind);
    const report = distinctFrameFailures(
      figure,
      (state, frame) => cellOf(kind, state, frame, 1).data,
    );
    for (const failure of report.failures) fail('G6', failure);
  }
}

// ── G7 it reads on every floor ───────────────────────────────────────────────

/**
 * The floors a fairy fights on, darkest to palest. Colours are the ground
 * materials' measured fallback tones: the dungeon's shadowed floor, floor
 * one's flagstone, and floor two's terrazzo, the palest floor in the game.
 */
const FLOORS: readonly {
  readonly name: string;
  readonly color: readonly [number, number, number];
}[] = [
  { name: 'dungeon', color: rgbOf('#191720') },
  { name: 'flagstone', color: rgbOf('#7e7463') },
  { name: 'terrazzo', color: rgbOf('#b1b3b0') },
];
const DARKEST_FLOOR = FLOORS[0];
const PALEST_FLOOR = FLOORS[FLOORS.length - 1];
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
/** A luminance step the eye reads as an edge at 32 px. */
const MIN_EDGE_STEP = 40;
/**
 * Share of the silhouette's outline pixels at which the edge is visible: the
 * outline pixel itself, or the fill within {@link EDGE_REACH_PX} inside it,
 * steps off the floor. A mid-blue outline on a mid-brown floor is invisible,
 * and the edge still reads because the white fill beside it is not.
 */
const MIN_READABLE_EDGE_SHARE = 0.8;
const EDGE_REACH_PX = 2;
/** The outline's own step against the floor it exists for. */
const MIN_OUTLINE_STEP = 45;

function luminance(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/** A pixel of the cell composited over a floor colour, as luminance. */
function compositeLuminance(
  cell: Cell,
  index: number,
  floor: readonly [number, number, number],
): number {
  const a = cell.data[index + ALPHA_OFFSET] / CHANNEL_MAX;
  const r = cell.data[index] * a + floor[0] * (1 - a);
  const g = cell.data[index + 1] * a + floor[1] * (1 - a);
  const b = cell.data[index + 2] * a + floor[2] * (1 - a);
  return luminance(r, g, b);
}

/**
 * The silhouette's outer band: solid pixels within `depth` pixels of a pixel
 * that is not solid. The outermost ring (depth 1) is the outline itself.
 */
function outerBand(cell: Cell, depth: number): number[] {
  const indices: number[] = [];
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < SOLID_ALPHA) continue;
      let edge = false;
      for (let dy = -depth; dy <= depth && !edge; dy++) {
        for (let dx = -depth; dx <= depth && !edge; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > depth) continue;
          if (alphaAt(cell, x + dx, y + dy) < SOLID_ALPHA) edge = true;
        }
      }
      if (edge) indices.push((y * cell.width + x) * CHANNELS);
    }
  }
  return indices;
}

const OUTLINE_DEPTH = 1;

/**
 * G7 — at the in-game 32 px size, on every floor, most of each fairy's outer
 * band stands off the floor by a readable step. And the two kinds painted
 * close to a floor's own value carry the outline that saves them: the white
 * ice fairy's cool-blue outline is dark enough to read on the palest floor,
 * and the near-black necro fairy's rim is light enough to read on the darkest.
 * Measured on every view of the first hover frame.
 */
function gateReadsOnEveryFloor(): void {
  let measured = 0;
  for (const kind of FAIRY_KINDS) {
    for (const view of FAIRY_VIEWS) {
      const state = fairyStateName('hover', view);
      const cell = cellOf(kind, state, 0, IN_GAME_DENSITY);
      const ring = outerBand(cell, OUTLINE_DEPTH);
      if (ring.length === 0) {
        fail('G7', `${kind}.${state} has no outline at 32 px`);
        continue;
      }
      for (const floor of FLOORS) {
        measured++;
        const floorLuma = luminance(...floor.color);
        const standsOff = (x: number, y: number): boolean =>
          alphaAt(cell, x, y) >= SOLID_ALPHA &&
          Math.abs(
            compositeLuminance(cell, (y * cell.width + x) * CHANNELS, floor.color) - floorLuma,
          ) >= MIN_EDGE_STEP;
        const readable = ring.filter((index) => {
          const pixel = index / CHANNELS;
          const x = pixel % cell.width;
          const y = Math.floor(pixel / cell.width);
          for (let dy = -EDGE_REACH_PX; dy <= EDGE_REACH_PX; dy++) {
            for (let dx = -EDGE_REACH_PX; dx <= EDGE_REACH_PX; dx++) {
              if (Math.abs(dx) + Math.abs(dy) > EDGE_REACH_PX) continue;
              if (standsOff(x + dx, y + dy)) return true;
            }
          }
          return false;
        }).length;
        const share = readable / ring.length;
        if (share >= MIN_READABLE_EDGE_SHARE) continue;
        fail(
          'G7',
          `${kind}.${state} on ${floor.name}: ${(share * PERCENT).toFixed(0)}% of its outline has ` +
            `a pixel ${MIN_EDGE_STEP} luminance off the floor at or just inside it (at least ` +
            `${MIN_READABLE_EDGE_SHARE * PERCENT}%) — it melts into the ground at 32 px`,
        );
      }
      const outlineFloor = kind === 'ice' ? PALEST_FLOOR : kind === 'necro' ? DARKEST_FLOOR : null;
      if (outlineFloor === null) continue;
      const floorLuma = luminance(...outlineFloor.color);
      const step = Math.abs(
        median(ring.map((index) => compositeLuminance(cell, index, outlineFloor.color))) -
          floorLuma,
      );
      if (step >= MIN_OUTLINE_STEP) continue;
      fail(
        'G7',
        `${kind}.${state}'s outline is a median ${step.toFixed(0)} luminance off the ` +
          `${outlineFloor.name} floor (at least ${MIN_OUTLINE_STEP}) — the rim it needs is not there`,
      );
    }
  }
  failUnlessMeasured('G7', measured, 'kind, view and floor combinations');
}

// ── G8 it hovers ─────────────────────────────────────────────────────────────

/** Share of the declared lift the lowest solid pixel must keep clear of the ground. */
const MIN_AIR_GAP_SHARE = 0.6;
/** The ground shadow must be painted within this many pixels of the ground line. */
const SHADOW_SEARCH_PX = 4;
const SHADOW_MIN_ALPHA = 20;

/**
 * G8 — every hover frame hangs clear of the ground by most of the hover lift,
 * with its shadow painted at the ground line: the shadow is where the player
 * reads the fairy's position for melee range, and a figure whose feet reach
 * the ground reads as standing.
 */
function gateHovers(): void {
  let measured = 0;
  for (const kind of FAIRY_KINDS) {
    const ground = groundRow(kind, 1);
    for (const view of FAIRY_VIEWS) {
      const state = fairyStateName('hover', view);
      for (let frame = 0; frame < fairyRowFrames('hover'); frame++) {
        const cell = cellOf(kind, state, frame, 1);
        const box = solidBox(cell);
        if (box === null) continue;
        measured++;
        const gapTiles = (ground - box.maxY) / TILE_SCALE;
        if (gapTiles < FAIRY_HOVER_LIFT_TILES * MIN_AIR_GAP_SHARE) {
          fail(
            'G8',
            `${kind}.${state}[${frame}] hangs ${gapTiles.toFixed(2)} tiles above the ground ` +
              `(at least ${(FAIRY_HOVER_LIFT_TILES * MIN_AIR_GAP_SHARE).toFixed(2)})`,
          );
        }
        const centreX = Math.round(cell.width / 2);
        let shadow = 0;
        for (let dy = -SHADOW_SEARCH_PX; dy <= SHADOW_SEARCH_PX; dy++) {
          shadow = Math.max(shadow, alphaAt(cell, centreX, Math.round(ground) + dy));
        }
        if (shadow < SHADOW_MIN_ALPHA) {
          fail('G8', `${kind}.${state}[${frame}] paints no shadow at the ground line`);
        }
      }
    }
  }
  failUnlessMeasured('G8', measured, 'hover frames');
}

// ── G9 the death falls, then fades ───────────────────────────────────────────

/**
 * How close to the ground line the fallen body's lowest pixel must come. The
 * shipped deaths all lie 0.11–0.27 tiles past it (the body rolls flat across
 * the line); one held just 0.12 tiles up is a fairy that never came down.
 */
const LANDED_TOLERANCE_TILES = 0.04;
/** The last death frame may keep this share of full opacity: a trace, not a body. */
const FINAL_FRAME_MAX_OPACITY = 0.4;
const FINAL_FRAME_MAX_ALPHA = FINAL_FRAME_MAX_OPACITY * CHANNEL_MAX;
const FIRST_FRAME_MIN_ALPHA = 250;

/** The lowest row of the largest 4-connected piece of solid ink, or -1 when there is none. */
function largestSolidBottom(cell: Cell): number {
  const seen = new Uint8Array(cell.width * cell.height);
  let bestSize = 0;
  let bestBottom = -1;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] === 1) continue;
    seen[start] = 1;
    if (cell.data[start * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
    let size = 0;
    let bottom = -1;
    const stack = [start];
    while (stack.length > 0) {
      const pixel = stack.pop() ?? 0;
      size++;
      const x = pixel % cell.width;
      const y = Math.floor(pixel / cell.width);
      bottom = Math.max(bottom, y);
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cell.width || ny >= cell.height) continue;
        const next = ny * cell.width + nx;
        if (seen[next] === 1) continue;
        seen[next] = 1;
        if (cell.data[next * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA) stack.push(next);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestBottom = bottom;
    }
  }
  return bestBottom;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function maxAlpha(cell: Cell): number {
  let peak = 0;
  for (let i = ALPHA_OFFSET; i < cell.data.length; i += CHANNELS)
    peak = Math.max(peak, cell.data[i]);
  return peak;
}

/**
 * G9 — the death row starts solid, reaches the ground (its solid ink comes
 * down to the ground line), and ends on a faded frame, so the corpse fizzles
 * out rather than popping. "Reaches the ground" is measured on the largest
 * connected piece of solid ink — the body — because the landing dust, the
 * shadow and the debris all sit at or near the ground line, and any of them
 * would answer "did it fall" for a body that never came down.
 */
function gateDeath(): void {
  const frames = fairyRowFrames('death');
  let measured = 0;
  for (const kind of FAIRY_KINDS) {
    const ground = groundRow(kind, 1);
    for (const view of FAIRY_VIEWS) {
      const state = fairyStateName('death', view);
      measured++;
      if (maxAlpha(cellOf(kind, state, 0, 1)) < FIRST_FRAME_MIN_ALPHA) {
        fail('G9', `${kind}.${state}[0] is already fading`);
      }
      const last = maxAlpha(cellOf(kind, state, frames - 1, 1));
      if (last > FINAL_FRAME_MAX_ALPHA) {
        fail(
          'G9',
          `${kind}.${state}'s last frame peaks at alpha ${last} (at most ${FINAL_FRAME_MAX_ALPHA}) — ` +
            'the corpse pops rather than fizzling',
        );
      }
      let lowest = -1;
      for (let frame = 0; frame < frames; frame++) {
        lowest = Math.max(lowest, largestSolidBottom(cellOf(kind, state, frame, 1)));
      }
      const shortfall = (ground - lowest) / TILE_SCALE;
      if (lowest < 0 || shortfall > LANDED_TOLERANCE_TILES) {
        fail(
          'G9',
          `${kind}.${state} never falls: its lowest solid pixel stays ${shortfall.toFixed(2)} ` +
            `tiles above the ground (within ${LANDED_TOLERANCE_TILES})`,
        );
      }
    }
  }
  failUnlessMeasured('G9', measured, 'death rows');
}

// ── G10 the release is drawn on the release frame ────────────────────────────

/**
 * G10 — for every cast row, the pose on the table's release frame is the first
 * that shows the spell leaving, and the frame before it still shows the
 * gathering. Behaviour code fires on the table's frame, so a choreography
 * whose release has drifted puts the hit on a hand that has not thrown.
 */
function gateReleaseFrames(): void {
  let measured = 0;
  for (const kind of FAIRY_KINDS) {
    for (const row of fairyRowsOf(kind)) {
      const spec = fairyRowSpec(row);
      const release = spec.releaseFrame;
      if (release === null) continue;
      measured++;
      if (release < 1 || release >= spec.frames) {
        fail('G10', `${row} releases on frame ${release} of ${spec.frames}`);
        continue;
      }
      const before = fairyPoseOf(kind, row, release - 1);
      const at = fairyPoseOf(kind, row, release);
      if (before.effectRelease > 0) {
        fail(
          'G10',
          `${kind}.${row}[${release - 1}] already shows the release, a frame before the table's`,
        );
      }
      if (at.effectRelease <= 0) {
        fail('G10', `${kind}.${row}[${release}] is the table's release frame but draws no release`);
      }
      if (before.effect === 'none' || before.effectAmount <= 0) {
        fail('G10', `${kind}.${row}[${release - 1}] shows nothing gathering before the release`);
      }
    }
  }
  failUnlessMeasured('G10', measured, 'cast rows');
}

// ── G11 the kinds are not palette swaps ──────────────────────────────────────

/** Share of the union of two kinds' silhouettes that only one of them covers. */
const MIN_SILHOUETTE_DIFFERENCE = 0.14;

/**
 * G11 — every pair of kinds differs in outline, not only in colour, at the
 * in-game size: a palette swap passes a colour gate and fails the player, who
 * reads shape first.
 */
function gateKindsDiffer(): void {
  let pairs = 0;
  for (const view of FAIRY_VIEWS) {
    const state = fairyStateName('hover', view);
    for (let a = 0; a < FAIRY_KINDS.length; a++) {
      for (let b = a + 1; b < FAIRY_KINDS.length; b++) {
        const first = cellOf(FAIRY_KINDS[a], state, 0, IN_GAME_DENSITY);
        const second = cellOf(FAIRY_KINDS[b], state, 0, IN_GAME_DENSITY);
        let union = 0;
        let only = 0;
        for (let i = ALPHA_OFFSET; i < first.data.length; i += CHANNELS) {
          const inFirst = first.data[i] >= SOLID_ALPHA;
          const inSecond = second.data[i] >= SOLID_ALPHA;
          if (inFirst || inSecond) union++;
          if (inFirst !== inSecond) only++;
        }
        pairs++;
        const share = union === 0 ? 0 : only / union;
        if (share >= MIN_SILHOUETTE_DIFFERENCE) continue;
        fail(
          'G11',
          `${FAIRY_KINDS[a]} and ${FAIRY_KINDS[b]} share all but ${(share * PERCENT).toFixed(1)}% ` +
            `of their ${state} silhouette (at least ${MIN_SILHOUETTE_DIFFERENCE * PERCENT}%)`,
        );
      }
    }
  }
  failUnlessMeasured('G11', pairs, 'kind pairs');
}

// ── G12 fine detail only where it resolves ───────────────────────────────────

/**
 * G12 — the detail threshold sits between the in-game size and the review
 * size: veins and facets are skipped at 32 px, where they would be sub-two-
 * pixel noise, and painted at the 64 px the figure is reviewed at.
 */
function gateDetailThreshold(): void {
  const inGamePx = FAIRY_FIGURE_HEIGHT_TILES * IN_GAME_TILE;
  const reviewPx = FAIRY_FIGURE_HEIGHT_TILES * TILE_SCALE;
  if (DETAIL_MIN_FIGURE_PX <= inGamePx || DETAIL_MIN_FIGURE_PX > reviewPx) {
    fail(
      'G12',
      `fine detail switches on at ${DETAIL_MIN_FIGURE_PX}px of figure height, which should sit ` +
        `above the in-game ${inGamePx.toFixed(1)}px and at or under the review ${reviewPx.toFixed(1)}px`,
    );
  }
}

// ── G13 memory ───────────────────────────────────────────────────────────────

/**
 * G13 — each kind holds every row warm inside its per-figure budget, and a
 * room with all five kinds in it — every kind's hover, hurt and death rows,
 * from every view, warm together — takes no more than a quarter of the global
 * cache. Casting rows are left out of the shared set because the cache
 * releases a row that stops being played, and a room never has every fairy
 * mid-cast from every side at once. Measured at the art's own density, four
 * times what a 32 px tile holds.
 */
function gateMemory(): void {
  let shared = 0;
  let measured = 0;
  for (const kind of FAIRY_KINDS) {
    const figure = fairyFigureOf(kind);
    const cellBytes = figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL;
    let frames = 0;
    for (const [, declared] of figure.states) frames += declared.frames;
    const bytes = frames * cellBytes;
    for (const row of FAIRY_COMMON_ROWS) {
      shared += fairyRowFrames(row) * FAIRY_VIEWS.length * cellBytes;
    }
    measured++;
    const budget = figureByteBudgetFor(figure);
    console.log(
      `  G13 ${figure.id}: every row warm ${(bytes / BYTES_PER_MEGABYTE).toFixed(2)} MB of ` +
        `${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB`,
    );
    if (bytes > budget) fail('G13', `${figure.id} needs ${bytes} bytes against ${budget}`);
  }
  failUnlessMeasured('G13', measured, 'figures');
  const ceiling = GLOBAL_CACHE_MEGABYTES * MAX_SHARE_OF_GLOBAL_CACHE * BYTES_PER_MEGABYTE;
  console.log(
    `  G13 all five kinds' common rows warm: ${(shared / BYTES_PER_MEGABYTE).toFixed(2)} MB of ` +
      `${(ceiling / BYTES_PER_MEGABYTE).toFixed(0)} MB`,
  );
  if (shared > ceiling) {
    fail('G13', `all five kinds' common rows take ${(shared / BYTES_PER_MEGABYTE).toFixed(2)} MB`);
  }
}

// ── G14 paint cost ───────────────────────────────────────────────────────────

/**
 * Node's software rasteriser is several times slower than Chrome at this, so
 * this is a magnitude check: a cell far past this is a painter that has grown
 * a loop, not a number to tune against.
 */
const MAX_NODE_MS_PER_CELL = 12;
const COST_SAMPLE_FRAMES = 4;

/** G14 — a cell costs a few milliseconds at most, measured at the in-game density. */
function gatePaintCost(): void {
  let measured = 0;
  for (const kind of FAIRY_KINDS) {
    const figure = fairyFigureOf(kind);
    const started = performance.now();
    for (let frame = 0; frame < COST_SAMPLE_FRAMES; frame++) {
      paintFigureCell(figure, fairyStateName('hover', 'front'), frame, IN_GAME_DENSITY);
    }
    const perCell = (performance.now() - started) / COST_SAMPLE_FRAMES;
    measured++;
    console.log(`  G14 ${figure.id}: ${perCell.toFixed(2)} ms per cell in node`);
    if (perCell > MAX_NODE_MS_PER_CELL) {
      fail(
        'G14',
        `${figure.id} costs ${perCell.toFixed(1)} ms a cell (at most ${MAX_NODE_MS_PER_CELL})`,
      );
    }
  }
  failUnlessMeasured('G14', measured, 'figures');
}

// ── G15 the health bar clears the headwear ──────────────────────────────────

/**
 * Ink this opaque is part of the figure a bar drawn over it would visibly
 * cut; the glow and the anti-aliased fringe under it are not.
 */
const BAR_CLEARANCE_ALPHA = 128;

/**
 * Every hover frame, from every view, whose highest solid ink under the bar's
 * span reaches past the bottom edge of a health bar hung off `crownTiles` —
 * a crown in tiles below the tile's top edge, as the mob's draw uses it.
 */
function barCollisions(kind: FairyKind, crownTiles: number): string[] {
  const collisions: string[] = [];
  const figure = fairyFigureOf(kind);
  const tileTopRow = figure.tileY * IN_GAME_DENSITY;
  const tileLeftColumn = Math.round(figure.tileX * IN_GAME_DENSITY);
  const barBottomPx = crownTiles * IN_GAME_TILE - HP_BAR_Y_OFFSET + HP_BAR_HEIGHT;
  for (const view of FAIRY_VIEWS) {
    const state = fairyStateName('hover', view);
    for (let frame = 0; frame < fairyRowFrames('hover'); frame++) {
      const cell = cellOf(kind, state, frame, IN_GAME_DENSITY);
      let topRow = cell.height;
      for (let y = 0; y < cell.height && topRow === cell.height; y++) {
        for (let x = tileLeftColumn; x < tileLeftColumn + IN_GAME_TILE; x++) {
          if (alphaAt(cell, x, y) < BAR_CLEARANCE_ALPHA) continue;
          topRow = y;
          break;
        }
      }
      const topPx = topRow - tileTopRow;
      if (topPx >= barBottomPx) continue;
      collisions.push(
        `${kind}.${state}[${frame}] paints ink ${(barBottomPx - topPx).toFixed(1)}px up into ` +
          `the health bar (ink top ${topPx.toFixed(1)}px, bar bottom ${barBottomPx.toFixed(1)}px ` +
          `from the tile's top)`,
      );
    }
  }
  return collisions;
}

/**
 * G15 — at 32 px the health bar and the aggro mark, hung off each kind's
 * painted crown, sit clear of everything the hover row paints under them:
 * the crest, the hood, the flames and the wingtips, from every view through
 * the whole beat. The body's own height is the negative: a bar hung off it
 * cuts through the headwear, and the gate must see that or it measures nothing.
 */
function gateHealthBarClearsHeadwear(): void {
  const bodyOnlyCrownTiles =
    TILE_CENTRE_SHARE + GROUND_Y - FAIRY_HOVER_LIFT_TILES - FAIRY_FIGURE_HEIGHT_TILES;
  let measured = 0;
  let bodyOnlyCollisions = 0;
  for (const kind of FAIRY_KINDS) {
    measured++;
    for (const collision of barCollisions(kind, fairyCrownBelowTileTopTiles(kind))) {
      fail('G15', collision);
    }
    bodyOnlyCollisions += barCollisions(kind, bodyOnlyCrownTiles).length;
  }
  failUnlessMeasured('G15', measured, 'kinds');
  if (bodyOnlyCollisions === 0) {
    fail(
      'G15',
      'a bar hung off the body-only crown clears every frame too — the gate cannot tell ' +
        'a crown that clears the headwear from one that ignores it',
    );
  }
}

/** Runs every gate and returns one message per failure. */
export function fairyGateFailures(): string[] {
  failures.length = 0;
  cellCache.clear();
  gateStructure();
  gateRuntimeStates();
  gateHeadsTall();
  gateWingsDominate();
  gateWingbeat();
  gateDistinctFrames();
  gateReadsOnEveryFloor();
  gateHovers();
  gateDeath();
  gateReleaseFrames();
  gateKindsDiffer();
  gateDetailThreshold();
  gateMemory();
  gatePaintCost();
  gateHealthBarClearsHeadwear();
  return [...failures];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Gating the fairy figures…');
  reportFigureGates('fairies', fairyGateFailures());
}
