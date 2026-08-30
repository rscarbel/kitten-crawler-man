#!/usr/bin/env tsx
/**
 * The art gates for the three Krakaren Clone figures, run by
 * `npm run render:krakaren` before it bakes a contact sheet.
 *
 * Every gate measures cells painted by `paintFrame` and downsampled exactly as
 * the runtime cache admits them, so what these numbers describe is what the
 * game blits. Failures accumulate rather than throwing one at a time, so one
 * run reports everything wrong across all three figures.
 *
 * Two of the gates here exist because she is unlike anything else in the game.
 * She never moves, so her ink centroid drifting at all is a bug rather than
 * animation. And she sprawls a half tile past her own contact point, so the
 * usual "lowest ink stands on the ground line" anchor cannot be used: the top
 * of her mantle carries the anchor instead.
 */

import { type Canvas } from 'canvas';

import {
  BODY_ROWS,
  GROUND_OFFSET_PX,
  GUARD_ROWS,
  KRAKAREN_FIGURE,
  KRAKAREN_GORE_STATES,
  KRAKAREN_SLAM_FIGURE,
  KRAKAREN_TENTACLE_FIGURE,
  KRAKAREN_TENTACLE_GORE_STATES,
  type RowSpec,
  SLAM_ROWS,
  TILE_SCALE,
} from '../src/sprites/art/krakarenFigure.js';
import {
  KRAKAREN_CREST_TILES,
  KRAKAREN_SPREAD_HALF_TILES,
  RIM_WIDTH,
} from '../src/sprites/art/krakarenArt.js';
import {
  KRAKAREN_LAIR_STONE_DARK,
  KRAKAREN_LAIR_STONE_LIGHT,
} from '../src/map/tiles/specialFloorTiles.js';
import {
  KRAKAREN_SWIPE_IMPACT_PROGRESS,
  SLAM_SMASH_IMPACT_PROGRESS,
  TENTACLE_STRIKE_IMPACT_PROGRESS,
} from '../src/sprites/krakarenAttackTiming.js';
import {
  KRAKAREN_GORE_PARTS,
  KRAKAREN_POSE_STATES,
  KRAKAREN_SLAM_PHASES,
} from '../src/sprites/krakarenSprite.js';
import {
  KRAKAREN_TENTACLE_GORE_PARTS,
  KRAKAREN_TENTACLE_STATES,
} from '../src/sprites/krakarenTentacleSprite.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { FIGURE_BYTE_BUDGET } from '../src/sprites/figure/figureFrameCache.js';
import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures as sharedDistinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

// A painter that composes on a scratch surface of its own reaches for
// `document.createElement('canvas')`, which a Node process does not have.
installCanvasGlobals();

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const CHANNEL_MAX = 255;
const DEGREES_PER_HUE_SECTOR = 60;
const FULL_TURN_DEGREES = 360;
const HEX_RADIX = 16;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const RGB_COMPONENTS = 3;
const IN_GAME_TILE = 32;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** The cache admits cells supersampled, so a warm row costs four times its cell. */
const CACHE_BAKE_DENSITY = 2;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

// ── The figures under test ───────────────────────────────────────────────────

/**
 * One figure plus the tables the gates read it through.
 *
 * The row table is the def's own choreography, which is where a row's loop or
 * one-shot kind lives; the gore states are the single-frame states the def
 * declares beside it.
 */
interface Subject {
  readonly def: FigureDef;
  readonly rows: readonly RowSpec[];
  readonly goreStates: readonly string[];
  readonly cells: Map<string, Canvas>;
}

function subjectOf(
  def: FigureDef,
  rows: readonly RowSpec[],
  goreStates: readonly string[],
): Subject {
  return { def, rows, goreStates, cells: new Map() };
}

/** The baked cell, memoised: every gate reads the same pixels the cache stores. */
function cellOf(subject: Subject, state: string, frame: number): Canvas {
  const key = `${state}[${frame}]`;
  const cached = subject.cells.get(key);
  if (cached !== undefined) return cached;
  const baked = bakeFigureCell(subject.def, state, frame);
  subject.cells.set(key, baked);
  return baked;
}

function pixelsOf(cell: Canvas): Uint8ClampedArray {
  return cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
}

function alphaOf(subject: Subject, state: string, frame: number): Uint8ClampedArray {
  const data = pixelsOf(cellOf(subject, state, frame));
  const out = new Uint8ClampedArray(data.length / CHANNELS);
  for (let i = 0; i < out.length; i++) out[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return out;
}

interface InkStats {
  readonly count: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const EMPTY_INK: InkStats = {
  count: 0,
  centroidX: 0,
  centroidY: 0,
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
};

function inkStatsOf(
  alpha: Uint8ClampedArray,
  width: number,
  threshold = INK_ALPHA_THRESHOLD,
): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const height = alpha.length / width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < threshold) continue;
      count++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return EMPTY_INK;
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

function statsFor(subject: Subject, state: string, frame: number, threshold?: number): InkStats {
  return inkStatsOf(alphaOf(subject, state, frame), subject.def.frameWidth, threshold);
}

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== b[i] >= INK_ALPHA_THRESHOLD) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function rowAlphas(subject: Subject, row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) =>
    alphaOf(subject, row.name, frame),
  );
}

function groundLineOf(def: FigureDef): number {
  return def.tileY + GROUND_OFFSET_PX;
}

function anchorXOf(def: FigureDef): number {
  return def.frameWidth / 2;
}

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than read
 * out of the row tables, so renaming a row would otherwise turn its gate into a
 * silent no-op: present, green, and measuring nothing.
 */
function rowNamed(subject: Subject, name: string): RowSpec | null {
  const row = subject.rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(
      'G0',
      `${subject.def.id} has no row named "${name}" — a gate is guarding a row that no longer exists`,
    );
    return null;
  }
  return row;
}

/**
 * The frame a contract progress lands on, inverting the choreography's one-shot
 * sampling (`shotProgress`, which spreads a row end to end over `n - 1` steps).
 */
function impactFrameOf(frameCount: number, progress: number): number {
  return Math.round(progress * (frameCount - 1));
}

/** Records a failure when a filtering loop examined nothing at all. */
function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const message of nothingMeasuredFailures(measured, what)) fail(id, message);
}

// ── G1 spread ────────────────────────────────────────────────────────────────

/**
 * Half of the rim-light stroke falls outside the silhouette it traces, and the
 * supersampled cell is box-filtered down, which spreads that stroke's own
 * antialiased edge across another destination pixel. Both are ink the spread
 * limit has to allow for; neither is the creature getting wider.
 */
const ANTIALIAS_BLEED_PX = 2;
const DRAPE_HALF_LIMIT_TILES =
  KRAKAREN_SPREAD_HALF_TILES + RIM_WIDTH / 2 + ANTIALIAS_BLEED_PX / TILE_SCALE;

/**
 * The rows the drape limit governs: she is at rest in all of them, which is the
 * spread the brief and her cull margin were written for.
 */
const DRAPE_ROWS = [
  'idle',
  'idle_side',
  'idle_away',
  'channel',
  'channel_side',
  'channel_away',
] as const;

/**
 * How far one lashing tentacle may rear past the resting drape, in tiles of
 * half-width.
 *
 * The swipe deliberately reaches beyond the drape — that is the attack — so the
 * drape budget cannot hold it. The ceiling that actually matters is the boss's
 * own `cullMarginTiles` of 3, beyond which the renderer stops drawing her at
 * all; this sits far inside that while still firing if the lash grows by more
 * than a few percent.
 */
const LASH_HALF_LIMIT_TILES = 1.8;
const KRAKAREN_CULL_MARGIN_TILES = 3;

/** G1 — the body's spread stays inside the reach her cull margin was widened for. */
function gateBodySpread(subject: Subject): void {
  const anchorX = anchorXOf(subject.def);
  let widestDrape = 0;
  let widestLash = 0;
  let measured = 0;
  for (const row of subject.rows) {
    const drape = DRAPE_ROWS.some((name) => name === row.name);
    const limit = drape ? DRAPE_HALF_LIMIT_TILES : LASH_HALF_LIMIT_TILES;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = statsFor(subject, row.name, frame);
      const half = Math.max(anchorX - stats.minX, stats.maxX - anchorX) / TILE_SCALE;
      measured++;
      if (drape) widestDrape = Math.max(widestDrape, half);
      else widestLash = Math.max(widestLash, half);
      if (half > limit) {
        fail(
          'G1',
          `${row.name}[${frame}] spreads ${half.toFixed(3)} tiles from the anchor against a limit ` +
            `of ${limit.toFixed(3)} (${drape ? 'resting drape' : 'lashing'}; the boss culls at ` +
            `${KRAKAREN_CULL_MARGIN_TILES} tiles)`,
        );
      }
    }
  }
  failUnlessMeasured('G1', measured, 'body frames for the spread limit');
  console.log(
    `  G1 spread: drape ${widestDrape.toFixed(3)} of ${DRAPE_HALF_LIMIT_TILES.toFixed(3)} tiles, ` +
      `lash ${widestLash.toFixed(3)} of ${LASH_HALF_LIMIT_TILES} tiles`,
  );
}

// ── G2 anchor ────────────────────────────────────────────────────────────────

/**
 * Tolerance on where the mantle's apex lands above the ground line.
 *
 * Wide enough for the breath, which swells the dome by a few pixels, and for
 * the rim stroke sitting outside it; far tighter than the half tile a wrong
 * `tileY` would move the whole figure by.
 *
 * What this can catch is the art drifting off its own anchor, and no more:
 * `paintFrame` derives its paint origin from the same `tileY` the ground line
 * is computed from, so moving that constant moves both sides together. The
 * parity run against the sheet is the only check on `tileY` itself.
 */
const MANTLE_APEX_TOLERANCE_PX = 8;
/**
 * Tolerance on where the floor debris sits for the tentacle figures.
 *
 * Their underground frames are nothing but broken floor painted about the
 * ground point, so the middle of that ink is the truest anchor either has; the
 * shards thrown upward pull it a few pixels high.
 */
const GROUND_DEBRIS_TOLERANCE_PX = 12;

/** G2 — the crest of the body's crown limbs stands where `tileY` claims. */
function gateBodyAnchor(subject: Subject): void {
  const groundY = groundLineOf(subject.def);
  const declared = KRAKAREN_CREST_TILES * TILE_SCALE;
  let measured = 0;
  for (const name of ['idle', 'idle_side', 'idle_away']) {
    if (rowNamed(subject, name) === null) continue;
    const stats = statsFor(subject, name, 0, SOLID_ALPHA_THRESHOLD);
    if (stats.count === 0) {
      fail('G2', `${name}[0] has no solid ink to anchor on`);
      continue;
    }
    measured++;
    const height = groundY - stats.minY;
    const off = Math.abs(height - declared);
    if (off > MANTLE_APEX_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] carries its highest ink ${height.toFixed(1)}px above the ground line ` +
          `(tileY ${subject.def.tileY} + ${GROUND_OFFSET_PX} = ${groundY}) against the ` +
          `${KRAKAREN_CREST_TILES}-tile crest the art declares (${declared.toFixed(1)}px) — ` +
          `${off.toFixed(1)}px off, limit ${MANTLE_APEX_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G2', measured, 'idle frames for the mantle anchor');
}

/** G2 — a tentacle figure's floor debris is painted on the floor. */
function gateDebrisAnchor(subject: Subject, rowName: string, frame: number): void {
  const groundY = groundLineOf(subject.def);
  if (rowNamed(subject, rowName) === null) return;
  const stats = statsFor(subject, rowName, frame, SOLID_ALPHA_THRESHOLD);
  if (stats.count === 0) {
    fail('G2', `${subject.def.id} ${rowName}[${frame}] has no solid ink to anchor on`);
    return;
  }
  const centre = (stats.minY + stats.maxY) / 2;
  const off = Math.abs(centre - groundY);
  if (off > GROUND_DEBRIS_TOLERANCE_PX) {
    fail(
      'G2',
      `${subject.def.id} ${rowName}[${frame}] centres its floor debris at y=${centre.toFixed(1)} ` +
        `against a ground line of ${groundY} — ${off.toFixed(1)}px off, limit ` +
        `${GROUND_DEBRIS_TOLERANCE_PX}`,
    );
  }
}

/** G2 — every animation frame straddles the floor plane it is anchored to. */
function gateGroundLineInsideInk(subject: Subject): void {
  const groundY = groundLineOf(subject.def);
  let measured = 0;
  for (const row of subject.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = statsFor(subject, row.name, frame);
      if (stats.count === 0) continue;
      measured++;
      if (groundY < stats.minY || groundY > stats.maxY) {
        fail(
          'G2',
          `${subject.def.id} ${row.name}[${frame}] paints from y=${stats.minY} to y=${stats.maxY}, ` +
            `which does not reach its own ground line at y=${groundY}`,
        );
      }
    }
  }
  failUnlessMeasured('G2', measured, 'frames for the ground-line check');
}

// ── G3 loop closure ──────────────────────────────────────────────────────────

/**
 * How far past the row's own largest ordinary step the seam may reach.
 *
 * A closed cycle crosses its seam the way it crosses anywhere else, so the
 * largest in-cycle step is the yardstick. Measured on shipped art, her nine loop
 * rows seam at 0.65–1.00 of their largest step (the guard tentacle's idle
 * lowest, the channels highest), and the worst reading of any painted figure in
 * the repo is 1.076. The limit this replaces also allowed 2.1× the row's
 * *median* step, and on a row whose steps are all large that clause swallowed
 * the whole check. This clause is an art-drift check and cannot see cycle count at
 * all: re-timing a row moves the steps it is judged against along with the
 * seam. The wrap clause is what covers that.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * How many pixels the frame one past a loop's last may differ from its first.
 *
 * The clause that binds a cycle to exactly one turn, and the only one that can:
 * a seam ratio moves its own denominator when the row is re-timed, so a cycle
 * running one and a half turns can measure *inside* the ceiling. The painter
 * takes a frame index rather than a phase, so a loop can be painted at
 * `frameCount` — one frame past its end — where a closed cycle reproduces frame
 * 0. Not held to exactly zero because the cell is downsampled from twice its
 * size and a pose value landing on 2π rather than 0 rounds independently on each
 * side; all nine of her loop rows measure 0px, and the worst across the seven
 * figures swept with this check is 4px.
 */
const LOOP_WRAP_TOLERANCE_PX = 16;
/**
 * The least any interior frame of a loop may differ from its first.
 *
 * The wrap check is satisfied by a row that runs its cycle *twice*, which
 * repeats frame 0 in the middle of the row. Measured: the closest any interior
 * frame comes to frame 0 is 22px, on the guard tentacle's idle, against the 0px
 * an exact repeat scores.
 */
const LOOP_INTERIOR_REPEAT_FLOOR_PX = 6;
/**
 * How small the seam may be relative to the row's own median step.
 *
 * A ceiling alone is half a gate: sampling a cycle at `frame / (frameCount - 1)`
 * instead of `frame / frameCount` makes the last frame identical to the first,
 * which sends the seam to zero and leaves a loop that spends a whole frame held
 * still while every "seam is not too big" check stays green. A closing cycle
 * steps across its seam the same way it steps anywhere else, so the seam has to
 * sit in a band rather than merely under a limit.
 */
const LOOP_SEAM_FLOOR_SHARE = 0.25;

/** G3 — a loop must step across its seam, and must not pop across it. */
function gateLoopClosure(subject: Subject): void {
  let worstRow = '';
  let measured = 0;
  for (const row of subject.rows) {
    if (row.kind !== 'loop') continue;
    const cells = rowAlphas(subject, row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      fail('G3', `${subject.def.id} ${row.name} does not move at all across its row`);
      continue;
    }
    measured++;

    const wrap = frameDelta(alphaOf(subject, row.name, row.frameCount), cells[0]);
    if (wrap > LOOP_WRAP_TOLERANCE_PX) {
      fail(
        'G3',
        `${subject.def.id} ${row.name} does not cover exactly one turn: painted at frame ` +
          `${row.frameCount}, one past its end, it differs from frame 0 by ${wrap}px (allowed ` +
          `${LOOP_WRAP_TOLERANCE_PX}px) — the cycle is sampled over more or less than its own ` +
          'length, so the row plays at the wrong rate and never closes',
      );
    }
    let closestInterior = Infinity;
    let closestFrame = -1;
    for (let frame = 1; frame < row.frameCount; frame++) {
      const distance = frameDelta(cells[frame], cells[0]);
      if (distance >= closestInterior) continue;
      closestInterior = distance;
      closestFrame = frame;
    }
    if (closestInterior < LOOP_INTERIOR_REPEAT_FLOOR_PX) {
      fail(
        'G3',
        `${subject.def.id} ${row.name}[${closestFrame}] comes back to within ` +
          `${closestInterior}px of frame 0 (at least ${LOOP_INTERIOR_REPEAT_FLOOR_PX}px ` +
          'expected) — the row is running its cycle more than once',
      );
    }

    const allowed = Math.max(...steps) * LOOP_SEAM_CEILING;
    const required = typical * LOOP_SEAM_FLOOR_SHARE;
    worstRow = `${row.name} ${seam}/${required.toFixed(0)}..${allowed.toFixed(0)}`;
    if (seam > allowed) {
      fail(
        'G3',
        `${subject.def.id} ${row.name} pops across its loop seam: last→first differs by ${seam}px ` +
          `against a largest in-cycle step of ${Math.max(...steps)}px (allowed ` +
          `${allowed.toFixed(0)}px)`,
      );
    }
    if (seam < required) {
      fail(
        'G3',
        `${subject.def.id} ${row.name} barely moves across its loop seam: last→first differs by ` +
          `${seam}px against a median step of ${typical}px (floor ${required.toFixed(0)}px) — the ` +
          `cycle is sampled so its last frame repeats its first and the loop holds for a frame`,
      );
    }
  }
  failUnlessMeasured('G3', measured, 'loop rows for the seam band');
  console.log(`  G3 loop seams: worst is ${worstRow}`);
}

// ── G4 motion continuity ─────────────────────────────────────────────────────

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
const STEP_FLOOR_SHARE = 0.005;
/**
 * How far the worst step may exceed the *second* worst.
 *
 * Any cycle driven off a sine has a bimodal step distribution — fast steps
 * around the zero crossings, slow ones at the extremes — so its median is the
 * slow step and a perfectly smooth row scores several times it. What actually
 * distinguishes a snap is that it is a *lone* outlier.
 *
 * The cost of that, measured by mutation: this gate cannot see a *single* wrong
 * frame. One bad cell produces two large steps — into it and out of it — and
 * they license each other through this clause. Painting a mid-swipe pose into
 * `idle[5]`, and blanking a whole frame of the guard's `idle`, both left every
 * gate in this module green except the structural blank-cell check. What it
 * does catch is a discontinuity the row never comes back from: a half-row
 * translate of 0.6 tiles reddens it on the one step that crosses.
 */
const STEP_VS_RUNNER_UP = 1.35;

/** G4 — no consecutive-frame step far above the row's own median. */
function gateMotionContinuity(subject: Subject): void {
  const cellArea = subject.def.frameWidth * subject.def.frameHeight;
  let measured = 0;
  for (const row of subject.rows) {
    const cells = rowAlphas(subject, row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    if (steps.length === 0) continue;
    measured++;
    const typical = median(steps);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const allowed = Math.max(
      typical * limitShare,
      runnerUp * STEP_VS_RUNNER_UP,
      cellArea * STEP_FLOOR_SHARE,
    );
    steps.forEach((step, i) => {
      if (step > allowed) {
        fail(
          'G4',
          `${subject.def.id} ${row.name} snaps between frames ${i} and ${i + 1}: ${step}px changed ` +
            `against a median step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
        );
      }
    });
  }
  failUnlessMeasured('G4', measured, 'rows for the continuity check');
}

// ── G5 centroid drift ────────────────────────────────────────────────────────

/**
 * She is rooted to the spot — `KRAKAREN_SPEED` is zero and she never walks — so
 * unlike every other creature's rows, hers have no reason to move the mass
 * anywhere. Anything that translates the whole body is a pose bug that no other
 * gate sees: the silhouette still animates smoothly, it just slides.
 *
 * Measured in two ways, because they fail differently. A row whose centroid
 * wanders has an animation bug; a row whose centroid sits off the anchor has a
 * *pose* bug that will make her jump when the runtime switches rows.
 */
const CENTROID_OFF_ANCHOR_LIMIT_PX = 5;
const CENTROID_ROW_DRIFT_LIMIT_PX = 6;

/** G5 — the rooted body never slides. */
function gateCentroidDrift(subject: Subject): void {
  const anchorX = anchorXOf(subject.def);
  let worstOffAnchor = 0;
  let worstDrift = 0;
  let measured = 0;
  for (const row of subject.rows) {
    const stats = Array.from({ length: row.frameCount }, (_unused, frame) =>
      statsFor(subject, row.name, frame),
    );
    const meanX = stats.reduce((total, s) => total + s.centroidX, 0) / stats.length;
    const meanY = stats.reduce((total, s) => total + s.centroidY, 0) / stats.length;
    for (const [frame, s] of stats.entries()) {
      measured++;
      const offAnchor = Math.abs(s.centroidX - anchorX);
      worstOffAnchor = Math.max(worstOffAnchor, offAnchor);
      if (offAnchor > CENTROID_OFF_ANCHOR_LIMIT_PX) {
        fail(
          'G5',
          `${row.name}[${frame}] puts its ink centroid ${offAnchor.toFixed(2)}px off the cell's ` +
            `own anchor (limit ${CENTROID_OFF_ANCHOR_LIMIT_PX}px) — the rooted boss has moved`,
        );
      }
      const drift = Math.hypot(s.centroidX - meanX, s.centroidY - meanY);
      worstDrift = Math.max(worstDrift, drift);
      if (drift > CENTROID_ROW_DRIFT_LIMIT_PX) {
        fail(
          'G5',
          `${row.name}[${frame}] drifts ${drift.toFixed(2)}px from its own row's mean centroid ` +
            `(limit ${CENTROID_ROW_DRIFT_LIMIT_PX}px)`,
        );
      }
    }
  }
  failUnlessMeasured('G5', measured, 'body frames for the drift check');
  console.log(
    `  G5 rooted: worst centroid ${worstOffAnchor.toFixed(2)}px off anchor (limit ` +
      `${CENTROID_OFF_ANCHOR_LIMIT_PX}), worst in-row drift ${worstDrift.toFixed(2)}px (limit ` +
      `${CENTROID_ROW_DRIFT_LIMIT_PX})`,
  );
}

// ── G6 one-shot settle ───────────────────────────────────────────────────────

/**
 * How much of a cell a one-shot's outer frame may differ from the frame it
 * hands off to.
 *
 * Tighter than the share other creatures' gates use, and measured rather than
 * inherited: her one-shots return to poses that match their neighbours almost
 * exactly — the widest legitimate mismatch on any of the three figures is under
 * 500 pixels of a 39,000-pixel cell — while the tentacles are thin enough that
 * a looser share lets a tentacle left two thirds risen through.
 */
const SETTLE_LIMIT_SHARE = 0.025;

type SettleEnd = 'first' | 'last';

/**
 * Where each one-shot hands off, and to which end of the row it hands off to.
 *
 * The underground rows are the reason both ends appear here: `retreat` ends
 * with the tentacle gone and can only settle onto the frame `emerge` starts
 * from, and `smash` ends the same way `dive` does, on bare floor debris.
 */
interface Settle {
  readonly shot: string;
  readonly shotEnd: SettleEnd;
  readonly settle: string;
  readonly settleEnd: SettleEnd;
}

const BODY_SETTLES: readonly Settle[] = [
  { shot: 'swipe', shotEnd: 'last', settle: 'idle', settleEnd: 'first' },
  { shot: 'swipe_side', shotEnd: 'last', settle: 'idle_side', settleEnd: 'first' },
  { shot: 'swipe_away', shotEnd: 'last', settle: 'idle_away', settleEnd: 'first' },
];

const GUARD_SETTLES: readonly Settle[] = [
  { shot: 'emerge', shotEnd: 'last', settle: 'idle', settleEnd: 'first' },
  { shot: 'strike', shotEnd: 'last', settle: 'idle', settleEnd: 'first' },
  { shot: 'strike_side', shotEnd: 'last', settle: 'idle', settleEnd: 'first' },
  { shot: 'strike_away', shotEnd: 'last', settle: 'idle', settleEnd: 'first' },
  { shot: 'retreat', shotEnd: 'last', settle: 'emerge', settleEnd: 'first' },
];

const SLAM_SETTLES: readonly Settle[] = [
  { shot: 'rise', shotEnd: 'last', settle: 'loom', settleEnd: 'first' },
  { shot: 'dive', shotEnd: 'last', settle: 'smash', settleEnd: 'first' },
  { shot: 'smash', shotEnd: 'last', settle: 'dive', settleEnd: 'last' },
];

function endFrame(row: RowSpec, end: SettleEnd): number {
  return end === 'first' ? 0 : row.frameCount - 1;
}

/** G6 — a one-shot's outer frame must match the frame it hands off to. */
function gateOneShotSettle(subject: Subject, settles: readonly Settle[]): void {
  const allowed = subject.def.frameWidth * subject.def.frameHeight * SETTLE_LIMIT_SHARE;
  const measured: string[] = [];
  for (const pair of settles) {
    const shotRow = rowNamed(subject, pair.shot);
    const settleRow = rowNamed(subject, pair.settle);
    if (shotRow === null || settleRow === null) continue;
    const delta = frameDelta(
      alphaOf(subject, pair.shot, endFrame(shotRow, pair.shotEnd)),
      alphaOf(subject, pair.settle, endFrame(settleRow, pair.settleEnd)),
    );
    measured.push(`${pair.shot}→${pair.settle} ${delta}`);
    if (delta > allowed) {
      fail(
        'G6',
        `${subject.def.id} ${pair.shot} does not settle onto ${pair.settle}: its ${pair.shotEnd} ` +
          `frame differs from ${pair.settle}'s ${pair.settleEnd} frame by ${delta}px (allowed ` +
          `${allowed.toFixed(0)}px)`,
      );
    }
  }
  failUnlessMeasured('G6', measured.length, 'one-shot hand-offs');
  console.log(`  G6 settle: ${measured.join(', ')} (allowed ${allowed.toFixed(0)}px)`);
}

// ── G7 impact is the peak ────────────────────────────────────────────────────

/**
 * How close to the row's own extreme a frame has to be to count as part of the
 * peak.
 *
 * The contract progresses do not land on whole frames — the swipe's peak sits
 * at frame 4.5 of ten, the strike's at 5.4, the smash's at 2.2 — and the
 * smash's drive plateaus rather than spiking, so the extreme is shared by
 * several frames. What the gate can hold exactly is that the declared frame is
 * the *first* frame of that peak: one frame either side of the truth fails.
 */
const PEAK_BAND_SHARE = 0.85;

/**
 * The peak of an attack is measured against the row's own resting frame 0, not
 * in absolute pixels: the boss's dozen idle tentacles dwarf the one that lashes,
 * and an absolute width is mostly her.
 */
type PeakMetric = 'lashWidth' | 'centroidTravel';

interface ImpactRow {
  readonly row: string;
  readonly progress: number;
  readonly metric: PeakMetric;
}

const BODY_IMPACTS: readonly ImpactRow[] = [
  { row: 'swipe', progress: KRAKAREN_SWIPE_IMPACT_PROGRESS, metric: 'lashWidth' },
  { row: 'swipe_side', progress: KRAKAREN_SWIPE_IMPACT_PROGRESS, metric: 'lashWidth' },
  { row: 'swipe_away', progress: KRAKAREN_SWIPE_IMPACT_PROGRESS, metric: 'lashWidth' },
];

const GUARD_IMPACTS: readonly ImpactRow[] = [
  { row: 'strike', progress: TENTACLE_STRIKE_IMPACT_PROGRESS, metric: 'centroidTravel' },
  { row: 'strike_side', progress: TENTACLE_STRIKE_IMPACT_PROGRESS, metric: 'centroidTravel' },
  { row: 'strike_away', progress: TENTACLE_STRIKE_IMPACT_PROGRESS, metric: 'centroidTravel' },
];

const SLAM_IMPACTS: readonly ImpactRow[] = [
  { row: 'smash', progress: SLAM_SMASH_IMPACT_PROGRESS, metric: 'lashWidth' },
];

/**
 * How far one frame has been driven past the row's own resting frame 0.
 *
 * The two metrics are the two shapes an attack here has. The swipe and the
 * smash both throw their subject sideways across the cell, so the extra width
 * is the blow. A guard tentacle whips its whole small body over, and does it
 * toward the camera in one view and away from it in another, so what its three
 * rows share is not a direction but how far the mass has travelled.
 */
function drivenPast(rest: InkStats, stats: InkStats, metric: PeakMetric): number {
  if (metric === 'lashWidth') return stats.maxX - stats.minX - (rest.maxX - rest.minX);
  return Math.hypot(stats.centroidX - rest.centroidX, stats.centroidY - rest.centroidY);
}

/** G7 — the frame the damage fires on is the frame the blow is landed on. */
function gateImpactIsThePeak(subject: Subject, impacts: readonly ImpactRow[]): void {
  let measured = 0;
  for (const impact of impacts) {
    const row = rowNamed(subject, impact.row);
    if (row === null) continue;
    const stats = Array.from({ length: row.frameCount }, (_unused, frame) =>
      statsFor(subject, row.name, frame),
    );
    const driven = stats.map((frame) => drivenPast(stats[0], frame, impact.metric));
    const peak = Math.max(...driven);
    if (peak <= 0) {
      fail(
        'G7',
        `${subject.def.id} ${impact.row} never moves past its own first frame — there is no blow ` +
          `in it to land`,
      );
      continue;
    }
    measured++;
    const band = peak * PEAK_BAND_SHARE;
    const firstInBand = driven.findIndex((value) => value >= band);
    const declared = impactFrameOf(row.frameCount, impact.progress);
    if (declared !== firstInBand) {
      fail(
        'G7',
        `${subject.def.id} ${impact.row} first reaches its peak on frame ${firstInBand} ` +
          `(${driven[firstInBand].toFixed(1)} of ${peak.toFixed(1)} past rest), but progress ` +
          `${impact.progress} of ${row.frameCount} frames puts the damage on frame ${declared} ` +
          `(${driven[declared].toFixed(1)} past rest, band floor ${band.toFixed(1)})`,
      );
    }
  }
  failUnlessMeasured('G7', measured, 'attack rows for the impact-frame check');
}

// ── G8 mouth presence ────────────────────────────────────────────────────────

/**
 * The human mouths studded through her flesh are the whole horror hook, and
 * they are drawn *after* the tentacle they sit on: a change to the paint order,
 * to the mouth sizing, or to the open/close cycle can bury every one of them
 * under flesh while leaving her silhouette, her reach and her animation
 * perfect. Gates go blind in pairs — a reach gate without an ink gate once
 * shipped an invisible claw — so this counts the lips themselves.
 *
 * Lips are separated from flesh by hue: her flesh ramp sits around 332° and her
 * lip ramp around 345°, and nothing else on her is both that red and that
 * saturated.
 */
const LIP_HUE_MIN_DEGREES = 338;
const LIP_HUE_MAX_DEGREES = 354;
const LIP_MIN_SATURATION = 0.5;
const LIP_MIN_VALUE = 80;
const LIP_MAX_VALUE = 235;
const LIP_MIN_CHROMA = 8;

interface MouthQuota {
  readonly row: string;
  readonly minLipPixels: number;
}

/**
 * Floors set at roughly a third of what the painter produces, which is the
 * distance between "the mouths are there" and "the mouths are gone": with the
 * mouth painter stubbed out these rows measure single digits.
 */
const BODY_MOUTH_QUOTAS: readonly MouthQuota[] = [
  { row: 'idle', minLipPixels: 1000 },
  { row: 'idle_side', minLipPixels: 1000 },
  { row: 'idle_away', minLipPixels: 1000 },
  { row: 'swipe', minLipPixels: 1000 },
  { row: 'channel', minLipPixels: 900 },
];

const GUARD_MOUTH_QUOTAS: readonly MouthQuota[] = [
  { row: 'idle', minLipPixels: 300 },
  { row: 'strike', minLipPixels: 400 },
  { row: 'strike_side', minLipPixels: 400 },
  { row: 'strike_away', minLipPixels: 400 },
];

const SLAM_MOUTH_QUOTAS: readonly MouthQuota[] = [
  { row: 'loom', minLipPixels: 1000 },
  { row: 'rise', minLipPixels: 800 },
  { row: 'smash', minLipPixels: 900 },
];

function hueOf(r: number, g: number, b: number): number | null {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < LIP_MIN_CHROMA || max !== r) return null;
  return (
    ((((DEGREES_PER_HUE_SECTOR * (g - b)) / chroma) % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) %
    FULL_TURN_DEGREES
  );
}

function lipPixelsIn(subject: Subject, row: RowSpec): number {
  let lips = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const data = pixelsOf(cellOf(subject, row.name, frame));
    for (let i = 0; i < data.length; i += CHANNELS) {
      if (data[i + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
      const r = data[i + RED_OFFSET];
      const g = data[i + GREEN_OFFSET];
      const b = data[i + BLUE_OFFSET];
      if (r < LIP_MIN_VALUE || r > LIP_MAX_VALUE) continue;
      if ((r - Math.min(r, g, b)) / r < LIP_MIN_SATURATION) continue;
      const hue = hueOf(r, g, b);
      if (hue === null) continue;
      if (hue >= LIP_HUE_MIN_DEGREES && hue <= LIP_HUE_MAX_DEGREES) lips++;
    }
  }
  return lips;
}

/** G8 — the mouths are actually painted, not merely posed. */
function gateMouthPresence(subject: Subject, quotas: readonly MouthQuota[]): void {
  const measured: string[] = [];
  for (const quota of quotas) {
    const row = rowNamed(subject, quota.row);
    if (row === null) continue;
    const lips = lipPixelsIn(subject, row);
    measured.push(`${quota.row} ${lips}/${quota.minLipPixels}`);
    if (lips < quota.minLipPixels) {
      fail(
        'G8',
        `${subject.def.id} ${quota.row} carries only ${lips} lip pixels across its ` +
          `${row.frameCount} frames (floor ${quota.minLipPixels}) — the mouths have stopped ` +
          `reaching the surface`,
      );
    }
  }
  failUnlessMeasured('G8', measured.length, 'rows with a mouth quota');
  console.log(`  G8 mouths: ${measured.join(', ')}`);
}

// ── G9 floor contrast ────────────────────────────────────────────────────────

function hexLightness(hex: string): number {
  const value = Number.parseInt(hex.slice(1), HEX_RADIX);
  const r = (value >> RED_SHIFT) & CHANNEL_MAX;
  const g = (value >> GREEN_SHIFT) & CHANNEL_MAX;
  const b = value & CHANNEL_MAX;
  return (r + g + b) / RGB_COMPONENTS;
}

/**
 * Lightness of the lair floor she is seen against, read off the tile renderer
 * rather than copied. The Ball of Swine's gate copied its floor's hex and the
 * floor was then rewritten in the same change, leaving the gate demanding
 * contrast against a colour the game had stopped drawing.
 */
const LAIR_FLOOR_LIGHTNESS =
  (hexLightness(KRAKAREN_LAIR_STONE_LIGHT) + hexLightness(KRAKAREN_LAIR_STONE_DARK)) / 2;

/**
 * A creature at the value of the ground it sits on is a smudge at a 32px tile
 * however well drawn it is, and her lair is dark wet stone.
 */
const MIN_FLOOR_CONTRAST = 2.2;
/** "Magenta-pink flesh" cannot be this dark whatever the floor does. */
const MIN_FLESH_LIGHTNESS = 90;

/** G9 — she reads as bright pink flesh against her own floor. */
function gateDescribedCreature(subject: Subject): void {
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const row of subject.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const data = pixelsOf(cellOf(subject, row.name, frame));
      for (let i = 0; i < data.length; i += CHANNELS) {
        if (data[i + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
        count++;
        sumR += data[i + RED_OFFSET];
        sumG += data[i + GREEN_OFFSET];
        sumB += data[i + BLUE_OFFSET];
      }
    }
  }
  if (count === 0) {
    fail('G9', `${subject.def.id} has no solid ink at all`);
    return;
  }
  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const lightness = (meanR + meanG + meanB) / RGB_COMPONENTS;
  const contrast = lightness / LAIR_FLOOR_LIGHTNESS;
  console.log(
    `  G9 floor contrast: ${subject.def.id} averages ${lightness.toFixed(1)} against a lair floor ` +
      `of ${LAIR_FLOOR_LIGHTNESS.toFixed(1)} — ${contrast.toFixed(2)}× (floor ` +
      `${MIN_FLOOR_CONTRAST}×)`,
  );
  if (lightness < MIN_FLESH_LIGHTNESS) {
    fail(
      'G9',
      `${subject.def.id} averages a lightness of ${lightness.toFixed(1)} (floor ` +
        `${MIN_FLESH_LIGHTNESS}); magenta-pink flesh cannot be this dark`,
    );
  }
  if (meanR <= meanG || meanR <= meanB) {
    fail(
      'G9',
      `${subject.def.id} averages rgb(${meanR.toFixed(0)}, ${meanG.toFixed(0)}, ` +
        `${meanB.toFixed(0)}), which is not pink`,
    );
  }
  if (contrast < MIN_FLOOR_CONTRAST) {
    fail(
      'G9',
      `${subject.def.id} averages only ${contrast.toFixed(2)}× the lair floor's lightness (floor ` +
        `${MIN_FLOOR_CONTRAST}×); at 32px she reads as a smudge on the wet stone`,
    );
  }
}

// ── G10 rise height ──────────────────────────────────────────────────────────

/**
 * How high the risen slam tentacle must stand above the floor, in tiles, on
 * *every* frame of the loom.
 *
 * Frozen here rather than taken as a share of the art's own `SLAM_HEIGHT`, which
 * is what this gate used to do and what made it unfailable against the defect it
 * names: that constant is the arc length the painter draws the tentacle at, so a
 * share of it moved the pass mark down in step with a shortened tentacle and the
 * gate stayed green at any height. Measured on the shipped row, which rises
 * 2.328–2.578 tiles; her own body crests at 2.33–2.38 tiles, so a loom under
 * this floor has stopped clearing the boss it telegraphs over.
 */
const MIN_LOOM_RISE_TILES = 2.2;

/** G10 — the slam tentacle really does loom, in every frame of the row. */
function gateRiseHeight(subject: Subject): void {
  const groundY = groundLineOf(subject.def);
  const row = rowNamed(subject, 'loom');
  if (row === null) return;
  const risen: number[] = [];
  // Sampled end to end rather than at the centre frame: the coil is at its most
  // bent at one phase of the cycle and a single frame never sees it.
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = statsFor(subject, row.name, frame, SOLID_ALPHA_THRESHOLD);
    const height = (groundY - stats.minY) / TILE_SCALE;
    risen.push(height);
    if (height < MIN_LOOM_RISE_TILES) {
      fail(
        'G10',
        `loom[${frame}] rises only ${height.toFixed(3)} tiles above the floor (floor ` +
          `${MIN_LOOM_RISE_TILES} tiles) — it no longer looms over the boss it telegraphs for`,
      );
    }
  }
  failUnlessMeasured('G10', risen.length, 'loom frames for the rise height');
  console.log(
    `  G10 rise: loom stands ${Math.min(...risen).toFixed(3)}..${Math.max(...risen).toFixed(3)} ` +
      `tiles (floor ${MIN_LOOM_RISE_TILES})`,
  );
}

// ── G11/G12 gore ─────────────────────────────────────────────────────────────

const GORE_MIN_SHORT_AXIS_PX = 9;

/** G11 — every gore piece must still be a shape at the size it actually renders. */
function gateGoreLegibility(subject: Subject): void {
  if (subject.goreStates.length === 0) {
    fail('G11', `${subject.def.id} declares no gore states for the legibility gate to measure`);
    return;
  }
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  for (const state of subject.goreStates) {
    const stats = statsFor(subject, state, 0);
    const shortAxis =
      (Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G11',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis in game (limit ` +
          `${GORE_MIN_SHORT_AXIS_PX}px) — at that size it is a speck, not a body part`,
      );
    }
  }
}

const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;
const MASK_SAMPLE_CENTRE = 0.5;

function maskOf(subject: Subject, state: string): boolean[] {
  const alpha = alphaOf(subject, state, 0);
  const { frameWidth } = subject.def;
  const stats = inkStatsOf(alpha, frameWidth);
  const width = Math.max(1, stats.maxX - stats.minX + 1);
  const height = Math.max(1, stats.maxY - stats.minY + 1);
  // Scale is normalised away but aspect deliberately is not: stretching each
  // piece to fill its own bounding box maps every convex blob onto a filled
  // square and measures the normalisation rather than the art.
  const span = Math.max(width, height);
  const mask: boolean[] = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  for (let y = 0; y < DISTINCT_MASK; y++) {
    for (let x = 0; x < DISTINCT_MASK; x++) {
      const sourceX = Math.round(
        stats.minX + (width - span) / 2 + ((x + MASK_SAMPLE_CENTRE) / DISTINCT_MASK) * span,
      );
      const sourceY = Math.round(
        stats.minY + (height - span) / 2 + ((y + MASK_SAMPLE_CENTRE) / DISTINCT_MASK) * span,
      );
      if (sourceX < 0 || sourceY < 0 || sourceX >= frameWidth) continue;
      if (sourceY * frameWidth + sourceX >= alpha.length) continue;
      mask[y * DISTINCT_MASK + x] = alpha[sourceY * frameWidth + sourceX] >= INK_ALPHA_THRESHOLD;
    }
  }
  return mask;
}

/** G12 — no two gore pieces of one creature may share a silhouette. */
function gateGoreDistinctness(subject: Subject): void {
  if (subject.goreStates.length === 0) {
    fail('G12', `${subject.def.id} declares no gore states for the distinctness gate to measure`);
    return;
  }
  const states = subject.goreStates;
  const masks = states.map((state) => maskOf(subject, state));
  let worst = 0;
  let worstPair = '';
  let compared = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].length; i++) {
        if (masks[a][i] && masks[b][i]) intersection++;
        if (masks[a][i] || masks[b][i]) union++;
      }
      compared++;
      const iou = union === 0 ? 0 : intersection / union;
      if (iou > worst) {
        worst = iou;
        worstPair = `${states[a]}/${states[b]}`;
      }
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'G12',
          `${states[a]} and ${states[b]} share ${(iou * 100).toFixed(0)}% of their silhouette ` +
            `(limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%) — they will read as the same piece`,
        );
      }
    }
  }
  failUnlessMeasured('G12', compared, 'gore piece pairs');
  console.log(
    `  G12 gore distinctness: ${subject.def.id} worst pair ${worstPair} at ` +
      `${(worst * 100).toFixed(0)}% (limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%)`,
  );
}

// ── G13 gore contract ────────────────────────────────────────────────────────

/**
 * The runtime's part list and the painter's own state list have to agree,
 * because the way they fail to is by dropping a body part on the floor in
 * silence: `BodyPartGoreSystem` skips a state the figure cannot paint.
 *
 * There are only two parties here, not three. A clause comparing the painter's
 * list against "the figure's declared states" used to sit beside this one, and
 * mutation testing showed it could not fail: `KRAKAREN_GORE_STATES` is
 * `krakarenGorePieces().map(p => p.state)` and the figure's states are built
 * from the same `krakarenGorePieces()`, so it compared one list against itself
 * — reordering the painter's pieces moved both sides together and it stayed
 * green while this clause caught the drift. Nothing is lost by its absence:
 * were those two ever to diverge, `paintSpecFrame` throws "paints no state"
 * on the first gore cell the gates bake.
 */
interface GoreContract {
  readonly subject: Subject;
  readonly runtimeParts: readonly string[];
  readonly runtimeName: string;
}

function sameStates(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((state, i) => state === b[i]);
}

function gateGoreContract(contracts: readonly GoreContract[]): void {
  for (const contract of contracts) {
    const declared = contract.subject.goreStates;
    if (!sameStates(contract.runtimeParts, declared)) {
      fail(
        'G13',
        `${contract.runtimeName} is [${contract.runtimeParts.join(', ')}] but ` +
          `${contract.subject.def.id} declares [${declared.join(', ')}] — a state the runtime ` +
          `names and the figure lacks is silently skipped`,
      );
    }
  }
  failUnlessMeasured('G13', contracts.length, 'gore contracts');
}

// ── G14 warm-row budget ──────────────────────────────────────────────────────

/**
 * What one warm state costs the figure cache.
 *
 * The whole-sheet texture budget the bake used has no analogue: a painted
 * figure is admitted a state at a time and lets go of the states it has stopped
 * playing, so the number that decides whether it fits is the widest single
 * state against the cache's per-figure ceiling — not the sum of every state.
 * Measured over every declared state, single-frame gore pieces included.
 */
function gateWarmRowBudget(subject: Subject): void {
  const cellBytes =
    subject.def.frameWidth *
    CACHE_BAKE_DENSITY *
    subject.def.frameHeight *
    CACHE_BAKE_DENSITY *
    BYTES_PER_PIXEL;
  let widest = 0;
  let widestState = '';
  let total = 0;
  let measured = 0;
  for (const [state, declared] of subject.def.states) {
    const bytes = cellBytes * declared.frames;
    total += bytes;
    measured++;
    if (bytes > widest) {
      widest = bytes;
      widestState = state;
    }
  }
  failUnlessMeasured('G14', measured, 'declared states for the warm-row budget');
  const megabytes = (value: number): string => (value / BYTES_PER_MEGABYTE).toFixed(2);
  console.log(
    `  G14 warm rows: ${subject.def.id}'s widest state is ${widestState} at ` +
      `${megabytes(widest)} MB of a ${megabytes(FIGURE_BYTE_BUDGET)} MB per-figure ceiling; ` +
      `every state warm at once is ${megabytes(total)} MB`,
  );
  if (widest > FIGURE_BYTE_BUDGET) {
    fail(
      'G14',
      `${subject.def.id}'s ${widestState} is ${megabytes(widest)} MB, over the ` +
        `${megabytes(FIGURE_BYTE_BUDGET)} MB the cache will hold for one figure — it can never be ` +
        `admitted and every frame of it falls back to a direct paint`,
    );
  }
}

// ── G15 the runtime's state names ────────────────────────────────────────────

/**
 * G15 — every state name the runtime builds is one the figure paints.
 *
 * Both draw paths return silently on a state they cannot find, so a pose name
 * assembled by template literal that the figure does not paint is an invisible
 * creature and no log line.
 */
function gateRuntimeStateNames(subject: Subject, names: readonly string[], purpose: string): void {
  for (const message of missingStateFailures(subject.def, names, purpose)) fail('G15', message);
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * G16 — a row paints as many pictures as it declares frames, bar the one repeat
 * that is the point.
 *
 * The exemption is the last frame of a one-shot landing back on its first. Her
 * one-shots are built to end on the lie they started from — one sway cycle and
 * one mouth cycle across the row, so the hand-off back to the idle or the loom
 * is not a snap — and the swipe, the guard strike and the smash all close that
 * way on purpose. Measured across those rows, every *other* pair of frames is
 * far apart: the closest non-exempt pair in the swipe differs over 3.2% of the
 * cell and in the strike over 4.4%, against a floor of 0.20%, so nothing else is
 * riding on the exemption. It is written as exactly that one pair rather than as
 * a tolerance, so a row that stalls anywhere else still fails.
 */
function gateDistinctFrames(subject: Subject): void {
  const settlesOntoItsOpening = (state: string): boolean =>
    subject.rows.find((candidate) => candidate.name === state)?.kind === 'oneShot';
  const report = sharedDistinctFrameFailures(
    subject.def,
    (state, frame) => pixelsOf(cellOf(subject, state, frame)),
    {
      repeatsOnPurpose: (state, earlier, later) =>
        settlesOntoItsOpening(state) &&
        earlier === 0 &&
        later === (subject.def.states.get(state)?.frames ?? 0) - 1,
    },
  );
  for (const message of report.failures) fail('G16', message);
  failUnlessMeasured('G16', report.framesMeasured, 'painted frames');
  if (report.closestNote !== null) console.log(`  G16 closest frames: ${report.closestNote}`);
}

export function krakarenGateFailures(): readonly string[] {
  failures.length = 0;

  const body = subjectOf(KRAKAREN_FIGURE, BODY_ROWS, KRAKAREN_GORE_STATES);
  const guard = subjectOf(KRAKAREN_TENTACLE_FIGURE, GUARD_ROWS, KRAKAREN_TENTACLE_GORE_STATES);
  const slam = subjectOf(KRAKAREN_SLAM_FIGURE, SLAM_ROWS, []);

  for (const subject of [body, guard, slam]) {
    console.log(`  — ${subject.def.id}`);
    for (const message of figureStructuralFailures(subject.def)) fail('G1', message);
    gateGroundLineInsideInk(subject);
    gateLoopClosure(subject);
    gateMotionContinuity(subject);
    gateDescribedCreature(subject);
    gateWarmRowBudget(subject);
    gateDistinctFrames(subject);
  }

  gateBodySpread(body);
  gateBodyAnchor(body);
  gateCentroidDrift(body);
  gateOneShotSettle(body, BODY_SETTLES);
  gateImpactIsThePeak(body, BODY_IMPACTS);
  gateMouthPresence(body, BODY_MOUTH_QUOTAS);
  gateGoreLegibility(body);
  gateGoreDistinctness(body);
  gateRuntimeStateNames(body, KRAKAREN_POSE_STATES, 'drawKrakarenSprite');
  gateRuntimeStateNames(body, KRAKAREN_GORE_PARTS, "BodyPartGoreSystem's krakaren parts");

  gateDebrisAnchor(guard, 'emerge', 0);
  gateOneShotSettle(guard, GUARD_SETTLES);
  gateImpactIsThePeak(guard, GUARD_IMPACTS);
  gateMouthPresence(guard, GUARD_MOUTH_QUOTAS);
  gateGoreLegibility(guard);
  gateGoreDistinctness(guard);
  gateRuntimeStateNames(guard, KRAKAREN_TENTACLE_STATES, 'drawKrakarenTentacleSprite');
  gateRuntimeStateNames(
    guard,
    KRAKAREN_TENTACLE_GORE_PARTS,
    "BodyPartGoreSystem's krakaren_tentacle parts",
  );

  gateDebrisAnchor(slam, 'smash', 0);
  gateOneShotSettle(slam, SLAM_SETTLES);
  gateImpactIsThePeak(slam, SLAM_IMPACTS);
  gateMouthPresence(slam, SLAM_MOUTH_QUOTAS);
  gateRiseHeight(slam);
  gateRuntimeStateNames(slam, KRAKAREN_SLAM_PHASES, 'drawKrakarenSlamTentacle');

  gateGoreContract([
    {
      subject: body,
      runtimeParts: KRAKAREN_GORE_PARTS,
      runtimeName: "krakarenSprite.ts's KRAKAREN_GORE_PARTS",
    },
    {
      subject: guard,
      runtimeParts: KRAKAREN_TENTACLE_GORE_PARTS,
      runtimeName: "krakarenTentacleSprite.ts's KRAKAREN_TENTACLE_GORE_PARTS",
    },
  ]);

  return [...failures];
}

/** Runs the gates and reports; returns true when every one passed. */
export function runKrakarenGates(): boolean {
  console.log('Gating the Krakaren figures…');
  return reportFigureGates('krakaren', krakarenGateFailures());
}
