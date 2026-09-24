/**
 * Art gates for the Grotesque Spider, her spit, her eggs, and the lab's life
 * machines.
 *
 * These are the things neither the painter nor the cache can check for
 * themselves: that she is centred on the tile she is rotated about, that each
 * attack's strike frame shows the strike (forelegs on the floor, the maw at its
 * widest, the glob on the mouth's edge), that her gait keeps its feet planted,
 * that every row name the runtime builds is one a figure paints, that the egg
 * reads as a countdown, and that a warm row still fits the cache.
 *
 * Many gates measure the rig's own solve (`grotesqueSpiderRig.ts`) rather than
 * pixels, because that solve is what the painter draws: a claim about where a
 * foot is, checked against the solve and then looked for as ink at that point,
 * cannot be passed by a louder neighbour painted nearby.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row it names fails
 * loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harnesses: `npm run render:spider`, `npm run render:life-machine`.
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';

// A painter that composes on scratch surfaces of its own reaches for
// `document.createElement('canvas')`, which a Node process does not have.
installCanvasGlobals();

import { TRAP_HIT_RADIUS_FRACTION } from '../src/creatures/GrotesqueSpider.js';
import {
  attackStageAt,
  LAY_EGG_FRAMES,
  MAX_EGG_CLUTCH_SIZE,
  recoveryStartFrame,
  SLAM_CONE_HALF_ANGLE_RAD,
  SLAM_CONE_RADIUS_TILES,
  SPIDER_ATTACK_TIMELINES,
  strikeFrame,
  totalFrames,
  type SpiderAttack,
  type SpiderAttackStage,
  type SpiderAttackTimeline,
} from '../src/creatures/grotesqueSpiderTimeline.js';
import { LIFE_MACHINE_STATES } from '../src/systems/SpiderQuestSystem.js';
import { figureFrameCount, figureStates, type FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  drawGrotesqueSpider,
  SPIDER_BODY_CENTRE_RATIO,
  SPIDER_BODY_SHADOW,
  spiderSacWindow,
} from '../src/sprites/art/grotesqueSpiderArt.js';
import {
  ABDOMEN_HALF_LENGTH,
  abdomenTailDistance,
  alongAbdomen,
  CEPH_HALF_LENGTH,
  cephDrawScale,
  cephToFigure,
  FANG_TIP_Y,
  distance3,
  FRONT_LEG_INDICES,
  getSpiderLegTip,
  MAW_CENTRE_Y,
  MAW_MAX_RADIUS,
  project,
  solveSpiderPose,
  SPIDER_LEGS,
  spiderGlobAtMouth,
  spiderMawOpen,
  STUMP_LEG_INDEX,
  WALK_STRIDE_TILES,
  type LayingEgg,
  type P2,
  type GrotesqueSpiderAttackRow,
  type GrotesqueSpiderPose,
} from '../src/sprites/art/grotesqueSpiderRig.js';
import {
  buildAttackSamples,
  GROTESQUE_SPIDER_ATTACK_SAMPLES,
  GROTESQUE_SPIDER_ATTACK_SAMPLING,
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_DEATH_FIGURE,
  GROTESQUE_SPIDER_FIGURE_FOR_ROW,
  GROTESQUE_SPIDER_FIGURES,
  GROTESQUE_SPIDER_ROW_FRAMES,
  GROTESQUE_SPIDER_IDLE_REACH_TILES,
  GROTESQUE_SPIDER_ROW_POSES,
  grotesqueSpiderStrikeFrame,
  type StageSample,
} from '../src/sprites/art/grotesqueSpiderFigure.js';
import {
  GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES,
  GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE,
  GROTESQUE_SPIDER_SPIT_TRAP_FIGURE,
  SPIT_TRAP_EVAPORATE_FRAMES,
} from '../src/sprites/art/grotesqueSpiderSpitFigure.js';
import {
  EGG_FIRST_CRACK_AT,
  EGG_FRENZY_AT,
  EGG_SECOND_CRACK_AT,
  INCUBATE_PULSE_PHASES,
  incubatingLook,
  SPIDER_EGG_FRAMES,
  SPIDER_EGG_RADIUS_TILES,
  SPIDER_EGG_SHELL_COLOURS,
} from '../src/sprites/art/spiderEggArt.js';
import { SPIDER_EGG_FIGURE } from '../src/sprites/art/spiderEggFigure.js';
import { LED_COUNT, LED_FIRST_X, LED_SPACING, LED_Y } from '../src/sprites/art/lifeMachineArt.js';
import {
  LIFE_MACHINE_FIGURE,
  LIFE_MACHINE_LAMP_STATES,
  LIFE_MACHINE_ROWS,
  lifeMachineStateName,
} from '../src/sprites/art/lifeMachineFigure.js';
import { lifeMachineSacSplitFrame } from '../src/sprites/lifeMachineTiming.js';
import {
  GROTESQUE_SPIDER_ATTACK_ROWS,
  GROTESQUE_SPIDER_RUNTIME_ROWS,
  grotesqueSpiderFacingRotation,
  grotesqueSpiderRowFrameAt,
} from '../src/sprites/grotesqueSpiderSprite.js';
import { SPIT_EFFECT_RUNTIME_ROWS } from '../src/sprites/grotesqueSpiderSpitSprite.js';
import { SPIDER_EGG_RUNTIME_ROWS } from '../src/sprites/spiderEggSprite.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { paintFigureCell } from './figureSheet.js';

const CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const FULL_ALPHA = 255;
const PERCENT = 100;
/** Decimal places a drift in tiles is reported to. */
const DRIFT_DECIMALS = 3;

const failures: string[] = [];

function fail(gate: string, message: string): void {
  failures.push(`${gate}: ${message}`);
}

/**
 * A gate whose filtered loop matched nothing passed without looking at
 * anything, which is indistinguishable from a pass and arrives by accident.
 */
function failUnlessMeasured(gate: string, measured: number, what: string): void {
  for (const message of nothingMeasuredFailures(measured, what)) fail(gate, message);
}

interface Cell {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const cellCache = new Map<string, Cell>();

function cellOf(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}|${state}|${frame}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const canvas = paintFigureCell(def, state, frame);
  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const cell: Cell = { width: canvas.width, height: canvas.height, data: image.data };
  cellCache.set(key, cell);
  return cell;
}

function alphaAt(cell: Cell, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= cell.width || y >= cell.height) return 0;
  return cell.data[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET];
}

/**
 * The alpha a pixel has to carry to count as the creature's own body rather
 * than as something soft it casts. She paints contact shadows under her body
 * and every leg, so anything measured against ordinary ink measures those.
 */
const SOLID_ALPHA = 200;

interface Extent {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The bounding box of pixels at or above an alpha, or null when there are none. */
function extentOf(cell: Cell, minAlpha: number): Extent | null {
  let minX = cell.width;
  let minY = cell.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (cell.data[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET] < minAlpha) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

function eachFrame(def: FigureDef, visit: (state: string, frame: number) => void): number {
  let visited = 0;
  for (const [state, declared] of def.states) {
    for (let frame = 0; frame < declared.frames; frame++) {
      visit(state, frame);
      visited++;
    }
  }
  return visited;
}

/** A pixel predicate over (r, g, b, a). */
type PixelTest = (r: number, g: number, b: number, a: number) => boolean;

/** How many pixels of a cell pass a test, optionally only within a radius of a point. */
function countPixels(
  cell: Cell,
  test: PixelTest,
  within?: { readonly x: number; readonly y: number; readonly radius: number },
): number {
  let count = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (within !== undefined && Math.hypot(x - within.x, y - within.y) > within.radius) continue;
      const i = (y * cell.width + x) * CHANNELS;
      const d = cell.data;
      if (test(d[i + RED_OFFSET], d[i + GREEN_OFFSET], d[i + BLUE_OFFSET], d[i + ALPHA_OFFSET])) {
        count++;
      }
    }
  }
  return count;
}

/** The pivot she is rotated about, in cell pixels; every spider figure shares it. */
const PIVOT_X =
  GROTESQUE_SPIDER_BASE_FIGURE.tileX +
  GROTESQUE_SPIDER_BASE_FIGURE.tileScale * SPIDER_BODY_CENTRE_RATIO;
const PIVOT_Y =
  GROTESQUE_SPIDER_BASE_FIGURE.tileY +
  GROTESQUE_SPIDER_BASE_FIGURE.tileScale * SPIDER_BODY_CENTRE_RATIO;
const TILE_PX = GROTESQUE_SPIDER_BASE_FIGURE.tileScale;

/** A figure-frame point, in tiles, as a cell pixel. */
function toCell(x: number, y: number): { x: number; y: number } {
  return { x: PIVOT_X + x * TILE_PX, y: PIVOT_Y + y * TILE_PX };
}

/** The shipped pose of one frame of one row, or null when the row has no pose table. */
function shippedPose(state: string, frame: number): GrotesqueSpiderPose | null {
  const poseFor = GROTESQUE_SPIDER_ROW_POSES.get(state);
  return poseFor === undefined ? null : poseFor(frame);
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * The glob's slime trail is authored to run off the back of its cell: the cell
 * is as long as a rotated blit of the glob needs to be, not as long as the
 * trail. The other three sides stay checked — a glob clipped at its leading
 * edge is a glob with a flat face.
 */
const PROJECTILE_BLEED_EDGES = ['left'] as const;

/**
 * The machine's frame is exactly two tiles by three: its plinth sits on the
 * frame's bottom edge because that edge is the floor it stands on, and its
 * power cables run off the left edge into the wall behind it.
 */
const LIFE_MACHINE_BLEED_EDGES = ['left', 'bottom'] as const;

/**
 * Her cell is square and wide enough to hold her splayed at any rotation, so
 * no single frame fills much of it. The margin is bought by the slam's raised
 * forelegs and the screech's splay, and G3 is what says it stays affordable.
 */
const SPIDER_MIN_INK_AREA_SHARE = 0.3;

function gateStructure(): void {
  const checked: string[] = [];
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    for (const message of figureStructuralFailures(def, {
      minInkAreaShare: SPIDER_MIN_INK_AREA_SHARE,
    })) {
      fail('G1', message);
    }
    checked.push(def.id);
  }
  for (const message of figureStructuralFailures(GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE, {
    bleedEdges: PROJECTILE_BLEED_EDGES,
  })) {
    fail('G1', message);
  }
  checked.push(GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE.id);
  for (const message of figureStructuralFailures(GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, {
    // A splat's first frames are a bead of slime in the middle of a cell sized
    // for the puddle it becomes, and a drying puddle shrinks to nothing.
    sparseStates: ['splat', 'evaporate'],
    blankFrames: new Map([['evaporate', new Set([SPIT_TRAP_EVAPORATE_FRAMES - 1])]]),
  })) {
    fail('G1', message);
  }
  checked.push(GROTESQUE_SPIDER_SPIT_TRAP_FIGURE.id);
  for (const message of figureStructuralFailures(SPIDER_EGG_FIGURE, {
    // The egg sits in the middle of a cell sized for its hatch spray.
    sparseStates: ['land', 'incubate'],
  })) {
    fail('G1', message);
  }
  checked.push(SPIDER_EGG_FIGURE.id);
  failUnlessMeasured('G1', checked.length, 'figures');
}

function gateLifeMachineStructure(): void {
  for (const message of figureStructuralFailures(LIFE_MACHINE_FIGURE, {
    bleedEdges: LIFE_MACHINE_BLEED_EDGES,
    // The lamp rows are three lit LEDs and their glow over an otherwise empty
    // frame; they are composited onto a body row, not shown on their own.
    sparseStates: LIFE_MACHINE_LAMP_STATES,
  })) {
    fail('L1', message);
  }
}

// ── G2 runtime state names ───────────────────────────────────────────────────

function gateRuntimeStateNames(): void {
  let checked = 0;
  for (const row of GROTESQUE_SPIDER_RUNTIME_ROWS) {
    for (const message of missingStateFailures(row.def, [row.state], 'the spider sprite module')) {
      fail('G2', message);
    }
    checked++;
  }
  const spitFigures = new Map(
    GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES.map((def) => [def.id, def] as const),
  );
  for (const row of SPIT_EFFECT_RUNTIME_ROWS) {
    const def = spitFigures.get(row.figureId);
    if (def === undefined) {
      fail('G2', `the spit sprite module draws figure "${row.figureId}", which does not exist`);
      continue;
    }
    for (const message of missingStateFailures(def, [row.state], 'the spit sprite module')) {
      fail('G2', message);
    }
    checked++;
  }
  for (const message of missingStateFailures(
    SPIDER_EGG_FIGURE,
    SPIDER_EGG_RUNTIME_ROWS,
    'the egg sprite module',
  )) {
    fail('G2', message);
  }
  checked += SPIDER_EGG_RUNTIME_ROWS.length;
  // Every row the runtime can land on must also have a pose table, or the
  // figure's painter returns without drawing.
  for (const row of GROTESQUE_SPIDER_RUNTIME_ROWS) {
    if (GROTESQUE_SPIDER_ROW_POSES.has(row.state)) continue;
    fail('G2', `the runtime draws "${row.state}", which has no pose table`);
  }
  failUnlessMeasured('G2', checked, 'rows the runtime can ask for');
}

function gateLifeMachineStateNames(): void {
  const asked = Object.values(LIFE_MACHINE_STATES).map((state) => state.spriteState);
  for (const message of missingStateFailures(LIFE_MACHINE_FIGURE, asked, 'SpiderQuestSystem')) {
    fail('L2', message);
  }
  for (const message of missingStateFailures(
    LIFE_MACHINE_FIGURE,
    LIFE_MACHINE_LAMP_STATES,
    'the lamp overlay',
  )) {
    fail('L2', message);
  }
}

// ── G3 warm-row budget ───────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

/** What a warm row costs the cache: one cell per frame, at the declared size. */
function rowBytes(def: FigureDef, frames: number): number {
  return def.frameWidth * def.frameHeight * BYTES_PER_PIXEL * frames;
}

/**
 * Checks the widest row of every figure against the cache's per-figure ceiling.
 *
 * The row is the unit, not the sheet: a painted figure is admitted one state at
 * a time and rows it stops playing are released, so what has to fit is the
 * widest state, measured over every state the def declares.
 */
function gateWarmRowSize(): void {
  let measured = 0;
  for (const def of [
    ...GROTESQUE_SPIDER_FIGURES,
    ...GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES,
    SPIDER_EGG_FIGURE,
    LIFE_MACHINE_FIGURE,
  ]) {
    let widest = 0;
    let widestState = '';
    for (const [state, declared] of def.states) {
      const bytes = rowBytes(def, declared.frames);
      measured++;
      if (bytes <= widest) continue;
      widest = bytes;
      widestState = state;
    }
    const figureBudget = figureByteBudgetFor(def);
    if (widest <= figureBudget) continue;
    fail(
      'G3',
      `${def.id}'s widest row ${widestState} is ` +
        `${(widest / BYTES_PER_MEGABYTE).toFixed(1)} MB, over the ` +
        `${(figureBudget / BYTES_PER_MEGABYTE).toFixed(0)} MB one figure may hold, so it ` +
        'can never be admitted and every frame of it repaints',
    );
  }
  failUnlessMeasured('G3', measured, 'rows');
}

/**
 * Locomotion plus the largest attack row is what she keeps warm at once, and
 * all of it has to fit one figure's share: the base figure and each attack are
 * separate figures, so this checks each pairing's total against the smaller of
 * the two budgets rather than trusting the split to have done it.
 */
function gateWarmWorkingSet(): void {
  const base = GROTESQUE_SPIDER_BASE_FIGURE;
  let baseBytes = 0;
  for (const [, declared] of base.states) baseBytes += rowBytes(base, declared.frames);
  let measured = 0;
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    if (def === base) continue;
    let attackBytes = 0;
    for (const [, declared] of def.states) attackBytes += rowBytes(def, declared.frames);
    measured++;
    const total = baseBytes + attackBytes;
    const budget = Math.min(figureByteBudgetFor(base), figureByteBudgetFor(def));
    if (total <= budget) continue;
    fail(
      'G3',
      `locomotion plus ${def.id} is ${(total / BYTES_PER_MEGABYTE).toFixed(1)} MB warm at once, ` +
        `over one figure's ${(budget / BYTES_PER_MEGABYTE).toFixed(0)} MB`,
    );
  }
  failUnlessMeasured('G3', measured, 'attack figures paired with locomotion');
}

// ── G4 anchor ────────────────────────────────────────────────────────────────

/**
 * How far her solid mass may sit from the pivot she is rotated about.
 *
 * She is drawn rotated about the centre of her tile, so any offset between her
 * mass and that point swings her body across the floor every time she turns.
 * Locomotion is held tight because it is what turns most; attacks may lean
 * further (the slam lunges, the lay tips her tail) since she is locked in place
 * through them. A centroid is a mass aggregate and says nothing about a single
 * limb — G12 and G13 are what see a missing leg.
 */
const ANCHOR_LOCOMOTION_MAX_PX = 10;
const ANCHOR_ATTACK_MAX_PX = 24;
/**
 * Dead, she never turns again, and what she spills lies behind her: the held
 * frame's mass is pulled back by the spilled eggs and ichor on the floor.
 */
const ANCHOR_DEATH_MAX_PX = 48;

/** The centre of mass of a frame's solid ink, or null when it painted none. */
function solidCentroid(cell: Cell): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (cell.data[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      sumX += x;
      sumY += y;
      count++;
    }
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

function gateAnchoredToItsPivot(): void {
  let measured = 0;
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    const limit =
      def === GROTESQUE_SPIDER_BASE_FIGURE
        ? ANCHOR_LOCOMOTION_MAX_PX
        : def === GROTESQUE_SPIDER_DEATH_FIGURE
          ? ANCHOR_DEATH_MAX_PX
          : ANCHOR_ATTACK_MAX_PX;
    eachFrame(def, (state, frame) => {
      const centroid = solidCentroid(cellOf(def, state, frame));
      if (centroid === null) {
        fail('G4', `${def.id}.${state}[${frame}] has no solid ink to measure`);
        return;
      }
      measured++;
      const offset = Math.hypot(centroid.x - PIVOT_X, centroid.y - PIVOT_Y);
      if (offset <= limit) return;
      fail(
        'G4',
        `${def.id}.${state}[${frame}] carries its mass ${offset.toFixed(1)} px from the pivot ` +
          `(${(centroid.x - PIVOT_X).toFixed(1)}, ${(centroid.y - PIVOT_Y).toFixed(1)}), past the ` +
          `${limit} px it may sit off it before turning swings her across the floor`,
      );
    });
  }
  failUnlessMeasured('G4', measured, 'frames with solid ink');
}

/**
 * The rotation the runtime is given turns her painted +Y to the facing it was
 * asked for, in every direction. Rotating by the facing angle itself (or a
 * quarter turn the wrong way) draws her walking backwards or sideways.
 */
const FACING_SAMPLES = 8;
const FACING_TOLERANCE = 1e-6;

function gateFacingRotation(): void {
  let measured = 0;
  for (let i = 0; i < FACING_SAMPLES; i++) {
    const angle = (i / FACING_SAMPLES) * Math.PI * 2;
    const facingX = Math.cos(angle);
    const facingY = Math.sin(angle);
    const theta = grotesqueSpiderFacingRotation(facingX, facingY);
    // Where the art's +Y axis lands after rotating by theta.
    const drawnX = -Math.sin(theta);
    const drawnY = Math.cos(theta);
    measured++;
    if (Math.hypot(drawnX - facingX, drawnY - facingY) <= FACING_TOLERANCE) continue;
    fail(
      'G4',
      `facing (${facingX.toFixed(2)}, ${facingY.toFixed(2)}) is drawn facing ` +
        `(${drawnX.toFixed(2)}, ${drawnY.toFixed(2)})`,
    );
  }
  failUnlessMeasured('G4', measured, 'facings');
}

// ── G5 clearance ─────────────────────────────────────────────────────────────

/**
 * Empty cell every pose has to leave on every side. She is rotated to all
 * facings, so a leg clipped at any edge of the cell ends abruptly in the game,
 * whichever way she is turned.
 */
const MIN_EDGE_CLEARANCE_PX = 6;
/** A cell's half-width, as a share of its side. */
const HALF_CELL = 0.5;
/** From a pixel's corner to its centre. */
const PIXEL_CENTRE = 0.5;

function gateEdgeClearance(): void {
  let measured = 0;
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    eachFrame(def, (state, frame) => {
      const cell = cellOf(def, state, frame);
      const extent = extentOf(cell, 1);
      if (extent === null) {
        fail('G5', `${def.id}.${state}[${frame}] painted nothing`);
        return;
      }
      measured++;
      const clearance = Math.min(
        extent.minX,
        extent.minY,
        cell.width - 1 - extent.maxX,
        cell.height - 1 - extent.maxY,
      );
      if (clearance >= MIN_EDGE_CLEARANCE_PX) return;
      fail(
        'G5',
        `${def.id}.${state}[${frame}] leaves ${clearance} px between its ink and the cell edge, ` +
          `under the ${MIN_EDGE_CLEARANCE_PX} px a reaching leg needs`,
      );
    });
  }
  failUnlessMeasured('G5', measured, 'frames');
}

// ── G6 the slam lands on its contact frame ───────────────────────────────────

/** A tip this close to the floor is on it. */
const GROUND_EPSILON = 0.01;
/** How high the raised forelegs must get before they come down. */
const SLAM_MIN_RAISE_TILES = 1;

/** The shipped pose of an attack row's frame. */
function attackPose(row: GrotesqueSpiderAttackRow, frame: number): GrotesqueSpiderPose | null {
  return shippedPose(row, frame);
}

/**
 * On the slam's contact frame both forelegs are on the floor, in front of her
 * and inside the cone the hit test uses; on the frame before, they are not; and
 * across the run-up they rise high enough to read as raised. Contact is also
 * looked for as solid ink at each projected tip, so a solve that says "down"
 * over a painter that drew them somewhere else still fails.
 */
function gateSlamContact(): void {
  const row: GrotesqueSpiderAttackRow = 'attack_slam';
  const contact = grotesqueSpiderStrikeFrame(row);
  if (contact <= 0) {
    fail('G6', 'the slam row has no strike frame after its run-up');
    return;
  }
  const contactPose = attackPose(row, contact);
  const beforePose = attackPose(row, contact - 1);
  if (contactPose === null || beforePose === null) {
    fail('G6', 'the slam row has no pose table');
    return;
  }
  const cell = cellOf(GROTESQUE_SPIDER_FIGURE_FOR_ROW[row], row, contact);
  let measured = 0;
  for (const index of FRONT_LEG_INDICES) {
    measured++;
    const tip = getSpiderLegTip(contactPose, index);
    if (tip.height > GROUND_EPSILON) {
      fail('G6', `foreleg ${index} is ${tip.height.toFixed(2)} tiles up on the contact frame`);
    }
    const reach = Math.hypot(tip.x, tip.y);
    const offAxis = Math.atan2(Math.abs(tip.x), tip.y);
    if (reach > SLAM_CONE_RADIUS_TILES || offAxis > SLAM_CONE_HALF_ANGLE_RAD) {
      fail(
        'G6',
        `foreleg ${index} lands at (${tip.x.toFixed(2)}, ${tip.y.toFixed(2)}) tiles, outside the ` +
          'cone the slam hits',
      );
    }
    const at = toCell(tip.x, tip.y);
    if (nearestSolidWithin(cell, at.x, at.y, LEG_TIP_SEARCH_PX) === null) {
      fail('G6', `no solid ink where foreleg ${index} lands on the contact frame`);
    }
    const before = getSpiderLegTip(beforePose, index);
    if (before.height <= GROUND_EPSILON) {
      fail('G6', `foreleg ${index} is already down the frame before contact`);
    }
  }
  let highest = 0;
  for (let frame = 0; frame < contact; frame++) {
    const pose = attackPose(row, frame);
    if (pose === null) continue;
    for (const index of FRONT_LEG_INDICES) {
      highest = Math.max(highest, getSpiderLegTip(pose, index).height);
    }
  }
  if (highest < SLAM_MIN_RAISE_TILES) {
    fail(
      'G6',
      `the forelegs rise only ${highest.toFixed(2)} tiles before the slam, under the ` +
        `${SLAM_MIN_RAISE_TILES} that reads as a raised hammer`,
    );
  }
  failUnlessMeasured('G6', measured, 'forelegs');
}

// ── G7 the screech bursts on its burst frame ─────────────────────────────────

/** How open the maw must be at the burst: all the way. */
const SCREECH_BURST_MAW = 0.99;
/** Glowing throat: hot, red-dominant pixels. */
const THROAT_MIN_RED = 200;
const THROAT_RED_OVER_BLUE = 120;
const THROAT_MIN_PIXELS = 120;

const isThroatGlow: PixelTest = (r, _g, b, a) =>
  a >= SOLID_ALPHA && r >= THROAT_MIN_RED && r - b >= THROAT_RED_OVER_BLUE;

/**
 * Glowing-throat pixels inside the disc the maw opens across on one frame.
 * Counted there and not over the whole cell: a whole-cell count also measures
 * every other warm, lit mark on her, not the mouth.
 */
function throatGlowInMaw(def: FigureDef, row: GrotesqueSpiderAttackRow, frame: number): number {
  const pose = attackPose(row, frame);
  if (pose === null) return 0;
  const solve = solveSpiderPose(pose);
  const centre = cephToFigure(solve, 0, MAW_CENTRE_Y);
  const at = toCell(centre.x, centre.y);
  return countPixels(cellOf(def, row, frame), isThroatGlow, {
    x: at.x,
    y: at.y,
    radius: MAW_MAX_RADIUS * cephDrawScale(solve) * TILE_PX,
  });
}

/**
 * The maw is at its widest on the burst frame — wider than any frame before it
 * and at least as wide as every frame after — and it is sealed when the tell
 * begins, so the opening itself is the warning. The glowing throat is counted
 * in pixels too: a maw that the solve opens and the painter never shows is a
 * screech with no silhouette.
 */
function gateScreechBurst(): void {
  const row: GrotesqueSpiderAttackRow = 'attack_screech';
  const burst = grotesqueSpiderStrikeFrame(row);
  const frames = GROTESQUE_SPIDER_ROW_FRAMES[row];
  if (burst <= 0) {
    fail('G7', 'the screech row has no burst frame after its run-up');
    return;
  }
  const opens: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const pose = attackPose(row, frame);
    if (pose === null) {
      fail('G7', 'the screech row has no pose table');
      return;
    }
    opens.push(spiderMawOpen(pose));
  }
  failUnlessMeasured('G7', opens.length, 'screech frames');
  const atBurst = opens[burst];
  if (atBurst < SCREECH_BURST_MAW) {
    fail('G7', `the maw is only ${atBurst.toFixed(2)} open on the burst frame`);
  }
  opens.forEach((open, frame) => {
    if (frame < burst && open >= atBurst) {
      fail('G7', `the maw is already as wide on frame ${frame} as on the burst frame ${burst}`);
    }
    if (frame > burst && open > atBurst) {
      fail('G7', `the maw opens wider on frame ${frame} than on the burst`);
    }
  });
  if (opens[0] > 0) fail('G7', `the maw is ${opens[0].toFixed(2)} open before the tell begins`);
  const def = GROTESQUE_SPIDER_FIGURE_FOR_ROW[row];
  const glowAtBurst = throatGlowInMaw(def, row, burst);
  const glowAtStart = throatGlowInMaw(def, row, 0);
  if (glowAtBurst < THROAT_MIN_PIXELS) {
    fail(
      'G7',
      `the burst frame shows ${glowAtBurst} px of glowing throat, under the ` +
        `${THROAT_MIN_PIXELS} that makes the open maw her screech silhouette`,
    );
  }
  if (glowAtStart > 0)
    fail('G7', `the first screech frame already shows ${glowAtStart} px of throat`);
}

// ── G8 the spit leaves from the mouth's edge ─────────────────────────────────

/** Pixels of olive slime that count as a glob rather than as a stray edge. */
const GLOB_MIN_PIXELS = 150;
const GLOB_GREEN_OVER_RED = 15;
const GLOB_GREEN_OVER_BLUE = 40;
const GLOB_MIN_GREEN = 50;
const GLOB_MIN_ALPHA = 128;
/** How far off the mouth's edge the glob's centre may sit on the release frame, in glob radii. */
const GLOB_EDGE_TOLERANCE = 0.25;

const isSlime: PixelTest = (r, g, b, a) =>
  a >= GLOB_MIN_ALPHA &&
  g >= GLOB_MIN_GREEN &&
  g - r >= GLOB_GREEN_OVER_RED &&
  g - b >= GLOB_GREEN_OVER_BLUE;

/**
 * The glob is absent when the tell opens, gathered and unmistakable through the
 * lock, sitting on the mouth's edge on the release frame — the frame the
 * projectile takes over from — and gone once she recoils.
 */
function gateSpitRelease(): void {
  const row: GrotesqueSpiderAttackRow = 'attack_spit';
  const release = grotesqueSpiderStrikeFrame(row);
  const frames = GROTESQUE_SPIDER_ROW_FRAMES[row];
  const def = GROTESQUE_SPIDER_FIGURE_FOR_ROW[row];
  if (release <= 0) {
    fail('G8', 'the spit row has no release frame after its run-up');
    return;
  }
  let measured = 0;
  for (let frame = 0; frame < frames; frame++) {
    const pose = attackPose(row, frame);
    if (pose?.row !== row) {
      fail('G8', 'the spit row has no pose table');
      return;
    }
    const slime = countPixels(cellOf(def, row, frame), isSlime);
    measured++;
    if (frame === 0 && slime > 0)
      fail('G8', `the first spit frame already holds ${slime} px of slime`);
    if (pose.stage === 'lock' && slime < GLOB_MIN_PIXELS) {
      fail('G8', `lock frame ${frame} holds ${slime} px of slime, under ${GLOB_MIN_PIXELS}`);
    }
    if (pose.stage === 'recovery' && slime > 0) {
      fail('G8', `recovery frame ${frame} still holds ${slime} px of slime after the release`);
    }
  }
  failUnlessMeasured('G8', measured, 'spit frames');
  const releasePose = attackPose(row, release);
  const glob = releasePose === null ? null : spiderGlobAtMouth(releasePose);
  if (glob === null) {
    fail('G8', 'there is no glob on the release frame');
    return;
  }
  const off = Math.hypot(glob.glob.x - glob.mouthEdge.x, glob.glob.y - glob.mouthEdge.y);
  if (off > glob.radius * GLOB_EDGE_TOLERANCE) {
    fail(
      'G8',
      `the glob sits ${(off / glob.radius).toFixed(2)} radii off the mouth's edge on the ` +
        'release frame, so the projectile jumps when it takes over',
    );
  }
  const at = toCell(glob.glob.x, glob.glob.y);
  const around = countPixels(cellOf(def, row, release), isSlime, {
    x: at.x,
    y: at.y,
    radius: glob.radius * TILE_PX,
  });
  if (around < GLOB_MIN_PIXELS) {
    fail('G8', `only ${around} px of slime are painted where the release frame's glob is`);
  }
}

// ── G9 the projectile trails behind itself ───────────────────────────────────

/** How much more slime hangs behind the glob than ahead of it. */
const TRAIL_INK_RATIO = 1.2;

function gateProjectileTrailsBehind(): void {
  const def = GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE;
  const frames = figureFrameCount(def, 'fly');
  let measured = 0;
  for (let frame = 0; frame < frames; frame++) {
    const cell = cellOf(def, 'fly', frame);
    let behind = 0;
    let ahead = 0;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (alphaAt(cell, x, y) === 0) continue;
        if (x < def.tileX) behind++;
        else ahead++;
      }
    }
    if (ahead === 0) {
      fail('G9', `fly[${frame}] paints nothing ahead of its anchor`);
      continue;
    }
    measured++;
    const ratio = behind / ahead;
    if (ratio >= TRAIL_INK_RATIO) continue;
    fail(
      'G9',
      `fly[${frame}] hangs ${ratio.toFixed(2)}× as much slime behind the glob as ahead of it, ` +
        `under ${TRAIL_INK_RATIO}× — a rotated glob with no trail reads as travelling backwards`,
    );
  }
  failUnlessMeasured('G9', measured, 'projectile frames');
}

// ── G10 the puddle covers what it catches ────────────────────────────────────

/**
 * How opaque the puddle has to be out at the radius the trap grabs players
 * inside.
 *
 * The radius is imported from the creature that owns it rather than restated,
 * so a designer widening the grab is what makes this gate fail — not only an
 * artist shrinking the art.
 */
const PUDDLE_EDGE_ALPHA = 96;
const PUDDLE_SAMPLE_COUNT = 72;

function gatePuddleCoversItsGrab(): void {
  const def = GROTESQUE_SPIDER_SPIT_TRAP_FIGURE;
  const grabRadiusPx = TRAP_HIT_RADIUS_FRACTION * def.tileScale;
  const frames = figureFrameCount(def, 'idle');
  let measured = 0;
  for (let frame = 0; frame < frames; frame++) {
    const cell = cellOf(def, 'idle', frame);
    let thinnest = 255;
    for (let sample = 0; sample < PUDDLE_SAMPLE_COUNT; sample++) {
      const angle = (sample / PUDDLE_SAMPLE_COUNT) * Math.PI * 2;
      const x = Math.round(def.tileX + Math.cos(angle) * grabRadiusPx);
      const y = Math.round(def.tileY + Math.sin(angle) * grabRadiusPx);
      thinnest = Math.min(thinnest, alphaAt(cell, x, y));
    }
    measured++;
    if (thinnest >= PUDDLE_EDGE_ALPHA) continue;
    fail(
      'G10',
      `the puddle thins to alpha ${thinnest} at the ${grabRadiusPx.toFixed(0)} px it still ` +
        `grabs players at (idle[${frame}]), under the ${PUDDLE_EDGE_ALPHA} a player has to see ` +
        'to know they are standing in it',
    );
  }
  failUnlessMeasured('G10', measured, 'puddle frames');
}

// ── G10b a pushed-out puddle dries up ────────────────────────────────────────

/**
 * The drying row thins every frame and ends with nothing left: a puddle that
 * stays visible after it has stopped catching players is a lie about where it
 * is safe to stand.
 */
function gatePuddleEvaporates(): void {
  const def = GROTESQUE_SPIDER_SPIT_TRAP_FIGURE;
  const frames = figureFrameCount(def, 'evaporate');
  if (frames === 0) {
    fail('G10', 'the puddle declares no evaporate row');
    return;
  }
  let previous = Number.POSITIVE_INFINITY;
  let measured = 0;
  for (let frame = 0; frame < frames; frame++) {
    const cell = cellOf(def, 'evaporate', frame);
    let total = 0;
    for (let i = ALPHA_OFFSET; i < cell.data.length; i += CHANNELS) total += cell.data[i];
    measured++;
    if (total >= previous) {
      fail('G10', `evaporate[${frame}] is no thinner than the frame before it`);
    }
    previous = total;
    if (frame === frames - 1 && total > 0) {
      fail('G10', 'the last evaporate frame still shows the puddle');
    }
  }
  failUnlessMeasured('G10', measured, 'evaporate frames');
}

// ── G11 the contact shadow stays a shadow ────────────────────────────────────

/**
 * The shadow's alpha is a computed fill, and node-canvas drops an `rgba()`
 * whose alpha is in exponent notation — baking the fill solid instead of not at
 * all. This samples round the body shadow's rim, where only some samples land
 * on her, and insists enough of what is there is translucent.
 */
const SHADOW_MAX_ALPHA = 200;
const SHADOW_SAMPLE_COUNT = 48;
const SHADOW_SAMPLE_SHARE_REQUIRED = 0.25;
/** Samples sit this far out toward the shadow's rim. */
const SHADOW_SAMPLE_REACH = 0.92;

function gateContactShadowIsTranslucent(): void {
  const def = GROTESQUE_SPIDER_BASE_FIGURE;
  let translucent = 0;
  let sampled = 0;
  for (let frame = 0; frame < figureFrameCount(def, 'idle'); frame++) {
    const pose = shippedPose('idle', frame);
    if (pose === null) continue;
    const waist = solveSpiderPose(pose).waist;
    const cell = cellOf(def, 'idle', frame);
    for (let sample = 0; sample < SHADOW_SAMPLE_COUNT; sample++) {
      const angle = (sample / SHADOW_SAMPLE_COUNT) * Math.PI * 2;
      const at = toCell(
        waist.x + Math.cos(angle) * SPIDER_BODY_SHADOW.rx * SHADOW_SAMPLE_REACH,
        waist.y -
          SPIDER_BODY_SHADOW.back +
          Math.sin(angle) * SPIDER_BODY_SHADOW.ry * SHADOW_SAMPLE_REACH,
      );
      const alpha = alphaAt(cell, Math.round(at.x), Math.round(at.y));
      if (alpha === 0) continue;
      sampled++;
      if (alpha < SHADOW_MAX_ALPHA) translucent++;
    }
  }
  failUnlessMeasured('G11', sampled, 'shadow samples with any ink');
  if (sampled === 0) return;
  const share = translucent / sampled;
  if (share >= SHADOW_SAMPLE_SHARE_REQUIRED) return;
  fail(
    'G11',
    `only ${(share * PERCENT).toFixed(0)}% of the contact shadow is translucent, under the ` +
      `${(SHADOW_SAMPLE_SHARE_REQUIRED * PERCENT).toFixed(0)}% it takes to read as a shadow rather ` +
      'than a slab',
  );
}

// ── G12 every leg is painted ─────────────────────────────────────────────────

/**
 * The eight legs the rig describes. Frozen here rather than read off the array
 * alone so that a leg deleted from the rig fails this gate instead of quietly
 * shrinking what it walks.
 */
const EXPECTED_LEG_COUNT = 8;

/** The state name the probe figure declares; one row, one frame per pose. */
const LEG_PROBE_STATE = 'leg_probe';

/**
 * Poses the legs are counted in, chosen by this gate rather than read from the
 * rows: a spread across every row and stage, including the slam's raised and
 * landed forelegs, the lay's turned abdomen and the death curl.
 */
const LEG_PROBE_POSES: readonly GrotesqueSpiderPose[] = [
  { row: 'idle', cycle: 0 },
  { row: 'idle', cycle: 0.45 },
  { row: 'walk', cycle: 0 },
  { row: 'walk', cycle: 0.3 },
  { row: 'walk', cycle: 0.7 },
  { row: 'attack_slam', stage: 'tell', stageProgress: 1 },
  { row: 'attack_slam', stage: 'lock', stageProgress: 0.97 },
  { row: 'attack_slam', stage: 'strike', stageProgress: 0 },
  { row: 'attack_screech', stage: 'strike', stageProgress: 0 },
  { row: 'attack_screech', stage: 'recovery', stageProgress: 0.3 },
  { row: 'attack_spit', stage: 'lock', stageProgress: 0.5 },
  { row: 'attack_lay', stage: 'strike', stageProgress: 0.6 },
  { row: 'death', progress: 1 },
];

/**
 * A figure that paints the boss in poses this gate chooses, at the cell
 * geometry the shipped figures use, so a rig-computed tip can be looked for in
 * a painted cell.
 */
const LEG_PROBE_FIGURE: FigureDef = {
  id: 'grotesque_spider_leg_probe',
  frameWidth: GROTESQUE_SPIDER_BASE_FIGURE.frameWidth,
  frameHeight: GROTESQUE_SPIDER_BASE_FIGURE.frameHeight,
  tileX: GROTESQUE_SPIDER_BASE_FIGURE.tileX,
  tileY: GROTESQUE_SPIDER_BASE_FIGURE.tileY,
  tileScale: GROTESQUE_SPIDER_BASE_FIGURE.tileScale,
  states: figureStates({ [LEG_PROBE_STATE]: LEG_PROBE_POSES.length }),
  paintFrame: (ctx, state, frame) => {
    if (state !== LEG_PROBE_STATE || frame < 0 || frame >= LEG_PROBE_POSES.length) return;
    drawGrotesqueSpider(
      ctx,
      GROTESQUE_SPIDER_BASE_FIGURE.tileX,
      GROTESQUE_SPIDER_BASE_FIGURE.tileY,
      GROTESQUE_SPIDER_BASE_FIGURE.tileScale,
      LEG_PROBE_POSES[frame],
    );
  },
};

/**
 * How far from a rig-computed tip solid ink may sit and still count as that
 * leg's foot. The tip is the round end of a solid stroke with a claw drawn past
 * it, so it lands on ink; two pixels allow for rounding and no more, since a
 * wider search starts finding a neighbouring leg.
 */
const LEG_TIP_SEARCH_PX = 2;

/** The nearest solid pixel to a point within the search radius, or null. */
function nearestSolidWithin(cell: Cell, x: number, y: number, radius: number): number | null {
  let nearest: number | null = null;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      if (alphaAt(cell, Math.round(x) + dx, Math.round(y) + dy) < SOLID_ALPHA) continue;
      if (nearest === null || distance < nearest) nearest = distance;
    }
  }
  return nearest;
}

/** Looks for ink at all eight tips of one painted pose; returns the legs examined. */
function checkLegTips(
  gate: string,
  cell: Cell,
  pose: GrotesqueSpiderPose,
  label: string,
): Set<number> {
  const seen = new Set<number>();
  for (let index = 0; index < SPIDER_LEGS.length; index++) {
    const tip = getSpiderLegTip(pose, index);
    seen.add(index);
    const at = toCell(tip.x, tip.y);
    if (
      Number.isFinite(at.x) &&
      Number.isFinite(at.y) &&
      nearestSolidWithin(cell, at.x, at.y, LEG_TIP_SEARCH_PX) !== null
    ) {
      continue;
    }
    fail(
      gate,
      `leg ${index} of ${label} paints nothing within ${LEG_TIP_SEARCH_PX} px of the tip the rig ` +
        `puts at (${at.x.toFixed(0)}, ${at.y.toFixed(0)}) — that leg is missing from the pose`,
    );
  }
  return seen;
}

/**
 * Walks the rig to all eight tips in every probe pose and insists there is ink
 * where each one lands. A leg is about two per cent of her ink, which every
 * whole-cell aggregate here misses; only asking the rig where the foot should
 * be sees it, and names the leg that is gone.
 */
function gateEveryLegIsPainted(): void {
  if (SPIDER_LEGS.length !== EXPECTED_LEG_COUNT) {
    fail(
      'G12',
      `the rig describes ${SPIDER_LEGS.length} legs, not the ${EXPECTED_LEG_COUNT} she is drawn with`,
    );
  }
  const legsSeen = new Set<number>();
  LEG_PROBE_POSES.forEach((pose, frame) => {
    const cell = cellOf(LEG_PROBE_FIGURE, LEG_PROBE_STATE, frame);
    for (const leg of checkLegTips('G12', cell, pose, `probe pose ${frame} (${pose.row})`)) {
      legsSeen.add(leg);
    }
  });
  failUnlessMeasured('G12', LEG_PROBE_POSES.length, 'probe poses');
  // Distinct legs, not tips: a loop over half the rig still walks to many feet.
  if (legsSeen.size >= EXPECTED_LEG_COUNT) return;
  fail('G12', `only ${legsSeen.size} of the ${EXPECTED_LEG_COUNT} legs were examined at all`);
}

// ── G13 every shipped frame paints every leg ─────────────────────────────────

/**
 * Walks the rig to all eight tips in every frame the game actually plays. G12
 * proves the painter; this proves the row tables, whose frames could hand the
 * painter a pose G12 never tried.
 */
function gateShippedFramesPaintEveryLeg(): void {
  let rowsChecked = 0;
  const legsSeen = new Set<number>();
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    for (const [state, declared] of def.states) {
      if (!GROTESQUE_SPIDER_ROW_POSES.has(state)) {
        fail(
          'G13',
          `${def.id} declares a "${state}" row that the shipped pose table has no poses for`,
        );
        continue;
      }
      rowsChecked++;
      for (let frame = 0; frame < declared.frames; frame++) {
        const pose = shippedPose(state, frame);
        if (pose === null) continue;
        const label = `${def.id}.${state}[${frame}]`;
        for (const leg of checkLegTips('G13', cellOf(def, state, frame), pose, label)) {
          legsSeen.add(leg);
        }
      }
    }
  }
  failUnlessMeasured('G13', rowsChecked, 'shipped rows');
  if (legsSeen.size >= EXPECTED_LEG_COUNT) return;
  fail(
    'G13',
    `only ${legsSeen.size} of the ${EXPECTED_LEG_COUNT} legs were examined in shipped frames`,
  );
}

// ── G14 the walk is a planted, alternating tetrapod ──────────────────────────

/** How far a planted foot may drift over the ground it is standing on, in tiles. */
const PLANTED_DRIFT_TILES = 0.005;

/**
 * Over the walk row: lifted feet always belong to one tetrapod (L1 R2 L3 R4 or
 * R1 L2 R3 L4), each tetrapod lifts at some point, and a planted foot stays on
 * the same patch of floor while the body moves over it — measured in the world
 * frame, where the ground under a stance foot does not move.
 */
function gateWalkIsPlantedTetrapod(): void {
  const frames = GROTESQUE_SPIDER_ROW_FRAMES.walk;
  const liftedGroups = new Set<string>();
  const plantedAt = new Map<number, number>();
  let planted = 0;
  for (let frame = 0; frame < frames; frame++) {
    const pose = shippedPose('walk', frame);
    if (pose?.row !== 'walk') {
      fail('G14', 'the walk row has no pose table');
      return;
    }
    const travelled = pose.cycle * WALK_STRIDE_TILES;
    const solve = solveSpiderPose(pose);
    const groupsUp = new Set<string>();
    for (const leg of solve.legs) {
      if (leg.index === STUMP_LEG_INDEX) continue;
      const tip = leg.joints[leg.joints.length - 1];
      if (tip.h > GROUND_EPSILON) {
        groupsUp.add(leg.desc.group);
        liftedGroups.add(leg.desc.group);
        plantedAt.delete(leg.index);
        continue;
      }
      const world = tip.y + travelled;
      const first = plantedAt.get(leg.index);
      if (first === undefined) {
        plantedAt.set(leg.index, world);
        continue;
      }
      planted++;
      if (Math.abs(world - first) <= PLANTED_DRIFT_TILES) continue;
      fail(
        'G14',
        `leg ${leg.index} skates ${Math.abs(world - first).toFixed(DRIFT_DECIMALS)} tiles on walk[${frame}] ` +
          'while planted',
      );
    }
    if (groupsUp.size > 1) {
      fail('G14', `walk[${frame}] lifts feet from both tetrapods at once`);
    }
  }
  failUnlessMeasured('G14', planted, 'planted foot steps');
  if (liftedGroups.size < 2) {
    fail('G14', `only ${liftedGroups.size} of the two tetrapods ever lift during the walk`);
  }
}

// ── G15 the idle blinks one eye at a time ────────────────────────────────────

const LID_SHUT = 0.99;
const LID_OPEN = 0.05;

/**
 * Every eye shuts once over the idle loop, each on a frame of its own. Eyes
 * that blink together read as one creature's eyes; these are meant to read as
 * several.
 */
function gateIdleBlinksIndependently(): void {
  const frames = GROTESQUE_SPIDER_ROW_FRAMES.idle;
  const shutFrames = new Map<number, number[]>();
  let eyes = 0;
  for (let frame = 0; frame < frames; frame++) {
    const pose = shippedPose('idle', frame);
    if (pose === null) continue;
    const solve = solveSpiderPose(pose);
    eyes = solve.lids.length;
    let shutNow = 0;
    solve.lids.forEach((lid, eye) => {
      if (lid >= LID_SHUT) {
        shutNow++;
        shutFrames.set(eye, [...(shutFrames.get(eye) ?? []), frame]);
      } else if (lid > LID_OPEN) {
        fail('G15', `eye ${eye} is half-shut (${lid.toFixed(2)}) on idle[${frame}]; blinks snap`);
      }
    });
    if (shutNow > 1) fail('G15', `idle[${frame}] shuts ${shutNow} eyes at once`);
  }
  failUnlessMeasured('G15', eyes, 'eyes');
  for (let eye = 0; eye < eyes; eye++) {
    if ((shutFrames.get(eye) ?? []).length === 1) continue;
    fail('G15', `eye ${eye} shuts on ${(shutFrames.get(eye) ?? []).length} idle frames, not one`);
  }
}

// ── G16 the lay swells, drops and deflates ───────────────────────────────────

const LAY_MIN_SWELL = 1.2;
const LAY_MAX_DEFLATED_SCALE = 0.95;
/**
 * Egg-shell pixels: within this distance, in RGB, of the ramp the shell is
 * shaded along, from its lit crown to its mid tone. Measured against the egg's
 * own palette rather than as "pale", because the sac is a mid-toned leathery
 * hide: nothing else she paints near her tail (grey-violet hide, olive clutch
 * seen through the sac, raw red ovipositor, venom) comes this close to it.
 */
const SHELL_COLOUR_TOLERANCE = 14;
const HEX_RADIX = 16;
const HEX_CHANNEL_DIGITS = 2;
const HEX_BODY_START = 1;

type Rgb = readonly [number, number, number];

function channelsOf(hex: string): Rgb {
  const channel = (index: number): number => {
    const from = HEX_BODY_START + index * HEX_CHANNEL_DIGITS;
    return Number.parseInt(hex.slice(from, from + HEX_CHANNEL_DIGITS), HEX_RADIX);
  };
  return [channel(0), channel(1), channel(2)];
}

const [SHELL_LIT, SHELL_MID] = SPIDER_EGG_SHELL_COLOURS.map(channelsOf);

/** How far a colour is from the nearest point on the straight ramp between two others. */
function distanceToRamp(colour: Rgb, from: Rgb, to: Rgb): number {
  const ramp = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const offset = [colour[0] - from[0], colour[1] - from[1], colour[2] - from[2]];
  const rampLengthSquared = ramp[0] ** 2 + ramp[1] ** 2 + ramp[2] ** 2;
  const along =
    rampLengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            (offset[0] * ramp[0] + offset[1] * ramp[1] + offset[2] * ramp[2]) / rampLengthSquared,
          ),
        )
      : 0;
  return Math.hypot(
    offset[0] - ramp[0] * along,
    offset[1] - ramp[1] * along,
    offset[2] - ramp[2] * along,
  );
}

const LAID_EGG_MIN_PIXELS = 60;
/**
 * Shell ink allowed where the expelled egg last was, on a tick the creature
 * has already put the real egg on the floor. A few stray pixels of staple or
 * slime may land there; an egg is hundreds.
 */
const GONE_EGG_MAX_PIXELS = 12;
/** How far past the furthest-expelled egg's edge leftover shell is looked for, in tiles. */
const LAY_EXPEL_SEARCH_TILES = 0.25;
/** The birth lump must travel at least this far down the abdomen during the tell. */
const LAY_MIN_LUMP_TRAVEL = 0.5;

const isShell: PixelTest = (r, g, b, a) =>
  a >= SOLID_ALPHA && distanceToRamp([r, g, b], SHELL_LIT, SHELL_MID) <= SHELL_COLOUR_TOLERANCE;

/** Shell ink painted where the rig says an egg is, in cell pixels. */
function shellAt(cell: Cell, egg: LayingEgg): number {
  const at = project(egg.at);
  const cellAt = toCell(at.x, at.y);
  return countPixels(cell, isShell, {
    x: cellAt.x,
    y: cellAt.y,
    radius: egg.radius * TILE_PX,
  });
}

/**
 * The lay reads as a lay at game size: the sac is visibly swollen by the end
 * of the tell and an egg-sized lump is squeezed down the abdomen before the
 * first drop; the tell crowns a full-sized egg at the ovipositor; every egg
 * the art shows is painted where the rig says it is; and the recovery hangs
 * smaller than she started.
 *
 * The creature puts each real egg on the floor, one to three tiles behind her,
 * on its tick in `LAY_EGG_FRAMES`, and from then on the egg entity owns it —
 * its own `land` row is the splat. So the art hands over: on the tick before
 * each landing it shows the egg being expelled off the ovipositor, and on the
 * landing tick itself, read through the same frame mapping the runtime uses,
 * no egg is left in the art. Otherwise two eggs are on screen at once.
 */
function gateLayDropsAnEgg(): void {
  const row: GrotesqueSpiderAttackRow = 'attack_lay';
  const frames = GROTESQUE_SPIDER_ROW_FRAMES[row];
  const def = GROTESQUE_SPIDER_FIGURE_FOR_ROW[row];
  let tellSwell = 0;
  let tellLump = 0;
  let tellCrown = 0;
  let recoveries = 0;
  let eggsShown = 0;
  let furthestExpelled: LayingEgg | null = null;
  for (let frame = 0; frame < frames; frame++) {
    const pose = attackPose(row, frame);
    if (pose?.row !== row) {
      fail('G16', 'the lay row has no pose table');
      return;
    }
    const solve = solveSpiderPose(pose);
    const egg = solve.heldEgg;
    if (pose.stage === 'tell') {
      tellSwell = Math.max(tellSwell, solve.abdomen.swell);
      tellLump = Math.max(tellLump, solve.birthLump);
      if (egg !== null) tellCrown = Math.max(tellCrown, egg.radius * 2);
    }
    if (egg !== null) {
      eggsShown++;
      const shell = shellAt(cellOf(def, row, frame), egg);
      if (shell < LAID_EGG_MIN_PIXELS) {
        fail('G16', `lay[${frame}] paints ${shell} px of shell where its egg is`);
      }
      if (furthestExpelled === null || egg.dropped > furthestExpelled.dropped) {
        furthestExpelled = egg;
      }
    }
    if (pose.stage === 'recovery') {
      recoveries++;
      if (egg !== null) fail('G16', `recovery frame ${frame} still shows an egg`);
      if (solve.abdomen.scale > LAY_MAX_DEFLATED_SCALE) {
        fail(
          'G16',
          `recovery frame ${frame} leaves the abdomen at ${solve.abdomen.scale.toFixed(2)}`,
        );
      }
    }
  }
  failUnlessMeasured('G16', recoveries, 'lay recovery frames');
  failUnlessMeasured('G16', eggsShown, 'lay frames showing an egg');
  if (tellSwell < LAY_MIN_SWELL) {
    fail('G16', `the sac swells only to ${tellSwell.toFixed(2)} before laying`);
  }
  if (tellLump < LAY_MIN_LUMP_TRAVEL) {
    fail('G16', 'no egg is squeezed down the abdomen before the first drop');
  }
  if (tellCrown < EGG_MIN_ACROSS_TILES) {
    fail('G16', 'the tell never crowns a full-sized egg at the ovipositor');
  }
  if (furthestExpelled === null || furthestExpelled.dropped <= 0) {
    fail('G16', 'no frame shows an egg leaving the ovipositor');
    return;
  }
  const expelledAt = toCell(project(furthestExpelled.at).x, project(furthestExpelled.at).y);
  let landings = 0;
  for (const landing of LAY_EGG_FRAMES) {
    landings++;
    const before = attackPose(row, grotesqueSpiderRowFrameAt('lay', landing - 1));
    const shownFrame = grotesqueSpiderRowFrameAt('lay', landing);
    const on = attackPose(row, shownFrame);
    if (before === null || on === null) {
      fail('G16', 'the lay row has no pose table');
      return;
    }
    const leaving = solveSpiderPose(before).heldEgg;
    if (leaving === null || leaving.dropped <= 0) {
      fail(
        'G16',
        `the tick before the egg landing on attack frame ${landing} shows no egg dropping`,
      );
    }
    if (solveSpiderPose(on).heldEgg !== null) {
      fail(
        'G16',
        `lay[${shownFrame}], shown as the egg lands on attack frame ${landing}, still holds one`,
      );
    }
    const leftover = countPixels(cellOf(def, row, shownFrame), isShell, {
      x: expelledAt.x,
      y: expelledAt.y,
      radius: (furthestExpelled.radius + LAY_EXPEL_SEARCH_TILES) * TILE_PX,
    });
    if (leftover > GONE_EGG_MAX_PIXELS) {
      fail(
        'G16',
        `lay[${shownFrame}] paints ${leftover} px of egg shell behind her on attack frame ` +
          `${landing}, when the creature has already put that egg on the floor`,
      );
    }
  }
  failUnlessMeasured('G16', landings, 'egg landings');
  gateLayShowsOnlyTheClutch();
}

/**
 * Every tick of the lay, for every clutch size she lays: an egg shows only in
 * the lead-up to one of that clutch's landings, never on a landing tick and
 * never after the last one. The row is painted for the largest clutch, so a
 * smaller clutch — or the dead stretch after the last egg of any clutch —
 * must be mapped onto frames that carry no egg; otherwise the art pushes out
 * an egg the creature never lays.
 */
function gateLayShowsOnlyTheClutch(): void {
  const row: GrotesqueSpiderAttackRow = 'attack_lay';
  const ticks = totalFrames('lay');
  let measured = 0;
  for (let clutch = 1; clutch <= MAX_EGG_CLUTCH_SIZE; clutch++) {
    const landings = LAY_EGG_FRAMES.slice(0, clutch);
    const lastLanding = landings[landings.length - 1];
    for (let tick = 0; tick < ticks; tick++) {
      const shown = grotesqueSpiderRowFrameAt('lay', tick, clutch);
      const pose = attackPose(row, shown);
      if (pose === null) {
        fail('G16', 'the lay row has no pose table');
        return;
      }
      measured++;
      const egg = solveSpiderPose(pose).heldEgg;
      if (egg === null) continue;
      const leadingUp = tick < lastLanding && !landings.includes(tick);
      if (leadingUp) continue;
      fail(
        'G16',
        `a clutch of ${clutch} shows an egg on lay tick ${tick} (row frame ${shown}), ` +
          `which is ${landings.includes(tick) ? 'a landing tick' : 'after its last landing'}`,
      );
    }
  }
  failUnlessMeasured('G16', measured, 'lay ticks');
}

// ── G17 death curls and spills ───────────────────────────────────────────────

/** A dead leg's tip sits at most this share of its resting reach from the pivot. */
const DEATH_CURL_SHARE = 0.75;
const DEATH_SPILL_BEHIND_TILES = 0.3;

/**
 * The last death frame — the one the runtime holds — has every leg curled in,
 * the sac torn and spilled, and ink lying on the floor behind her tail.
 */
function gateDeathCurlsAndSpills(): void {
  const frames = GROTESQUE_SPIDER_ROW_FRAMES.death;
  const last = shippedPose('death', frames - 1);
  const first = shippedPose('death', 0);
  if (last === null || first === null || last.row !== 'death') {
    fail('G17', 'the death row has no pose table');
    return;
  }
  if (last.progress < 1) fail('G17', `the held death frame is at progress ${last.progress}, not 1`);
  const rest = solveSpiderPose({ row: 'idle', cycle: 0 });
  const dead = solveSpiderPose(last);
  let measured = 0;
  dead.legs.forEach((leg, index) => {
    if (leg.index === STUMP_LEG_INDEX) return;
    measured++;
    const tip = getSpiderLegTip(last, index);
    const restTip = rest.legs[index].joints[rest.legs[index].joints.length - 1];
    const share = Math.hypot(tip.x, tip.y) / Math.hypot(restTip.x, restTip.y);
    if (share <= DEATH_CURL_SHARE) return;
    fail('G17', `leg ${index} is still ${(share * PERCENT).toFixed(0)}% extended when she is dead`);
  });
  failUnlessMeasured('G17', measured, 'dead legs');
  if (dead.rupture < 1) fail('G17', 'the sac is not fully torn in the held frame');
  const deadCell = cellOf(GROTESQUE_SPIDER_DEATH_FIGURE, 'death', frames - 1);
  const aliveCell = cellOf(GROTESQUE_SPIDER_DEATH_FIGURE, 'death', 0);
  const deadExtent = extentOf(deadCell, 1);
  const aliveExtent = extentOf(aliveCell, SOLID_ALPHA);
  if (deadExtent === null || aliveExtent === null) {
    fail('G17', 'a death frame painted nothing');
    return;
  }
  // Her tail points up the cell (-Y), so the spill reaches above the living silhouette.
  const behind = (aliveExtent.minY - deadExtent.minY) / TILE_PX;
  if (behind < DEATH_SPILL_BEHIND_TILES) {
    fail(
      'G17',
      `the spill reaches only ${behind.toFixed(2)} tiles behind her, under the ` +
        `${DEATH_SPILL_BEHIND_TILES} that reads as a burst sac`,
    );
  }
}

// ── G20 legs are rigid ───────────────────────────────────────────────────────

/** How far a solved segment may differ from its built length, as a share of it. */
const SEGMENT_LENGTH_TOLERANCE = 1e-6;
/** Decimal places a length in tiles is reported to. */
const TILE_DECIMALS = 3;

/** Every pose the game plays, row by row, plus the leg probe's poses. */
function everyShippedPose(): { readonly label: string; readonly pose: GrotesqueSpiderPose }[] {
  const poses: { label: string; pose: GrotesqueSpiderPose }[] = [];
  for (const [state, frames] of Object.entries(GROTESQUE_SPIDER_ROW_FRAMES)) {
    for (let frame = 0; frame < frames; frame++) {
      const pose = shippedPose(state, frame);
      if (pose !== null) poses.push({ label: `${state}[${frame}]`, pose });
    }
  }
  LEG_PROBE_POSES.forEach((pose, index) => poses.push({ label: `probe ${index}`, pose }));
  return poses;
}

/**
 * Every segment of every leg keeps its built length in every pose the game
 * plays. A leg asked for a pose it cannot reach must bend or fall short, never
 * stretch: stretched, a raised foreleg reads as rubber rather than as a limb.
 */
function gateLegsAreRigid(): void {
  let measured = 0;
  for (const { label, pose } of everyShippedPose()) {
    for (const leg of solveSpiderPose(pose).legs) {
      const built = leg.desc.segments;
      if (leg.joints.length !== built.length + 1) {
        fail(
          'G20',
          `${label} leg ${leg.index} has ${leg.joints.length} joints for ${built.length} segments`,
        );
        continue;
      }
      built.forEach((length, segment) => {
        measured++;
        const solved = distance3(leg.joints[segment], leg.joints[segment + 1]);
        if (Math.abs(solved - length) <= length * SEGMENT_LENGTH_TOLERANCE) return;
        fail(
          'G20',
          `${label} leg ${leg.index} segment ${segment} is ${solved.toFixed(TILE_DECIMALS)} tiles long, ` +
            `built ${length.toFixed(TILE_DECIMALS)}: the leg stretches`,
        );
      });
    }
  }
  failUnlessMeasured('G20', measured, 'leg segments');
}

// ── G21 no pose asks a leg for more than it has ──────────────────────────────

/** How far a solved foot may fall short of where its pose put it, in tiles. */
const FOOT_TARGET_TOLERANCE_TILES = 0.005;

/**
 * Every foot lands where its pose asked it to. The solver never stretches a
 * leg, so a pose demanding more reach than the leg has is silently clamped —
 * a planted foot then slides and a slam lands short. This reads the demand,
 * not the clamped result, which would always agree with itself.
 */
function gateFeetReachTheirTargets(): void {
  let measured = 0;
  for (const { label, pose } of everyShippedPose()) {
    for (const leg of solveSpiderPose(pose).legs) {
      if (leg.index === STUMP_LEG_INDEX) continue;
      measured++;
      const foot = leg.joints[leg.joints.length - 1];
      const short = distance3(foot, leg.target);
      if (short <= FOOT_TARGET_TOLERANCE_TILES) continue;
      fail(
        'G21',
        `${label} asks leg ${leg.index} to reach ${short.toFixed(TILE_DECIMALS)} tiles further than it can`,
      );
    }
  }
  failUnlessMeasured('G21', measured, 'feet');
}

// ── G22 the abdomen is her heaviest mass ─────────────────────────────────────

/**
 * Abdomen length against carapace length, in the locomotion she spends the
 * fight in. Under the floor the abdomen is no bigger than the carapace and the
 * two ends of her read as two heads; over the ceiling the carapace, which
 * carries her face, is lost next to it.
 */
const ABDOMEN_RATIO_FLOOR = 1.5;
const ABDOMEN_RATIO_CEILING = 1.75;

function gateAbdomenDominates(): void {
  let measured = 0;
  for (const state of ['idle', 'walk'] as const) {
    for (let frame = 0; frame < GROTESQUE_SPIDER_ROW_FRAMES[state]; frame++) {
      const pose = shippedPose(state, frame);
      if (pose === null) continue;
      const solve = solveSpiderPose(pose);
      measured++;
      const abdomen = 2 * ABDOMEN_HALF_LENGTH * solve.abdomen.scale;
      const carapace = 2 * CEPH_HALF_LENGTH * cephDrawScale(solve);
      const ratio = abdomen / carapace;
      if (ratio >= ABDOMEN_RATIO_FLOOR && ratio <= ABDOMEN_RATIO_CEILING) continue;
      fail(
        'G22',
        `${state}[${frame}] draws the abdomen ${ratio.toFixed(2)}× the carapace's length, outside ` +
          `${ABDOMEN_RATIO_FLOOR}–${ABDOMEN_RATIO_CEILING}`,
      );
    }
  }
  failUnlessMeasured('G22', measured, 'locomotion frames');
}

// ── G23 every pose survives being rotated ────────────────────────────────────

/**
 * The runtime rotates the whole cell to her facing, so ink in a cell's corner
 * swings out past its edge at a diagonal facing and is clipped by the
 * silhouette composite. G5 checks the square; this checks the circle the
 * square turns through.
 */
function gateInkFitsTheTurningCircle(): void {
  const radiusLimit =
    Math.min(GROTESQUE_SPIDER_BASE_FIGURE.frameWidth, GROTESQUE_SPIDER_BASE_FIGURE.frameHeight) *
      HALF_CELL -
    MIN_EDGE_CLEARANCE_PX;
  let measured = 0;
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    eachFrame(def, (state, frame) => {
      const cell = cellOf(def, state, frame);
      let furthest = 0;
      for (let y = 0; y < cell.height; y++) {
        for (let x = 0; x < cell.width; x++) {
          if (alphaAt(cell, x, y) === 0) continue;
          furthest = Math.max(
            furthest,
            Math.hypot(x + PIXEL_CENTRE - PIVOT_X, y + PIXEL_CENTRE - PIVOT_Y),
          );
        }
      }
      measured++;
      if (furthest <= radiusLimit) return;
      fail(
        'G23',
        `${def.id}.${state}[${frame}] paints ${furthest.toFixed(0)} px from the pivot, past the ` +
          `${radiusLimit} px that stays inside the cell at every facing`,
      );
    });
  }
  failUnlessMeasured('G23', measured, 'frames');
}

// ── G24 her loops move enough to see, and never strobe ───────────────────────

/**
 * How far her abdomen's tail must travel over a loop, in tiles: at a 32 px
 * tile, a tenth of a tile is three pixels, the least a heavy abdomen swaying
 * reads as alive rather than as a still.
 */
const LOOP_MIN_TAIL_SWEEP_TILES = 0.1;
/**
 * The largest single-frame step allowed, as a share of the whole sweep. A
 * motion that covers half its range in one frame is sampled below four frames
 * a cycle, and at game size it strobes instead of swaying.
 */
const LOOP_MAX_STEP_SHARE = 0.5;
/** How high a forefoot must lift in the loop to be seen leaving its shadow, in tiles. */
const LOOP_MIN_FOOT_LIFT_TILES = 0.4;

function gateLoopsMoveVisibly(): void {
  let measured = 0;
  for (const state of ['idle', 'walk'] as const) {
    const frames = GROTESQUE_SPIDER_ROW_FRAMES[state];
    const tails: P2[] = [];
    let highestFoot = 0;
    for (let frame = 0; frame < frames; frame++) {
      const pose = shippedPose(state, frame);
      if (pose === null) continue;
      const solve = solveSpiderPose(pose);
      tails.push(alongAbdomen(solve, abdomenTailDistance(solve)));
      for (const leg of solve.legs) {
        if (leg.index === STUMP_LEG_INDEX) continue;
        highestFoot = Math.max(highestFoot, leg.joints[leg.joints.length - 1].h);
      }
    }
    measured += tails.length;
    if (tails.length !== frames) {
      fail('G24', `the ${state} row has no pose table`);
      continue;
    }
    let sweep = 0;
    for (const a of tails)
      for (const b of tails) sweep = Math.max(sweep, Math.hypot(a.x - b.x, a.y - b.y));
    if (sweep < LOOP_MIN_TAIL_SWEEP_TILES) {
      fail('G24', `the ${state} loop sways her tail only ${sweep.toFixed(TILE_DECIMALS)} tiles`);
    }
    tails.forEach((tail, frame) => {
      const next = tails[(frame + 1) % tails.length];
      const step = Math.hypot(next.x - tail.x, next.y - tail.y);
      if (step <= sweep * LOOP_MAX_STEP_SHARE) return;
      fail(
        'G24',
        `${state}[${frame}]→[${(frame + 1) % tails.length}] jumps the tail ${step.toFixed(TILE_DECIMALS)} tiles, ` +
          `over half its ${sweep.toFixed(TILE_DECIMALS)} sweep`,
      );
    });
    if (highestFoot < LOOP_MIN_FOOT_LIFT_TILES) {
      fail('G24', `no foot lifts more than ${highestFoot.toFixed(2)} tiles in the ${state} loop`);
    }
  }
  failUnlessMeasured('G24', measured, 'loop frames');
}

// ── G25 her face leads, not her clutch ───────────────────────────────────────

/** Rec. 601 luma weights. */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
/** The share of a region's pixels its highlights are read from: its brightest twentieth. */
const HIGHLIGHT_PERCENTILE = 0.95;
/** The share its darks are read from. */
const SHADOW_PERCENTILE = 0.05;
/**
 * How far the face's highlights must out-shine the clutch's, in luma steps.
 * Level with each other the eye splits between her two ends; this far apart
 * it goes to her face first at 32 px.
 */
const FACE_HIGHLIGHT_LEAD = 40;
/** The face's contrast, darks to highlights, must beat the clutch's by this factor. */
const FACE_CONTRAST_LEAD = 1.4;
/** The face disc runs from the carapace's back edge to the fang tips, centred between them. */
const MIDPOINT_SHARE = 0.5;
/** Fewer solid pixels than this in a region and there is nothing there to measure. */
const REGION_MIN_PIXELS = 200;

interface RegionTone {
  readonly highlight: number;
  readonly contrast: number;
  readonly pixels: number;
}

function percentileOf(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/** The highlight and darks-to-highlights spread of the solid pixels in a disc of a cell. */
function regionTone(cell: Cell, at: { x: number; y: number }, radius: number): RegionTone {
  const lumas: number[] = [];
  for (let y = Math.floor(at.y - radius); y <= Math.ceil(at.y + radius); y++) {
    for (let x = Math.floor(at.x - radius); x <= Math.ceil(at.x + radius); x++) {
      if (Math.hypot(x - at.x, y - at.y) > radius) continue;
      if (alphaAt(cell, x, y) < SOLID_ALPHA) continue;
      const i = (y * cell.width + x) * CHANNELS;
      const d = cell.data;
      lumas.push(
        d[i + RED_OFFSET] * LUMA_RED +
          d[i + GREEN_OFFSET] * LUMA_GREEN +
          d[i + BLUE_OFFSET] * LUMA_BLUE,
      );
    }
  }
  lumas.sort((a, b) => a - b);
  if (lumas.length === 0) return { highlight: 0, contrast: 0, pixels: 0 };
  const highlight = percentileOf(lumas, HIGHLIGHT_PERCENTILE);
  return {
    highlight,
    contrast: highlight - percentileOf(lumas, SHADOW_PERCENTILE),
    pixels: lumas.length,
  };
}

/**
 * Her face — the carapace with its lit eyes, and the bone fangs in front of it
 * — out-shines and out-contrasts the egg clutch on every locomotion frame. The
 * clutch is the biggest patch of pale on her back; lit brighter than her face,
 * it pulls the eye to her tail and she reads as walking backwards.
 */
function gateFaceLeadsTheClutch(): void {
  let measured = 0;
  for (const state of ['idle', 'walk'] as const) {
    const def = GROTESQUE_SPIDER_FIGURE_FOR_ROW[state];
    for (let frame = 0; frame < GROTESQUE_SPIDER_ROW_FRAMES[state]; frame++) {
      const pose = shippedPose(state, frame);
      if (pose === null) {
        fail('G25', `the ${state} row has no pose table`);
        return;
      }
      const solve = solveSpiderPose(pose);
      const cell = cellOf(def, state, frame);
      const faceCentre = cephToFigure(solve, 0, (FANG_TIP_Y - CEPH_HALF_LENGTH) * MIDPOINT_SHARE);
      const faceRadius = (FANG_TIP_Y + CEPH_HALF_LENGTH) * MIDPOINT_SHARE * cephDrawScale(solve);
      const sac = spiderSacWindow(solve);
      const face = regionTone(cell, toCell(faceCentre.x, faceCentre.y), faceRadius * TILE_PX);
      const clutch = regionTone(cell, toCell(sac.x, sac.y), sac.radius * TILE_PX);
      if (face.pixels < REGION_MIN_PIXELS || clutch.pixels < REGION_MIN_PIXELS) {
        fail('G25', `${state}[${frame}] has too little ink where her face or clutch should be`);
        continue;
      }
      measured++;
      if (face.highlight < clutch.highlight + FACE_HIGHLIGHT_LEAD) {
        fail(
          'G25',
          `${state}[${frame}] lights her face to ${face.highlight.toFixed(0)} and her clutch to ` +
            `${clutch.highlight.toFixed(0)}; the face must lead by ${FACE_HIGHLIGHT_LEAD}`,
        );
      }
      if (face.contrast < clutch.contrast * FACE_CONTRAST_LEAD) {
        fail(
          'G25',
          `${state}[${frame}] gives her face ${face.contrast.toFixed(0)} of contrast against the ` +
            `clutch's ${clutch.contrast.toFixed(0)}`,
        );
      }
    }
  }
  failUnlessMeasured('G25', measured, 'locomotion frames');
}

// ── G26 the strike pose holds for its hold, not longer ───────────────────────

/**
 * Ticks past the impact hold the strike pose may still show. None: the hold
 * is the pose's whole budget, and every tick past it shows the contact as
 * lasting longer than the damage window it telegraphs.
 */
const IMPACT_HOLD_SLACK_FRAMES = 0;

/**
 * Walking every tick of each damaging attack, the row shows one of its strike
 * samples — the contact, burst or release pose — on no more ticks than the
 * attack's impact hold. The phase-change roar reads the screech through the
 * same mapping, so it inherits this.
 */
function gateStrikePoseHoldsForItsHold(): void {
  let measured = 0;
  for (const attack of ['slam', 'screech', 'spit'] as const) {
    const row = GROTESQUE_SPIDER_ATTACK_ROWS[attack];
    const samples = GROTESQUE_SPIDER_ATTACK_SAMPLES[row];
    let strikeTicks = 0;
    for (let tick = 0; tick < totalFrames(attack); tick++) {
      const sample = samples[grotesqueSpiderRowFrameAt(attack, tick)];
      measured++;
      if (sample.stage === 'strike') strikeTicks++;
    }
    const limit = SPIDER_ATTACK_TIMELINES[attack].impactHoldFrames + IMPACT_HOLD_SLACK_FRAMES;
    if (strikeTicks > limit) {
      fail(
        'G26',
        `${attack} shows its strike pose on ${strikeTicks} ticks, past its ${limit}-tick hold`,
      );
    }
  }
  failUnlessMeasured('G26', measured, 'attack ticks');
}

// ── G27 her frozen idle reach matches her ink ────────────────────────────────

/** Ink at least this opaque counts toward her reach: what a viewer sees as her edge. */
const REACH_INK_ALPHA = 128;
/**
 * How far the frozen reach may overstate the measured one, in tiles. Over it,
 * a portrait sized from the constant draws her smaller than she needs to be;
 * under the measurement at all, it draws her through the panel's edge.
 */
const REACH_SLACK_TILES = 0.1;

/**
 * `GROTESQUE_SPIDER_IDLE_REACH_TILES` still bounds every idle frame's ink,
 * tightly, on each side. Frozen because nothing measures ink at runtime; a
 * redraw that grows her would otherwise push her out of her intro portrait
 * with every other gate green.
 */
function gateIdleReachIsFrozen(): void {
  const def = GROTESQUE_SPIDER_FIGURE_FOR_ROW.idle;
  let tail = 0;
  let head = 0;
  let side = 0;
  let measured = 0;
  for (let frame = 0; frame < GROTESQUE_SPIDER_ROW_FRAMES.idle; frame++) {
    const cell = cellOf(def, 'idle', frame);
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (alphaAt(cell, x, y) < REACH_INK_ALPHA) continue;
        measured++;
        const dx = (x + PIXEL_CENTRE - PIVOT_X) / TILE_PX;
        const dy = (y + PIXEL_CENTRE - PIVOT_Y) / TILE_PX;
        tail = Math.max(tail, -dy);
        head = Math.max(head, dy);
        side = Math.max(side, Math.abs(dx));
      }
    }
  }
  failUnlessMeasured('G27', measured, 'idle ink pixels');
  const frozen = GROTESQUE_SPIDER_IDLE_REACH_TILES;
  const sides = [
    ['tail', frozen.tail, tail],
    ['head', frozen.head, head],
    ['side', frozen.side, side],
  ] as const;
  for (const [name, declared, actual] of sides) {
    if (actual <= declared && declared - actual <= REACH_SLACK_TILES) continue;
    fail(
      'G27',
      `her idle ink reaches ${actual.toFixed(2)} tiles toward her ${name}, against a frozen ` +
        declared.toFixed(2),
    );
  }
}

// ── G18 the egg is a countdown ───────────────────────────────────────────────

const EGG_MIN_ACROSS_TILES = 0.5;
const EGG_MAX_ACROSS_TILES = 0.75;
/** Pulse cycles per frame over which a throb aliases into a slower one or a strobe. */
const PULSE_NYQUIST = 0.5;
const EGG_GLOW_MIN_GREEN = 150;
const EGG_GLOW_GREEN_OVER_RED = 30;
const EGG_GLOW_GREEN_OVER_BLUE = 60;
const EGG_GLOW_MIN_PIXELS = 20;

const isEggGlow: PixelTest = (r, g, b, a) =>
  a >= SOLID_ALPHA &&
  g >= EGG_GLOW_MIN_GREEN &&
  g - r >= EGG_GLOW_GREEN_OVER_RED &&
  g - b >= EGG_GLOW_GREEN_OVER_BLUE;

/**
 * The incubate row reads its hatch progress out loud: the pulse only ever
 * quickens and never passes the rate that aliases; the cracks open at their
 * thresholds; the green glow and the shake belong to the last stretch and
 * nowhere else; the sac is about six-tenths of a tile across; and the destroyed
 * row ends on a decal rather than nothing.
 */
function gateEggCountsDown(): void {
  const frames = SPIDER_EGG_FRAMES.incubate;
  let previousStep = 0;
  for (let frame = 1; frame < frames; frame++) {
    const step = INCUBATE_PULSE_PHASES[frame] - INCUBATE_PULSE_PHASES[frame - 1];
    if (step < previousStep) fail('G18', `the pulse slows down at incubate[${frame}]`);
    if (step >= PULSE_NYQUIST) {
      fail('G18', `incubate[${frame}] steps ${step.toFixed(2)} pulse cycles, which aliases`);
    }
    previousStep = step;
  }
  let glowing = 0;
  for (let frame = 0; frame < frames; frame++) {
    const progress = frame / (frames - 1);
    const look = incubatingLook(progress, INCUBATE_PULSE_PHASES[frame], frame);
    const cracks = look.crack ?? 0;
    const expected = progress >= EGG_SECOND_CRACK_AT ? 2 : progress >= EGG_FIRST_CRACK_AT ? 1 : 0;
    if (cracks !== expected) {
      fail('G18', `incubate[${frame}] shows ${cracks} cracks at progress ${progress.toFixed(2)}`);
    }
    const glow = countPixels(cellOf(SPIDER_EGG_FIGURE, 'incubate', frame), isEggGlow);
    const frenzied = progress >= EGG_FRENZY_AT;
    if (frenzied && progress > EGG_FRENZY_AT && glow < EGG_GLOW_MIN_PIXELS) {
      fail('G18', `incubate[${frame}] is in its last quarter with ${glow} px of green glow`);
    }
    if (!frenzied && glow > 0)
      fail('G18', `incubate[${frame}] glows green before its last quarter`);
    if (frenzied && (look.shake ?? 0) === 0) fail('G18', `incubate[${frame}] does not shake`);
    if (!frenzied && (look.shake ?? 0) !== 0) fail('G18', `incubate[${frame}] shakes too early`);
    if (frenzied) glowing++;
  }
  failUnlessMeasured('G18', glowing, 'frenzied incubate frames');
  const first = extentOf(cellOf(SPIDER_EGG_FIGURE, 'incubate', 0), FULL_ALPHA);
  if (first === null) {
    fail('G18', 'the first incubate frame has no solid sac');
  } else {
    const across = (first.maxX - first.minX + 1) / SPIDER_EGG_FIGURE.tileScale;
    if (across < EGG_MIN_ACROSS_TILES || across > EGG_MAX_ACROSS_TILES) {
      fail(
        'G18',
        `the sac is ${across.toFixed(2)} tiles across, outside ${EGG_MIN_ACROSS_TILES}–` +
          `${EGG_MAX_ACROSS_TILES} (the design is about ${(SPIDER_EGG_RADIUS_TILES * 2).toFixed(1)})`,
      );
    }
  }
  const decal = extentOf(
    cellOf(SPIDER_EGG_FIGURE, 'destroyed', SPIDER_EGG_FRAMES.destroyed - 1),
    SOLID_ALPHA,
  );
  if (decal === null) fail('G18', 'the destroyed row ends on nothing, not a decal');
}
// ── G18b the egg is not an eyeball ──────────────────────────────────────────

/**
 * How far red must lead both other channels for a pixel to read as blood.
 * The shell's warm off-white leads by a few steps, its brown outline by about
 * fifteen; a red vein blended over the shell leads by sixty and more.
 */
const BLOOD_RED_LEAD = 40;
/** A few antialiased pixels may tip over where the outline meets the smear. */
const EGG_BLOOD_MAX_PIXELS = 4;

const isBloodRed: PixelTest = (r, g, b, a) =>
  a >= SOLID_ALPHA && r - g >= BLOOD_RED_LEAD && r - b >= BLOOD_RED_LEAD;

/**
 * No red on the egg. A round, glossy, off-white egg with red veins over it is
 * an eyeball at game size, and she already carries a dozen eyes; its veins
 * are pale and sickly instead. Every incubate frame is measured, because the
 * glow, the cracks and the wriggling shadow each paint over the shell in turn.
 * The egg she lays is painted by the same `paintEggSac`, so this covers it too.
 */
function gateEggIsNotAnEyeball(): void {
  let measured = 0;
  for (let frame = 0; frame < SPIDER_EGG_FRAMES.incubate; frame++) {
    const red = countPixels(cellOf(SPIDER_EGG_FIGURE, 'incubate', frame), isBloodRed);
    measured++;
    if (red > EGG_BLOOD_MAX_PIXELS) {
      fail('G18b', `incubate[${frame}] paints ${red} px of blood red on the egg`);
    }
  }
  failUnlessMeasured('G18b', measured, 'incubate frames');
}

// ── L3 the plinth covers its tile ────────────────────────────────────────────

/**
 * There is no manifest entry to declare a blocked region over the machine's
 * bottom tile and make it solid to walk into, so what has to stay true is
 * enforced here directly: the plinth fills the tile the player collides with,
 * or they walk into an invisible wall beside a machine that is not there.
 */
const PLINTH_TILE_COVERAGE = 0.75;

function gatePlinthCoversItsTile(): void {
  const def = LIFE_MACHINE_FIGURE;
  let measured = 0;
  for (const row of LIFE_MACHINE_ROWS) {
    if (row.lampColor !== undefined) continue;
    const state = lifeMachineStateName(row.name);
    const frames = figureFrameCount(def, state);
    if (frames === 0) {
      fail('L3', `the life machine declares no state "${state}"`);
      continue;
    }
    const cell = cellOf(def, state, 0);
    let solid = 0;
    let total = 0;
    for (let y = def.tileY; y < def.tileY + def.tileScale; y++) {
      for (let x = def.tileX; x < def.tileX + def.tileScale; x++) {
        total++;
        if (alphaAt(cell, x, y) >= SOLID_ALPHA) solid++;
      }
    }
    measured++;
    const coverage = solid / total;
    if (coverage >= PLINTH_TILE_COVERAGE) continue;
    fail(
      'L3',
      `${state}'s plinth fills ${(coverage * PERCENT).toFixed(0)}% of the tile it blocks, under the ` +
        `${(PLINTH_TILE_COVERAGE * PERCENT).toFixed(0)}% that keeps the wall and the art the same thing`,
    );
  }
  failUnlessMeasured('L3', measured, 'body rows');
}

// ── L4 the lamps are the two colours the runtime chooses between ─────────────

/** How far the lit channel has to lead the other for the colour to be unambiguous. */
const LAMP_CHANNEL_LEAD = 40;

interface LampExpectation {
  readonly row: string;
  readonly lit: number;
  readonly other: number;
  readonly name: string;
}

const LAMP_EXPECTATIONS: readonly LampExpectation[] = [
  { row: 'green_lights', lit: GREEN_OFFSET, other: RED_OFFSET, name: 'green' },
  { row: 'red_lights', lit: RED_OFFSET, other: GREEN_OFFSET, name: 'red' },
];

function gateLampColours(): void {
  let measured = 0;
  for (const expectation of LAMP_EXPECTATIONS) {
    const state = lifeMachineStateName(expectation.row);
    const frames = figureFrameCount(LIFE_MACHINE_FIGURE, state);
    if (frames === 0) {
      fail('L4', `the life machine declares no lamp row "${state}"`);
      continue;
    }
    const cell = cellOf(LIFE_MACHINE_FIGURE, state, 0);
    let lit = 0;
    let other = 0;
    let pixels = 0;
    for (let i = 0; i < cell.data.length; i += CHANNELS) {
      if (cell.data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      lit += cell.data[i + expectation.lit];
      other += cell.data[i + expectation.other];
      pixels++;
    }
    if (pixels === 0) {
      fail('L4', `${state} paints no solid lamp at all`);
      continue;
    }
    measured++;
    const lead = (lit - other) / pixels;
    if (lead >= LAMP_CHANNEL_LEAD) continue;
    fail(
      'L4',
      `${state} leads its ${expectation.name} channel by only ${lead.toFixed(0)}, under the ` +
        `${LAMP_CHANNEL_LEAD} that tells a running machine from a shut-down one`,
    );
  }
  failUnlessMeasured('L4', measured, 'lamp rows');
}

// ── L5 the lamps chase ───────────────────────────────────────────────────────

/**
 * The lamps chase around the panel rather than blinking in unison, which is
 * what makes a machine look like it is working through a job.
 *
 * Measured at the three lamps themselves rather than over the whole frame: the
 * screen readout beside them marches on the same counter, so a frame-to-frame
 * difference anywhere in the cell is one this gate would pass with every lamp
 * pinned to the same brightness.
 */
function gateLampsChase(): void {
  let compared = 0;
  for (const expectation of LAMP_EXPECTATIONS) {
    const state = lifeMachineStateName(expectation.row);
    const frames = figureFrameCount(LIFE_MACHINE_FIGURE, state);
    if (frames === 0) {
      fail('L5', `the life machine declares no lamp row "${state}"`);
      continue;
    }
    let previousBrightest = -1;
    for (let frame = 0; frame < frames; frame++) {
      const cell = cellOf(LIFE_MACHINE_FIGURE, state, frame);
      let brightest = -1;
      let brightestValue = -1;
      for (let lamp = 0; lamp < LED_COUNT; lamp++) {
        const x = Math.round(LED_FIRST_X + lamp * LED_SPACING);
        const y = Math.round(LED_Y);
        const index = (y * cell.width + x) * CHANNELS;
        const value = cell.data[index + expectation.lit] * cell.data[index + ALPHA_OFFSET];
        if (value <= brightestValue) continue;
        brightestValue = value;
        brightest = lamp;
      }
      if (brightestValue <= 0) {
        fail('L5', `${state}[${frame}] lights none of its three lamps`);
        continue;
      }
      if (frame > 0) {
        compared++;
        if (brightest === previousBrightest) {
          fail(
            'L5',
            `${state}[${frame}] keeps lamp ${brightest} the brightest one, as the frame before ` +
              'it did — the lamps are blinking in unison rather than chasing',
          );
        }
      }
      previousBrightest = brightest;
    }
  }
  failUnlessMeasured('L5', compared, 'lamp frame transitions');
}

// ── L6 the sac splits inside the row that delivers it ────────────────────────

function gateSacSplitsInsideTheRow(): void {
  const frames = figureFrameCount(LIFE_MACHINE_FIGURE, lifeMachineStateName('dispensing'));
  if (frames === 0) {
    fail('L6', 'the life machine declares no dispensing row');
    return;
  }
  const split = lifeMachineSacSplitFrame(frames);
  if (split > 0 && split < frames - 1) return;
  fail(
    'L6',
    `the sac splits on frame ${split} of a ${frames}-frame dispensing row, which is not inside ` +
      'it — the player has to watch the sac leave the machine before it opens, and see it open',
  );
}

// ── G19 attack rows are sampled from the timeline ────────────────────────────

/** Frames added to every stage of a retuned timeline; odd, so no stage keeps its ticks. */
const RETUNE_EXTRA_FRAMES = 7;
const MIN_TELL_SAMPLES = 3;
const MIN_LOCK_SAMPLES = 2;
const MAX_LOCK_SAMPLES = 3;
/** The contact frame plus at least one hold frame. */
const MIN_STRIKE_SAMPLES = 2;
const MIN_RECOVERY_SAMPLES = 2;
const TICK_EPSILON = 1e-9;

function stageStartFrame(attack: SpiderAttack, stage: SpiderAttackStage): number {
  switch (stage) {
    case 'tell':
      return 0;
    case 'lock':
      return SPIDER_ATTACK_TIMELINES[attack].tellFrames;
    case 'strike':
      return strikeFrame(attack);
    case 'recovery':
      return recoveryStartFrame(attack);
  }
}

function stageLength(timeline: SpiderAttackTimeline, stage: SpiderAttackStage): number {
  switch (stage) {
    case 'tell':
      return timeline.tellFrames;
    case 'lock':
      return timeline.lockFrames;
    case 'strike':
      return timeline.impactHoldFrames;
    case 'recovery':
      return timeline.recoveryFrames;
  }
}

/** The whole tick a sample names inside one play of its stage, or null when it names none. */
function sampleTick(sample: StageSample, playedFrames: number): number | null {
  const tick = sample.stageProgress * playedFrames;
  const whole = Math.round(tick);
  if (Math.abs(tick - whole) > TICK_EPSILON || whole < 0 || whole >= playedFrames) return null;
  return whole;
}

/**
 * Every attack row's frames are built from the attack timeline, and the
 * wrapper's lookup lands on each of them on the tick it names.
 *
 * Three checks, because each alone can be passed by a hand-written table:
 * the exported samples equal what the builder makes from the live timeline;
 * every sample sits on a whole tick of its stage and `grotesqueSpiderRowFrameAt`
 * shows that frame from exactly that attack frame (so the strike tick shows the
 * contact frame by construction); and a retuned copy of each timeline moves
 * every sample onto the retuned stage's ticks, so a stage-length change cannot
 * leave the art sampling the old one.
 */
function gateAttackSamplesFollowTheTimeline(): void {
  let measured = 0;
  for (const [attack, row] of Object.entries(GROTESQUE_SPIDER_ATTACK_ROWS)) {
    const sampling = GROTESQUE_SPIDER_ATTACK_SAMPLING[row];
    if (sampling.attack !== attack) {
      fail('G19', `${row} is sampled from the ${sampling.attack} timeline, not ${attack}'s`);
      continue;
    }
    const timeline = SPIDER_ATTACK_TIMELINES[sampling.attack];
    const samples = GROTESQUE_SPIDER_ATTACK_SAMPLES[row];
    const built = buildAttackSamples(timeline, sampling);
    if (JSON.stringify(built) !== JSON.stringify(samples)) {
      fail('G19', `${row}'s samples are not the ones its timeline builds`);
    }
    if (GROTESQUE_SPIDER_ROW_FRAMES[row] !== samples.length) {
      fail(
        'G19',
        `${row} declares ${GROTESQUE_SPIDER_ROW_FRAMES[row]} frames for ${samples.length} samples`,
      );
    }
    const { counts } = sampling;
    if (counts.tell < MIN_TELL_SAMPLES) fail('G19', `${row} paints ${counts.tell} tell frames`);
    const lockRange =
      timeline.lockFrames > 0
        ? counts.lock >= MIN_LOCK_SAMPLES && counts.lock <= MAX_LOCK_SAMPLES
        : counts.lock === 0;
    if (!lockRange) fail('G19', `${row} paints ${counts.lock} lock frames`);
    if (counts.strike < MIN_STRIKE_SAMPLES)
      fail('G19', `${row} paints ${counts.strike} strike frames`);
    if (counts.recovery < MIN_RECOVERY_SAMPLES) {
      fail('G19', `${row} paints ${counts.recovery} recovery frames`);
    }

    samples.forEach((sample, index) => {
      measured++;
      const repeats = sample.stage === 'strike' ? sampling.strikeRepeats : 1;
      const played = Math.floor(stageLength(timeline, sample.stage) / repeats);
      const tick = sampleTick(sample, played);
      if (tick === null) {
        fail(
          'G19',
          `${row} frame ${index} (${sample.stage} ${sample.stageProgress}) is on no tick`,
        );
        return;
      }
      for (let repeat = 0; repeat < repeats; repeat++) {
        // The lay's last drop window follows the last egg of even the largest
        // clutch, so it holds its egg-free opening rather than playing a
        // drop; G16 checks what it shows instead.
        const heldOpen = sampling.attack === 'lay' && repeat + 1 >= MAX_EGG_CLUTCH_SIZE && tick > 0;
        if (heldOpen) continue;
        const frame = stageStartFrame(sampling.attack, sample.stage) + repeat * played + tick;
        const at = attackStageAt(sampling.attack, frame);
        if (at.stage !== sample.stage) {
          fail('G19', `${row} frame ${index} is a ${sample.stage} sample on a ${at.stage} tick`);
        }
        const shown = grotesqueSpiderRowFrameAt(sampling.attack, frame);
        if (shown !== index) {
          fail('G19', `attack frame ${frame} of ${attack} shows row frame ${shown}, not ${index}`);
        }
        const previous = frame > 0 ? grotesqueSpiderRowFrameAt(sampling.attack, frame - 1) : -1;
        if (previous === index) {
          fail('G19', `${row} frame ${index} is already shown before the tick it names`);
        }
      }
    });

    const contact = grotesqueSpiderRowFrameAt(sampling.attack, strikeFrame(sampling.attack));
    if (contact !== grotesqueSpiderStrikeFrame(row)) {
      fail('G19', `${attack}'s strike tick shows frame ${contact}, not the row's strike frame`);
    }

    const retuned: SpiderAttackTimeline = {
      ...timeline,
      tellFrames: timeline.tellFrames + RETUNE_EXTRA_FRAMES,
      lockFrames: timeline.lockFrames > 0 ? timeline.lockFrames + RETUNE_EXTRA_FRAMES : 0,
      impactHoldFrames: timeline.impactHoldFrames + RETUNE_EXTRA_FRAMES * sampling.strikeRepeats,
      recoveryFrames: timeline.recoveryFrames + RETUNE_EXTRA_FRAMES,
    };
    const retunedSamples = buildAttackSamples(retuned, sampling);
    if (retunedSamples.length !== samples.length) {
      fail('G19', `retuning ${attack} changes ${row}'s frame count`);
    }
    let moved = 0;
    retunedSamples.forEach((sample, index) => {
      const repeats = sample.stage === 'strike' ? sampling.strikeRepeats : 1;
      const played = Math.floor(stageLength(retuned, sample.stage) / repeats);
      if (sampleTick(sample, played) === null) {
        fail('G19', `retuned ${row} frame ${index} is on no tick of the retuned ${sample.stage}`);
      }
      if (samples[index].stageProgress !== sample.stageProgress) moved++;
    });
    if (moved === 0) fail('G19', `retuning ${attack}'s timeline moves none of ${row}'s samples`);
  }
  failUnlessMeasured('G19', measured, 'attack samples');
}

/** Runs the spider's gates and returns one message per failure. */
export function spiderGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateRuntimeStateNames();
  gateWarmRowSize();
  gateWarmWorkingSet();
  gateAnchoredToItsPivot();
  gateFacingRotation();
  gateEdgeClearance();
  gateSlamContact();
  gateScreechBurst();
  gateSpitRelease();
  gateProjectileTrailsBehind();
  gatePuddleCoversItsGrab();
  gatePuddleEvaporates();
  gateContactShadowIsTranslucent();
  gateEveryLegIsPainted();
  gateShippedFramesPaintEveryLeg();
  gateWalkIsPlantedTetrapod();
  gateIdleBlinksIndependently();
  gateLayDropsAnEgg();
  gateDeathCurlsAndSpills();
  gateEggCountsDown();
  gateEggIsNotAnEyeball();
  gateAttackSamplesFollowTheTimeline();
  gateLegsAreRigid();
  gateFeetReachTheirTargets();
  gateAbdomenDominates();
  gateInkFitsTheTurningCircle();
  gateLoopsMoveVisibly();
  gateFaceLeadsTheClutch();
  gateStrikePoseHoldsForItsHold();
  gateIdleReachIsFrozen();
  return [...failures];
}

/** Runs the life machine's gates and returns one message per failure. */
export function lifeMachineGateFailures(): string[] {
  failures.length = 0;
  gateLifeMachineStructure();
  gateLifeMachineStateNames();
  gateWarmRowSize();
  gatePlinthCoversItsTile();
  gateLampColours();
  gateLampsChase();
  gateSacSplitsInsideTheRow();
  return [...failures];
}
