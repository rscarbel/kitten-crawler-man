/**
 * Old Lori's choreography and figure definition.
 *
 * Two rows in three views: `idle`, a slow hobble onto her cane and back with a
 * re-plant of the stick, and `walk`, the slow three-beat walk of someone who
 * leans on a cane — the cane and her bad (right) leg go forward together and
 * share her weight, then the good leg steps through.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import { LORI_IDLE_FRAMES, LORI_WALK_FRAMES } from '../loriTiming';
import { easeInOut, hump, lerp } from './bipedArt';
import {
  type FootPose,
  type LoriPose,
  type LoriView,
  type Vec3,
  RESTING_CANE_FOOT,
  RESTING_LEFT_FOOT_D,
  canePitchToReach,
  drawLoriAway,
  drawLoriFront,
  drawLoriSide,
  restingPose,
} from './loriArt';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile. */
export const TILE_SCALE = 64;
/**
 * Tiles per unit of her pose space. Her art and choreography are written in
 * pose units, so this one factor sets how big she stands in the world.
 */
export const LORI_BODY_SCALE = 1.66;
/** Cell pixels per unit of her pose space. */
export const POSE_UNIT_PX = TILE_SCALE * LORI_BODY_SCALE;

/** Wide enough for the cane swung out round her skirt on either side. */
export const FRAME_W = 136;
export const FRAME_H = 118;
export const TILE_X = (FRAME_W - TILE_SCALE) / 2;
/** Her feet sit on a whole cell row near the bottom of her tile, level with where the human crawler's do. */
const GROUND_ROW_IN_TILE = 58;
export const GROUND_OFFSET_IN_TILE = GROUND_ROW_IN_TILE / TILE_SCALE;
/**
 * Cell row of the ground line; everything above it is room for her, and the
 * rows below it hold a cane planted well ahead of her head-on.
 */
const GROUND_ROW = 104;
export const TILE_Y = GROUND_ROW - GROUND_ROW_IN_TILE;
const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = GROUND_ROW;

// ── Rows ─────────────────────────────────────────────────────────────────────

export type LoriRow = 'idle' | 'walk';

interface LoriRowSpec {
  readonly frameCount: number;
  readonly pose: (frame: number) => LoriPose;
}

/** Every row she is painted in, with its length and the pose each frame is painted from. */
const LORI_ROWS = {
  idle: { frameCount: LORI_IDLE_FRAMES, pose: idlePose },
  walk: { frameCount: LORI_WALK_FRAMES, pose: walkPose },
} as const satisfies Record<LoriRow, LoriRowSpec>;

function isLoriRow(name: string): name is LoriRow {
  return name in LORI_ROWS;
}

/** Her rows by name, in the table's order. */
export const LORI_ROW_NAMES: readonly LoriRow[] = Object.keys(LORI_ROWS).filter(isLoriRow);
export const LORI_VIEWS: readonly LoriView[] = ['front', 'side', 'away'];

/** The state name a row takes in a view: head-on is the bare name, the others add the view. */
export function loriStateName(row: LoriRow, view: LoriView): string {
  switch (view) {
    case 'front':
      return row;
    case 'side':
      return `${row}_side`;
    case 'away':
      return `${row}_away`;
    default: {
      const unhandled: never = view;
      throw new Error(`no state name for view ${String(unhandled)}`);
    }
  }
}

const TAU = Math.PI * 2;

/** One blink per loop, on a single frame; the rest of the time her lids hang a little. */
const BLINK_SQUINT = 1;
const RESTING_SQUINT = 0.15;

// ── Idle: the cane hobble ────────────────────────────────────────────────────

/** How far she sways onto the cane and sinks as she leans on it. */
const HOBBLE_SWAY = 0.045;
const HOBBLE_DIP = 0.024;
/** The head follows the body a beat late — that lag is what makes it weight and not a slide. */
const HEAD_LAG = 0.08;
const HEAD_SWAY = 0.012;
const HEAD_ROLL = 0.07;
const HEAD_SINK = 0.006;
/** The bad foot eases off the floor as the cane takes her weight. */
const BAD_FOOT_LIFT = 0.018;
/** Late in the cycle, weight off the stick, she lifts it and plants it again a touch further out. */
const CANE_TAP_START = 0.78;
const CANE_TAP_LENGTH = 0.18;
const CANE_TAP_LIFT = 0.035;
const CANE_TAP_OUT = 0.015;
/** Her breath runs a quarter of a hobble ahead of her weight. */
const IDLE_BREATH_LEAD = 0.25;
export const IDLE_BLINK_FRAME = 3;

function weightAt(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * TAU);
}

function withBody(hand: Vec3, bodyL: number, dip: number): Vec3 {
  return { l: hand.l + bodyL, y: hand.y + dip, d: hand.d };
}

export function idlePose(frame: number): LoriPose {
  const rest = restingPose();
  const phase = frame / LORI_IDLE_FRAMES;
  const weight = weightAt(phase);
  const headWeight = weightAt(phase - HEAD_LAG);
  const tap = hump((phase - CANE_TAP_START) / CANE_TAP_LENGTH);
  const tapping = phase >= CANE_TAP_START && phase <= CANE_TAP_START + CANE_TAP_LENGTH;
  const bodyL = HOBBLE_SWAY * weight;
  const dip = HOBBLE_DIP * weight;
  return {
    ...rest,
    bodyL,
    dip,
    headL: HEAD_SWAY * headWeight,
    headTilt: HEAD_ROLL * (headWeight - 0.5),
    headDip: HEAD_SINK * headWeight,
    rightHand: withBody(rest.rightHand, bodyL, dip),
    caneFoot: {
      l: rest.caneFoot.l + (tapping ? CANE_TAP_OUT * tap : 0),
      y: rest.caneFoot.y,
      d: rest.caneFoot.d,
    },
    caneLift: tapping ? CANE_TAP_LIFT * tap : 0,
    rightFoot: { ...rest.rightFoot, lift: BAD_FOOT_LIFT * weight },
    squint: frame === IDLE_BLINK_FRAME ? BLINK_SQUINT : RESTING_SQUINT,
    breath: weightAt(phase + IDLE_BREATH_LEAD),
  };
}

// ── Walk: cane and bad leg together, then the good leg ───────────────────────

/** Her hip height under the skirt: the leg every step is a share of. */
const LEG_LENGTH = 0.4;
/**
 * An old woman on a cane steps about half her leg's length; a young adult's
 * step is three-quarters of it.
 */
const STEP_SHARE = 0.5;
const STEP_LENGTH = LEG_LENGTH * STEP_SHARE;

/** Ground covered in one full cycle — two steps — in her pose units. */
export const WALK_CYCLE_POSE_LENGTH = STEP_LENGTH * 2;

/**
 * Tiles covered in one full cycle. A caller advances the walk phase by 2π for
 * every this many tiles she moves, which is the only way a planted boot and a
 * planted cane stay put on the floor.
 */
export const LORI_TILES_PER_WALK_CYCLE = WALK_CYCLE_POSE_LENGTH * LORI_BODY_SCALE;

/** One foot (or the cane) through the cycle: when it lands, and how long it bears weight. */
export interface Support {
  /** Phase, 0–1, of the moment it lands. */
  readonly contact: number;
  /** Share of the cycle it is on the floor. */
  readonly stance: number;
  /** Its body-relative depth at the middle of its stance. */
  readonly centreD: number;
  /** How high it is carried through its swing. */
  readonly lift: number;
}

/**
 * Walking, both boots work about one spot a little forward of where she
 * stands, so each leading toe shows past the hem as it lands — under a
 * floor-length skirt that glimpse is most of what says she is stepping —
 * without the longer good step throwing a boot out past the cane.
 */
const WALK_STANCE_CENTRE_D = 0.15;

/**
 * The bad leg lands at phase 0 and is off the floor again soonest: she spends
 * as little time as she can on it. The good leg bears her longer and its swing
 * is a quick step through.
 */
export const BAD_FOOT_SUPPORT: Support = {
  contact: 0,
  stance: 0.55,
  centreD: WALK_STANCE_CENTRE_D,
  lift: 0.022,
};
export const GOOD_FOOT_SUPPORT: Support = {
  contact: 0.5,
  stance: 0.7,
  centreD: WALK_STANCE_CENTRE_D,
  lift: 0.03,
};
/**
 * Walking, she plants the cane further ahead than she stands it, so through
 * its whole stance it stays out in front of her skirt rather than passing
 * behind it.
 */
const CANE_WALK_AHEAD = 0.07;
/** The cane lands with the bad leg and stays down a little after it, taking the load off it. */
export const CANE_SUPPORT: Support = {
  contact: 0,
  stance: 0.65,
  centreD: RESTING_CANE_FOOT.d + CANE_WALK_AHEAD,
  lift: 0.09,
};

/** Rolling off the ball at push-off, and a little toe-up on landing. */
const TOE_OFF_PITCH = 0.3;
const HEEL_STRIKE_PITCH = -0.12;
/** Where in stance the heel starts to peel up. */
const HEEL_PEEL_STARTS = 0.6;

/** Where `phase` falls in a support's stance or swing. */
export function supportPhase(phase: number, support: Support): { stance: boolean; t: number } {
  const cycle = (((phase - support.contact) % 1) + 1) % 1;
  if (cycle < support.stance) return { stance: true, t: cycle / support.stance };
  return { stance: false, t: (cycle - support.stance) / (1 - support.stance) };
}

/** Body-relative depth and lift of a support at `phase`. On the floor it slides back as she travels. */
function supportPlace(
  phase: number,
  support: Support,
): { d: number; lift: number; t: number; stance: boolean } {
  const slide = WALK_CYCLE_POSE_LENGTH * support.stance;
  const landD = support.centreD + slide / 2;
  const liftD = support.centreD - slide / 2;
  const { stance, t } = supportPhase(phase, support);
  if (stance) return { d: lerp(landD, liftD, t), lift: 0, t, stance };
  return {
    d: lerp(liftD, landD, easeInOut(t)),
    lift: support.lift * hump(t),
    t,
    stance,
  };
}

/** Where in its swing a boot has turned toe-up for the landing. */
const HEEL_STRIKE_READY = 0.75;
/** Where in stance a landed boot has rocked flat. */
const FOOT_FLAT = 0.15;

/** A linear ramp through `[t, value]` keys, held flat past either end. */
function keyed(t: number, keys: ReadonlyArray<readonly [number, number]>): number {
  let previous = keys[0];
  if (t <= previous[0]) return previous[1];
  for (const next of keys.slice(1)) {
    if (t <= next[0])
      return lerp(previous[1], next[1], (t - previous[0]) / (next[0] - previous[0]));
    previous = next;
  }
  return previous[1];
}

function walkFoot(phase: number, support: Support): FootPose {
  const place = supportPlace(phase, support);
  const pitch = place.stance
    ? keyed(place.t, [
        [0, HEEL_STRIKE_PITCH],
        [FOOT_FLAT, 0],
        [HEEL_PEEL_STARTS, 0],
        [1, TOE_OFF_PITCH],
      ])
    : keyed(place.t, [
        [0, TOE_OFF_PITCH],
        [HEEL_STRIKE_READY, HEEL_STRIKE_PITCH],
      ]);
  return { d: place.d, lift: place.lift, pitch };
}

/** The pelvis drops at each footfall, and deeper when she comes down onto the cane. */
const WALK_DIP = 0.012;
const CANE_LANDING_DIP = 0.045;
/** She sinks onto the cane just after it lands, not as it lands. */
const CANE_SINK_LAG = 0.06;
/** Sideways, she rides over the good leg and leans the bad leg's load onto the cane. */
const WALK_SWAY = 0.055;
/** As the cane lands with the bad leg she drops her weight sideways onto it. */
const CANE_LEAN = 0.03;
const SWAY_PEAK_PHASE = GOOD_FOOT_SUPPORT.contact + GOOD_FOOT_SUPPORT.stance / 2 - 0.1;
/** The hem trails her sway by this much of a cycle. */
const HEM_LAG = 0.12;
/** How much of the leading boot's reach past rest pushes the hem forward. */
const HEM_FOLLOW = 0.08;
const HEM_REST_LEAD = RESTING_LEFT_FOOT_D;
const WALK_TWIST = 0.08;
/** The free arm's swing, in pose units of hand travel: an old woman's arm barely swings. */
const WALK_ARM_SWING = 0.035;
const WALK_ARM_LIFT = 0.012;
/** The head nods forward on each footfall, a beat late. */
const WALK_HEAD_NOD = 0.014;
const WALK_HEAD_LAG = 0.06;
const WALK_HEAD_ROLL = 0.05;
/** The cane's hand rides with her and reaches ahead a little as it carries the cane forward. */
const CANE_TOP_D = RESTING_CANE_FOOT.d;
const CANE_SWING_REACH = 0.03;
/** Carried forward, the cane swings out round her in a shallow arc, clear of her skirt. */
const CANE_SWING_OUT = 0.04;
export const WALK_BLINK_FRAME = 11;

function swayAt(phase: number): number {
  return 0.5 + 0.5 * Math.cos((phase - SWAY_PEAK_PHASE) * TAU);
}

/** A raised cosine that peaks once on each footfall. */
function footfallAt(phase: number): number {
  return 0.5 + 0.5 * Math.cos(phase * TAU * 2);
}

export function walkPose(frame: number): LoriPose {
  const rest = restingPose();
  const phase = frame / LORI_WALK_FRAMES;
  const rightFoot = walkFoot(phase, BAD_FOOT_SUPPORT);
  const leftFoot = walkFoot(phase, GOOD_FOOT_SUPPORT);
  const cane = supportPlace(phase, CANE_SUPPORT);
  const caneSwing = cane.stance ? 0 : hump(cane.t);

  const sway = swayAt(phase);
  const landingOnCane = 0.5 + 0.5 * Math.cos(phase * TAU);
  const bodyL = WALK_SWAY * sway + CANE_LEAN * landingOnCane;
  const sinkOntoCane = 0.5 + 0.5 * Math.cos((phase - CANE_SINK_LAG) * TAU);
  const dip = WALK_DIP * footfallAt(phase) + CANE_LANDING_DIP * sinkOntoCane;
  const armSwing = Math.cos(phase * TAU);
  const leadD = Math.max(rightFoot.d, leftFoot.d);

  const caneFoot: Vec3 = {
    l: rest.caneFoot.l + CANE_SWING_OUT * caneSwing,
    y: rest.caneFoot.y,
    d: cane.d,
  };
  const caneTopD = CANE_TOP_D + CANE_SWING_REACH * caneSwing;
  return {
    ...rest,
    bodyL,
    dip,
    twist: WALK_TWIST * armSwing,
    headForward: WALK_HEAD_NOD * footfallAt(phase - WALK_HEAD_LAG),
    headTilt: WALK_HEAD_ROLL * (swayAt(phase - WALK_HEAD_LAG) - 0.5),
    rightHand: {
      l: rest.rightHand.l + bodyL,
      y: rest.rightHand.y + dip - WALK_ARM_LIFT * armSwing * armSwing,
      // At the bad leg's footfall its own arm is furthest back.
      d: rest.rightHand.d - WALK_ARM_SWING * armSwing,
    },
    caneFoot,
    caneLift: cane.lift,
    canePitch: canePitchToReach(cane.d, caneTopD),
    rightFoot,
    leftFoot,
    hemForward: HEM_FOLLOW * (leadD - HEM_REST_LEAD),
    hemLateral: WALK_SWAY * (swayAt(phase - HEM_LAG) - sway),
    squint: frame === WALK_BLINK_FRAME ? BLINK_SQUINT : RESTING_SQUINT,
    breath: footfallAt(phase),
  };
}

export function loriPose(row: LoriRow, frame: number): LoriPose {
  return LORI_ROWS[row].pose(frame);
}

// ── Painting ─────────────────────────────────────────────────────────────────

interface ResolvedState {
  readonly row: LoriRow;
  readonly view: LoriView;
}

function resolveState(state: string): ResolvedState | null {
  for (const row of LORI_ROW_NAMES) {
    for (const view of LORI_VIEWS) {
      if (loriStateName(row, view) === state) return { row, view };
    }
  }
  return null;
}

const PAINTERS: Readonly<
  Record<LoriView, (ctx: CanvasRenderingContext2D, pose: LoriPose) => void>
> = {
  front: drawLoriFront,
  side: drawLoriSide,
  away: drawLoriAway,
};

function paintLori(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const resolved = resolveState(state);
  if (resolved === null) return;
  const pose = loriPose(resolved.row, frame);
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(POSE_UNIT_PX, POSE_UNIT_PX);
  PAINTERS[resolved.view](ctx, pose);
  ctx.restore();
}

function loriStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of LORI_ROW_NAMES) {
    for (const view of LORI_VIEWS) frames[loriStateName(row, view)] = LORI_ROWS[row].frameCount;
  }
  return frames;
}

export const LORI_FIGURE: FigureDef = {
  id: 'lori',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(loriStateFrames()),
  paintFrame: paintLori,
};
