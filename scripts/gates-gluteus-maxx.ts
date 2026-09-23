/**
 * Gluteus Maxx's art gates.
 *
 * The pose-stream gates measure the rig itself; the pixel gates measure cells
 * painted from the figure exactly the way the runtime cache bakes them, so what
 * is measured is what the game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness, `npm run render:gluteus-maxx`, or alone with
 * `npm run gates:gluteus-maxx`.
 */

import { pathToFileURL } from 'node:url';

import type { Canvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures,
  figureStructuralFailures,
  inkBoxOf,
  nothingMeasuredFailures,
  reportFigureGates,
} from './figureGates.js';
import { getMercenaryTemplate } from '../src/core/mercenaryTemplates.js';
import {
  LEG_REACH,
  MAXX_BODY_SCALE,
  SIDES,
  buildSkeleton,
  footPoints,
  pelvisPoint,
  project,
  type MaxxPose,
  type MaxxView,
  type V3,
} from '../src/sprites/art/gluteusMaxxArt.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureByteBudgetFor } from '../src/sprites/figure/figureFrameCache.js';
import {
  GLUTEUS_MAXX_FIGURE,
  GLUTEUS_MAXX_FIGURES,
  GLUTEUS_MAXX_FINISHER_FIGURE,
  MAXX_CELLS,
  MAXX_FACINGS,
  MAXX_IMPACT_FRAMES,
  MAXX_ROWS,
  MAXX_WALK_GROUND_PER_CYCLE_TILES,
  TILE_SCALE,
  WALK_STANCE_SHARE,
  cyclePhase,
  maxxFigureOfState,
  maxxFrameOf,
  maxxOrigin,
  maxxStateName,
  walkPose,
  type MaxxFacing,
  type MaxxRowBase,
} from '../src/sprites/art/gluteusMaxxFigure.js';
import {
  MAXX_CORPSE_FRAME,
  MAXX_CRUSH_FRAMES,
  MAXX_CRUSH_IMPACT_FRAME,
  MAXX_CRUSH_SEAT_REACH_TILES,
  MAXX_DEATH_FRAMES,
  MAXX_HURT_FRAMES,
  MAXX_IDLE_FRAMES,
  MAXX_JAB_FRAMES,
  MAXX_JAB_IMPACT_FRAME,
  MAXX_MAX_WALK_FRAMES_PER_TICK,
  MAXX_WALK_FRAMES,
} from '../src/sprites/gluteusMaxxTiming.js';
import {
  GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES,
  gluteusMaxxApproachWarmSet,
  gluteusMaxxFightWarmSet,
  gluteusMaxxReachableStates,
  type MaxxWarmRequest,
} from '../src/sprites/gluteusMaxxSprite.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const INK_ALPHA = 24;
/**
 * Alpha above which a pixel is the figure rather than the soft ground shadow
 * under it: an anchor gate measured on ordinary ink measures the shadow, which
 * lands on the ground line whether or not the feet do.
 */
const SOLID_ALPHA = 200;
/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
/** Floating-point slack for comparisons of solved positions, in tiles. */
const EPSILON = 1e-6;
/** Decimal places a distance in tiles is reported to: a thousandth is well under a pixel. */
const TILE_DECIMALS = 3;
/** A walk step is a tenth of a tile, so its skate is reported a place finer. */
const STEP_DECIMALS = 4;
/** The left foot's contact comes half a cycle after the right's. */
const LEFT_CONTACT_PHASE = 0.5;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(id: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(id, failure);
}

const FIGURES: readonly FigureDef[] = Object.values(GLUTEUS_MAXX_FIGURES);

/** The figure that paints a state; a state neither paints fails the gate asking. */
function figureOf(state: string): FigureDef {
  const figure = maxxFigureOfState(state);
  if (figure === null) throw new Error(`neither gluteus_maxx figure paints "${state}"`);
  return figure;
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const cellByKey = new Map<string, Canvas>();

function cellOf(state: string, frame: number): Canvas {
  const key = `${state}[${frame}]`;
  const cached = cellByKey.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(figureOf(state), state, frame);
  cellByKey.set(key, cell);
  return cell;
}

function pixelsOf(state: string, frame: number): Uint8ClampedArray {
  const cell = cellOf(state, frame);
  return cell.getContext('2d').getImageData(0, 0, cell.width, cell.height).data;
}

function alphaOf(state: string, frame: number): Uint8ClampedArray {
  const data = pixelsOf(state, frame);
  const alpha = new Uint8ClampedArray(data.length / CHANNELS);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

/** Pixels whose ink coverage differs between two frames. */
function coverageDelta(state: string, a: number, b: number): number {
  const alphaA = alphaOf(state, a);
  const alphaB = alphaOf(state, b);
  let differing = 0;
  for (let i = 0; i < alphaA.length; i++) {
    if (alphaA[i] >= INK_ALPHA !== alphaB[i] >= INK_ALPHA) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

function poseOf(state: string, frame: number): MaxxPose {
  const painted = maxxFrameOf(state, frame);
  if (painted === null) throw new Error(`gluteus_maxx paints no state "${state}"`);
  return painted.pose;
}

function framesOf(state: string): number {
  const figure = maxxFigureOfState(state);
  const declared = figure?.states.get(state);
  if (declared === undefined) {
    fail('G0', `the figure declares no state "${state}"`);
    return 0;
  }
  return declared.frames;
}

// ── G1: structure ────────────────────────────────────────────────────────────

/** Every cell paints something and nothing paints against a cell edge. */
function gateStructure(): void {
  for (const figure of FIGURES) {
    for (const failure of figureStructuralFailures(figure)) fail('G1', failure);
  }
}

// ── G2: the names the runtime asks for ───────────────────────────────────────

function gateRuntimeStateNames(): void {
  const names = gluteusMaxxReachableStates();
  for (const failure of nothingMeasuredFailures(names.length, 'reachable state names')) {
    fail('G2', failure);
  }
  // Both draw paths return silently on a state they do not paint, so a name
  // neither figure declares is an invisible hireling.
  for (const name of names) {
    if (FIGURES.some((figure) => figure.states.has(name))) continue;
    fail('G2', `gluteusMaxxReachableStates() asks for "${name}", which neither figure paints`);
  }
}

// ── G3: row lengths agree with the timing module ─────────────────────────────

const EXPECTED_FRAMES: Readonly<Record<MaxxRowBase, number>> = {
  idle: MAXX_IDLE_FRAMES,
  walk: MAXX_WALK_FRAMES,
  jab_left: MAXX_JAB_FRAMES,
  jab_right: MAXX_JAB_FRAMES,
  crush: MAXX_CRUSH_FRAMES,
  hurt: MAXX_HURT_FRAMES,
  death: MAXX_DEATH_FRAMES,
};

function gateRowLengths(): void {
  let measured = 0;
  for (const row of MAXX_ROWS) {
    for (const facing of MAXX_FACINGS) {
      const state = maxxStateName(row.base, facing);
      const frames = framesOf(state);
      measured++;
      if (frames !== EXPECTED_FRAMES[row.base]) {
        fail(
          'G3',
          `${state} paints ${frames} frames; the timing module says ${EXPECTED_FRAMES[row.base]}`,
        );
      }
    }
  }
  failUnlessMeasured('G3', measured, 'rows');
}

// ── G4: each jab is at full extension on its impact frame ────────────────────

/**
 * The punching fist is furthest along his facing on the impact frame, which
 * is the frame the kit lands the hit on: a jab whose fist is still travelling
 * when the damage lands reads as a hit from nowhere.
 */
function gateJabImpact(): void {
  let measured = 0;
  for (const base of ['jab_left', 'jab_right'] as const) {
    const side = base === 'jab_left' ? 'left' : 'right';
    const impact = MAXX_IMPACT_FRAMES.get(base);
    if (impact !== MAXX_JAB_IMPACT_FRAME) {
      fail('G4', `${base} names impact frame ${String(impact)}, not ${MAXX_JAB_IMPACT_FRAME}`);
      continue;
    }
    for (const facing of MAXX_FACINGS) {
      const state = maxxStateName(base, facing);
      const reaches = Array.from({ length: framesOf(state) }, (_unused, frame) => {
        const pose = poseOf(state, frame);
        return buildSkeleton(pose).fists[side].z - pose.pelvis.z;
      });
      measured += reaches.length;
      const furthest = reaches.indexOf(Math.max(...reaches));
      if (furthest !== impact) {
        fail(
          'G4',
          `${state}: the fist is furthest out on frame ${furthest}, but the hit lands on ${impact}`,
        );
      }
    }
  }
  failUnlessMeasured('G4', measured, 'jab frames');
}

// ── G5: the crush lands its seat on the target on its impact frame ───────────

/** How close the drawn seat has to land to where the kit expects the target. */
const SEAT_TOLERANCE_TILES = 0.08;
/**
 * Where the seat of his Speedo is on his rig: the bottom of the glutes, below
 * and behind the hip joints in his own frame, in rig tiles. The gate's own
 * anatomical estimate, read off the torso outline's lowest, rearmost point.
 */
const GLUTE_DROP = 0.06;
const GLUTE_BEHIND = 0.15;
/** Cell pixels round a point searched for solid ink. */
const INK_SEARCH_RADIUS = 4;

function seatOf(pose: MaxxPose): V3 {
  return { x: pose.pelvis.x, y: pose.pelvis.y + GLUTE_DROP, z: pose.pelvis.z - GLUTE_BEHIND };
}

/** Whether a solid pixel lies within a few cell pixels of a point given in tiles from the origin. */
function solidInkNear(state: string, frame: number, at: { x: number; y: number }): boolean {
  const figure = figureOf(state);
  const origin = maxxOrigin(
    MAXX_CELLS[figure === GLUTEUS_MAXX_FINISHER_FIGURE ? 'finisher' : 'body'],
  );
  const cx = Math.round(origin.x + at.x * TILE_SCALE);
  const cy = Math.round(origin.y + at.y * TILE_SCALE);
  const alpha = alphaOf(state, frame);
  for (let dy = -INK_SEARCH_RADIUS; dy <= INK_SEARCH_RADIUS; dy++) {
    for (let dx = -INK_SEARCH_RADIUS; dx <= INK_SEARCH_RADIUS; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= figure.frameWidth || y >= figure.frameHeight) continue;
      if (alpha[y * figure.frameWidth + x] >= SOLID_ALPHA) return true;
    }
  }
  return false;
}

/**
 * On the impact frame his hips are at their lowest in the row and the seat of
 * his Speedo is where the timing module promises the target is:
 * `MAXX_CRUSH_SEAT_REACH_TILES` along his facing. Measured in screen tiles, the
 * way the kit's target position is.
 */
function gateCrushSeat(): void {
  let measured = 0;
  const travel: Readonly<Record<MaxxFacing, { x: number; y: number }>> = {
    front: { x: 0, y: 1 },
    side: { x: 1, y: 0 },
    away: { x: 0, y: -1 },
  };
  for (const facing of MAXX_FACINGS) {
    const state = maxxStateName('crush', facing);
    const heights = Array.from({ length: framesOf(state) }, (_unused, frame) => {
      const pose = poseOf(state, frame);
      return -pose.pelvis.y;
    });
    measured += heights.length;
    const lowest = heights.indexOf(Math.min(...heights));
    if (lowest !== MAXX_CRUSH_IMPACT_FRAME) {
      fail(
        'G5',
        `${state}: his seat is lowest on frame ${lowest}, but the hit lands on ${MAXX_CRUSH_IMPACT_FRAME}`,
      );
    }
    const painted = maxxFrameOf(state, MAXX_CRUSH_IMPACT_FRAME);
    if (painted === null) {
      fail('G5', `${state} paints no impact frame`);
      continue;
    }
    const impact = painted.pose;
    const dir = travel[facing];
    // The seat is measured off the rig as painted — through the view, the
    // turn, the squash, the body scale and the travel — not re-derived from
    // the numbers the choreography used to put it there.
    const seat = onScreen(impact, painted.view, seatOf(impact));
    const reached = seat.x * dir.x + seat.y * dir.y;
    if (!solidInkNear(state, MAXX_CRUSH_IMPACT_FRAME, seat)) {
      fail('G5', `${state}: nothing solid is painted where his seat should be on the impact frame`);
    }
    if (Math.abs(reached - MAXX_CRUSH_SEAT_REACH_TILES) > SEAT_TOLERANCE_TILES) {
      fail(
        'G5',
        `${state}: the seat lands ${reached.toFixed(TILE_DECIMALS)} tiles along his facing, ` +
          `not the ${MAXX_CRUSH_SEAT_REACH_TILES} the kit aims it at`,
      );
    }
    if (impact.squash >= 1)
      fail('G5', `${state}: the impact frame does not squash him onto the seat`);
    const last = poseOf(state, framesOf(state) - 1);
    if (Math.hypot(last.offset.x, last.offset.y) > EPSILON) {
      fail(
        'G5',
        `${state}: the routine ends ${Math.hypot(last.offset.x, last.offset.y).toFixed(TILE_DECIMALS)} tiles from where he stands`,
      );
    }
  }
  failUnlessMeasured('G5', measured, 'crush frames');
}

// ── G6: no leg is asked to reach past its length ─────────────────────────────

/**
 * The hip-to-ankle distance each pose asks for, on every frame of every row,
 * against the leg's own length. The IK clamps an over-long demand, so the
 * solved chain always looks legal — this measures the demand, not the answer,
 * and a clamped planted foot is one that hangs off the floor.
 */
function gateLegReach(): void {
  let measured = 0;
  let worst = 0;
  for (const [state, declared] of FIGURES.flatMap((figure) => [...figure.states])) {
    for (let frame = 0; frame < declared.frames; frame++) {
      const pose = poseOf(state, frame);
      const skel = buildSkeleton(pose);
      for (const side of SIDES) {
        const ankle = footPoints(pose.legs[side]).ankle;
        const hip = skel.hips[side];
        const demand = Math.hypot(ankle.x - hip.x, ankle.y - hip.y, ankle.z - hip.z);
        measured++;
        worst = Math.max(worst, demand / LEG_REACH);
        if (demand > LEG_REACH + EPSILON) {
          fail(
            'G6',
            `${state}[${frame}] asks his ${side} leg to reach ${demand.toFixed(TILE_DECIMALS)} of ${LEG_REACH.toFixed(TILE_DECIMALS)}`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G6', measured, 'legs');
}

// ── G7: a planted walk foot holds still on the floor ─────────────────────────

/**
 * Between two frames where a foot is planted it slides back through the cell
 * by exactly the ground the sprite is carried in a frame — so it holds still
 * against the floor. Any other rate is a foot skating.
 */
function gateWalkFootSlide(): void {
  let measured = 0;
  const perFrame = MAXX_WALK_GROUND_PER_CYCLE_TILES / MAXX_WALK_FRAMES;
  for (let frame = 0; frame < MAXX_WALK_FRAMES; frame++) {
    const now = walkPose(cyclePhase(frame, MAXX_WALK_FRAMES));
    const next = walkPose(cyclePhase(frame + 1, MAXX_WALK_FRAMES));
    for (const side of SIDES) {
      const a = now.legs[side].ball;
      const b = next.legs[side].ball;
      if (Math.abs(a.y) > EPSILON || Math.abs(b.y) > EPSILON) continue;
      // A step from the stance into the swing is not a planted pair.
      if (b.z > a.z) continue;
      measured++;
      const slid = (a.z - b.z) * MAXX_BODY_SCALE;
      if (Math.abs(slid - perFrame) > EPSILON) {
        fail(
          'G7',
          `walk[${frame}→${frame + 1}] slides his planted ${side} foot ${slid.toFixed(STEP_DECIMALS)}, not ${perFrame.toFixed(STEP_DECIMALS)}`,
        );
      }
    }
  }
  failUnlessMeasured('G7', measured, 'planted walk foot pairs');
}

// ── G8: the arms swing in phase with the legs ────────────────────────────────

/**
 * At each foot's contact its own arm is furthest back. A sine driver puts the
 * arms neutral at contact and peaking at mid-stance, which reads as a shuffle
 * while every limb moves correctly; this asserts the phase rather than trusting
 * it.
 */
function gateArmPhase(): void {
  let measured = 0;
  for (const side of SIDES) {
    const contactPhase = side === 'right' ? 0 : LEFT_CONTACT_PHASE;
    const swings = Array.from({ length: MAXX_WALK_FRAMES }, (_unused, frame) => {
      const arm = walkPose(cyclePhase(frame, MAXX_WALK_FRAMES)).arms[side];
      return arm.kind === 'angles' ? arm.upperSwing : Number.NaN;
    });
    if (swings.some(Number.isNaN)) {
      fail('G8', `the walk poses his ${side} arm by a hand target, so its swing cannot be read`);
      continue;
    }
    measured++;
    const contactFrame = Math.round(contactPhase * MAXX_WALK_FRAMES);
    const backmost = swings.indexOf(Math.min(...swings));
    if (backmost !== contactFrame) {
      fail(
        'G8',
        `his ${side} arm is furthest back on walk[${backmost}], not at its foot's contact on walk[${contactFrame}]`,
      );
    }
  }
  failUnlessMeasured('G8', measured, 'arms');
}

// ── G9: the walk cadence can be played at his speed ──────────────────────────

/** Game ticks per second, for the cadence gate's message. */
const TICKS_PER_SECOND = 60;

/**
 * At his hired speed, how many walk frames go by per game tick when the phase
 * is advanced by ground covered. Past `MAXX_MAX_WALK_FRAMES_PER_TICK` the row
 * is undersampled rather than played and the legs strobe. Read from the
 * template, so a retuned speed is re-checked here.
 */
function gateCadence(): void {
  const speed = getMercenaryTemplate('gluteus_maxx').speed;
  const groundPx = MAXX_WALK_GROUND_PER_CYCLE_TILES * IN_GAME_TILE;
  const framesPerTick = (speed / groundPx) * MAXX_WALK_FRAMES;
  if (framesPerTick > MAXX_MAX_WALK_FRAMES_PER_TICK) {
    fail(
      'G9',
      `at speed ${speed} px/tick the walk plays ${framesPerTick.toFixed(2)} frames a tick ` +
        `(${((speed * TICKS_PER_SECOND) / groundPx).toFixed(1)} cycles a second) — undersampled`,
    );
  }
}

// ── G10: loops close, in a band ──────────────────────────────────────────────

/**
 * The wrap from a loop's last frame to its first moves about as much as any
 * other step of the loop: not a jump (the cycle is not closing), and not
 * nothing (the last frame repeats the first and the loop holds still for a
 * frame). Measured against the median step.
 */
const SEAM_MIN_SHARE = 0.35;
const SEAM_MAX_SHARE = 1.8;

function gateLoopSeams(): void {
  let measured = 0;
  for (const row of MAXX_ROWS) {
    if (row.kind !== 'loop') continue;
    for (const facing of MAXX_FACINGS) {
      const state = maxxStateName(row.base, facing);
      const frames = framesOf(state);
      if (frames < 2) continue;
      const steps = Array.from({ length: frames - 1 }, (_unused, frame) =>
        coverageDelta(state, frame, frame + 1),
      );
      const seam = coverageDelta(state, frames - 1, 0);
      const typical = median(steps);
      measured++;
      if (typical === 0) {
        fail('G10', `${state} does not move at all`);
        continue;
      }
      const share = seam / typical;
      if (share < SEAM_MIN_SHARE || share > SEAM_MAX_SHARE) {
        fail(
          'G10',
          `${state}: the wrap step is ${share.toFixed(2)}× the median step, outside [${SEAM_MIN_SHARE}, ${SEAM_MAX_SHARE}]`,
        );
      }
    }
  }
  failUnlessMeasured('G10', measured, 'loop rows');
}

// ── G11: every frame is its own picture ──────────────────────────────────────

function gateDistinctFrames(): void {
  for (const figure of FIGURES) {
    const report = distinctFrameFailures(figure, pixelsOf, {
      // A jab is authored to end on the guard it began from, so the hand back to
      // the idle is not a snap.
      repeatsOnPurpose: (state, earlier, later) =>
        state.startsWith('jab_') && earlier === 0 && later === MAXX_JAB_FRAMES - 1,
    });
    for (const failure of report.failures) fail('G11', failure);
    failUnlessMeasured('G11', report.framesMeasured, 'frames');
  }
}

// ── G12: the Meat Shields armband shows in every view ────────────────────────

const ARMBAND_RGB = { r: 0xe0, g: 0x60, b: 0x40 };
/**
 * How far a pixel's channels may sit from the armband's and still count as
 * it. Tight, because his lit skin is a warm orange too: at a looser slack the
 * tan of a shoulder answers for a missing band.
 */
const ARMBAND_CHANNEL_SLACK = 20;
/** The band is far redder than it is green; skin, however lit, is not. */
const ARMBAND_MIN_RED_OVER_GREEN = 100;
/**
 * Pixels of armband a standing frame must show. At the bake's 64 px tile the
 * band is roughly a 5×4 patch; below this it is two or three pixels, which is
 * noise at the 32 px tile rather than a badge.
 */
const MIN_ARMBAND_PIXELS = 10;

/**
 * The armband is the one thing that says "yours" on a hireling, so it has to
 * be visible, standing and walking, from every side he can be seen.
 */
function gateArmband(): void {
  let measured = 0;
  for (const base of ['idle', 'walk'] as const) {
    for (const facing of MAXX_FACINGS) {
      const state = maxxStateName(base, facing);
      for (let frame = 0; frame < framesOf(state); frame++) {
        const data = pixelsOf(state, frame);
        let count = 0;
        for (let i = 0; i < data.length; i += CHANNELS) {
          if (data[i + ALPHA_OFFSET] < SOLID_ALPHA) continue;
          const near =
            Math.abs(data[i] - ARMBAND_RGB.r) <= ARMBAND_CHANNEL_SLACK &&
            Math.abs(data[i + 1] - ARMBAND_RGB.g) <= ARMBAND_CHANNEL_SLACK &&
            Math.abs(data[i + 2] - ARMBAND_RGB.b) <= ARMBAND_CHANNEL_SLACK &&
            data[i] - data[i + 1] >= ARMBAND_MIN_RED_OVER_GREEN;
          if (near) count++;
        }
        measured++;
        if (count < MIN_ARMBAND_PIXELS) {
          fail(
            'G12',
            `${state}[${frame}] shows ${count} pixels of armband, under ${MIN_ARMBAND_PIXELS}`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G12', measured, 'standing and walking frames');
}

/** Whether either foot is in its stance on a walk frame, by the cycle's timing. */
function walkFootDown(frame: number): boolean {
  const phase = cyclePhase(frame, MAXX_WALK_FRAMES);
  const leftPhase = (phase + LEFT_CONTACT_PHASE) % 1;
  return phase < WALK_STANCE_SHARE || leftPhase < WALK_STANCE_SHARE;
}

// ── G13: he stands on the ground line ────────────────────────────────────────

/**
 * Rows of slack either way. The one-pixel silhouette line is ink under the
 * sole, and the near foot is drawn a little nearer the camera — lower on the
 * screen — than the ground line his tile is anchored by.
 */
const GROUND_SLACK_ROWS = 3;

/**
 * His lowest solid pixel on every standing and walking frame with a foot down
 * sits on the ground line the tile promises — measured on solid alpha, so the
 * contact shadow cannot answer for the feet.
 */
function gateGroundLine(): void {
  const groundRow = maxxOrigin(MAXX_CELLS.body).y;
  let measured = 0;
  for (const state of (['idle', 'walk'] as const).flatMap((base) =>
    MAXX_FACINGS.map((facing) => maxxStateName(base, facing)),
  )) {
    for (let frame = 0; frame < framesOf(state); frame++) {
      // A walk frame in its flight has no foot to stand on. Which frames those
      // are comes from the cycle's timing, never from where the pose put the
      // feet — a foot lifted by mistake must fail here, not be excused.
      if (state.startsWith('walk') && !walkFootDown(frame)) continue;
      const alpha = alphaOf(state, frame);
      const width = figureOf(state).frameWidth;
      let lowest = -1;
      for (let i = 0; i < alpha.length; i++) {
        if (alpha[i] >= SOLID_ALPHA) lowest = Math.max(lowest, Math.floor(i / width));
      }
      measured++;
      if (lowest < 0) {
        fail('G13', `${state}[${frame}] paints nothing solid`);
        continue;
      }
      if (Math.abs(lowest + 1 - groundRow) > GROUND_SLACK_ROWS) {
        fail(
          'G13',
          `${state}[${frame}]: his soles end on row ${lowest + 1}, the ground line is row ${groundRow}`,
        );
      }
    }
  }
  failUnlessMeasured('G13', measured, 'standing and walking frames with a foot down');
}

// ── G14: the frozen head clearance still matches the art ─────────────────────

/** How far under the frozen clearance the measured top may sit before it is stale. */
const HEAD_CLEARANCE_SLACK_TILES = 0.04;

/**
 * `GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES` is where a health bar clears his hair.
 * Nothing can measure ink at runtime, so it is frozen; this re-measures the
 * tallest standing and walking frame and fails when the two part company in
 * either direction.
 */
function gateHeadClearance(): void {
  let top = Number.POSITIVE_INFINITY;
  let measured = 0;
  for (const base of ['idle', 'walk'] as const) {
    for (const facing of MAXX_FACINGS) {
      const state = maxxStateName(base, facing);
      for (let frame = 0; frame < framesOf(state); frame++) {
        const box = inkBoxOf(figureOf(state), state, frame);
        if (box === null) continue;
        measured++;
        top = Math.min(top, box.minY);
      }
    }
  }
  failUnlessMeasured('G14', measured, 'standing frames');
  if (measured === 0) return;
  const aboveTile = (GLUTEUS_MAXX_FIGURE.tileY - top) / TILE_SCALE;
  if (aboveTile > GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES) {
    fail(
      'G14',
      `his hair reaches ${aboveTile.toFixed(TILE_DECIMALS)} tiles above his tile, past the frozen ${GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES}`,
    );
  }
  if (aboveTile < GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES - HEAD_CLEARANCE_SLACK_TILES) {
    fail(
      'G14',
      `his hair tops out ${aboveTile.toFixed(TILE_DECIMALS)} tiles above his tile; the frozen ${GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES} is stale`,
    );
  }
}

// ── G15: the death row ends on a corpse ──────────────────────────────────────

/** How far the head may sit above or below the hips on a body lying flat, in tiles. */
const LYING_LEVEL_TOLERANCE = 0.15;

/** Where a figure-space point lands in the cell's tiles, through `drawMaxx`'s own transform. */
function onScreen(pose: MaxxPose, view: MaxxView, p: V3): { x: number; y: number } {
  const flat = project(p, view);
  const x = (pose.mirrored ? -flat.x : flat.x) - pose.rollPivot.x;
  const y = flat.y * pose.squash - pose.rollPivot.y;
  const c = Math.cos(pose.screenRoll);
  const s = Math.sin(pose.screenRoll);
  const k = MAXX_BODY_SCALE;
  return {
    x: pose.offset.x + k * (pose.rollPivot.x + x * c - y * s),
    y: pose.offset.y + k * (pose.rollPivot.y + x * s + y * c),
  };
}

/**
 * The last death frame is the one the corpse is held on while it fades: he
 * is lying flat (his head level with his hips, not above them) in every view,
 * and his body stays over his own tile so the fading corpse is where he fell.
 */
function gateCorpse(): void {
  let measured = 0;
  for (const facing of MAXX_FACINGS) {
    const state = maxxStateName('death', facing);
    if (framesOf(state) - 1 !== MAXX_CORPSE_FRAME) {
      fail(
        'G15',
        `${state} ends on frame ${framesOf(state) - 1}, not the corpse frame ${MAXX_CORPSE_FRAME}`,
      );
    }
    const painted = maxxFrameOf(state, MAXX_CORPSE_FRAME);
    const box = inkBoxOf(figureOf(state), state, MAXX_CORPSE_FRAME);
    if (painted === null || box === null) {
      fail('G15', `${state}'s corpse frame paints nothing`);
      continue;
    }
    measured++;
    const skel = buildSkeleton(painted.pose);
    const head = onScreen(painted.pose, painted.view, skel.head);
    const hips = onScreen(painted.pose, painted.view, skel.pelvis);
    if (Math.abs(head.y - hips.y) > LYING_LEVEL_TOLERANCE) {
      fail(
        'G15',
        `${state}'s corpse has his head ${(hips.y - head.y).toFixed(2)} tiles above his hips: he is not lying down`,
      );
    }
    const centre = (box.minX + box.maxX) / 2;
    if (Math.abs(centre - maxxOrigin(MAXX_CELLS.finisher).x) > TILE_SCALE / 2) {
      fail(
        'G15',
        `${state}'s corpse is centred ${((centre - maxxOrigin(MAXX_CELLS.finisher).x) / TILE_SCALE).toFixed(2)} tiles off his tile`,
      );
    }
  }
  failUnlessMeasured('G15', measured, 'corpse frames');
}

// ── G16: warm-row memory ─────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MEGABYTE_DECIMALS = 2;
/**
 * The cache holds a cell at its declared size times the bake scale, which is
 * 1 everywhere but on a low-end device; the full-size cell is the one that has
 * to fit.
 */
const FULL_BAKE_SCALE = 1;
/**
 * A runaway stop on one warm row. The widest shipped row is the finisher's
 * crush, sixteen of the big cells at about 2 MB; this is the rock golem's
 * ceiling, and it takes the crush growing half again or the finisher cell
 * growing by a third each way before it says anything.
 */
const ROW_BUDGET_MEGABYTES = 3;

function cellBytes(figure: FigureDef): number {
  return (
    figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL * FULL_BAKE_SCALE * FULL_BAKE_SCALE
  );
}

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS);
}

/**
 * The rows that are warm together must fit each figure's own budget. Once he
 * has been hired and has fought, everything both prewarms ask for is resident
 * at once — walking, standing and the jab wind-ups, then the flinch, the fall
 * and the finisher — and those are read from the sprite module's own warm
 * sets, so a row added to a prewarm is a row counted here. Every row is also
 * held under a per-row ceiling.
 */
function gateWarmRowSize(): void {
  const requests: readonly MaxxWarmRequest[] = [
    ...gluteusMaxxApproachWarmSet(),
    ...gluteusMaxxFightWarmSet(),
  ];
  failUnlessMeasured('G16', requests.length, 'prewarm requests');
  let rowsMeasured = 0;
  for (const figure of FIGURES) {
    let warmFrames = 0;
    for (const request of requests) {
      if (request.figure !== figure) continue;
      const declared = figure.states.get(request.state)?.frames ?? 0;
      warmFrames += Math.min(declared, request.frames ?? declared);
    }
    const warmBytes = warmFrames * cellBytes(figure);
    const budget = figureByteBudgetFor(figure);
    console.log(
      `  G16 warm set: ${figure.id} holds ${warmFrames} cells, ${megabytes(warmBytes)} MB of its ` +
        `${megabytes(budget)} MB budget`,
    );
    if (warmBytes > budget) {
      fail(
        'G16',
        `${figure.id}'s warm rows come to ${megabytes(warmBytes)} MB, past its ${megabytes(budget)} MB budget`,
      );
    }
    for (const [state, declared] of figure.states) {
      rowsMeasured++;
      const rowBytes = declared.frames * cellBytes(figure);
      if (rowBytes / BYTES_PER_MEGABYTE <= ROW_BUDGET_MEGABYTES) continue;
      fail(
        'G16',
        `${figure.id}.${state} warms to ${megabytes(rowBytes)} MB against a ${ROW_BUDGET_MEGABYTES} MB row budget`,
      );
    }
  }
  failUnlessMeasured('G16', rowsMeasured, 'declared rows');
}

// ── G17: the Speedo covers him ───────────────────────────────────────────────

/**
 * Points on his pelvis that the Speedo must cover in each view, in the
 * pelvis's own frame (x his right, y down, z the way his hips face), read
 * off the garment's cut: head-on the crotch and both hips; from behind both
 * cheeks of the seat; edge-on the seat, the underside of the seat, the side
 * strip over the hip and the front panel.
 */
const GARMENT_SAMPLES: Readonly<Record<MaxxView, readonly V3[]>> = {
  front: [
    { x: 0, y: 0.04, z: 0 },
    { x: 0.1, y: -0.03, z: 0 },
    { x: -0.1, y: -0.03, z: 0 },
  ],
  back: [
    { x: 0.085, y: 0.04, z: -0.1 },
    { x: -0.085, y: 0.04, z: -0.1 },
    { x: 0, y: -0.04, z: -0.1 },
  ],
  side: [
    { x: 0, y: 0.03, z: -0.12 },
    { x: 0, y: -0.04, z: 0 },
    { x: 0, y: -0.04, z: -0.08 },
    { x: 0, y: 0.07, z: -0.09 },
    { x: 0, y: 0.02, z: 0.08 },
  ],
};
/** Cell pixels either side of a sample point that are read with it. */
const GARMENT_SAMPLE_RADIUS = 1;
/**
 * Skin pixels allowed round any one sample: antialiasing where the garment's
 * edge meets bare skin can put a pixel or two of tan in the neighbourhood of a
 * point near the edge; more than that is bare skin inside the garment.
 */
const MAX_SKIN_PIXELS_PER_SAMPLE = 2;
/**
 * Speedo pixels the clearest frame of every row must show. Per row, not per
 * frame: a gauntlet swung across his hips, or an arm lying along a fallen
 * body, hides most of the garment for a frame or two, and that is fine. A
 * row whose best frame shows less than this has a garment shrunk to a
 * sliver. The smallest shipped is the head-on walk at about 110 — the
 * garment is a narrow brief seen from the front — so this sits a quarter
 * under it.
 */
const MIN_SPEEDO_PIXELS = 80;
/** How far above red and green a pixel's blue must be to count as the Speedo. */
const SPEEDO_BLUE_MARGIN = 40;
/** How far above blue a pixel's red must be to count as skin. */
const SKIN_RED_MARGIN = 60;

function isSkin(data: Uint8ClampedArray, i: number): boolean {
  const red = data[i];
  const green = data[i + 1];
  const blue = data[i + 2];
  return red > green && green > blue && red - blue >= SKIN_RED_MARGIN;
}

function isSpeedo(data: Uint8ClampedArray, i: number): boolean {
  const blue = data[i + 2];
  return blue - data[i] >= SPEEDO_BLUE_MARGIN && blue - data[i + 1] >= SPEEDO_BLUE_MARGIN;
}

/**
 * On every frame of every row and view, the parts of him the garment is for
 * are covered by it: no skin shows at the crotch, hip or seat points of the
 * rig, projected through the frame's own draw transform (turns, hops, squash
 * and falls included), and the Speedo itself shows at a real size. Skin is
 * what fails; steel is not, because a gauntlet swung in front of his hips
 * legitimately hides the garment.
 */
function gateSpeedoCoverage(): void {
  let samplesMeasured = 0;
  for (const figure of FIGURES) {
    for (const [state, declared] of figure.states) {
      let clearest = 0;
      for (let frame = 0; frame < declared.frames; frame++) {
        const painted = maxxFrameOf(state, frame);
        if (painted === null) continue;
        const data = pixelsOf(state, frame);
        const width = figure.frameWidth;
        let speedoPixels = 0;
        for (let i = 0; i < data.length; i += CHANNELS) {
          if (data[i + ALPHA_OFFSET] >= SOLID_ALPHA && isSpeedo(data, i)) speedoPixels++;
        }
        clearest = Math.max(clearest, speedoPixels);
        const origin = maxxOrigin(
          MAXX_CELLS[figure === GLUTEUS_MAXX_FINISHER_FIGURE ? 'finisher' : 'body'],
        );
        for (const local of GARMENT_SAMPLES[painted.view]) {
          const at = onScreen(painted.pose, painted.view, pelvisPoint(painted.pose, local));
          const cx = Math.round(origin.x + at.x * TILE_SCALE);
          const cy = Math.round(origin.y + at.y * TILE_SCALE);
          let skin = 0;
          for (let dy = -GARMENT_SAMPLE_RADIUS; dy <= GARMENT_SAMPLE_RADIUS; dy++) {
            for (let dx = -GARMENT_SAMPLE_RADIUS; dx <= GARMENT_SAMPLE_RADIUS; dx++) {
              const x = cx + dx;
              const y = cy + dy;
              if (x < 0 || y < 0 || x >= width || y >= figure.frameHeight) continue;
              const i = (y * width + x) * CHANNELS;
              if (data[i + ALPHA_OFFSET] >= SOLID_ALPHA && isSkin(data, i)) skin++;
            }
          }
          samplesMeasured++;
          if (skin > MAX_SKIN_PIXELS_PER_SAMPLE) {
            fail(
              'G17',
              `${state}[${frame}]: bare skin where the Speedo should be, at pelvis point ` +
                `(${local.x}, ${local.y}, ${local.z}) — ${skin} skin pixels`,
            );
          }
        }
      }
      if (clearest < MIN_SPEEDO_PIXELS) {
        fail(
          'G17',
          `${state}'s clearest frame shows ${clearest} pixels of Speedo, under ${MIN_SPEEDO_PIXELS}`,
        );
      }
    }
  }
  failUnlessMeasured('G17', samplesMeasured, 'garment samples');
}

/** Runs every gate and returns one message per failure. */
export function gluteusMaxxGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateRuntimeStateNames();
  gateRowLengths();
  gateJabImpact();
  gateCrushSeat();
  gateLegReach();
  gateWalkFootSlide();
  gateArmPhase();
  gateCadence();
  gateLoopSeams();
  gateDistinctFrames();
  gateArmband();
  gateGroundLine();
  gateHeadClearance();
  gateCorpse();
  gateWarmRowSize();
  gateSpeedoCoverage();
  return [...failures];
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  console.log('Gating Gluteus Maxx…');
  reportFigureGates('gluteus maxx', gluteusMaxxGateFailures());
}
