/**
 * Mordecai as an Incubus — his shape on the Over City floor — as a painted
 * figure: Carl's own rig and choreography (`carl/figure.ts`, `human/`), in a
 * dusky grey skin, slicked black hair and a wine silk shirt, with the horns,
 * wings, tail, sash, trousers and boots of `incubusArt.ts` composed into it.
 *
 * Built on Carl's rig rather than a rig of its own for the same reason the
 * town's residents are: it is the only figure in the game whose movement
 * convinces, and it puts Mordecai in the same drawing style as the humans
 * around him in the town.
 *
 * Rows, in three views (profile drawn facing +X and mirrored at runtime):
 *    idle / idle_side / idle_away   — Carl's breathing idle, blink included
 *    walk / walk_side / walk_away   — Carl's walk, paced by ground covered
 *    talk / talk_side / talk_away   — Carl's talking gestures
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import { type CarlComposeOptions, drawCarlBack, drawCarlFront, drawCarlSide } from './carl/figure';
import { type CarlPose } from './carl/rig';
import {
  FACING_BROW_DEFAULT,
  PROFILE_BROW_DEFAULT,
  resetCarlExpression,
  setCarlExpression,
} from './carl/head';
import {
  resetCarlGarmentRamp,
  resetCarlSkinHairRamp,
  setCarlGarmentRamp,
  setCarlSkinHairRamp,
} from './carl/palette';
import { resetCarlTorsoCut, setCarlTorsoCut } from './carl/torso';
import { idleBack, idleFront, idleSide } from './human/idles';
import { walkFacing, walkSide } from './human/locomotion';
import { talkBack, talkFront, talkSide, TALK_FRAMES } from './human/actionsMisc';
import {
  heldFrameStart,
  heldLength,
  IDLE_BLINK_FRAME,
  IDLE_FRAME_TICKS,
  IDLE_FRAMES,
  WALK_FRAMES,
} from './human/timing';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import {
  INCUBUS_HAIR,
  INCUBUS_SHIRT,
  INCUBUS_SKIN,
  type IncubusMotion,
  incubusAttachments,
} from './incubusArt';
import { TWO_PI } from './carl/geometry';

type Ctx = CanvasRenderingContext2D;

export type IncubusView = 'front' | 'side' | 'away';
export type IncubusRole = 'idle' | 'walk' | 'talk';

const VIEW_SUFFIX: Readonly<Record<IncubusView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};

export const INCUBUS_VIEWS: readonly IncubusView[] = ['front', 'side', 'away'];
export const INCUBUS_ROLES: readonly IncubusRole[] = ['idle', 'walk', 'talk'];

export function incubusStateName(role: IncubusRole, view: IncubusView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * He stands a little taller than Carl and the townsfolk, and broader again
 * than that: a heroic frame reads by shoulders a size too big for the head,
 * never by a bigger head. Height is uniform scale; the extra width is
 * horizontal only.
 */
export const INCUBUS_HEIGHT_SCALE = 1.06;
const INCUBUS_WIDTH_SCALE = 1.14;
const UNIT_PX_Y = HUMAN_CELL_PX_PER_UNIT * INCUBUS_HEIGHT_SCALE;
const UNIT_PX_X = UNIT_PX_Y * INCUBUS_WIDTH_SCALE;

/**
 * A shirt cut just past the waist, with no zip or waistband of its own: the
 * sash is the waistband. Carl's jacket repainted in silk.
 */
const SHIRT_HEM_DROP = 0.06;
const SHIRT_HEM_FLARE = 1.04;

/** Calm and faintly amused: Carl's brow, with almost none of his combat scowl. */
const INCUBUS_ANGER_SCALE = 0.12;
const INCUBUS_EXPRESSION = {
  angerScale: INCUBUS_ANGER_SCALE,
  profileBrow: PROFILE_BROW_DEFAULT,
  facingBrow: FACING_BROW_DEFAULT,
  lipFullness: 1,
} as const;

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / INCUBUS_TILE_SCALE`. */
export const INCUBUS_TILE_SCALE = 64;
/**
 * Room for the wing peaks and horn tips above his head, the wing bulges and
 * the tail's curl either side, and a stride. Re-measured by the harness: no
 * frame's ink may touch the cell's edge.
 */
const CELL_WIDTH = 176;
const CELL_HEIGHT = 196;
/** Floor below his soles, for the contact shadow. */
const GROUND_MARGIN = 12;
const GROUND_Y = CELL_HEIGHT - GROUND_MARGIN;
const ORIGIN_X = CELL_WIDTH / 2;
const HALF_TILE = INCUBUS_TILE_SCALE / 2;

// ── Secondary motion ─────────────────────────────────────────────────────────

/**
 * The folded wings settle and rise with the breath; the tail idles through a
 * slow half-sway. Both are sampled once per frame of a loop that holds each
 * frame close to half a second, so they are kept small: a big swing sampled
 * that coarsely strobes instead of moving.
 */
const IDLE_TAIL_SWAY = 0.6;
const IDLE_WING_LIFT = 0.8;
/**
 * Walking, the tail swings once per stride against the hips, and the wings
 * bounce twice — once per footfall — as the shoulders ride up over each leg.
 */
const WALK_TAIL_SWAY = 1;
const WALK_WING_LIFT = 0.7;
const FOOTFALLS_PER_STRIDE = 2;
/** Talking, the tail flicks with the gestures, faster and smaller than a walk's swing. */
const TALK_TAIL_SWAY = 0.7;
const TALK_TAIL_FLICKS = 2;
const TALK_WING_LIFT = 0.4;

function breathOf(phase: number): number {
  // 0 at the top of the breath, as the idle's frame 0 is.
  return (1 - Math.cos(phase * TWO_PI)) / 2;
}

function idleMotion(phase: number): IncubusMotion {
  return {
    tailSway: Math.sin(phase * TWO_PI) * IDLE_TAIL_SWAY,
    wingLift: (1 - breathOf(phase)) * IDLE_WING_LIFT,
  };
}

function walkMotion(phase: number): IncubusMotion {
  return {
    tailSway: Math.sin(phase * TWO_PI) * WALK_TAIL_SWAY,
    wingLift: breathOf(phase * FOOTFALLS_PER_STRIDE) * WALK_WING_LIFT,
  };
}

function talkMotion(phase: number): IncubusMotion {
  return {
    tailSway: Math.sin(phase * TWO_PI * TALK_TAIL_FLICKS) * TALK_TAIL_SWAY,
    wingLift: breathOf(phase) * TALK_WING_LIFT,
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** How far round the breath an idle frame is, from the tick it is first drawn: the blink frame is held short. */
function idlePhase(frame: number): number {
  return heldFrameStart(IDLE_FRAME_TICKS, frame) / heldLength(IDLE_FRAME_TICKS);
}

function idleLid(frame: number): number {
  return frame === IDLE_BLINK_FRAME ? 1 : 0;
}

interface IncubusRow {
  readonly frames: number;
  readonly pose: (frame: number) => CarlPose;
  readonly motion: (frame: number) => IncubusMotion;
}

const IDLE_POSE: Readonly<Record<IncubusView, (phase: number, lid: number) => CarlPose>> = {
  front: idleFront,
  side: idleSide,
  away: idleBack,
};
const WALK_POSE: Readonly<Record<IncubusView, (phase: number) => CarlPose>> = {
  front: (phase) => walkFacing(phase, false),
  side: walkSide,
  away: (phase) => walkFacing(phase, true),
};
const TALK_POSE: Readonly<Record<IncubusView, (frame: number) => CarlPose>> = {
  front: talkFront,
  side: talkSide,
  away: talkBack,
};

function rowFor(role: IncubusRole, view: IncubusView): IncubusRow {
  if (role === 'idle') {
    return {
      frames: IDLE_FRAMES,
      pose: (frame) => IDLE_POSE[view](idlePhase(frame), idleLid(frame)),
      motion: (frame) => idleMotion(idlePhase(frame)),
    };
  }
  if (role === 'walk') {
    return {
      frames: WALK_FRAMES,
      pose: (frame) => WALK_POSE[view](frame / WALK_FRAMES),
      motion: (frame) => walkMotion(frame / WALK_FRAMES),
    };
  }
  return {
    frames: TALK_FRAMES,
    pose: TALK_POSE[view],
    motion: (frame) => talkMotion(frame / TALK_FRAMES),
  };
}

interface NamedRow extends IncubusRow {
  readonly view: IncubusView;
}

const ROWS: ReadonlyMap<string, NamedRow> = new Map(
  INCUBUS_ROLES.flatMap((role) =>
    INCUBUS_VIEWS.map((view): [string, NamedRow] => [
      incubusStateName(role, view),
      { ...rowFor(role, view), view },
    ]),
  ),
);

const DRAW_BY_VIEW: Readonly<
  Record<IncubusView, (ctx: Ctx, pose: CarlPose, options: CarlComposeOptions) => void>
> = {
  front: drawCarlFront,
  side: drawCarlSide,
  away: drawCarlBack,
};

/** No Carl gear: no cloak, no gauntlet, no trollskin band at the collar. */
const NO_GEAR = {} as const;

function paintIncubusFrame(ctx: Ctx, state: string, frame: number): void {
  const row = ROWS.get(state);
  if (row === undefined) return;
  const pose: CarlPose = { ...row.pose(frame), gear: NO_GEAR };
  const attachments = incubusAttachments(row.motion(frame));
  // Reset in `finally`: a painter that throws mid-bake must not leave the next
  // figure baked — Carl or a resident — in this one's skin, shirt or face.
  setCarlSkinHairRamp(INCUBUS_SKIN, INCUBUS_HAIR);
  setCarlGarmentRamp(INCUBUS_SHIRT);
  setCarlTorsoCut(SHIRT_HEM_DROP, false, SHIRT_HEM_FLARE);
  setCarlExpression(INCUBUS_EXPRESSION);
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, GROUND_Y);
    ctx.scale(UNIT_PX_X, UNIT_PX_Y);
    DRAW_BY_VIEW[row.view](ctx, pose, { attachments });
  } finally {
    ctx.restore();
    resetCarlSkinHairRamp();
    resetCarlGarmentRamp();
    resetCarlTorsoCut();
    resetCarlExpression();
  }
}

const FRAME_COUNTS: Record<string, number> = Object.fromEntries(
  [...ROWS].map(([name, row]) => [name, row.frames]),
);

export const INCUBUS_FIGURE: FigureDef = {
  id: 'mordecai_incubus',
  frameWidth: CELL_WIDTH,
  frameHeight: CELL_HEIGHT,
  tileX: ORIGIN_X - HALF_TILE,
  tileY: GROUND_Y - INCUBUS_TILE_SCALE,
  tileScale: INCUBUS_TILE_SCALE,
  // Carl's painter composes on its own surface at the bake's density, with a
  // one-pixel outline; a supersampled bake would only smear it.
  skipSupersample: true,
  states: figureStates(FRAME_COUNTS),
  paintFrame: paintIncubusFrame,
};
