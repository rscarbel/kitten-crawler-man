#!/usr/bin/env tsx
/**
 * Motion gates for the town casts: the skyfowl's walk and run holding its feet
 * still on the floor at the speeds the game actually moves them, and the
 * Desperado Club's dance rows (both casts) moving like dancing rather than
 * swaying on the spot.
 *
 *   M1  foot-lock: at every speed a citizen, a club patron or the fightable
 *       fowl travels, a planted foot moves less than a pixel over the floor
 *       from one frame of the row to the next, and barely more over its whole
 *       stance — measured the way the runtime
 *       paces the row (distance covered over the look's own cycle length,
 *       capped at a frame a tick), in profile, where a skate is plainest
 *   M2  cadence: a real citizen's walk turns by the ground it covered, and
 *       never more than one row frame a tick under a shove
 *   M3  dance energy: every dance row raises a limb clearly over the head,
 *       moves its top edge and its width by a floor, and loops without a seam
 *       larger than its own largest in-row step
 *   M4  dance rows stay inside their cells (the human dancer is outside the
 *       human cast's own structural gate, so it is checked here)
 *
 * Run by `npm run render:cast-motion`, or alone: `npm run gates:cast-motion`.
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { gaitCyclesForDistance } from '../src/sprites/gaitCadence.js';
import {
  RUN_FRAMES,
  SKYFOWL_CAST_SCALE,
  WALK_FRAMES,
  castRow,
  skyfowlCastFigure,
  skyfowlRunCyclePx,
  skyfowlWalkCyclePx,
} from '../src/sprites/art/skyfowlCastFigure.js';
import {
  SKYFOWL_CIVILIAN_LOOKS,
  SKYFOWL_LOOKS,
  SKYFOWL_TOUGH_LOOKS,
  type SkyfowlLook,
} from '../src/sprites/art/skyfowl/cast.js';
import { SKYFOWL_BUILDS } from '../src/sprites/art/skyfowl/palette.js';
import { probeSkyfowlFeet } from '../src/sprites/art/skyfowl/rig.js';
import {
  CONTRALATERAL_PHASE,
  SKYFOWL_RUN,
  SKYFOWL_WALK,
  footPlanted,
} from '../src/sprites/art/skyfowl/gait.js';
import { SKYFOWL_MOB_TRAVEL_SPEEDS, skyfowlMobRunsAt } from '../src/creatures/SkyFowl.js';
import { citizenWalkCyclePx, citizenWalkFrames } from '../src/creatures/citizenFigure.js';
import { Townsperson } from '../src/creatures/Townsperson.js';
import { DANCE_STYLES, danceStateName } from '../src/sprites/art/danceStyles.js';
import { townCastOutfitFigure } from '../src/sprites/art/townCastFigure.js';
import { clubDancerLook } from '../src/sprites/person/clubCastLooks.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { figureStructuralFailures, nothingMeasuredFailures } from './figureGates.js';
import { paintFigureCell } from './figureSheet.js';

let failures: string[] = [];
/** `--report` prints every dance row's measured energy, for re-deriving the floors. */
const REPORT = process.argv.includes('--report');

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── M1 foot-lock ─────────────────────────────────────────────────────────────

/**
 * World pixels per tick the town moves its walkers at: the street crowd's
 * slowest anchored stroller up to its fastest traveller, which also brackets
 * the club's patrons. Swept in steps, not read off the systems, because the
 * row has to hold at every speed in between as well.
 */
const CITIZEN_SPEED_MIN = 0.2;
const CITIZEN_SPEED_MAX = 1.0;
const CITIZEN_SPEED_STEP = 0.1;
/**
 * Children never walk the road — the traveller cohort's roles leave them out —
 * so a fledgling's fastest is the plaza stroller's, not the traveller's.
 */
const FLEDGLING_SPEED_MAX = 0.9;
/** Ticks simulated per speed: several full cycles at the slowest speed. */
const SIMULATED_TICKS = 1200;
/**
 * The most a planted foot may travel over the floor between two frames of the
 * row, in world pixels at the 32px tile. Under a pixel is under what the
 * screen can show; a skate is several.
 */
const MAX_FOOT_SLIP_PX = 0.75;
/**
 * The most a planted foot may travel over one whole stance. A small per-frame
 * creep summed over ten planted frames is a skate the eye catches even when
 * no single frame does.
 */
const MAX_STANCE_DRIFT_PX = 1.5;
/** Where in a frame's span of the cycle it is shown centred. */
const FRAME_CENTRE = 0.5;

interface GaitCase {
  readonly label: string;
  readonly look: SkyfowlLook;
  readonly state: string;
  readonly frames: number;
  readonly cyclePx: number;
  readonly pxPerTick: number;
  readonly planted: (phase: number) => boolean;
}

/** World px per figure unit for a look at the 32px tile. */
function unitPx(look: SkyfowlLook): number {
  return TILE_SIZE * SKYFOWL_CAST_SCALE * SKYFOWL_BUILDS[look.outfit.build].scale;
}

/**
 * Plays a row the way the runtime does — the phase turned by the ground
 * covered each tick, capped at a frame a tick — and measures where each
 * planted foot is in the world at the middle of every frame it is shown on.
 * Returns the worst frame-to-frame travel of a planted foot, the worst travel
 * over one whole stance, and how many steps were measured.
 */
function worstSlip(gait: GaitCase): { slip: number; drift: number; steps: number } {
  const row = castRow(gait.look.id, gait.state);
  if (row === undefined) return { slip: Infinity, drift: Infinity, steps: 0 };
  // The world x the sprite stood at when each frame was centred on screen.
  const centreX = new Map<number, number>();
  let phase = 0;
  let x = 0;
  for (let tick = 0; tick < SIMULATED_TICKS; tick++) {
    const turn = gaitCyclesForDistance(gait.pxPerTick, gait.cyclePx, gait.frames);
    const nextPhase = phase + turn;
    const nextX = x + gait.pxPerTick;
    const firstFrame = Math.ceil(phase * gait.frames - FRAME_CENTRE);
    const lastFrame = Math.floor(nextPhase * gait.frames - FRAME_CENTRE);
    for (let k = firstFrame; k <= lastFrame; k++) {
      const centre = (k + FRAME_CENTRE) / gait.frames;
      const share = turn > 0 ? (centre - phase) / turn : 0;
      centreX.set(k, x + share * gait.pxPerTick);
    }
    phase = nextPhase;
    x = nextX;
  }
  let slip = 0;
  let drift = 0;
  let steps = 0;
  const stance = new Map<'near' | 'far', { low: number; high: number }>();
  const frames = [...centreX.keys()].sort((a, b) => a - b);
  for (const k of frames) {
    const next = centreX.get(k + 1);
    const here = centreX.get(k);
    if (next === undefined || here === undefined) continue;
    const frameHere = k % gait.frames;
    const frameNext = (k + 1) % gait.frames;
    const feetHere = probeSkyfowlFeet('side', row.pose(frameHere), gait.look.outfit.build);
    const feetNext = probeSkyfowlFeet('side', row.pose(frameNext), gait.look.outfit.build);
    const phaseHere = frameHere / gait.frames;
    const phaseNext = frameNext / gait.frames;
    for (const [foot, offset] of [
      ['near', 0],
      ['far', CONTRALATERAL_PHASE],
    ] as const) {
      if (!gait.planted(phaseHere + offset) || !gait.planted(phaseNext + offset)) {
        stance.delete(foot);
        continue;
      }
      const worldHere = here + feetHere[foot].x * unitPx(gait.look);
      const worldNext = next + feetNext[foot].x * unitPx(gait.look);
      slip = Math.max(slip, Math.abs(worldNext - worldHere));
      const span = stance.get(foot) ?? { low: worldHere, high: worldHere };
      const low = Math.min(span.low, worldHere, worldNext);
      const high = Math.max(span.high, worldHere, worldNext);
      stance.set(foot, { low, high });
      drift = Math.max(drift, high - low);
      steps++;
    }
  }
  return { slip, drift, steps };
}

function gaitCases(): GaitCase[] {
  const cases: GaitCase[] = [];
  const speedSteps = Math.round((CITIZEN_SPEED_MAX - CITIZEN_SPEED_MIN) / CITIZEN_SPEED_STEP);
  for (const look of SKYFOWL_CIVILIAN_LOOKS) {
    const figure = { species: 'skyfowl', look } as const;
    const fastest = look.outfit.build === 'fledgling' ? FLEDGLING_SPEED_MAX : CITIZEN_SPEED_MAX;
    for (let i = 0; i <= speedSteps; i++) {
      const pxPerTick = CITIZEN_SPEED_MIN + i * CITIZEN_SPEED_STEP;
      if (pxPerTick > fastest + PHASE_EPSILON) continue;
      cases.push({
        label: `${look.id} citizen walk at ${pxPerTick.toFixed(2)}px/tick`,
        look,
        state: 'walk_side',
        frames: citizenWalkFrames(figure),
        cyclePx: citizenWalkCyclePx(figure, TILE_SIZE),
        pxPerTick,
        planted: (phase) => footPlanted(SKYFOWL_WALK, phase),
      });
    }
  }
  for (const look of SKYFOWL_TOUGH_LOOKS) {
    for (const { pxPerTick } of SKYFOWL_MOB_TRAVEL_SPEEDS) {
      const runs = skyfowlMobRunsAt(pxPerTick / TILE_SIZE);
      cases.push({
        label: `${look.id} mob ${runs ? 'run' : 'walk'} at ${pxPerTick.toFixed(2)}px/tick`,
        look,
        state: runs ? 'run_side' : 'walk_side',
        frames: runs ? RUN_FRAMES : WALK_FRAMES,
        cyclePx: runs
          ? skyfowlRunCyclePx(look.id, TILE_SIZE)
          : skyfowlWalkCyclePx(look.id, TILE_SIZE),
        pxPerTick,
        planted: (phase) => footPlanted(runs ? SKYFOWL_RUN : SKYFOWL_WALK, phase),
      });
    }
  }
  return cases;
}

function gateFootLock(): void {
  let measured = 0;
  for (const gait of gaitCases()) {
    const { slip, drift, steps } = worstSlip(gait);
    measured += steps;
    if (steps === 0) {
      fail('M1', `${gait.label}: no planted foot was measured across two frames`);
      continue;
    }
    if (slip > MAX_FOOT_SLIP_PX) {
      fail(
        'M1',
        `${gait.label}: a planted foot slides ${slip.toFixed(2)}px over the floor between two ` +
          `frames (limit ${MAX_FOOT_SLIP_PX}px) — the stride and the cadence disagree`,
      );
    }
    if (drift > MAX_STANCE_DRIFT_PX) {
      fail(
        'M1',
        `${gait.label}: a planted foot skates ${drift.toFixed(2)}px over one stance ` +
          `(limit ${MAX_STANCE_DRIFT_PX}px)`,
      );
    }
  }
  failUnlessMeasured('M1', measured, 'planted-foot frame steps');
}

// ── M2 cadence ───────────────────────────────────────────────────────────────

/** A shove: far more ground in a tick than any walker covers, as a separation push can. */
const SHOVE_PX_PER_TICK = 12;
/** An ordinary stroll, well inside the cadence cap. */
const STROLL_PX_PER_TICK = 0.5;
const PHASE_EPSILON = 1e-9;
/** A wander target far enough away that the citizen never arrives within the test. */
const FAR_TARGET_TILES = 1000;
const TURN_DIGITS = 4;
const REPORT_DIGITS = 3;

function strollingCitizen(seed: number, speed: number): Townsperson {
  const far = { x: TILE_SIZE * FAR_TARGET_TILES, y: 0 };
  const citizen = new Townsperson({
    x: 0,
    y: 0,
    role: 'commoner',
    species: 'skyfowl',
    seed,
    speed,
    wander: { pickTarget: () => far, arriveDist: 1, pauseMin: 0, pauseMax: 1 },
  });
  citizen.targetX = far.x;
  citizen.targetY = far.y;
  return citizen;
}

/**
 * Drives real skyfowl citizens through `Townsperson.update`: at a stroll the
 * walk cycle turns by exactly the ground covered over the look's cycle
 * length — distance, not time — and under a shove it turns no more than one
 * frame of the row, so the row is played rather than skipped through.
 */
function gateCadence(): void {
  let measured = 0;
  for (let seed = 0; seed < CADENCE_SEEDS; seed++) {
    for (const speed of [STROLL_PX_PER_TICK, SHOVE_PX_PER_TICK]) {
      const citizen = strollingCitizen(seed, speed);
      const cyclePx = citizenWalkCyclePx(citizen.figure, TILE_SIZE);
      const frames = citizenWalkFrames(citizen.figure);
      const before = citizen.phase;
      citizen.update();
      const turned = (citizen.phase - before + 1) % 1;
      measured++;
      const expected = Math.min(speed / cyclePx, 1 / frames);
      if (Math.abs(turned - expected) > PHASE_EPSILON) {
        fail(
          'M2',
          `a ${speed}px/tick skyfowl citizen turned its walk ${turned.toFixed(TURN_DIGITS)} of a cycle in ` +
            `one tick; the ground it covered asks for ${expected.toFixed(TURN_DIGITS)}` +
            (speed === SHOVE_PX_PER_TICK ? ' (one frame of the row at most)' : ''),
        );
      }
    }
  }
  failUnlessMeasured('M2', measured, 'citizen ticks');
}

/** Seeds enough to land on several different skyfowl looks. */
const CADENCE_SEEDS = 12;

// ── M3 dance energy ──────────────────────────────────────────────────────────

const SOLID_ALPHA = 200;
const RGBA = 4;
const ALPHA = 3;
/**
 * Solid ink this close above the ground line is feet and the contact shadow,
 * which a dance's width is not measured from.
 */
const FEET_BAND_TILES = 0.12;
/**
 * Floors set between two measurements (`--report` prints them): a dance
 * whose arms swing at chest height on the walk's own helpers, with one sway a
 * loop, reaches at most 0.05 tiles over the crown, 0.05 of top-edge travel
 * and 0.34 of combined travel even with a turn painted in; the routines the
 * club dances measure at least 0.11, 0.15 and 0.42.
 *
 * Some routine of every dancer must put a hand or a wing clearly over its
 * head, in tiles above its own standing crown.
 */
const MIN_BEST_REACH_OVER_HEAD_TILES = 0.1;
/** Every routine's top edge must travel this far: a bounce, a hop, arms pumping. */
const MIN_TOP_TRAVEL_TILES = 0.12;
/** Every routine's top-edge travel plus width travel: limbs flung up and out, and back. */
const MIN_COMBINED_TRAVEL_TILES = 0.4;
/** A loop's seam may not be a bigger jump than the row's own largest step: nothing snaps at the wrap. */
const MAX_SEAM_OVER_WORST_STEP = 1;

interface Silhouette {
  readonly top: number;
  readonly width: number;
}

/**
 * The top edge and width of a cell's solid ink above `bandTop` — the figure
 * without its feet and contact shadow, which sit still while the body dances.
 */
function silhouette(
  def: FigureDef,
  state: string,
  frame: number,
  bandTop: number,
): Silhouette | null {
  const cell = paintFigureCell(def, state, frame);
  const { width, height } = cell;
  const { data } = cell.getContext('2d').getImageData(0, 0, width, height);
  let top = height;
  let minX = width;
  let maxX = -1;
  for (let y = 0; y < Math.min(height, bandTop); y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * RGBA + ALPHA] < SOLID_ALPHA) continue;
      if (y < top) top = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (maxX < 0) return null;
  return { top, width: maxX - minX };
}

/** The lowest row of solid ink in a cell: where the figure's feet stand. */
function soleRow(def: FigureDef, state: string, frame: number): number | null {
  const cell = paintFigureCell(def, state, frame);
  const { width, height } = cell;
  const { data } = cell.getContext('2d').getImageData(0, 0, width, height);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * RGBA + ALPHA] >= SOLID_ALPHA) return y;
    }
  }
  return null;
}

interface DanceFigure {
  readonly label: string;
  readonly def: FigureDef;
  readonly idleState: string;
}

function danceFigures(): DanceFigure[] {
  const figures: DanceFigure[] = SKYFOWL_LOOKS.filter((look) => look.dances === true).map(
    (look) => ({ label: look.id, def: skyfowlCastFigure(look.id), idleState: 'idle' }),
  );
  figures.push({
    label: 'club_dancer',
    def: townCastOutfitFigure(clubDancerLook()),
    idleState: 'idle',
  });
  return figures;
}

function gateDanceEnergy(): void {
  let rows = 0;
  for (const figure of danceFigures()) {
    const sole = soleRow(figure.def, figure.idleState, 0);
    const tile = figure.def.tileScale;
    const bandTop = sole === null ? 0 : Math.round(sole - tile * FEET_BAND_TILES);
    const idle = silhouette(figure.def, figure.idleState, 0, bandTop);
    if (idle === null) {
      fail(
        'M3',
        `${figure.label}.${figure.idleState}[0] painted nothing to compare a dance against`,
      );
      continue;
    }
    let bestOverHead = -Infinity;
    for (const style of DANCE_STYLES) {
      const state = danceStateName(style);
      const frames = figure.def.states.get(state)?.frames ?? 0;
      if (frames === 0) {
        fail('M3', `${figure.label} paints no ${state}`);
        continue;
      }
      rows++;
      const shapes: Silhouette[] = [];
      for (let frame = 0; frame < frames; frame++) {
        const shape = silhouette(figure.def, state, frame, bandTop);
        if (shape === null) {
          fail('M3', `${figure.label}.${state}[${frame}] painted nothing`);
          continue;
        }
        shapes.push(shape);
      }
      if (shapes.length !== frames) continue;
      const highest = Math.min(...shapes.map((shape) => shape.top));
      const lowest = Math.max(...shapes.map((shape) => shape.top));
      const widest = Math.max(...shapes.map((shape) => shape.width));
      const narrowest = Math.min(...shapes.map((shape) => shape.width));
      const overHead = (idle.top - highest) / tile;
      const topTravel = (lowest - highest) / tile;
      const widthTravel = (widest - narrowest) / tile;
      if (REPORT) {
        console.log(
          `  info ${figure.label}.${state}: over crown ${overHead.toFixed(REPORT_DIGITS)}, top travel ` +
            `${topTravel.toFixed(REPORT_DIGITS)}, width travel ${widthTravel.toFixed(REPORT_DIGITS)} (tiles)`,
        );
      }
      bestOverHead = Math.max(bestOverHead, overHead);
      if (topTravel < MIN_TOP_TRAVEL_TILES) {
        fail(
          'M3',
          `${figure.label}.${state}'s top edge travels only ${topTravel.toFixed(2)} tiles ` +
            `(floor ${MIN_TOP_TRAVEL_TILES}) — no bounce, no arms pumping`,
        );
      }
      if (topTravel + widthTravel < MIN_COMBINED_TRAVEL_TILES) {
        fail(
          'M3',
          `${figure.label}.${state}'s silhouette travels only ${(topTravel + widthTravel).toFixed(2)} ` +
            `tiles up and across (floor ${MIN_COMBINED_TRAVEL_TILES}) — nothing is flung out and back`,
        );
      }
      const step = (a: Silhouette, b: Silhouette): number =>
        Math.abs(a.top - b.top) + Math.abs(a.width - b.width);
      let worstStep = 0;
      for (let frame = 1; frame < frames; frame++) {
        worstStep = Math.max(worstStep, step(shapes[frame - 1], shapes[frame]));
      }
      const seam = step(shapes[frames - 1], shapes[0]);
      if (seam > worstStep * MAX_SEAM_OVER_WORST_STEP) {
        fail(
          'M3',
          `${figure.label}.${state}'s loop seam jumps ${seam}px, more than any step inside the ` +
            `row (${worstStep}px) — it snaps at the wrap`,
        );
      }
    }
    if (bestOverHead < MIN_BEST_REACH_OVER_HEAD_TILES) {
      fail(
        'M3',
        `${figure.label}'s routines never put a limb more than ${bestOverHead.toFixed(2)} tiles ` +
          `over its own standing crown (floor ${MIN_BEST_REACH_OVER_HEAD_TILES}) — no hands in the air`,
      );
    }
  }
  failUnlessMeasured('M3', rows, 'dance rows');
}

// ── M4 dance rows stay in their cells ────────────────────────────────────────

function gateDanceStructure(): void {
  let measured = 0;
  for (const figure of danceFigures()) {
    measured++;
    for (const failure of figureStructuralFailures(figure.def, {
      minInkAreaShare: DANCE_MIN_INK_AREA_SHARE,
    })) {
      fail('M4', failure);
    }
  }
  failUnlessMeasured('M4', measured, 'dancer figures');
}

/** The cast cells are sized for spread limbs, so a standing row fills little of one. */
const DANCE_MIN_INK_AREA_SHARE = 0.06;

export function castMotionGateFailures(): string[] {
  failures = [];
  gateFootLock();
  gateCadence();
  gateDanceEnergy();
  gateDanceStructure();
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = castMotionGateFailures();
  if (result.length === 0) {
    console.log('  ok   cast-motion (4 gates)');
  } else {
    for (const failure of result) console.error(`  FAIL ${failure}`);
    process.exitCode = 1;
  }
}
