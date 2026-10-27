/**
 * Steve Cartwright's art gates: the otter wheelwright and his crossbow bolt.
 *
 * Pose-stream gates measure the choreography itself; pixel gates measure cells
 * painted from the figures exactly the way the runtime cache bakes them, so
 * what is measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 *   npm run gates:steve        (also run first by `npm run render:steve`)
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  type OtterPose,
  type OtterView,
  type V3,
  boltTipAt,
  crankHandleAt,
  crossbowAim,
  crossbowPointOnScreen,
  foreStockAt,
  legReachShare,
  length3,
  otterSilhouetteRatios,
  otterSkeleton,
  pawMissAt,
  stirrupAt,
} from '../src/sprites/art/steveArt.js';
import {
  BOLT_BURIED_TILES,
  BOLT_FLY_STATE,
  BOLT_STUCK_STATE,
  OTTER_TILE_X,
  OTTER_TILE_Y,
  STEVE_BOLT_FIGURE,
  STEVE_FIGURE,
  STEVE_ROWS,
  STEVE_ROW_NAMES,
  STEVE_VIEWS,
  TILE_SCALE,
  paintStevePose,
  steveMuzzleInCell,
  stevePoseAt,
  steveStateName,
  type SteveRow,
} from '../src/sprites/art/steveFigure.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  STEVE_AIM_FRAMES,
  STEVE_BOLT_FRAMES,
  STEVE_IDLE_FRAMES,
  STEVE_RELOAD_FRAMES,
  STEVE_SHOOT_FRAMES,
  STEVE_SHOOT_RELEASE_FRAME,
  STEVE_SHOOT_RELEASE_PROGRESS,
  STEVE_WALK_FRAMES,
} from '../src/sprites/steveTiming.js';
import { steveMuzzlePoint, steveReachableStates } from '../src/sprites/steveSprite.js';

const CHANNELS = 4;
const ALPHA = 3;
/**
 * Alpha above which a pixel is the otter rather than the soft contact shadow
 * under him. An anchor gate measured on ordinary ink measures the shadow, which
 * sits on the ground line whether or not the feet do.
 */
const SOLID_ALPHA = 200;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
/** Turns a 0-1 share into the percentage a failure message reads in. */
const PERCENT = 100;
/** Tiles are reported to a thousandth: a sixty-fourth of a pixel at the tile. */
const TILE_DECIMALS = 3;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const cellCache = new Map<string, Uint8ClampedArray>();

function pixelsOf(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}:${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const cell: Canvas = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
  cellCache.set(key, data);
  return data;
}

function alphaAt(data: Uint8ClampedArray, def: FigureDef, x: number, y: number): number {
  return data[(y * def.frameWidth + x) * CHANNELS + ALPHA];
}

/** Mean absolute alpha difference between two frames of a state, 0..255. */
function frameDelta(def: FigureDef, state: string, a: number, b: number): number {
  const first = pixelsOf(def, state, a);
  const second = pixelsOf(def, state, b);
  let total = 0;
  for (let i = ALPHA; i < first.length; i += CHANNELS) total += Math.abs(first[i] - second[i]);
  return total / (first.length / CHANNELS);
}

interface SolidBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function solidBoxOf(def: FigureDef, state: string, frame: number): SolidBox | null {
  const data = pixelsOf(def, state, frame);
  let minX = def.frameWidth;
  let minY = def.frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < def.frameHeight; y++) {
    for (let x = 0; x < def.frameWidth; x++) {
      if (alphaAt(data, def, x, y) < SOLID_ALPHA) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

function frameCountOf(def: FigureDef, state: string): number {
  return def.states.get(state)?.frames ?? 0;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * The flying bolt's streak is authored to trail off the back of its cell. The
 * stuck bolt is a short shaft in a cell sized for the flying one's streak.
 */
const BOLT_MIN_FILL = 0.2;

function gateStructure(): void {
  for (const failure of figureStructuralFailures(STEVE_FIGURE)) fail('G1', failure);
  for (const failure of figureStructuralFailures(STEVE_BOLT_FIGURE, {
    bleedEdges: ['left'],
    sparseStates: [BOLT_STUCK_STATE],
    minInkAreaShare: BOLT_MIN_FILL,
  })) {
    fail('G1', failure);
  }
}

// ── G2 every state the runtime can ask for is painted ────────────────────────

function gateReachableStates(): void {
  for (const failure of missingStateFailures(
    STEVE_FIGURE,
    steveReachableStates(),
    'steveReachableStates()',
  )) {
    fail('G2', failure);
  }
  for (const failure of missingStateFailures(
    STEVE_BOLT_FIGURE,
    [BOLT_FLY_STATE, BOLT_STUCK_STATE],
    'the bolt states',
  )) {
    fail('G2', failure);
  }
}

// ── G3 row lengths match the timing module ───────────────────────────────────

/**
 * The frame counts the timing is computed against. Written out here from the
 * timing module rather than read off the row table, so a row that stops being
 * built from its timing constant is caught instead of agreeing with itself.
 */
const EXPECTED_FRAMES: Readonly<Record<SteveRow, number>> = {
  idle: STEVE_IDLE_FRAMES,
  walk: STEVE_WALK_FRAMES,
  aim: STEVE_AIM_FRAMES,
  shoot: STEVE_SHOOT_FRAMES,
  reload: STEVE_RELOAD_FRAMES,
};

function gateRowLengths(): void {
  let measured = 0;
  for (const row of STEVE_ROW_NAMES) {
    for (const view of STEVE_VIEWS) {
      const state = steveStateName(row, view);
      const frames = frameCountOf(STEVE_FIGURE, state);
      measured++;
      if (frames !== EXPECTED_FRAMES[row]) {
        fail(
          'G3',
          `${state} paints ${frames} frames; the timing module says ${EXPECTED_FRAMES[row]}`,
        );
      }
    }
  }
  measured++;
  const boltFrames = frameCountOf(STEVE_BOLT_FIGURE, BOLT_FLY_STATE);
  if (boltFrames !== STEVE_BOLT_FRAMES) {
    fail(
      'G3',
      `the flying bolt paints ${boltFrames} frames; the timing module says ${STEVE_BOLT_FRAMES}`,
    );
  }
  failUnlessMeasured('G3', measured, 'rows');
}

// ── G4 the release frame shows the release ───────────────────────────────────

/**
 * The routine spawns the flying bolt at `STEVE_SHOOT_RELEASE_PROGRESS`, so
 * the frame drawn from that progress on must be the first with the crossbow
 * empty, and every frame before it loaded and cocked. The shot ends empty;
 * the reload ends loaded and cocked; the aim is loaded throughout.
 */
function shootFramesAt(progress: number): number {
  return Math.min(STEVE_SHOOT_FRAMES - 1, Math.floor(progress * STEVE_SHOOT_FRAMES));
}

function gateReleaseFrames(): void {
  let measured = 0;
  const drawnAtRelease = shootFramesAt(STEVE_SHOOT_RELEASE_PROGRESS);
  if (drawnAtRelease !== STEVE_SHOOT_RELEASE_FRAME) {
    fail(
      'G4',
      `progress ${STEVE_SHOOT_RELEASE_PROGRESS} draws shoot frame ${drawnAtRelease}, not the release frame ${STEVE_SHOOT_RELEASE_FRAME}`,
    );
  }
  for (const view of STEVE_VIEWS) {
    const shoot = steveStateName('shoot', view);
    for (let frame = 0; frame < STEVE_SHOOT_FRAMES; frame++) {
      const pose = stevePoseAt(shoot, frame);
      if (pose === null) {
        fail('G4', `${shoot}[${frame}] has no pose`);
        continue;
      }
      measured++;
      const shouldBeLoaded = frame < STEVE_SHOOT_RELEASE_FRAME;
      const loaded = pose.crossbow.loaded && pose.crossbow.cocked >= 1;
      const empty = !pose.crossbow.loaded && pose.crossbow.cocked <= 0;
      if (shouldBeLoaded && !loaded) {
        fail(
          'G4',
          `${shoot}[${frame}] is drawn empty before the release frame ${STEVE_SHOOT_RELEASE_FRAME}`,
        );
      }
      if (!shouldBeLoaded && !empty) {
        fail(
          'G4',
          `${shoot}[${frame}] still shows a loaded or cocked crossbow from the release frame on`,
        );
      }
    }
    for (const [row, frame] of [
      ['reload', STEVE_RELOAD_FRAMES - 1],
      ...Array.from({ length: STEVE_AIM_FRAMES }, (_unused, f) => ['aim', f] as const),
    ] as const) {
      const state = steveStateName(row, view);
      const pose = stevePoseAt(state, frame);
      measured++;
      if (pose === null || !pose.crossbow.loaded || pose.crossbow.cocked < 1) {
        fail('G4', `${state}[${frame}] should hold a loaded, cocked crossbow`);
      }
    }
  }
  failUnlessMeasured('G4', measured, 'release frames');
}

// ── G5 standing on the ground line ───────────────────────────────────────────

/** The cell row the tile's bottom edge — the ground — falls on. */
const GROUND_ROW = OTTER_TILE_Y + TILE_SCALE;
/** A sole may reach a pixel or two past the line; it may never float above it. */
const GROUND_BELOW_TOLERANCE = 3;
/**
 * From behind, his tail lies on the floor between him and the camera, so it
 * draws a little lower on the screen than his soles do.
 */
const AWAY_TAIL_BELOW_TOLERANCE = 9;
const GROUND_ABOVE_TOLERANCE = 2;
const STANDING_ROWS: readonly SteveRow[] = STEVE_ROW_NAMES;

function gateGroundLine(): void {
  let measured = 0;
  for (const row of STANDING_ROWS) {
    for (const view of STEVE_VIEWS) {
      const state = steveStateName(row, view);
      for (let frame = 0; frame < frameCountOf(STEVE_FIGURE, state); frame++) {
        const box = solidBoxOf(STEVE_FIGURE, state, frame);
        if (box === null) {
          fail('G5', `${state}[${frame}] has no solid pixels at all`);
          continue;
        }
        measured++;
        const offset = box.maxY - GROUND_ROW;
        const below = view === 'away' ? AWAY_TAIL_BELOW_TOLERANCE : GROUND_BELOW_TOLERANCE;
        if (offset < -GROUND_ABOVE_TOLERANCE || offset > below) {
          fail(
            'G5',
            `${state}[${frame}]: lowest solid pixel is ${offset} px from the ground line ` +
              `(allowed ${-GROUND_ABOVE_TOLERANCE}..+${below})`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G5', measured, 'standing frames');
}

// ── G6 facing ────────────────────────────────────────────────────────────

/** How much of the ink's height, from the bottom, counts as "the floor band" for the facing test. */
const FLOOR_BAND_SHARE = 0.2;
/** The tail must trail at least this much further behind the tile's centre than anything reaches ahead of it. */
const TAIL_TRAIL_MARGIN_PX = 10;
/** Head-on and from behind are the same body; their crowns may differ in height by this much. */
const VIEW_TOP_TOLERANCE_PX = 3;

/**
 * The profile is painted facing +X and the runtime mirrors it for -X, so in
 * every standing profile frame the heavy tail lies along the floor behind him,
 * reaching well past the tile's centre on the -X side — a row authored facing
 * the other way walks backward after the flip. Head-on and from behind must
 * stand the same height, or turning round changes his size.
 */
function gateFacing(): void {
  const tileCentreX = STEVE_FIGURE.tileX + TILE_SCALE / 2;
  let measured = 0;
  for (const row of STANDING_ROWS) {
    const state = steveStateName(row, 'side');
    for (let frame = 0; frame < frameCountOf(STEVE_FIGURE, state); frame++) {
      const box = solidBoxOf(STEVE_FIGURE, state, frame);
      if (box === null) {
        fail('G6', `${state}[${frame}] has no solid ink`);
        continue;
      }
      const data = pixelsOf(STEVE_FIGURE, state, frame);
      const bandTop = box.maxY - Math.round((box.maxY - box.minY) * FLOOR_BAND_SHARE);
      let behind = 0;
      let ahead = 0;
      for (let y = bandTop; y <= box.maxY; y++) {
        for (let x = 0; x < STEVE_FIGURE.frameWidth; x++) {
          if (alphaAt(data, STEVE_FIGURE, x, y) < SOLID_ALPHA) continue;
          behind = Math.max(behind, tileCentreX - x);
          ahead = Math.max(ahead, x - tileCentreX);
        }
      }
      measured++;
      if (behind < ahead + TAIL_TRAIL_MARGIN_PX) {
        fail(
          'G6',
          `${state}[${frame}]: along the floor the ink reaches ${behind} px behind the tile centre ` +
            `and ${ahead} px ahead — the tail is not trailing behind a +X-facing profile`,
        );
      }
    }
  }
  const front = solidBoxOf(STEVE_FIGURE, steveStateName('idle', 'front'), 0);
  const away = solidBoxOf(STEVE_FIGURE, steveStateName('idle', 'away'), 0);
  if (front === null || away === null) {
    fail('G6', 'the head-on or away idle painted nothing');
  } else {
    measured++;
    const difference = Math.abs(front.minY - away.minY);
    if (difference > VIEW_TOP_TOLERANCE_PX) {
      fail(
        'G6',
        `head-on and away idles top out ${difference} px apart (limit ${VIEW_TOP_TOLERANCE_PX})`,
      );
    }
  }
  failUnlessMeasured('G6', measured, 'facing measurements');
}

// ── G7 leg reach ─────────────────────────────────────────────────────────────

/**
 * Every frame of every row keeps each hip-to-ankle span inside the leg's
 * reach. A clamped leg locks straight and leaves its foot hanging off the
 * floor, which in a walk reads as a hop.
 */
function gateLegReach(): void {
  let measured = 0;
  for (const row of STEVE_ROW_NAMES) {
    const spec = STEVE_ROWS[row];
    for (const view of STEVE_VIEWS) {
      const state = steveStateName(row, view);
      for (let frame = 0; frame < spec.frameCount; frame++) {
        const pose = stevePoseAt(state, frame);
        if (pose === null) {
          fail('G7', `${state}[${frame}] has no pose`);
          continue;
        }
        for (const side of ['R', 'L'] as const) {
          measured++;
          const share = legReachShare(pose, side);
          if (!(share <= 1)) {
            fail(
              'G7',
              `${state}[${frame}] leg ${side} reaches ${(share * PERCENT).toFixed(1)}% of its length`,
            );
          }
        }
      }
    }
  }
  failUnlessMeasured('G7', measured, 'legs');
}

// ── G8 loop seams ────────────────────────────────────────────────────────────

/**
 * A loop's last-to-first step, held to a band. The ceiling is against the
 * largest step inside the row, not the median: the idle's bounce and the
 * walk's footfalls are deliberate sharp steps that recur once a cycle, and a
 * seam that lands on one of them is exactly as big as its twin mid-row. A pop
 * is a seam bigger than anything the row does on purpose. The floor is against
 * the median: a seam near zero means the cycle holds still for a frame.
 */
const SEAM_MIN_TO_MEDIAN = 0.4;
const SEAM_MAX_TO_LARGEST = 1.25;

function loopSeamFailures(def: FigureDef, state: string): number {
  const frames = frameCountOf(def, state);
  if (frames < 2) {
    fail('G8', `${def.id}.${state} has ${frames} frames, too few to loop`);
    return 0;
  }
  const steps: number[] = [];
  for (let frame = 1; frame < frames; frame++) steps.push(frameDelta(def, state, frame - 1, frame));
  const seam = frameDelta(def, state, frames - 1, 0);
  const typical = median(steps);
  const largest = Math.max(...steps);
  if (typical <= 0) {
    fail('G8', `${def.id}.${state} never moves`);
    return 1;
  }
  if (seam < typical * SEAM_MIN_TO_MEDIAN) {
    fail(
      'G8',
      `${def.id}.${state}: loop seam is ${(seam / typical).toFixed(2)}× the median step ` +
        `(floor ${SEAM_MIN_TO_MEDIAN}) — the cycle holds still across the seam`,
    );
  }
  if (seam > largest * SEAM_MAX_TO_LARGEST) {
    fail(
      'G8',
      `${def.id}.${state}: loop seam is ${(seam / largest).toFixed(2)}× the largest step in the ` +
        `row (ceiling ${SEAM_MAX_TO_LARGEST}) — the loop pops once a cycle`,
    );
  }
  return 1;
}

function gateLoopSeams(): void {
  let measured = 0;
  for (const row of STEVE_ROW_NAMES) {
    const spec = STEVE_ROWS[row];
    if (spec.kind !== 'loop') continue;
    for (const view of STEVE_VIEWS) {
      measured += loopSeamFailures(STEVE_FIGURE, steveStateName(row, view));
    }
  }
  failUnlessMeasured('G8', measured, 'loop rows');
}

// ── G9 not a rat ────────────────────────────────────────────────────────────

/** A rat's head is a long wedge; an otter's is broad and flat. */
const MIN_HEAD_WIDTH_TO_HEIGHT = 1.35;
/** A rat's tail is a thin cord; an otter's roots as thick as a thigh. */
const MIN_TAIL_ROOT_TO_THIGH = 1;
/** A rat's ears are big discs; an otter's are small round nubs. */
const MAX_EAR_TO_HEAD_HALF_WIDTH = 0.3;

function gateNotARat(): void {
  const ratios = otterSilhouetteRatios();
  if (ratios.headWidthToHeight < MIN_HEAD_WIDTH_TO_HEIGHT) {
    fail(
      'G9',
      `head is ${ratios.headWidthToHeight.toFixed(2)}× as wide as tall (min ${MIN_HEAD_WIDTH_TO_HEIGHT}) — a wedge reads as a rat`,
    );
  }
  if (ratios.tailRootToThigh < MIN_TAIL_ROOT_TO_THIGH) {
    fail(
      'G9',
      `tail root is ${ratios.tailRootToThigh.toFixed(2)}× a thigh (min ${MIN_TAIL_ROOT_TO_THIGH}) — a thin tail reads as a rat's`,
    );
  }
  if (ratios.earToHeadHalfWidth > MAX_EAR_TO_HEAD_HALF_WIDTH) {
    fail(
      'G9',
      `ears are ${ratios.earToHeadHalfWidth.toFixed(2)} of the head's half-width (max ${MAX_EAR_TO_HEAD_HALF_WIDTH}) — big ears read as a rat's`,
    );
  }
}

// ── G10 warm-row size ────────────────────────────────────────────────────────

function gateWarmRowSize(): void {
  let measured = 0;
  for (const def of [STEVE_FIGURE, STEVE_BOLT_FIGURE]) {
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widest = 0;
    let widestState = '';
    for (const [state, declared] of def.states) {
      measured++;
      if (declared.frames <= widest) continue;
      widest = declared.frames;
      widestState = state;
    }
    const bytes = widest * cellBytes;
    if (bytes > figureByteBudgetFor(def)) {
      fail(
        'G10',
        `${def.id}.${widestState} warms to ${(bytes / BYTES_PER_MEGABYTE).toFixed(2)} MB, over ` +
          `its ${(figureByteBudgetFor(def) / BYTES_PER_MEGABYTE).toFixed(1)} MB budget`,
      );
    }
  }
  failUnlessMeasured('G10', measured, 'declared states');
}

// ── G12 the bolt sits on its anchor ──────────────────────────────────────────

const BOLT_TIP_TOLERANCE_PX = 2;
/** The stuck bolt must show at least this much less shaft than the flying one, as a share of what is buried. */
const STUCK_SHORTER_SHARE = 0.6;
/** The stuck bolt paints nothing this far behind its own nock: the flying bolt's streak lives there. */
const STREAK_CLEAR_PX = 3;

/**
 * The runtime passes the flying bolt's point as its position and hit-tests
 * there, so its frontmost solid ink sits on the anchor. The stuck bolt is
 * anchored where it went in: its frontmost ink (the split in the wood) sits on
 * the anchor too, its shaft is shorter than the flying one's by most of what
 * is buried, and it paints no streak behind its nock.
 */
function gateBoltAnchors(): void {
  let measured = 0;
  const bolt = STEVE_BOLT_FIGURE;
  let flyingLength = 0;
  for (let frame = 0; frame < frameCountOf(bolt, BOLT_FLY_STATE); frame++) {
    const box = solidBoxOf(bolt, BOLT_FLY_STATE, frame);
    if (box === null) {
      fail('G12', `${bolt.id}.${BOLT_FLY_STATE}[${frame}] has no solid ink`);
      continue;
    }
    measured++;
    flyingLength = Math.max(flyingLength, box.maxX - box.minX);
    if (Math.abs(box.maxX - bolt.tileX) > BOLT_TIP_TOLERANCE_PX) {
      fail(
        'G12',
        `${bolt.id}[${frame}]: the point is at x=${box.maxX}, not on the anchor x=${bolt.tileX}`,
      );
    }
  }
  const stuck = solidBoxOf(bolt, BOLT_STUCK_STATE, 0);
  if (stuck === null) {
    fail('G12', `${bolt.id}.${BOLT_STUCK_STATE} has no solid ink`);
  } else {
    measured++;
    if (Math.abs(stuck.maxX - bolt.tileX) > BOLT_TIP_TOLERANCE_PX) {
      fail(
        'G12',
        `the stuck bolt's front is at x=${stuck.maxX}, not at the entry point x=${bolt.tileX}`,
      );
    }
    const stuckLength = stuck.maxX - stuck.minX;
    const shorterBy = flyingLength - stuckLength;
    const buriedPx = BOLT_BURIED_TILES * TILE_SCALE;
    if (shorterBy < buriedPx * STUCK_SHORTER_SHARE) {
      fail(
        'G12',
        `the stuck bolt shows ${stuckLength} px of shaft against the flying bolt's ${flyingLength} — ` +
          `only ${shorterBy} px shorter with ${buriedPx.toFixed(1)} px buried`,
      );
    }
    const data = pixelsOf(bolt, BOLT_STUCK_STATE, 0);
    let streakInk = 0;
    for (let y = 0; y < bolt.frameHeight; y++) {
      for (let x = 0; x < stuck.minX - STREAK_CLEAR_PX; x++) streakInk += alphaAt(data, bolt, x, y);
    }
    if (streakInk > 0) fail('G12', `the stuck bolt paints ink behind its nock — a motion streak`);
  }
  failUnlessMeasured('G12', measured, 'bolt frames');
}

// ── G13 the aim, the shot and the reload share one line ──────────────────────

/** How far the bolt's point may drift off the shot's line, in tiles: his breathing, under a pixel at the tile. */
const LINE_TIP_TOLERANCE_TILES = 0.012;
/** How far the crossbow may turn off the shot's line. */
const LINE_ANGLE_TOLERANCE_DEGREES = 2;
const HALF_TURN_DEGREES = 180;
const DEGREES_PER_RADIAN = HALF_TURN_DEGREES / Math.PI;

interface CrossbowLine {
  readonly tip: V3;
  readonly aim: V3;
}

function lineOf(pose: OtterPose): CrossbowLine {
  const skeleton = otterSkeleton(pose);
  return { tip: boltTipAt(pose, skeleton), aim: crossbowAim(pose, skeleton) };
}

function angleBetween(a: V3, b: V3): number {
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (length3(a) * length3(b));
  return Math.acos(Math.max(-1, Math.min(1, dot))) * DEGREES_PER_RADIAN;
}

/**
 * The routine chains aim → shoot → reload → aim. The shot's release frame is
 * the line the bolt leaves on; every aim frame, the shot's first and last
 * frames and the reload's first and last frames must hold the crossbow on that
 * same line, or the crossbow pops as one row hands to the next.
 */
function gateSharedLine(): void {
  let measured = 0;
  const release = stevePoseAt(steveStateName('shoot', 'side'), STEVE_SHOOT_RELEASE_FRAME);
  if (release === null) {
    fail('G13', 'the shoot row has no release frame');
    return;
  }
  const line = lineOf(release);
  const checks: ReadonlyArray<readonly [SteveRow, number]> = [
    ...Array.from({ length: STEVE_AIM_FRAMES }, (_unused, frame) => ['aim', frame] as const),
    ['shoot', 0],
    ['shoot', STEVE_SHOOT_RELEASE_FRAME - 1],
    ['shoot', STEVE_SHOOT_FRAMES - 1],
    ['reload', 0],
    ['reload', STEVE_RELOAD_FRAMES - 1],
  ];
  for (const [row, frame] of checks) {
    const pose = stevePoseAt(steveStateName(row, 'side'), frame);
    if (pose === null) {
      fail('G13', `${row}[${frame}] has no pose`);
      continue;
    }
    measured++;
    const here = lineOf(pose);
    const drift = length3({
      x: here.tip.x - line.tip.x,
      y: here.tip.y - line.tip.y,
      z: here.tip.z - line.tip.z,
    });
    const turn = angleBetween(here.aim, line.aim);
    if (!(drift <= LINE_TIP_TOLERANCE_TILES && turn <= LINE_ANGLE_TOLERANCE_DEGREES)) {
      fail(
        'G13',
        `${row}[${frame}] holds the bolt's point ${drift.toFixed(TILE_DECIMALS)} tiles and ${turn.toFixed(1)}° off the ` +
          `release line (limits ${LINE_TIP_TOLERANCE_TILES}, ${LINE_ANGLE_TOLERANCE_DEGREES}°)`,
      );
    }
  }
  failUnlessMeasured('G13', measured, 'line frames');
}

// ── G14 the reload cranks the windlass ───────────────────────────────────────

/**
 * A paw this close to what it holds is on it, in tiles: under a pixel at the
 * tile. Limits in these pose gates are tested as `!(value <= limit)`, so a NaN
 * from a broken pose fails rather than slipping past every comparison.
 */
const PAW_HOLD_TOLERANCE_TILES = 0.012;
/** The cranking paw has to travel at least this far, in tiles — most of the crank's circle. */
const CRANK_PAW_MIN_TRAVEL_TILES = 0.09;
/** The crank must make at least one whole turn while the string winds. */
const CRANK_MIN_TURNS = 1;
/** The ankle in the stirrup sits about a foot's height above the stirrup's centre on the floor. */
const FOOT_IN_STIRRUP_TOLERANCE_TILES = 0.09;
/** Cranking frames: no fewer, or the turn strobes. */
const CRANK_MIN_FRAMES = 5;

/**
 * While the string winds the left paw is on the crank handle on every frame,
 * the handle goes round at least once, the paw really travels with it, his
 * left foot holds the stirrup down, and the string is drawn monotonically back
 * to the latch. Before the bolt is seated
 * it is carried in the paw.
 */
function gateReloadCranks(): void {
  let cranking = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let firstCrank = Infinity;
  let lastCrank = -Infinity;
  let lastCocked = 0;
  let carried = 0;
  const state = steveStateName('reload', 'side');
  for (let frame = 0; frame < STEVE_RELOAD_FRAMES; frame++) {
    const pose = stevePoseAt(state, frame);
    if (pose === null) {
      fail('G14', `${state}[${frame}] has no pose`);
      continue;
    }
    if (pose.crossbow.cocked < lastCocked) {
      fail(
        'G14',
        `${state}[${frame}] lets the string slip forward (${pose.crossbow.cocked.toFixed(2)} after ${lastCocked.toFixed(2)})`,
      );
    }
    lastCocked = pose.crossbow.cocked;
    if (pose.crossbow.boltInLeftPaw) carried++;
    if (pose.crossbow.boltInLeftPaw && pose.crossbow.loaded) {
      fail('G14', `${state}[${frame}] shows the bolt both in his paw and in the track`);
    }
    const winding = pose.crossbow.cocked > 0 && pose.crossbow.cocked < 1;
    if (!winding) continue;
    cranking++;
    const skeleton = otterSkeleton(pose);
    const handle = crankHandleAt(pose, skeleton);
    const miss = pawMissAt(pose, 'L', handle);
    if (!(miss <= PAW_HOLD_TOLERANCE_TILES)) {
      fail(
        'G14',
        `${state}[${frame}]: the left paw is ${miss.toFixed(TILE_DECIMALS)} tiles off the crank handle`,
      );
    }
    const stirrup = stirrupAt(pose, skeleton);
    const footOff = length3({
      x: skeleton.ankleL.x - stirrup.x,
      y: skeleton.ankleL.y - stirrup.y,
      z: skeleton.ankleL.z - stirrup.z,
    });
    if (!(footOff <= FOOT_IN_STIRRUP_TOLERANCE_TILES)) {
      fail(
        'G14',
        `${state}[${frame}]: the left foot is ${footOff.toFixed(TILE_DECIMALS)} tiles from the stirrup it holds down`,
      );
    }
    const paw = skeleton.armL.paw;
    minX = Math.min(minX, paw.x);
    maxX = Math.max(maxX, paw.x);
    minY = Math.min(minY, paw.y);
    maxY = Math.max(maxY, paw.y);
    minZ = Math.min(minZ, paw.z);
    maxZ = Math.max(maxZ, paw.z);
    firstCrank = Math.min(firstCrank, pose.crossbow.crank);
    lastCrank = Math.max(lastCrank, pose.crossbow.crank);
  }
  failUnlessMeasured('G14', cranking, 'cranking frames');
  if (cranking > 0 && cranking < CRANK_MIN_FRAMES) {
    fail('G14', `the string winds over ${cranking} frames (need ${CRANK_MIN_FRAMES})`);
  }
  if (cranking > 0) {
    const travel = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    if (!(travel >= CRANK_PAW_MIN_TRAVEL_TILES)) {
      fail(
        'G14',
        `the cranking paw travels ${travel.toFixed(TILE_DECIMALS)} tiles (need ${CRANK_PAW_MIN_TRAVEL_TILES})`,
      );
    }
    const turns = (lastCrank - firstCrank) / (2 * Math.PI);
    if (!(turns >= CRANK_MIN_TURNS)) {
      fail(
        'G14',
        `the crank turns ${turns.toFixed(2)} times while the string winds (need ${CRANK_MIN_TURNS})`,
      );
    }
  }
  if (lastCocked < 1)
    fail('G14', `the reload ends with the string at ${lastCocked.toFixed(2)}, not on the latch`);
  if (carried === 0) fail('G14', 'no reload frame shows the bolt carried to the track');
}

// ── G15 the free paw steadies the stock ──────────────────────────────────────

/** On every aim frame and every shot frame the left paw is on the fore-stock. */
function gateSteadyingPaw(): void {
  let measured = 0;
  for (const [row, frames] of [
    ['aim', STEVE_AIM_FRAMES],
    ['shoot', STEVE_SHOOT_FRAMES],
  ] as const) {
    const state = steveStateName(row, 'side');
    for (let frame = 0; frame < frames; frame++) {
      const pose = stevePoseAt(state, frame);
      if (pose === null) {
        fail('G15', `${state}[${frame}] has no pose`);
        continue;
      }
      measured++;
      const miss = pawMissAt(pose, 'L', foreStockAt(pose, otterSkeleton(pose)));
      if (!(miss <= PAW_HOLD_TOLERANCE_TILES)) {
        fail(
          'G15',
          `${state}[${frame}]: the left paw is ${miss.toFixed(TILE_DECIMALS)} tiles off the fore-stock`,
        );
      }
    }
  }
  failUnlessMeasured('G15', measured, 'steadied frames');
}

// ── G16 the muzzle point is where the bolt is painted ────────────────────────

/**
 * The painted point runs past the muzzle point by the steel point's radius and
 * the silhouette outline round it — about three cell pixels — and never falls
 * short of it by more than a pixel of antialiasing.
 */
const MUZZLE_AHEAD_PX = 3.5;
const MUZZLE_BEHIND_PX = 1;
const MUZZLE_ACROSS_PX = 2;
/** The runtime's muzzle point and the cell's agree to well under a pixel. */
const MUZZLE_RUNTIME_TOLERANCE_PX = 0.01;
/** A pixel counts as the bolt where painting it changed the cell's alpha or colour by this much. */
const BOLT_DIFF_THRESHOLD = 40;
const RGB = 3;

function paintedCell(view: OtterView, pose: OtterPose): Uint8ClampedArray {
  const canvas = createCanvas(STEVE_FIGURE.frameWidth, STEVE_FIGURE.frameHeight);
  const ctx = canvas.getContext('2d');
  paintStevePose(asGameContext(ctx), view, pose);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * The loosed bolt starts at `steveMuzzlePoint`. On the frame before the
 * release the same crossbow is on the same line (G13) with the bolt in it, so
 * the cell is painted with the bolt and without it; the pixels that differ are
 * the bolt, and the one furthest along the line of fire is its point. The
 * muzzle point must sit on it in every view, and a west-facing profile's must
 * be the east-facing one's mirrored about his tile.
 */
function gateMuzzle(): void {
  let measured = 0;
  for (const view of STEVE_VIEWS) {
    const state = steveStateName('shoot', view);
    const pose = stevePoseAt(state, STEVE_SHOOT_RELEASE_FRAME - 1);
    if (pose === null) {
      fail('G16', `${state} has no frame before its release`);
      continue;
    }
    const withBolt = paintedCell(view, pose);
    const without = paintedCell(view, { ...pose, crossbow: { ...pose.crossbow, loaded: false } });
    const skeleton = otterSkeleton(pose);
    const grip = crossbowPointOnScreen(view, skeleton, skeleton.armR.paw);
    const tip = crossbowPointOnScreen(view, skeleton, boltTipAt(pose, skeleton));
    const dirLength = Math.hypot(tip.x - grip.x, tip.y - grip.y);
    const dir = { x: (tip.x - grip.x) / dirLength, y: (tip.y - grip.y) / dirLength };
    let best = -Infinity;
    let bestX = 0;
    let bestY = 0;
    let boltPixels = 0;
    for (let y = 0; y < STEVE_FIGURE.frameHeight; y++) {
      for (let x = 0; x < STEVE_FIGURE.frameWidth; x++) {
        const i = (y * STEVE_FIGURE.frameWidth + x) * CHANNELS;
        let change = Math.abs(withBolt[i + ALPHA] - without[i + ALPHA]);
        for (let c = 0; c < RGB; c++)
          change = Math.max(change, Math.abs(withBolt[i + c] - without[i + c]));
        if (change < BOLT_DIFF_THRESHOLD) continue;
        boltPixels++;
        const along = x * dir.x + y * dir.y;
        if (along > best) {
          best = along;
          bestX = x;
          bestY = y;
        }
      }
    }
    if (view === 'away') {
      // From behind, the levelled crossbow is in front of him and his head and
      // shoulders hide the bolt; it must stay hidden, or the frame shows a bolt
      // whose point this gate would have to measure as in the other views.
      measured++;
      if (boltPixels > 0) {
        fail(
          'G16',
          `${state}: the loaded bolt shows from behind; gate its point as in the other views`,
        );
      }
      continue;
    }
    if (boltPixels === 0) {
      fail(
        'G16',
        `${state}[${STEVE_SHOOT_RELEASE_FRAME - 1}]: the loaded bolt paints nothing in view`,
      );
      continue;
    }
    measured++;
    const muzzle = steveMuzzleInCell(view);
    const offX = bestX + HALF_PIXEL - muzzle.x;
    const offY = bestY + HALF_PIXEL - muzzle.y;
    const ahead = offX * dir.x + offY * dir.y;
    const across = Math.abs(offX * dir.y - offY * dir.x);
    if (ahead < -MUZZLE_BEHIND_PX || ahead > MUZZLE_AHEAD_PX || across > MUZZLE_ACROSS_PX) {
      fail(
        'G16',
        `${view}: the painted bolt's point (${bestX}, ${bestY}) is ${ahead.toFixed(1)} px ahead of and ` +
          `${across.toFixed(1)} px across the muzzle point (${muzzle.x.toFixed(1)}, ${muzzle.y.toFixed(1)}) ` +
          `(allowed -${MUZZLE_BEHIND_PX}..${MUZZLE_AHEAD_PX} ahead, ${MUZZLE_ACROSS_PX} across)`,
      );
    }
    const facing = FACING_OF_VIEW[view];
    const runtime = steveMuzzlePoint(facing.x, facing.y);
    const runtimeOff = Math.hypot(
      runtime.x * TILE_SCALE + OTTER_TILE_X - muzzle.x,
      runtime.y * TILE_SCALE + OTTER_TILE_Y - muzzle.y,
    );
    if (runtimeOff > MUZZLE_RUNTIME_TOLERANCE_PX) {
      fail('G16', `${view}: steveMuzzlePoint is ${runtimeOff.toFixed(1)} px off the cell's muzzle`);
    }
  }
  const east = steveMuzzlePoint(1, 0);
  const west = steveMuzzlePoint(-1, 0);
  measured++;
  if (
    Math.abs(west.x - (1 - east.x)) > MIRROR_TOLERANCE_TILES ||
    Math.abs(west.y - east.y) > MIRROR_TOLERANCE_TILES
  ) {
    fail(
      'G16',
      `the west-facing muzzle (${west.x.toFixed(TILE_DECIMALS)}, ${west.y.toFixed(TILE_DECIMALS)}) is not the east one mirrored about his tile`,
    );
  }
  failUnlessMeasured('G16', measured, 'muzzle views');
}

// ── G17 the crossbow never goes through the floor ───────────────────────────

/** A stirrup stood on the floor may sit this far into it: its own stroke's half-width. */
const FLOOR_TOLERANCE_TILES = 0.01;

/**
 * The crossbow is over half his height, so a carry or a lowered pose can put
 * its stirrup through the floor. On every frame of every row the stirrup and
 * the point of a loaded bolt stay above the floor.
 */
function gateFloorClearance(): void {
  let measured = 0;
  for (const row of STEVE_ROW_NAMES) {
    const spec = STEVE_ROWS[row];
    const state = steveStateName(row, 'side');
    for (let frame = 0; frame < spec.frameCount; frame++) {
      const pose = stevePoseAt(state, frame);
      if (pose === null) {
        fail('G17', `${state}[${frame}] has no pose`);
        continue;
      }
      measured++;
      const skeleton = otterSkeleton(pose);
      const boltLowest = pose.crossbow.loaded ? boltTipAt(pose, skeleton).y : -Infinity;
      const lowest = Math.max(stirrupAt(pose, skeleton).y, boltLowest);
      if (!(lowest <= FLOOR_TOLERANCE_TILES)) {
        fail(
          'G17',
          `${state}[${frame}]: the crossbow reaches ${lowest.toFixed(TILE_DECIMALS)} tiles into the floor`,
        );
      }
    }
  }
  failUnlessMeasured('G17', measured, 'crossbow frames');
}

const HALF_PIXEL = 0.5;
/** A facing that selects each view, east for the profile so it is drawn unmirrored. */
const FACING_OF_VIEW: Readonly<Record<OtterView, { readonly x: number; readonly y: number }>> = {
  front: { x: 0, y: 1 },
  side: { x: 1, y: 0 },
  away: { x: 0, y: -1 },
};
const MIRROR_TOLERANCE_TILES = 1e-9;

/** Runs every gate and returns one message per failure. */
export function steveGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateReachableStates();
  gateRowLengths();
  gateReleaseFrames();
  gateGroundLine();
  gateFacing();
  gateLegReach();
  gateLoopSeams();
  gateNotARat();
  gateWarmRowSize();
  gateBoltAnchors();
  gateSharedLine();
  gateReloadCranks();
  gateSteadyingPaw();
  gateMuzzle();
  gateFloorClearance();
  return [...failures];
}

if (process.argv[1]?.endsWith('gates-steve.ts')) {
  console.log('Gating Steve Cartwright…');
  reportFigureGates('steve', steveGateFailures());
}
