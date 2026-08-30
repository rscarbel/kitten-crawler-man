/**
 * The small hunting spider, as a painted figure: the choreography, the cell
 * geometry, and the `FigureDef` the runtime cache and the review harness both
 * draw through.
 *
 * One pose builder per animation row, exactly the rows the sheet this replaces
 * carried:
 *   walk         — alternating-tetrapod skitter, one full gait cycle
 *   idle         — planted stance, breathing abdomen, twitching pedipalps
 *   crouch       — attack wind-up: body hunkers, rear legs load for the leap
 *   pounce       — the hop: launch, airborne splay, hard landing, recovery
 *   death_curl   — legs fail, the body rolls onto its back and curls
 *   death_spasm  — thrashing seizure, then the roll and curl
 *   death_flip   — knocked spinning, lands on its back, bounces, curls
 *
 * Every death row ends on the same pose: on its back with the legs curled over
 * the belly. The creature holds that final frame as its corpse.
 *
 * Anatomy, palette and every stroke of paint live in `spiderArt.ts`. The art
 * invariants live in `scripts/gates-spider-small.ts`, which the review harness
 * runs: `npm run render:spider`.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  DEFAULT_SHADOW_ALPHA,
  FIRST_LEFT_LEG,
  LEGS,
  LEG_COUNT_PER_SIDE,
  type LegPose,
  type SpiderPose,
  TOTAL_LEGS,
  TWO_PI,
  basePose,
  curlLeg,
  drawSpider,
  easeInOut,
  hashRandom,
  lerp,
  ramp,
  reachLeg,
  restLeg,
  swingLeg,
} from './spiderArt';

// ── Cell geometry ─────────────────────────────────────────────

/**
 * A spider's legs span well over twice its body, and the pounce row throws them
 * out further still, so the cell has to be four tiles across to hold the splay.
 *
 * These four numbers were measured by the bake this figure replaces, and
 * `scripts/parity-figure-sheet.ts` is what proved the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 */
const FRAME_WIDTH = 256;
const FRAME_HEIGHT = 256;
/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/**
 * The rotation pivot, which is the spider's own body centre rather than a tile
 * top-left: the art faces one way and is spun to its heading, so the anchor the
 * draw call passes is the point it spins about.
 */
const TILE_X = FRAME_WIDTH / 2;
const TILE_Y = FRAME_HEIGHT / 2;

export const WALK_FRAMES = 8;
export const IDLE_FRAMES = 6;
export const CROUCH_FRAMES = 6;
export const POUNCE_FRAMES = 10;
export const DEATH_FRAMES = 12;

// ── Pose builders, one per animation row ─────────────────────────────────────

/** Fraction of the gait cycle a leg spends in the air. */
const SWING_FRACTION = 0.32;
const STRIDE_DEG = 14;
const WALK_YAW_RAD = 0.035;
const WALK_BOB = 0.018;
const WALK_ABDOMEN_SWAY = 0.016;

interface GaitSample {
  /** -1 fully forward, +1 fully rearward. */
  readonly stride: number;
  readonly lift: number;
}

function gaitSample(phase: number): GaitSample {
  const p = phase - Math.floor(phase);
  if (p < SWING_FRACTION) {
    const t = p / SWING_FRACTION;
    return { stride: 1 - 2 * easeInOut(t), lift: Math.sin(t * Math.PI) };
  }
  const t = (p - SWING_FRACTION) / (1 - SWING_FRACTION);
  return { stride: -1 + 2 * t, lift: 0 };
}

/**
 * Alternating tetrapod: legs L1, R2, L3, R4 swing while R1, L2, R3, L4 hold the
 * ground, then the two sets trade — the gait that makes a spider look skittery
 * rather than marching.
 */
function gaitGroupOffset(legIndex: number): number {
  const side = legIndex < FIRST_LEFT_LEG ? 0 : 1;
  const pair = legIndex % LEG_COUNT_PER_SIDE;
  return (pair + side) % 2 === 0 ? 0 : 0.5;
}

function walkPose(cyclePhase: number): SpiderPose {
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const { stride, lift } = gaitSample(cyclePhase + gaitGroupOffset(i));
    legs.push(swingLeg(restLeg(LEGS[i % LEG_COUNT_PER_SIDE]), stride * STRIDE_DEG, lift));
  }

  const yaw = Math.sin(cyclePhase * TWO_PI) * WALK_YAW_RAD;
  return {
    ...basePose(legs),
    spin: yaw,
    bodyScale: 1 + Math.sin(cyclePhase * TWO_PI * 2) * WALK_BOB,
    abdomenSway: -Math.sin(cyclePhase * TWO_PI) * WALK_ABDOMEN_SWAY,
    palpSwing: Math.sin(cyclePhase * TWO_PI * 2) * 6,
  };
}

const IDLE_TREMOR_DEG = 1.8;
const IDLE_BREATH = 0.014;
const IDLE_PALP_SWING_DEG = 9;

function idlePose(cyclePhase: number): SpiderPose {
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const tremorPhase = cyclePhase * TWO_PI + i * 1.7;
    legs.push(
      swingLeg(restLeg(LEGS[i % LEG_COUNT_PER_SIDE]), Math.sin(tremorPhase) * IDLE_TREMOR_DEG),
    );
  }
  return {
    ...basePose(legs),
    abdomenScale: 1 + Math.sin(cyclePhase * TWO_PI) * IDLE_BREATH,
    palpSwing: Math.sin(cyclePhase * TWO_PI * 3) * IDLE_PALP_SWING_DEG,
  };
}

// Wind-up: the front pair rocks back and lifts clear while the rear pair loads.
const CROUCH_FRONT_PULL_DEG = 26;
const CROUCH_REAR_LOAD_DEG = -18;
const CROUCH_FRONT_REACH = 0.78;
const CROUCH_REAR_REACH = 1.06;
const CROUCH_BODY_SCALE = 0.93;
const CROUCH_SINK = 0.03;
const CROUCH_FANG_OPEN = 0.45;

function crouchPose(progress: number): SpiderPose {
  const t = easeInOut(progress);
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const pair = i % LEG_COUNT_PER_SIDE;
    const isFrontPair = pair < 2;
    const rest = restLeg(LEGS[pair]);
    const sweep = isFrontPair ? CROUCH_FRONT_PULL_DEG : CROUCH_REAR_LOAD_DEG;
    const reach = lerp(1, isFrontPair ? CROUCH_FRONT_REACH : CROUCH_REAR_REACH, t);
    legs.push(swingLeg(rest, sweep * t, isFrontPair ? t * 0.5 : 0, reach));
  }
  return {
    ...basePose(legs),
    bodyScale: lerp(1, CROUCH_BODY_SCALE, t),
    prosomaSink: CROUCH_SINK * t,
    abdomenSway: 0,
    fangOpen: CROUCH_FANG_OPEN * t,
    palpSwing: -8 * t,
    shadowScale: lerp(1, 1.06, t),
    eyeShine: t * 0.5,
  };
}

// The hop: an explosive launch, an airborne splay, then a hard four-point
// landing. Height reads as scale because the camera looks straight down.
const POUNCE_LAUNCH_END = 0.18;
const POUNCE_AIRBORNE_END = 0.6;
const POUNCE_IMPACT_END = 0.78;
const POUNCE_PEAK_SCALE = 1.26;
const POUNCE_LANDING_SQUASH = 0.94;
/**
 * Airborne direction per leg pair, front → rear. Fanning the four out to
 * separate headings keeps them from collapsing into two parallel lines: the
 * forelegs reach ahead like grapples, the hind pair trails from the kick.
 */
const POUNCE_AIR_TARGET_DEG: readonly number[] = [-62, -26, 30, 64];
const POUNCE_AIR_BEND_DEG = 18;
const POUNCE_SPLAY_DEG = 20;
const POUNCE_AIR_SHADOW_SCALE = 0.55;
const POUNCE_AIR_SHADOW_ALPHA = 0.5;

function pouncePose(progress: number): SpiderPose {
  const launch = ramp(progress, 0, POUNCE_LAUNCH_END);
  const airborne = ramp(progress, POUNCE_LAUNCH_END, POUNCE_AIRBORNE_END);
  const impact = ramp(progress, POUNCE_AIRBORNE_END, POUNCE_IMPACT_END);
  const recover = ramp(progress, POUNCE_IMPACT_END, 1);

  // Height rises through the launch and falls away as the impact lands.
  const height = Math.min(launch, 1) * (1 - impact);
  const airPose = launch * (1 - impact);

  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const pair = i % LEG_COUNT_PER_SIDE;
    const isFrontPair = pair < 2;
    const rest = restLeg(LEGS[pair]);

    const airReach = isFrontPair ? 1.12 : 1.1;
    const splay = impact * (1 - recover) * POUNCE_SPLAY_DEG * (isFrontPair ? -1 : 1);
    const reach = lerp(1, airReach, airPose) * lerp(1, 1.08, impact * (1 - recover));

    const extended = reachLeg(rest, POUNCE_AIR_TARGET_DEG[pair], POUNCE_AIR_BEND_DEG, airPose);
    legs.push(swingLeg(extended, splay, airPose * (isFrontPair ? 0.8 : 0.4), reach));
  }

  const scale =
    lerp(1, POUNCE_PEAK_SCALE, easeInOut(height)) *
    lerp(1, POUNCE_LANDING_SQUASH, impact * (1 - recover));

  return {
    ...basePose(legs),
    bodyScale: scale,
    abdomenScale: lerp(1, 1.05, airborne * (1 - impact)),
    fangOpen: Math.max(CROUCH_FANG_OPEN, Math.min(1, launch * 1.6)) * (1 - recover * 0.6),
    palpSwing: -18 * airPose,
    shadowScale: lerp(1, POUNCE_AIR_SHADOW_SCALE, height),
    shadowAlpha: lerp(DEFAULT_SHADOW_ALPHA, POUNCE_AIR_SHADOW_ALPHA, height),
    eyeShine: Math.max(0.5, 1 - recover),
  };
}

// ── Death poses ──────────────────────────────────────────────────────────────

const DEATH_ROLL_TARGET = Math.PI;
const DEATH_LIMP_DROOP_DEG = 9;
const DEATH_FINAL_TWITCH_DEG = 4;

/**
 * The pose every death converges on: on its back, legs folded tight over the
 * belly. Shared so all three rows end on an identical corpse frame.
 */
function corpsePose(curl: number, roll: number, spin: number, extraDeg = 0): SpiderPose {
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const pair = i % LEG_COUNT_PER_SIDE;
    // Jitter rides on top of the curl so the settling twitch still shows once
    // the legs have fully folded.
    const jitter = extraDeg * (hashRandom(i * 29) - 0.5) * 2;
    legs.push(swingLeg(curlLeg(pair, restLeg(LEGS[pair]), curl), jitter));
  }
  return {
    ...basePose(legs),
    roll,
    spin,
    bodyScale: lerp(1, 0.98, curl),
    fangOpen: lerp(0.35, 0, curl),
    palpSwing: 12 * curl,
    shadowScale: lerp(1, 0.88, curl),
    shadowAlpha: lerp(DEFAULT_SHADOW_ALPHA, 0.78, curl),
  };
}

const CURL_LIMP_END = 0.22;
const CURL_ROLL_START = 0.2;
const CURL_ROLL_END = 0.62;
const CURL_TIGHTEN_START = 0.45;

/** The slow collapse: the legs give out, the body rolls over, the legs fold. */
function deathCurlPose(progress: number): SpiderPose {
  const limp = ramp(progress, 0, CURL_LIMP_END);
  const roll = easeInOut(ramp(progress, CURL_ROLL_START, CURL_ROLL_END)) * DEATH_ROLL_TARGET;
  const curl = easeInOut(ramp(progress, CURL_TIGHTEN_START, 1));
  // One last twitch as the legs settle.
  const twitch = Math.sin(ramp(progress, 0.82, 0.95) * Math.PI) * DEATH_FINAL_TWITCH_DEG;

  const pose = corpsePose(curl, roll, 0, twitch);
  const legs = pose.legs.map((leg) => swingLeg(leg, DEATH_LIMP_DROOP_DEG * limp * (1 - curl)));
  return { ...pose, legs };
}

const SPASM_BEATS: readonly (readonly [number, number])[] = [
  [0.0, 34],
  [0.16, -26],
  [0.3, 22],
  [0.42, -14],
];
const SPASM_ROLL_START = 0.46;
const SPASM_ROLL_END = 0.74;
const SPASM_CURL_START = 0.6;
const SPASM_SPIN_RAD = 0.22;

/** The seizure: rigid legs snap in and out in decaying beats, then it folds. */
function deathSpasmPose(progress: number): SpiderPose {
  let thrash = 0;
  for (const [start, amplitude] of SPASM_BEATS) {
    const beat = ramp(progress, start, start + 0.14);
    thrash += Math.sin(beat * Math.PI) * amplitude;
  }

  const roll = easeInOut(ramp(progress, SPASM_ROLL_START, SPASM_ROLL_END)) * DEATH_ROLL_TARGET;
  const curl = easeInOut(ramp(progress, SPASM_CURL_START, 1));
  const spin = Math.sin(ramp(progress, 0, SPASM_ROLL_END) * Math.PI) * SPASM_SPIN_RAD;

  const pose = corpsePose(curl, roll, spin);
  const legs = pose.legs.map((leg, i) =>
    swingLeg(leg, thrash * (1 - curl) * (i % 2 === 0 ? 1 : -0.7)),
  );
  return { ...pose, legs, bodyScale: pose.bodyScale * (1 + Math.sin(thrash * 0.06) * 0.03) };
}

const FLIP_TUMBLE_END = 0.46;
const FLIP_SPIN_RAD = 1.9;
const FLIP_BOUNCE_START = 0.46;
const FLIP_BOUNCE_END = 0.66;
const FLIP_CURL_START = 0.58;
const FLIP_AIR_SCALE = 1.18;
const FLIP_FLAIL_DEG = 30;

/** Knocked clean off its feet: it tumbles, slams down on its back, and curls. */
function deathFlipPose(progress: number): SpiderPose {
  const tumble = ramp(progress, 0, FLIP_TUMBLE_END);
  const bounce = ramp(progress, FLIP_BOUNCE_START, FLIP_BOUNCE_END);
  const curl = easeInOut(ramp(progress, FLIP_CURL_START, 1));

  // Two rotations of roll settle onto the back; the spin unwinds to zero so the
  // corpse matches the other death rows.
  const roll = Math.min(DEATH_ROLL_TARGET, easeInOut(tumble) * DEATH_ROLL_TARGET);
  const spin = Math.sin(tumble * Math.PI) * FLIP_SPIN_RAD * (1 - curl);

  const airborne = Math.sin(tumble * Math.PI);
  const flail = Math.sin(progress * TWO_PI * 2) * FLIP_FLAIL_DEG * (1 - curl);
  const bounceKick = Math.sin(bounce * Math.PI) * FLIP_FLAIL_DEG * 0.6;

  const pose = corpsePose(curl, roll, spin);
  const legs = pose.legs.map((leg, i) =>
    swingLeg(leg, (flail + bounceKick) * (i % 2 === 0 ? 1 : -1), airborne * 0.6),
  );

  return {
    ...pose,
    legs,
    bodyScale:
      pose.bodyScale *
      lerp(1, FLIP_AIR_SCALE, airborne) *
      lerp(1, 0.93, Math.sin(bounce * Math.PI)),
    shadowScale: lerp(pose.shadowScale, 0.6, airborne),
    shadowAlpha: lerp(pose.shadowAlpha, 0.45, airborne),
  };
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

/**
 * One animation row: its name, its length, and the pose each frame gets.
 *
 * `kind` is what the loop and continuity gates narrow on — a cycle has to come
 * back to where it started and a one-shot must not.
 */
export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: 'loop' | 'oneShot';
  readonly pose: (frame: number) => SpiderPose;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

export const SPIDER_ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    kind: 'loop',
    frameCount: WALK_FRAMES,
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'idle',
    kind: 'loop',
    frameCount: IDLE_FRAMES,
    pose: (f) => idlePose(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'crouch',
    kind: 'oneShot',
    frameCount: CROUCH_FRAMES,
    pose: (f) => crouchPose(shotProgress(f, CROUCH_FRAMES)),
  },
  {
    name: 'pounce',
    kind: 'oneShot',
    frameCount: POUNCE_FRAMES,
    pose: (f) => pouncePose(shotProgress(f, POUNCE_FRAMES)),
  },
  {
    name: 'death_curl',
    kind: 'oneShot',
    frameCount: DEATH_FRAMES,
    pose: (f) => deathCurlPose(shotProgress(f, DEATH_FRAMES)),
  },
  {
    name: 'death_spasm',
    kind: 'oneShot',
    frameCount: DEATH_FRAMES,
    pose: (f) => deathSpasmPose(shotProgress(f, DEATH_FRAMES)),
  },
  {
    name: 'death_flip',
    kind: 'oneShot',
    frameCount: DEATH_FRAMES,
    pose: (f) => deathFlipPose(shotProgress(f, DEATH_FRAMES)),
  },
];

function poseRowOf(state: string): RowSpec {
  const row = SPIDER_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) throw new Error(`no spider row for "${state}"`);
  return row;
}

/**
 * Paints one cell of the spider, in the cell's own pixels.
 *
 * The body centre sits at the cell centre, which is the point the runtime spins
 * the creature about when it turns to face its heading.
 */
function paintSpiderFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  drawSpider(ctx, TILE_X, TILE_Y, TILE_SCALE, poseRowOf(state).pose(frame));
}

function spiderStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of SPIDER_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const SPIDER_FIGURE: FigureDef = {
  id: 'spider',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(spiderStateFrames()),
  paintFrame: paintSpiderFrame,
};
