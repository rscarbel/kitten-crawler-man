#!/usr/bin/env tsx
/**
 * The bake gate for the three Krakaren Clone sheets, and the entry point
 * `npm run gen:krakaren` runs.
 *
 * A sheet that fails a gate must never reach disk. This module bakes all three
 * into memory, measures the baked pixels, collects every defect it finds with
 * the number it measured and the limit it measured against, and only then lets
 * the generator write. Failures accumulate rather than throwing one at a time,
 * so one run reports everything that is wrong across all three sheets.
 *
 * Two of the gates here exist because she is unlike anything else in the game.
 * She never moves, so her ink centroid drifting at all is a bug rather than
 * animation. And she sprawls a half tile past her own contact point, so the
 * usual "lowest ink stands on the ground line" anchor cannot be used: the top
 * of her mantle carries the anchor instead.
 *
 * `--skip-manifest-gate` is the measure → paste → re-run escape hatch: after a
 * pose change the cell geometry moves, so the manifest is knowingly stale for
 * exactly one run.
 */

import { type Canvas, createCanvas, loadImage } from 'canvas';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  type BakedSheet,
  BODY_SHEET,
  GROUND_OFFSET_PX,
  GUARD_SHEET,
  type RowSpec,
  SLAM_SHEET,
  type SheetSpec,
  TILE_SCALE,
  bake,
  goreStatesOf,
  manifestMismatch,
  writeSheets,
} from './generate-krakaren-sprite.js';
import {
  KRAKAREN_CREST_TILES,
  KRAKAREN_SPREAD_HALF_TILES,
  RIM_WIDTH,
  SLAM_HEIGHT,
} from './krakarenArt.js';
import { KRAKAREN_GORE_STATES, KRAKAREN_TENTACLE_GORE_STATES } from './krakarenGore.js';
import {
  KRAKAREN_LAIR_STONE_DARK,
  KRAKAREN_LAIR_STONE_LIGHT,
} from '../src/map/tiles/specialFloorTiles.js';
import {
  KRAKAREN_SWIPE_IMPACT_PROGRESS,
  SLAM_SMASH_IMPACT_PROGRESS,
  TENTACLE_STRIKE_IMPACT_PROGRESS,
} from '../src/sprites/krakarenAttackTiming.js';

const SKIP_MANIFEST_GATE = process.argv.includes('--skip-manifest-gate');

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
const IN_GAME_TILE = 32;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

// ── Pixel helpers ────────────────────────────────────────────────────────────

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

async function decode(sheet: BakedSheet): Promise<Canvas> {
  const image = await loadImage(sheet.buffer);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function gridOf(canvas: Canvas): Grid {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

/** One baked sheet plus its decoded pixels, which every gate reads. */
interface Subject {
  readonly sheet: BakedSheet;
  readonly grid: Grid;
}

interface Cell {
  readonly col: number;
  readonly row: number;
}

function cellAlpha(subject: Subject, cell: Cell): Uint8ClampedArray {
  const { frameWidth, frameHeight } = subject.sheet.geometry;
  const out = new Uint8ClampedArray(frameWidth * frameHeight);
  const baseX = cell.col * frameWidth;
  const baseY = cell.row * frameHeight;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const source = ((baseY + y) * subject.grid.width + baseX + x) * CHANNELS + ALPHA_OFFSET;
      out[y * frameWidth + x] = subject.grid.data[source];
    }
  }
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

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const inkedA = a[i] >= INK_ALPHA_THRESHOLD;
    const inkedB = b[i] >= INK_ALPHA_THRESHOLD;
    if (inkedA !== inkedB) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function cellsOf(subject: Subject, rowIndex: number, count: number): Uint8ClampedArray[] {
  return Array.from({ length: count }, (_unused, col) =>
    cellAlpha(subject, { col, row: rowIndex }),
  );
}

function groundLineOf(sheet: BakedSheet): number {
  return sheet.geometry.tileY + GROUND_OFFSET_PX;
}

function anchorXOf(sheet: BakedSheet): number {
  return sheet.geometry.frameWidth / 2;
}

/**
 * The index of a row a gate names, or −1 after recording a failure.
 *
 * Every one of these names is a string literal written here rather than read
 * out of the row tables, so renaming a row would otherwise turn its gate into a
 * silent no-op: present, green, and measuring nothing. A gate that cannot find
 * its subject must fail, not skip.
 */
function rowIndexOf(sheet: BakedSheet, name: string): number {
  const index = sheet.spec.rows.findIndex((row) => row.name === name);
  if (index < 0) {
    fail(
      'G0',
      `${sheet.spec.key} has no row named "${name}" — a gate is guarding a row that no longer exists`,
    );
  }
  return index;
}

function rowsOf(sheet: BakedSheet): readonly RowSpec[] {
  return sheet.spec.rows;
}

/**
 * The frame a contract progress lands on, inverting the generator's one-shot
 * sampling (`shotProgress`, which spreads a row end to end over `n - 1` steps).
 */
function impactFrameOf(frameCount: number, progress: number): number {
  return Math.round(progress * (frameCount - 1));
}

// ── G1 border clip and spread ────────────────────────────────────────────────

/**
 * Half of the rim-light stroke falls outside the silhouette it traces, and the
 * 2× supersampled cell is box-filtered down, which spreads that stroke's own
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

/** G1 — no frame may paint on its own cell border, and none may be blank. */
function gateBorderClip(subject: Subject): void {
  const { frameWidth, frameHeight } = subject.sheet.geometry;
  rowsOf(subject.sheet).forEach((row, rowIndex) => {
    for (let col = 0; col < row.frameCount; col++) {
      const stats = inkStatsOf(cellAlpha(subject, { col, row: rowIndex }), frameWidth);
      if (stats.count === 0) {
        fail('G1', `${subject.sheet.spec.key} ${row.name}[${col}] painted nothing at all`);
        continue;
      }
      if (
        stats.minX === 0 ||
        stats.minY === 0 ||
        stats.maxX === frameWidth - 1 ||
        stats.maxY === frameHeight - 1
      ) {
        fail(
          'G1',
          `${subject.sheet.spec.key} ${row.name}[${col}] paints on its cell border (ink box ` +
            `${stats.minX}..${stats.maxX} × ${stats.minY}..${stats.maxY} in a ` +
            `${frameWidth}×${frameHeight} cell)`,
        );
      }
    }
  });
}

/** G1 — the body's spread stays inside the reach her cull margin was widened for. */
function gateBodySpread(subject: Subject): void {
  const { frameWidth } = subject.sheet.geometry;
  const anchorX = anchorXOf(subject.sheet);
  let widestDrape = 0;
  let widestLash = 0;
  rowsOf(subject.sheet).forEach((row, rowIndex) => {
    if (row.kind === 'gore') return;
    const drape = DRAPE_ROWS.some((name) => name === row.name);
    const limit = drape ? DRAPE_HALF_LIMIT_TILES : LASH_HALF_LIMIT_TILES;
    for (let col = 0; col < row.frameCount; col++) {
      const stats = inkStatsOf(cellAlpha(subject, { col, row: rowIndex }), frameWidth);
      const half = Math.max(anchorX - stats.minX, stats.maxX - anchorX) / TILE_SCALE;
      if (drape) widestDrape = Math.max(widestDrape, half);
      else widestLash = Math.max(widestLash, half);
      if (half > limit) {
        fail(
          'G1',
          `${row.name}[${col}] spreads ${half.toFixed(3)} tiles from the anchor against a limit of ` +
            `${limit.toFixed(3)} (${drape ? 'resting drape' : 'lashing'}; the boss culls at ` +
            `${KRAKAREN_CULL_MARGIN_TILES} tiles)`,
        );
      }
    }
  });
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
 * `tileY` would move the whole sheet by.
 */
const MANTLE_APEX_TOLERANCE_PX = 8;
/**
 * Tolerance on where the floor debris sits for the tentacle sheets.
 *
 * Their underground frames are nothing but broken floor painted about the
 * ground point, so the middle of that ink is the truest anchor either sheet
 * has; the shards thrown upward pull it a few pixels high.
 */
const GROUND_DEBRIS_TOLERANCE_PX = 12;

/** G2 — the crest of the body's crown limbs stands where `tileY` claims. */
function gateBodyAnchor(subject: Subject): void {
  const { frameWidth } = subject.sheet.geometry;
  const groundY = groundLineOf(subject.sheet);
  const declared = KRAKAREN_CREST_TILES * TILE_SCALE;
  for (const name of ['idle', 'idle_side', 'idle_away']) {
    const rowIndex = rowIndexOf(subject.sheet, name);
    if (rowIndex < 0) continue;
    const stats = inkStatsOf(
      cellAlpha(subject, { col: 0, row: rowIndex }),
      frameWidth,
      SOLID_ALPHA_THRESHOLD,
    );
    const measured = groundY - stats.minY;
    const off = Math.abs(measured - declared);
    if (off > MANTLE_APEX_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] carries its highest ink ${measured.toFixed(1)}px above the ground line ` +
          `(tileY ${subject.sheet.geometry.tileY} + ${GROUND_OFFSET_PX} = ${groundY}) against the ` +
          `${KRAKAREN_CREST_TILES}-tile crest the art declares (${declared.toFixed(1)}px) — ` +
          `${off.toFixed(1)}px off, limit ${MANTLE_APEX_TOLERANCE_PX}`,
      );
    }
  }
}

/** G2 — a tentacle sheet's floor debris is painted on the floor. */
function gateDebrisAnchor(subject: Subject, rowName: string, frame: number): void {
  const { frameWidth } = subject.sheet.geometry;
  const groundY = groundLineOf(subject.sheet);
  const rowIndex = rowIndexOf(subject.sheet, rowName);
  if (rowIndex < 0) return;
  const stats = inkStatsOf(
    cellAlpha(subject, { col: frame, row: rowIndex }),
    frameWidth,
    SOLID_ALPHA_THRESHOLD,
  );
  if (stats.count === 0) {
    fail('G2', `${subject.sheet.spec.key} ${rowName}[${frame}] has no solid ink to anchor on`);
    return;
  }
  const centre = (stats.minY + stats.maxY) / 2;
  const off = Math.abs(centre - groundY);
  if (off > GROUND_DEBRIS_TOLERANCE_PX) {
    fail(
      'G2',
      `${subject.sheet.spec.key} ${rowName}[${frame}] centres its floor debris at y=` +
        `${centre.toFixed(1)} against a ground line of ${groundY} — ${off.toFixed(1)}px off, ` +
        `limit ${GROUND_DEBRIS_TOLERANCE_PX}`,
    );
  }
}

/** G2 — every animation frame straddles the floor plane it is anchored to. */
function gateGroundLineInsideInk(subject: Subject): void {
  const { frameWidth } = subject.sheet.geometry;
  const groundY = groundLineOf(subject.sheet);
  rowsOf(subject.sheet).forEach((row, rowIndex) => {
    if (row.kind === 'gore') return;
    for (let col = 0; col < row.frameCount; col++) {
      const stats = inkStatsOf(cellAlpha(subject, { col, row: rowIndex }), frameWidth);
      if (stats.count === 0) continue;
      if (groundY < stats.minY || groundY > stats.maxY) {
        fail(
          'G2',
          `${subject.sheet.spec.key} ${row.name}[${col}] paints from y=${stats.minY} to ` +
            `y=${stats.maxY}, which does not reach its own ground line at y=${groundY}`,
        );
      }
    }
  });
}

// ── G3 loop closure ──────────────────────────────────────────────────────────

const LOOP_SEAM_LIMIT = 2.1;
const LOOP_SEAM_VS_WORST_STEP = 1.25;

/** G3 — a loop must not pop across its seam. */
function gateLoopClosure(subject: Subject): void {
  let worstShare = 0;
  let worstRow = '';
  rowsOf(subject.sheet).forEach((row, rowIndex) => {
    if (row.kind !== 'loop') return;
    const cells = cellsOf(subject, rowIndex, row.frameCount);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      fail('G3', `${subject.sheet.spec.key} ${row.name} does not move at all across its row`);
      return;
    }
    const allowed = Math.max(
      typical * LOOP_SEAM_LIMIT,
      Math.max(...steps) * LOOP_SEAM_VS_WORST_STEP,
    );
    if (allowed > 0 && seam / allowed > worstShare) {
      worstShare = seam / allowed;
      worstRow = `${row.name} ${seam}/${allowed.toFixed(0)}`;
    }
    if (seam > allowed) {
      fail(
        'G3',
        `${subject.sheet.spec.key} ${row.name} pops across its loop seam: last→first differs by ` +
          `${seam}px against a median step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
  });
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
 */
const STEP_VS_RUNNER_UP = 1.35;

/** G4 — no consecutive-frame step far above the row's own median. */
function gateMotionContinuity(subject: Subject): void {
  const cellArea = subject.sheet.geometry.frameWidth * subject.sheet.geometry.frameHeight;
  rowsOf(subject.sheet).forEach((row, rowIndex) => {
    if (row.kind === 'gore') return;
    const cells = cellsOf(subject, rowIndex, row.frameCount);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
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
          `${subject.sheet.spec.key} ${row.name} snaps between frames ${i} and ${i + 1}: ` +
            `${step}px changed against a median step of ${typical}px (allowed ` +
            `${allowed.toFixed(0)}px)`,
        );
      }
    });
  });
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
  const { frameWidth } = subject.sheet.geometry;
  const anchorX = anchorXOf(subject.sheet);
  let worstOffAnchor = 0;
  let worstDrift = 0;
  rowsOf(subject.sheet).forEach((row, rowIndex) => {
    if (row.kind === 'gore') return;
    const stats = cellsOf(subject, rowIndex, row.frameCount).map((cell) =>
      inkStatsOf(cell, frameWidth),
    );
    const meanX = stats.reduce((total, s) => total + s.centroidX, 0) / stats.length;
    const meanY = stats.reduce((total, s) => total + s.centroidY, 0) / stats.length;
    for (const [frame, s] of stats.entries()) {
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
  });
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
 * exactly — the widest legitimate mismatch on any of the three sheets is under
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
  const { frameWidth, frameHeight } = subject.sheet.geometry;
  const allowed = frameWidth * frameHeight * SETTLE_LIMIT_SHARE;
  const measured: string[] = [];
  for (const pair of settles) {
    const shotIndex = rowIndexOf(subject.sheet, pair.shot);
    const settleIndex = rowIndexOf(subject.sheet, pair.settle);
    if (shotIndex < 0 || settleIndex < 0) continue;
    const rows = rowsOf(subject.sheet);
    const shot = cellAlpha(subject, {
      col: endFrame(rows[shotIndex], pair.shotEnd),
      row: shotIndex,
    });
    const target = cellAlpha(subject, {
      col: endFrame(rows[settleIndex], pair.settleEnd),
      row: settleIndex,
    });
    const delta = frameDelta(shot, target);
    measured.push(`${pair.shot}→${pair.settle} ${delta}`);
    if (delta > allowed) {
      fail(
        'G6',
        `${subject.sheet.spec.key} ${pair.shot} does not settle onto ${pair.settle}: its ` +
          `${pair.shotEnd} frame differs from ${pair.settle}'s ${pair.settleEnd} frame by ` +
          `${delta}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
  }
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
 * Measured against that first frame rather than in absolute pixels because the
 * boss's dozen idle tentacles dwarf the one that lashes, so an absolute width is
 * mostly her sitting still.
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
  const { frameWidth } = subject.sheet.geometry;
  for (const impact of impacts) {
    const rowIndex = rowIndexOf(subject.sheet, impact.row);
    if (rowIndex < 0) continue;
    const row = rowsOf(subject.sheet)[rowIndex];
    const stats = cellsOf(subject, rowIndex, row.frameCount).map((cell) =>
      inkStatsOf(cell, frameWidth),
    );
    const driven = stats.map((frame) => drivenPast(stats[0], frame, impact.metric));
    const peak = Math.max(...driven);
    if (peak <= 0) {
      fail(
        'G7',
        `${subject.sheet.spec.key} ${impact.row} never moves past its own first frame — there is ` +
          `no blow in it to land`,
      );
      continue;
    }
    const band = peak * PEAK_BAND_SHARE;
    const firstInBand = driven.findIndex((value) => value >= band);
    const declared = impactFrameOf(row.frameCount, impact.progress);
    if (declared !== firstInBand) {
      fail(
        'G7',
        `${subject.sheet.spec.key} ${impact.row} first reaches its peak on frame ${firstInBand} ` +
          `(${driven[firstInBand].toFixed(1)} of ${peak.toFixed(1)} past rest), but progress ` +
          `${impact.progress} of ${row.frameCount} frames puts the damage on frame ${declared} ` +
          `(${driven[declared].toFixed(1)} past rest, band floor ${band.toFixed(1)})`,
      );
    }
  }
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
 * Floors set at roughly a third of what the current bake paints, which is the
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

function lipPixelsIn(subject: Subject, rowIndex: number, frameCount: number): number {
  const { frameWidth, frameHeight } = subject.sheet.geometry;
  let lips = 0;
  for (let col = 0; col < frameCount; col++) {
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const i =
          ((rowIndex * frameHeight + y) * subject.grid.width + col * frameWidth + x) * CHANNELS;
        if (subject.grid.data[i + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
        const r = subject.grid.data[i + RED_OFFSET];
        const g = subject.grid.data[i + GREEN_OFFSET];
        const b = subject.grid.data[i + BLUE_OFFSET];
        if (r < LIP_MIN_VALUE || r > LIP_MAX_VALUE) continue;
        if ((r - Math.min(r, g, b)) / r < LIP_MIN_SATURATION) continue;
        const hue = hueOf(r, g, b);
        if (hue === null) continue;
        if (hue >= LIP_HUE_MIN_DEGREES && hue <= LIP_HUE_MAX_DEGREES) lips++;
      }
    }
  }
  return lips;
}

/** G8 — the mouths are actually painted, not merely posed. */
function gateMouthPresence(subject: Subject, quotas: readonly MouthQuota[]): void {
  const measured: string[] = [];
  for (const quota of quotas) {
    const rowIndex = rowIndexOf(subject.sheet, quota.row);
    if (rowIndex < 0) continue;
    const row = rowsOf(subject.sheet)[rowIndex];
    const lips = lipPixelsIn(subject, rowIndex, row.frameCount);
    measured.push(`${quota.row} ${lips}/${quota.minLipPixels}`);
    if (lips < quota.minLipPixels) {
      fail(
        'G8',
        `${subject.sheet.spec.key} ${quota.row} carries only ${lips} lip pixels across its ` +
          `${row.frameCount} frames (floor ${quota.minLipPixels}) — the mouths have stopped ` +
          `reaching the surface`,
      );
    }
  }
  console.log(`  G8 mouths: ${measured.join(', ')}`);
}

// ── G9 floor contrast ────────────────────────────────────────────────────────

function hexLightness(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & CHANNEL_MAX;
  const g = (value >> 8) & CHANNEL_MAX;
  const b = value & CHANNEL_MAX;
  return (r + g + b) / 3;
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
  const { frameWidth, frameHeight } = subject.sheet.geometry;
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  rowsOf(subject.sheet).forEach((row, rowIndex) => {
    if (row.kind === 'gore') return;
    for (let col = 0; col < row.frameCount; col++) {
      for (let y = 0; y < frameHeight; y++) {
        for (let x = 0; x < frameWidth; x++) {
          const i =
            ((rowIndex * frameHeight + y) * subject.grid.width + col * frameWidth + x) * CHANNELS;
          if (subject.grid.data[i + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
          count++;
          sumR += subject.grid.data[i + RED_OFFSET];
          sumG += subject.grid.data[i + GREEN_OFFSET];
          sumB += subject.grid.data[i + BLUE_OFFSET];
        }
      }
    }
  });
  if (count === 0) {
    fail('G9', `${subject.sheet.spec.key} has no solid ink at all`);
    return;
  }
  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const lightness = (meanR + meanG + meanB) / 3;
  const contrast = lightness / LAIR_FLOOR_LIGHTNESS;
  console.log(
    `  G9 floor contrast: ${subject.sheet.spec.key} averages ${lightness.toFixed(1)} against a ` +
      `lair floor of ${LAIR_FLOOR_LIGHTNESS.toFixed(1)} — ${contrast.toFixed(2)}× (floor ` +
      `${MIN_FLOOR_CONTRAST}×)`,
  );
  if (lightness < MIN_FLESH_LIGHTNESS) {
    fail(
      'G9',
      `${subject.sheet.spec.key} averages a lightness of ${lightness.toFixed(1)} (floor ` +
        `${MIN_FLESH_LIGHTNESS}); magenta-pink flesh cannot be this dark`,
    );
  }
  if (meanR <= meanG || meanR <= meanB) {
    fail(
      'G9',
      `${subject.sheet.spec.key} averages rgb(${meanR.toFixed(0)}, ${meanG.toFixed(0)}, ` +
        `${meanB.toFixed(0)}), which is not pink`,
    );
  }
  if (contrast < MIN_FLOOR_CONTRAST) {
    fail(
      'G9',
      `${subject.sheet.spec.key} averages only ${contrast.toFixed(2)}× the lair floor's lightness ` +
        `(floor ${MIN_FLOOR_CONTRAST}×); at 32px she reads as a smudge on the wet stone`,
    );
  }
}

// ── G10 rise height ──────────────────────────────────────────────────────────

/**
 * How much of its declared height the risen slam tentacle must actually stand
 * up above the floor, on *every* frame of the loom.
 *
 * Its 2.5 tiles are arc length, and the loom's coil spends part of its cycle
 * bending that arc over, which legitimately costs vertical reach. What the
 * player must never see is the tentacle that is supposed to make them look up
 * failing to clear the boss.
 */
const MIN_LOOM_RISE_SHARE = 0.9;

/** G10 — the slam tentacle really does loom, in every frame of the row. */
function gateRiseHeight(subject: Subject): void {
  const { frameWidth } = subject.sheet.geometry;
  const groundY = groundLineOf(subject.sheet);
  const rowIndex = rowIndexOf(subject.sheet, 'loom');
  if (rowIndex < 0) return;
  const row = rowsOf(subject.sheet)[rowIndex];
  const required = SLAM_HEIGHT * MIN_LOOM_RISE_SHARE;
  const risen: number[] = [];
  // Sampled end to end rather than at the centre frame: the coil is at its
  // most bent at one phase of the cycle and a single frame never sees it.
  for (let col = 0; col < row.frameCount; col++) {
    const stats = inkStatsOf(
      cellAlpha(subject, { col, row: rowIndex }),
      frameWidth,
      SOLID_ALPHA_THRESHOLD,
    );
    const height = (groundY - stats.minY) / TILE_SCALE;
    risen.push(height);
    if (height < required) {
      fail(
        'G10',
        `loom[${col}] rises only ${height.toFixed(3)} tiles above the floor against the ` +
          `${SLAM_HEIGHT}-tile tentacle it is drawing (floor ${required.toFixed(3)} tiles)`,
      );
    }
  }
  console.log(
    `  G10 rise: loom stands ${Math.min(...risen).toFixed(3)}..${Math.max(...risen).toFixed(3)} ` +
      `tiles of ${SLAM_HEIGHT} (floor ${required.toFixed(3)})`,
  );
}

// ── G11/G12 gore ─────────────────────────────────────────────────────────────

const GORE_MIN_SHORT_AXIS_PX = 9;

function goreRowIndexOf(sheet: BakedSheet): number {
  return sheet.spec.rows.findIndex((row) => row.kind === 'gore');
}

/** G11 — every gore piece must still be a shape at the size it actually renders. */
function gateGoreLegibility(subject: Subject): void {
  const rowIndex = goreRowIndexOf(subject.sheet);
  if (rowIndex < 0) {
    fail('G11', `${subject.sheet.spec.key} has no gore row for the legibility gate to measure`);
    return;
  }
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  goreStatesOf(subject.sheet.spec).forEach((state, col) => {
    const stats = inkStatsOf(
      cellAlpha(subject, { col, row: rowIndex }),
      subject.sheet.geometry.frameWidth,
    );
    const shortAxis =
      (Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G11',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis in game (limit ` +
          `${GORE_MIN_SHORT_AXIS_PX}px) — at that size it is a speck, not a body part`,
      );
    }
  });
}

const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function maskOf(subject: Subject, cell: Cell): boolean[] {
  const alpha = cellAlpha(subject, cell);
  const { frameWidth } = subject.sheet.geometry;
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
        stats.minX + (width - span) / 2 + ((x + 0.5) / DISTINCT_MASK) * span,
      );
      const sourceY = Math.round(
        stats.minY + (height - span) / 2 + ((y + 0.5) / DISTINCT_MASK) * span,
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
  const rowIndex = goreRowIndexOf(subject.sheet);
  if (rowIndex < 0) {
    fail('G12', `${subject.sheet.spec.key} has no gore row for the distinctness gate to measure`);
    return;
  }
  const states = goreStatesOf(subject.sheet.spec);
  const masks = states.map((_state, col) => maskOf(subject, { col, row: rowIndex }));
  let worst = 0;
  let worstPair = '';
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].length; i++) {
        if (masks[a][i] && masks[b][i]) intersection++;
        if (masks[a][i] || masks[b][i]) union++;
      }
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
  console.log(
    `  G12 gore distinctness: ${subject.sheet.spec.key} worst pair ${worstPair} at ` +
      `${(worst * 100).toFixed(0)}% (limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%)`,
  );
}

// ── G13 gore contract ────────────────────────────────────────────────────────

/**
 * The three places a gore piece's name is written down have to agree, because
 * the way they fail to is by dropping a body part on the floor in silence:
 * `BodyPartGoreSystem` skips a state it cannot find in the sheet.
 *
 * Two of the three exist today — the gore painter's own state list and the
 * bake's row — and this gate holds them together. The third, the sprite
 * module's exported part list, is written by the runtime-wiring work that comes
 * after this bake; the moment `src/sprites/krakarenSprite.ts` exists this gate
 * starts reading it as well, without an edit here.
 */
interface GoreContract {
  readonly spec: SheetSpec;
  readonly painterStates: readonly string[];
  readonly modulePath: string;
  readonly exportName: string;
}

const GORE_CONTRACTS: readonly GoreContract[] = [
  {
    spec: BODY_SHEET,
    painterStates: KRAKAREN_GORE_STATES,
    modulePath: 'src/sprites/krakarenSprite.ts',
    exportName: 'KRAKAREN_GORE_PARTS',
  },
  {
    spec: GUARD_SHEET,
    painterStates: KRAKAREN_TENTACLE_GORE_STATES,
    modulePath: 'src/sprites/krakarenTentacleSprite.ts',
    exportName: 'KRAKAREN_TENTACLE_GORE_PARTS',
  },
];

function sameStates(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((state, i) => state === b[i]);
}

function gateGoreContract(): void {
  for (const contract of GORE_CONTRACTS) {
    const baked = goreStatesOf(contract.spec);
    if (!sameStates(contract.painterStates, baked)) {
      fail(
        'G13',
        `krakarenGore.ts paints [${contract.painterStates.join(', ')}] but ${contract.spec.key}'s ` +
          `gore row bakes [${baked.join(', ')}]`,
      );
    }
    const path = resolve(contract.modulePath);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const declaration = new RegExp(`${contract.exportName}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source);
    if (declaration === null) {
      console.log(
        `  G13 NOT YET LIVE: ${contract.spec.key} matches its painter, but ` +
          `${contract.modulePath} does not export ${contract.exportName} yet, so the runtime side ` +
          `of the contract is unchecked. Wiring that module must make this line disappear.`,
      );
      continue;
    }
    const runtimeParts = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    if (!sameStates(runtimeParts, baked)) {
      fail(
        'G13',
        `${contract.modulePath}'s ${contract.exportName} is [${runtimeParts.join(', ')}] but the ` +
          `bake produces [${baked.join(', ')}] — a state the runtime names and the sheet lacks is ` +
          `silently skipped`,
      );
    }
  }
}

// ── G14 texture size ─────────────────────────────────────────────────────────

/**
 * All three keys preload together with the floor-2 groups, so the sum is the
 * real cost. Frame counts are not the lever they are elsewhere: they are a
 * contract shared with the gameplay code through
 * `src/sprites/krakarenAttackTiming.ts`.
 */
const TEXTURE_BUDGET_MEGAPIXELS: Readonly<Record<string, number>> = {
  krakaren: 6,
  krakaren_tentacle: 3,
  krakaren_slam: 4,
};

/** G14 — the sheet's own size, reported whether or not it passes. */
function gateTextureSize(sheet: BakedSheet): void {
  const megapixels =
    (sheet.columns *
      sheet.geometry.frameWidth *
      sheet.spec.rows.length *
      sheet.geometry.frameHeight) /
    1e6;
  const budget = TEXTURE_BUDGET_MEGAPIXELS[sheet.spec.key];
  if (budget === undefined) {
    fail('G14', `${sheet.spec.key} has no texture budget — a new sheet needs one`);
    return;
  }
  console.log(`  G14 texture: ${megapixels.toFixed(2)} MP of a ${budget} MP budget`);
  if (megapixels > budget) {
    fail(
      'G14',
      `${sheet.spec.key} is ${megapixels.toFixed(2)} MP against a budget of ${budget} MP`,
    );
  }
}

// ── G15 manifest ─────────────────────────────────────────────────────────────

/** G15 — a sheet whose manifest entry does not describe it renders as garbage. */
function gateManifest(sheet: BakedSheet): void {
  const mismatch = manifestMismatch(sheet);
  if (mismatch === null) {
    console.log(`  G15 manifest: "${sheet.spec.key}" is in sync`);
    return;
  }
  if (SKIP_MANIFEST_GATE) {
    console.warn(`  G15 SKIPPED — paste this and re-run without the flag:\n${mismatch}`);
    return;
  }
  fail('G15', mismatch);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function subjectOf(spec: SheetSpec): Promise<Subject> {
  const sheet = bake(spec);
  return { sheet, grid: gridOf(await decode(sheet)) };
}

async function runGates(): Promise<readonly BakedSheet[]> {
  console.log(`Gating the Krakaren bakes (tileScale=${TILE_SCALE})…`);
  const body = await subjectOf(BODY_SHEET);
  const guard = await subjectOf(GUARD_SHEET);
  const slam = await subjectOf(SLAM_SHEET);
  const all = [body, guard, slam];

  for (const subject of all) {
    console.log(`  — ${subject.sheet.spec.key}`);
    gateBorderClip(subject);
    gateGroundLineInsideInk(subject);
    gateLoopClosure(subject);
    gateMotionContinuity(subject);
    gateTextureSize(subject.sheet);
    gateDescribedCreature(subject);
    gateManifest(subject.sheet);
  }

  gateBodySpread(body);
  gateBodyAnchor(body);
  gateCentroidDrift(body);
  gateOneShotSettle(body, BODY_SETTLES);
  gateImpactIsThePeak(body, BODY_IMPACTS);
  gateMouthPresence(body, BODY_MOUTH_QUOTAS);
  gateGoreLegibility(body);
  gateGoreDistinctness(body);

  gateDebrisAnchor(guard, 'emerge', 0);
  gateOneShotSettle(guard, GUARD_SETTLES);
  gateImpactIsThePeak(guard, GUARD_IMPACTS);
  gateMouthPresence(guard, GUARD_MOUTH_QUOTAS);
  gateGoreLegibility(guard);
  gateGoreDistinctness(guard);

  gateDebrisAnchor(slam, 'smash', 0);
  gateOneShotSettle(slam, SLAM_SETTLES);
  gateImpactIsThePeak(slam, SLAM_IMPACTS);
  gateMouthPresence(slam, SLAM_MOUTH_QUOTAS);
  gateRiseHeight(slam);

  gateGoreContract();

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} gate${failures.length === 1 ? '' : 's'} failed; nothing was written:\n  ` +
        failures.join('\n  '),
    );
  }
  console.log('  all gates passed');
  return all.map((subject) => subject.sheet);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  // The gated sheets are the ones written. Baking a second time to write would
  // put bytes on disk that nothing measured, and the whole contract of this
  // module is that a sheet which failed a gate never reaches the filesystem.
  runGates()
    .then((sheets) => {
      writeSheets(sheets);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { runGates };
