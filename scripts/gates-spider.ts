/**
 * Art gates for the Grotesque Spider, her spit, and the lab's life machines.
 *
 * None of these had a gate module before: their sheets were baked by scripts
 * that asserted nothing about what they had painted, and the only invariant
 * written down anywhere was a comment on the boss's frame width explaining how
 * much clearance the widest walk pose left inside its cell. That comment is now
 * G5, and the rest of these are the things the bake could not check and the
 * cache cannot either — that the boss stands on the tile her health bar hangs
 * off, that each attack reads as the attack it is, that the spit puddle covers
 * the radius it catches players inside, that every row name the runtime builds
 * is one of these figures actually paints, and that a warm row still fits the
 * cache.
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
import { LIFE_MACHINE_STATES } from '../src/systems/SpiderQuestSystem.js';
import { figureFrameCount, figureStates, type FigureDef } from '../src/sprites/figure/figureDef.js';
import { FIGURE_BYTE_BUDGET } from '../src/sprites/figure/figureFrameCache.js';
import {
  drawGrotesqueSpider,
  getSpiderLegTip,
  SPIDER_BODY_CENTRE_RATIO,
  SPIDER_LEGS,
  type GrotesqueSpiderPose,
} from '../src/sprites/art/grotesqueSpiderArt.js';
import {
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_FIGURES,
  GROTESQUE_SPIDER_ROW_POSES,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
} from '../src/sprites/art/grotesqueSpiderFigure.js';
import {
  GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES,
  GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE,
  GROTESQUE_SPIDER_SPIT_TRAP_FIGURE,
} from '../src/sprites/art/grotesqueSpiderSpitFigure.js';
import { LED_COUNT, LED_FIRST_X, LED_SPACING, LED_Y } from '../src/sprites/art/lifeMachineArt.js';
import {
  LIFE_MACHINE_FIGURE,
  LIFE_MACHINE_LAMP_STATES,
  LIFE_MACHINE_ROWS,
  lifeMachineStateName,
} from '../src/sprites/art/lifeMachineFigure.js';
import { lifeMachineSacSplitFrame } from '../src/sprites/lifeMachineTiming.js';
import { GROTESQUE_SPIDER_RUNTIME_ROWS } from '../src/sprites/grotesqueSpiderSprite.js';
import { SPIT_EFFECT_RUNTIME_ROWS } from '../src/sprites/grotesqueSpiderSpitSprite.js';
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
 * than as something soft it casts.
 *
 * She paints a contact shadow on the ground line under her whole width, so a
 * lowest-*ink* anchor check measures that shadow and stays green while she
 * floats above it. Only near-solid pixels are body.
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

function gateStructure(): void {
  const checked: string[] = [];
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    for (const message of figureStructuralFailures(def)) fail('G1', message);
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
    // for the puddle it becomes.
    sparseStates: ['splat'],
  })) {
    fail('G1', message);
  }
  checked.push(GROTESQUE_SPIDER_SPIT_TRAP_FIGURE.id);
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
const BYTES_PER_MEGABYTE = 1024 * 1024;

/** What a warm row costs the cache: one cell per frame, at the declared size. */
function rowBytes(def: FigureDef, frames: number): number {
  return def.frameWidth * def.frameHeight * BYTES_PER_PIXEL * frames;
}

/**
 * Checks the widest row of every figure against the cache's per-figure ceiling.
 *
 * The row is the unit, not the sheet: a painted figure is admitted one state at
 * a time and rows it stops playing are released, so what has to fit is the
 * widest state, measured over every state the def declares — the single-frame
 * ones included, since leaving them out is how a figure's accounting quietly
 * stops covering half of it.
 */
function gateWarmRowSize(): void {
  let measured = 0;
  for (const def of [
    ...GROTESQUE_SPIDER_FIGURES,
    ...GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES,
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
    if (widest <= FIGURE_BYTE_BUDGET) continue;
    fail(
      'G3',
      `${def.id}'s widest row ${widestState} is ` +
        `${(widest / BYTES_PER_MEGABYTE).toFixed(1)} MB, over the ` +
        `${(FIGURE_BYTE_BUDGET / BYTES_PER_MEGABYTE).toFixed(0)} MB one figure may hold, so it ` +
        'can never be admitted and every frame of it repaints',
    );
  }
  failUnlessMeasured('G3', measured, 'rows');
}

// ── G4 anchor ────────────────────────────────────────────────────────────────

/** The centre of the tile she stands on, in cell pixels. */
const TILE_CENTRE_X =
  GROTESQUE_SPIDER_BASE_FIGURE.tileX + GROTESQUE_SPIDER_BASE_FIGURE.tileScale / 2;
const TILE_CENTRE_Y =
  GROTESQUE_SPIDER_BASE_FIGURE.tileY + GROTESQUE_SPIDER_BASE_FIGURE.tileScale / 2;

/**
 * Two tolerances, because one number over "distance from the tile centre" has
 * to cover two unrelated defects and ends up catching neither.
 *
 * Her mass hangs *below* the tile she occupies — rear legs planted a tile and a
 * half back, hair falling past all of it — so the two directions are not the
 * same claim. Rising is the tight one: nothing in the art legitimately pulls
 * her up, so a pose drifting off its anchor shows here first. Dropping is the
 * loose one, since a splayed row genuinely sits lower than a gathered one; it
 * only says the pose has not slid out of the cell the health bar and the danger
 * cones are placed against.
 *
 * This measures art against its own anchor and claims nothing more: the paint
 * origin and the tile box come from the same two frozen numbers, so moving one
 * moves both. The parity run against the sheets is what proved those numbers.
 *
 * It is also a *mass* aggregate, so it says nothing about any individual limb
 * and cannot see a missing one. One of her eight legs is around two per cent of
 * her ink: skipping a leg entirely leaves this centroid, G5's clearance and
 * every other whole-cell score in this module green — all four legs this was
 * tried on were caught by nothing here. G12 is the gate that sees it, by asking
 * the rig where each of the eight feet lands and looking for ink at that point
 * rather than scoring the silhouette.
 */
const ANCHOR_MAX_RISE_PX = 0;
const ANCHOR_MAX_DROP_PX = 32;
/** How far off the tile's vertical axis her mass may sit, either way. */
const ANCHOR_MAX_SIDEWAYS_PX = 8;

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

function gateAnchoredToItsTile(): void {
  let measured = 0;
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    eachFrame(def, (state, frame) => {
      const centroid = solidCentroid(cellOf(def, state, frame));
      if (centroid === null) {
        fail('G4', `${def.id}.${state}[${frame}] has no solid ink to measure`);
        return;
      }
      measured++;
      const drop = centroid.y - TILE_CENTRE_Y;
      if (drop < -ANCHOR_MAX_RISE_PX) {
        fail(
          'G4',
          `${def.id}.${state}[${frame}] carries its mass ${(-drop).toFixed(1)} px above the ` +
            'centre of the tile it stands on — it has drifted up off its anchor',
        );
      }
      if (drop > ANCHOR_MAX_DROP_PX) {
        fail(
          'G4',
          `${def.id}.${state}[${frame}] carries its mass ${drop.toFixed(1)} px below the tile ` +
            `centre, past the ${ANCHOR_MAX_DROP_PX} px a splayed pose accounts for`,
        );
      }
      const sideways = Math.abs(centroid.x - TILE_CENTRE_X);
      if (sideways <= ANCHOR_MAX_SIDEWAYS_PX) return;
      fail(
        'G4',
        `${def.id}.${state}[${frame}] carries its mass ${sideways.toFixed(1)} px off the tile's ` +
          `vertical axis, past the ${ANCHOR_MAX_SIDEWAYS_PX} px an asymmetric body accounts for`,
      );
    });
  }
  failUnlessMeasured('G4', measured, 'frames with solid ink');
}

// ── G5 side clearance ────────────────────────────────────────────────────────

/**
 * How much empty cell every pose has to leave at each side.
 *
 * The cell was widened to 320 px precisely because the walk row's leading legs
 * step 29 px past their rest position and were being cut off by the 256 px cell
 * before it. A pose that comes back within a few pixels of the wall is one edit
 * away from being clipped again, and the clipping is invisible in the game —
 * the leg simply ends.
 */
const MIN_SIDE_CLEARANCE_PX = 8;

function gateSideClearance(): void {
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
      const clearance = Math.min(extent.minX, cell.width - 1 - extent.maxX);
      if (clearance >= MIN_SIDE_CLEARANCE_PX) return;
      fail(
        'G5',
        `${def.id}.${state}[${frame}] leaves ${clearance} px between its ink and the cell wall, ` +
          `under the ${MIN_SIDE_CLEARANCE_PX} px a stepping leg needs`,
      );
    });
  }
  failUnlessMeasured('G5', measured, 'frames');
}

// ── G6 the slam rears ────────────────────────────────────────────────────────

/**
 * How much higher than any locomotion pose the reared forelegs must reach.
 *
 * An ordering between rows rather than a height: the legs are placed by a
 * two-bone solve that clamps at full extension, so a frozen number is one the
 * rig cannot be pushed past and a gate on it could never go red.
 */
const SLAM_REAR_CLEARANCE_PX = 40;

function highestSolidRow(def: FigureDef, state: string): number {
  let highest = Number.POSITIVE_INFINITY;
  const frames = figureFrameCount(def, state);
  if (frames === 0) {
    fail('G6', `${def.id} declares no state "${state}"`);
    return highest;
  }
  for (let frame = 0; frame < frames; frame++) {
    const extent = extentOf(cellOf(def, state, frame), SOLID_ALPHA);
    if (extent !== null) highest = Math.min(highest, extent.minY);
  }
  return highest;
}

function gateSlamRearsAboveTheWalk(): void {
  const slamTop = highestSolidRow(GROTESQUE_SPIDER_SLAM_FIGURE, 'attack_slam');
  let compared = 0;
  for (const [state] of GROTESQUE_SPIDER_BASE_FIGURE.states) {
    const walkTop = highestSolidRow(GROTESQUE_SPIDER_BASE_FIGURE, state);
    if (!Number.isFinite(slamTop) || !Number.isFinite(walkTop)) {
      fail('G6', `nothing solid to compare between attack_slam and ${state}`);
      continue;
    }
    compared++;
    const rear = walkTop - slamTop;
    if (rear >= SLAM_REAR_CLEARANCE_PX) continue;
    fail(
      'G6',
      `the slam reaches only ${rear.toFixed(0)} px above the ${state} row, under the ` +
        `${SLAM_REAR_CLEARANCE_PX} px that reads as forelegs rearing rather than a step`,
    );
  }
  failUnlessMeasured('G6', compared, 'locomotion rows to compare the slam against');
}

// ── G7 the screech announces itself ─────────────────────────────────────────

/**
 * How far above her standing silhouette the screech's shockwave ring has to
 * reach.
 *
 * An ordering against the idle row rather than a height, so it stays a claim
 * about the attack reading as an attack: the ring is the only part of the
 * screech visible from outside her own footprint, and it is what tells a player
 * standing at its edge that the damage is coming.
 */
const SCREECH_RING_CLEARANCE_PX = 30;

function gateScreechRingClearsHer(): void {
  const idleTop = highestSolidRow(GROTESQUE_SPIDER_BASE_FIGURE, 'idle');
  const frames = figureFrameCount(GROTESQUE_SPIDER_SCREECH_FIGURE, 'attack_screech');
  if (frames === 0) {
    fail('G7', 'the screech figure declares no attack_screech row');
    return;
  }
  let highest = Number.POSITIVE_INFINITY;
  let measured = 0;
  let openingTop = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < frames; frame++) {
    const extent = extentOf(cellOf(GROTESQUE_SPIDER_SCREECH_FIGURE, 'attack_screech', frame), 1);
    if (extent === null) continue;
    measured++;
    if (frame === 0) openingTop = extent.minY;
    highest = Math.min(highest, extent.minY);
  }
  failUnlessMeasured('G7', measured, 'screech frames');
  if (!Number.isFinite(idleTop) || !Number.isFinite(highest) || !Number.isFinite(openingTop)) {
    fail('G7', 'nothing to compare between the screech and the idle row');
    return;
  }
  const clearance = idleTop - highest;
  if (clearance < SCREECH_RING_CLEARANCE_PX) {
    fail(
      'G7',
      `the screech reaches only ${clearance.toFixed(0)} px above her standing silhouette, under ` +
        `the ${SCREECH_RING_CLEARANCE_PX} px that puts the wave where a player at its edge can ` +
        'see it',
    );
  }
  // The ring expands out of her rather than being there from the first frame:
  // a wave that opens at full size is a flash, and a flash is not a telegraph.
  if (openingTop <= highest) {
    fail(
      'G7',
      'the screech opens as wide as it ever gets, so the wave never reads as expanding out of her',
    );
  }
}

// ── G8 the spit glob ─────────────────────────────────────────────────────────

/** Pixels of olive slime that count as a glob rather than as a stray edge. */
const GLOB_MIN_PIXELS = 200;
const GLOB_GREEN_OVER_RED = 15;
const GLOB_GREEN_OVER_BLUE = 40;
const GLOB_MIN_GREEN = 50;
const GLOB_MIN_ALPHA = 128;

/** Slime pixels in a frame: green well clear of both other channels. */
function globPixels(def: FigureDef, state: string, frame: number): number {
  const cell = cellOf(def, state, frame);
  let count = 0;
  for (let i = 0; i < cell.data.length; i += CHANNELS) {
    if (cell.data[i + ALPHA_OFFSET] < GLOB_MIN_ALPHA) continue;
    const red = cell.data[i + RED_OFFSET];
    const green = cell.data[i + GREEN_OFFSET];
    const blue = cell.data[i + BLUE_OFFSET];
    if (green < GLOB_MIN_GREEN) continue;
    if (green - red < GLOB_GREEN_OVER_RED) continue;
    if (green - blue < GLOB_GREEN_OVER_BLUE) continue;
    count++;
  }
  return count;
}

/**
 * The glob is gathered and then thrown: absent when the row opens, unmistakable
 * before the release, and gone by the time the row closes — which is the only
 * thing that tells a player what the wind-up was for, and the frame the
 * projectile takes over from.
 */
function gateSpitGathersAndThrows(): void {
  const frames = figureFrameCount(GROTESQUE_SPIDER_SPIT_FIGURE, 'attack_spit');
  if (frames === 0) {
    fail('G8', 'the spit figure declares no attack_spit row');
    return;
  }
  const counts: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    counts.push(globPixels(GROTESQUE_SPIDER_SPIT_FIGURE, 'attack_spit', frame));
  }
  failUnlessMeasured('G8', counts.length, 'spit frames');
  const first = counts[0];
  const last = counts[frames - 1];
  const peak = Math.max(...counts);
  if (first > 0) fail('G8', `the spit row already holds ${first} px of slime on its first frame`);
  if (last > 0) fail('G8', `the spit row still holds ${last} px of slime after the release`);
  if (peak < GLOB_MIN_PIXELS) {
    fail(
      'G8',
      `the gathered glob peaks at ${peak} px of slime, under the ${GLOB_MIN_PIXELS} px that ` +
        'reads as a mouthful about to be thrown',
    );
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

// ── G11 the contact shadow stays a shadow ────────────────────────────────────

/**
 * The shadow's alpha is a computed fill, and node-canvas drops an `rgba()`
 * whose alpha is in exponent notation — baking the fill solid instead of not at
 * all. A solid contact patch under a nine-tile spider is a black slab across
 * the floor, so this samples the shadow where nothing else covers it and
 * insists it is still translucent.
 */
const SHADOW_MAX_ALPHA = 200;
const SHADOW_SAMPLE_COUNT = 24;
const SHADOW_SAMPLE_SHARE_REQUIRED = 0.25;
/** Where the shadow ellipse sits, in tiles from the figure's own tile origin. */
const SHADOW_CENTRE_X_TILES = 0.56;
const SHADOW_CENTRE_Y_TILES = 0.96;
const SHADOW_SAMPLE_RADIUS_TILES = 0.9;

function gateContactShadowIsTranslucent(): void {
  const def = GROTESQUE_SPIDER_BASE_FIGURE;
  const centreX = def.tileX + SHADOW_CENTRE_X_TILES * def.tileScale;
  const centreY = def.tileY + SHADOW_CENTRE_Y_TILES * def.tileScale;
  const radius = SHADOW_SAMPLE_RADIUS_TILES * def.tileScale;
  let translucent = 0;
  let sampled = 0;
  for (let frame = 0; frame < figureFrameCount(def, 'idle'); frame++) {
    const cell = cellOf(def, 'idle', frame);
    for (let sample = 0; sample < SHADOW_SAMPLE_COUNT; sample++) {
      const offset = (sample / (SHADOW_SAMPLE_COUNT - 1) - 0.5) * 2 * radius;
      const alpha = alphaAt(cell, Math.round(centreX + offset), Math.round(centreY));
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
    `only ${(share * 100).toFixed(0)}% of the contact shadow is translucent, under the ` +
      `${(SHADOW_SAMPLE_SHARE_REQUIRED * 100).toFixed(0)}% it takes for it to still read as a ` +
      'shadow rather than as a slab',
  );
}

// ── L3 the plinth covers its tile ────────────────────────────────────────────

/**
 * The machine's manifest entry used to declare a blocked region over its bottom
 * tile, which is what made that tile solid to walk into. The declaration is
 * gone with the manifest; what has to stay true is the thing it described — the
 * plinth fills the tile the player collides with, or they walk into an
 * invisible wall beside a machine that is not there.
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
      `${state}'s plinth fills ${(coverage * 100).toFixed(0)}% of the tile it blocks, under the ` +
        `${(PLINTH_TILE_COVERAGE * 100).toFixed(0)}% that keeps the wall and the art the same thing`,
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
 * Poses the legs are counted in.
 *
 * The choreography's own per-frame poses are private to the figure module, so
 * this gate paints the painter with poses of its own. They are not a sample of
 * a cycle: the eight legs step at mutually irrational frequencies, so no set of
 * times is "one period" and none can be assumed to catch a given leg lifted.
 * These are distinct clocks across all four painted states — the two ends and
 * the rear of the slam among them — and the claim holds at each of them
 * separately rather than depending on periodicity.
 *
 * `attack_spit` is left out on purpose: that pose translates the whole body by
 * a lean this gate would have to duplicate to predict a tip's position, and it
 * paints the same eight legs from the same two loops as every other state.
 */
const LEG_PROBE_POSES: readonly GrotesqueSpiderPose[] = [
  { time: 0, eyeTime: 0, facingX: 0, facingY: 1, state: 'idle', stateProgress: 0 },
  { time: 3.3, eyeTime: 3.3, facingX: 0, facingY: 1, state: 'idle', stateProgress: 0 },
  { time: 0, eyeTime: 0, facingX: 0, facingY: 1, state: 'walk', stateProgress: 0 },
  { time: 0.5, eyeTime: 0.5, facingX: 0, facingY: 1, state: 'walk', stateProgress: 0 },
  { time: 1.13, eyeTime: 1.13, facingX: 0, facingY: 1, state: 'walk', stateProgress: 0 },
  { time: 0.87, eyeTime: 0.87, facingX: 1, facingY: 0, state: 'walk', stateProgress: 0 },
  { time: 0, eyeTime: 0, facingX: 0, facingY: 1, state: 'attack_slam', stateProgress: 0 },
  { time: 0, eyeTime: 0, facingX: 0, facingY: 1, state: 'attack_slam', stateProgress: 0.55 },
  { time: 0, eyeTime: 0, facingX: 0, facingY: 1, state: 'attack_slam', stateProgress: 1 },
  { time: 0, eyeTime: 0, facingX: 0, facingY: 1, state: 'attack_screech', stateProgress: 0.5 },
];

/**
 * A figure that paints the boss in poses this gate chooses, at the cell
 * geometry the shipped figures use. Reusing the base figure's four numbers
 * rather than restating them keeps the probe and the ships in one coordinate
 * space, which is what lets a rig-computed tip be looked for in a painted cell.
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
    const pose = LEG_PROBE_POSES[frame];
    if (state !== LEG_PROBE_STATE || pose === undefined) return;
    drawGrotesqueSpider(
      ctx,
      GROTESQUE_SPIDER_BASE_FIGURE.tileX,
      GROTESQUE_SPIDER_BASE_FIGURE.tileY,
      GROTESQUE_SPIDER_BASE_FIGURE.tileScale,
      pose,
    );
  },
};

/**
 * How far from a rig-computed tip solid ink may sit and still count as that
 * leg's foot.
 *
 * Shipped, all eighty tips this gate walks to land *on* solid ink — the nearest
 * solid pixel is zero away from every one of them, because the foot is the end
 * of a round-capped stroke and the claws are drawn past it. The two pixels are
 * for a pose nudged by a pixel of rounding, and no more than that: the tips sit
 * about a tile and a half out from the body, and a wide search would start
 * finding a *neighbouring* leg, which is how a gate like this passes a missing
 * limb on its neighbour's ink.
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

/**
 * Walks the rig to all eight feet in every probe pose and insists there is ink
 * where each one lands.
 *
 * This is the gate that sees a missing leg, and the only one that can: a leg is
 * about two per cent of her ink, which leaves every whole-cell aggregate in
 * this module — G4's centroid, G5's clearance — green when one is skipped. It
 * asks the rig where the foot should be rather than measuring the silhouette,
 * so it fails for the leg that is gone and names it.
 */
function gateEveryLegIsPainted(): void {
  if (SPIDER_LEGS.length !== EXPECTED_LEG_COUNT) {
    fail(
      'G12',
      `the rig describes ${SPIDER_LEGS.length} legs, not the ${EXPECTED_LEG_COUNT} the spider ` +
        'is drawn with',
    );
  }
  const centreX = LEG_PROBE_FIGURE.tileX + LEG_PROBE_FIGURE.tileScale * SPIDER_BODY_CENTRE_RATIO;
  const centreY = LEG_PROBE_FIGURE.tileY + LEG_PROBE_FIGURE.tileScale * SPIDER_BODY_CENTRE_RATIO;
  let tipsChecked = 0;
  const legsSeen = new Set<number>();
  for (let frame = 0; frame < LEG_PROBE_POSES.length; frame++) {
    const pose = LEG_PROBE_POSES[frame];
    const cell = cellOf(LEG_PROBE_FIGURE, LEG_PROBE_STATE, frame);
    const walking = pose.state === 'walk';
    const movingX = walking ? pose.facingX : 0;
    const movingY = walking ? pose.facingY : 0;
    for (let index = 0; index < SPIDER_LEGS.length; index++) {
      const leg = SPIDER_LEGS[index];
      const { tx, ty } = getSpiderLegTip(
        centreX,
        centreY,
        LEG_PROBE_FIGURE.tileScale,
        leg,
        pose.time,
        pose.state,
        pose.stateProgress,
        movingX,
        movingY,
      );
      tipsChecked++;
      legsSeen.add(index);
      if (nearestSolidWithin(cell, tx, ty, LEG_TIP_SEARCH_PX) !== null) continue;
      fail(
        'G12',
        `leg ${index} of ${pose.state} at t=${pose.time} p=${pose.stateProgress} paints nothing ` +
          `within ${LEG_TIP_SEARCH_PX} px of the foot the rig puts at ` +
          `(${tx.toFixed(0)}, ${ty.toFixed(0)}) — that leg is missing from the pose`,
      );
    }
  }
  failUnlessMeasured('G12', tipsChecked, 'leg tips');
  // Distinct legs, not tips: a loop over half the rig across ten poses still
  // walks to forty feet, and would pass a count of what it looked at.
  if (legsSeen.size >= EXPECTED_LEG_COUNT) return;
  fail(
    'G12',
    `only ${legsSeen.size} of the spider's ${EXPECTED_LEG_COUNT} legs were examined at all, so ` +
      'this gate cannot claim every limb is painted',
  );
}

// ── G13 every shipped frame paints every leg ─────────────────────────────────

/**
 * The row whose leg tips cannot be predicted from the rig alone.
 *
 * The spit wind-up translates the whole body by a lean the rig's tip solver
 * knows nothing about, so a predicted foot lands a lean away from the painted
 * one. Named rather than skipped silently, and it is the only exemption: every
 * other shipped frame is measured, and the count below is what says so.
 */
const LEG_TIP_UNPREDICTABLE_STATES: ReadonlySet<string> = new Set(['attack_spit']);

/**
 * Walks the rig to all eight feet in every frame the game actually plays.
 *
 * G12 proves the *painter* draws eight legs, by handing it poses of its own.
 * That is a different claim from this one: the shipped frames come from the row
 * tables in `grotesqueSpiderFigure.ts`, and nothing in G12 reads them. A sample
 * table one entry short of its row's declared frame count hands the painter an
 * undefined time, every joint resolves to NaN, and the last frame of that row
 * paints a creature with no legs at all while G12 stays green. This gate paints
 * the shipped cells and looks for ink where the rig puts each foot.
 */
function gateShippedFramesPaintEveryLeg(): void {
  const centreX =
    GROTESQUE_SPIDER_BASE_FIGURE.tileX +
    GROTESQUE_SPIDER_BASE_FIGURE.tileScale * SPIDER_BODY_CENTRE_RATIO;
  const centreY =
    GROTESQUE_SPIDER_BASE_FIGURE.tileY +
    GROTESQUE_SPIDER_BASE_FIGURE.tileScale * SPIDER_BODY_CENTRE_RATIO;
  let tipsChecked = 0;
  let rowsChecked = 0;
  const legsSeen = new Set<number>();
  for (const def of GROTESQUE_SPIDER_FIGURES) {
    for (const [state, declared] of def.states) {
      const poseFor = GROTESQUE_SPIDER_ROW_POSES.get(state);
      if (poseFor === undefined) {
        fail(
          'G13',
          `${def.id} declares a "${state}" row that the shipped pose table has no poses for, so ` +
            'nothing can say what that row paints',
        );
        continue;
      }
      if (LEG_TIP_UNPREDICTABLE_STATES.has(state)) continue;
      rowsChecked++;
      for (let frame = 0; frame < declared.frames; frame++) {
        const pose = poseFor(frame);
        const cell = cellOf(def, state, frame);
        const walking = pose.state === 'walk';
        const movingX = walking ? pose.facingX : 0;
        const movingY = walking ? pose.facingY : 0;
        for (let index = 0; index < SPIDER_LEGS.length; index++) {
          const { tx, ty } = getSpiderLegTip(
            centreX,
            centreY,
            GROTESQUE_SPIDER_BASE_FIGURE.tileScale,
            SPIDER_LEGS[index],
            pose.time,
            pose.state,
            pose.stateProgress,
            movingX,
            movingY,
          );
          tipsChecked++;
          legsSeen.add(index);
          if (
            Number.isFinite(tx) &&
            Number.isFinite(ty) &&
            nearestSolidWithin(cell, tx, ty, LEG_TIP_SEARCH_PX) !== null
          ) {
            continue;
          }
          fail(
            'G13',
            `leg ${index} of ${def.id}.${state}[${frame}] paints nothing within ` +
              `${LEG_TIP_SEARCH_PX} px of the foot the shipped pose puts at ` +
              `(${tx.toFixed(0)}, ${ty.toFixed(0)}) — that frame's pose is not painting the leg`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G13', tipsChecked, 'leg tips in shipped frames');
  failUnlessMeasured('G13', rowsChecked, 'shipped rows');
  // Distinct legs, not tips: a loop over half the rig across every shipped
  // frame still walks to hundreds of feet, and would pass a count of them.
  if (legsSeen.size >= EXPECTED_LEG_COUNT) return;
  fail(
    'G13',
    `only ${legsSeen.size} of the spider's ${EXPECTED_LEG_COUNT} legs were examined in the ` +
      'shipped frames, so this gate cannot claim every limb is painted',
  );
}

/** Runs the spider's gates and returns one message per failure. */
export function spiderGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateRuntimeStateNames();
  gateWarmRowSize();
  gateAnchoredToItsTile();
  gateSideClearance();
  gateSlamRearsAboveTheWalk();
  gateScreechRingClearsHer();
  gateSpitGathersAndThrows();
  gateProjectileTrailsBehind();
  gatePuddleCoversItsGrab();
  gateContactShadowIsTranslucent();
  gateEveryLegIsPainted();
  gateShippedFramesPaintEveryLeg();
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
