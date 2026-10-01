/**
 * GumGum as a painted figure: Carl's own rig and choreography (`carl/figure.ts`,
 * `human/`), in her green skin, mustard coat-dress and apron, with the hair,
 * ears, tusks, apron and bodice of `gumGumArt.ts` composed into it.
 *
 * Her own figure rather than a street-cast look, because the cast's paint path
 * has no hook for the sleeve: Carl's shoved-up sleeve, bunched at the elbow,
 * squares off the shoulders and reads as a man's arm, so she is drawn with a
 * long sleeve and a soft cuff, swapped in and reset like every other cut.
 *
 * Rows, in three views (profile drawn facing +X and mirrored at runtime):
 *    idle / idle_side / idle_away   — Carl's breathing idle
 *    walk / walk_side / walk_away   — Carl's walk
 *    talk / talk_side / talk_away   — Carl's talk
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import { type CarlComposeOptions, drawCarlBack, drawCarlFront, drawCarlSide } from './carl/figure';
import { resetCarlExpression, setCarlExpression } from './carl/head';
import {
  resetCarlGarmentRamp,
  resetCarlSkinHairRamp,
  setCarlGarmentRamp,
  setCarlSkinHairRamp,
} from './carl/palette';
import type { CarlPose, CarlView } from './carl/rig';
import { pt } from './carl/geometry';
import { resetCarlSleeveCut, setCarlSleeveCut } from './carl/sleeve';
import { resetCarlTorsoCut, setCarlTorsoCut } from './carl/torso';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import { idleBack, idleFront, idleSide } from './human/idles';
import { walkFacing, walkSide } from './human/locomotion';
import { talkBack, talkFront, talkSide, TALK_FRAMES } from './human/actionsMisc';
import { IDLE_FRAMES, idleBlinkLid, idleBreathPhase, WALK_FRAMES } from './human/timing';
import { drawShoes } from './human/townAccessories';
import {
  GUMGUM_ATTACHMENTS,
  GUMGUM_COAT_RAMP,
  GUMGUM_DRESS_HEM_DROP,
  GUMGUM_DRESS_HEM_FLARE,
  GUMGUM_EXPRESSION,
  GUMGUM_HAIR,
  GUMGUM_SHOE,
  GUMGUM_SKIN,
  GUMGUM_SLEEVE_CUFF_ALONG,
  GUMGUM_SLEEVE_CUFF_BULK,
  gumGumPosture,
} from './gumGumArt';

type Ctx = CanvasRenderingContext2D;

export type GumGumView = 'front' | 'side' | 'away';
export type GumGumRole = 'idle' | 'walk' | 'talk';

const VIEW_SUFFIX: Readonly<Record<GumGumView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};
const CARL_VIEW: Readonly<Record<GumGumView, CarlView>> = {
  front: 'front',
  side: 'side',
  away: 'back',
};

export const GUMGUM_VIEWS: readonly GumGumView[] = ['front', 'side', 'away'];
export const GUMGUM_ROLES: readonly GumGumRole[] = ['idle', 'walk', 'talk'];

export function gumGumStateName(role: GumGumRole, view: GumGumView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * Carl's height and, sideways, a shade under his width: stout and matronly.
 * The breadth she needs is in the bell skirt, not the shoulders — widening the
 * whole figure further squares the shoulders and reads as a man.
 */
const GUMGUM_WIDTH_SCALE = 0.84;
const UNIT_PX_Y = HUMAN_CELL_PX_PER_UNIT;
const UNIT_PX_X = HUMAN_CELL_PX_PER_UNIT * GUMGUM_WIDTH_SCALE;

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / GUMGUM_TILE_SCALE`. */
export const GUMGUM_TILE_SCALE = 64;
/**
 * Room for the bun above the head, the bell skirt's hem and a stride. The
 * structural gate re-measures that no frame's ink touches an edge.
 */
const CELL_WIDTH = 160;
const CELL_HEIGHT = 200;
/** Floor below the soles, for the contact shadow. */
const GROUND_MARGIN = 14;
const GROUND_Y = CELL_HEIGHT - GROUND_MARGIN;
const ORIGIN_X = CELL_WIDTH / 2;
const HALF_TILE = GUMGUM_TILE_SCALE / 2;

// ── Rows ─────────────────────────────────────────────────────────────────────

interface Row {
  readonly frames: number;
  readonly view: GumGumView;
  readonly pose: (frame: number) => CarlPose;
}

const IDLE_POSE: Readonly<Record<GumGumView, (phase: number, lid: number) => CarlPose>> = {
  front: idleFront,
  side: idleSide,
  away: idleBack,
};
const WALK_POSE: Readonly<Record<GumGumView, (phase: number) => CarlPose>> = {
  front: (phase) => walkFacing(phase, false),
  side: walkSide,
  away: (phase) => walkFacing(phase, true),
};
const TALK_POSE: Readonly<Record<GumGumView, (frame: number) => CarlPose>> = {
  front: talkFront,
  side: talkSide,
  away: talkBack,
};

/**
 * Standing, she waits with her hands folded in front of her apron. It pulls her
 * elbows in off the line of her shoulders, so the bell of the skirt shows
 * either side instead of two arms hanging square down her sides — and it is a
 * patient, kindly way to stand. Head-on the hands meet just under the apron's
 * bow, in front of the body; edge-on they rest on the front of the apron. From
 * behind the arms hang as Carl's do.
 */
const FOLDED_HANDS_Y = -1.0;
const FOLDED_HAND_SPREAD = 0.05;
const FOLDED_HANDS_DEPTH = 0.2;
const FOLDED_HAND_FIST = 0.35;
const PROFILE_FOLDED_HANDS_X = 0.2;

function foldHands(pose: CarlPose, view: GumGumView): CarlPose {
  if (view === 'away') return pose;
  const lift = pose.bob;
  const atX = view === 'side' ? PROFILE_FOLDED_HANDS_X : 0;
  return {
    ...pose,
    leftArmAngles: null,
    rightArmAngles: null,
    leftHand: pt(atX - FOLDED_HAND_SPREAD, FOLDED_HANDS_Y + lift),
    rightHand: pt(atX + FOLDED_HAND_SPREAD, FOLDED_HANDS_Y + lift),
    leftHandDepth: FOLDED_HANDS_DEPTH,
    rightHandDepth: FOLDED_HANDS_DEPTH,
    leftArmBehind: false,
    rightArmBehind: false,
    leftFist: FOLDED_HAND_FIST,
    rightFist: FOLDED_HAND_FIST,
  };
}

function rowFor(role: GumGumRole, view: GumGumView): Row {
  if (role === 'idle') {
    return {
      frames: IDLE_FRAMES,
      view,
      pose: (frame) =>
        foldHands(IDLE_POSE[view](idleBreathPhase(frame), idleBlinkLid(frame)), view),
    };
  }
  if (role === 'walk') {
    return { frames: WALK_FRAMES, view, pose: (frame) => WALK_POSE[view](frame / WALK_FRAMES) };
  }
  return { frames: TALK_FRAMES, view, pose: TALK_POSE[view] };
}

const ROWS: ReadonlyMap<string, Row> = new Map(
  GUMGUM_ROLES.flatMap((role) =>
    GUMGUM_VIEWS.map((view): [string, Row] => [gumGumStateName(role, view), rowFor(role, view)]),
  ),
);

const DRAW_BY_VIEW: Readonly<
  Record<GumGumView, (ctx: Ctx, pose: CarlPose, options: CarlComposeOptions) => void>
> = {
  front: drawCarlFront,
  side: drawCarlSide,
  away: drawCarlBack,
};

/** No Carl gear: no cloak, no gauntlet, no trollskin band at the collar. */
const NO_GEAR = {} as const;

function paintGumGumFrame(ctx: Ctx, state: string, frame: number): void {
  const row = ROWS.get(state);
  if (row === undefined) return;
  const carlView = CARL_VIEW[row.view];
  const pose = gumGumPosture({ ...row.pose(frame), gear: NO_GEAR }, carlView);
  // Reset in `finally`: a painter that throws mid-bake must not leave the next
  // figure baked — Carl or a resident — in her skin, dress, sleeves or face.
  setCarlSkinHairRamp(GUMGUM_SKIN, GUMGUM_HAIR);
  setCarlGarmentRamp(GUMGUM_COAT_RAMP);
  setCarlTorsoCut(GUMGUM_DRESS_HEM_DROP, false, GUMGUM_DRESS_HEM_FLARE);
  setCarlSleeveCut(GUMGUM_SLEEVE_CUFF_ALONG, GUMGUM_SLEEVE_CUFF_BULK);
  setCarlExpression(GUMGUM_EXPRESSION);
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, GROUND_Y);
    ctx.scale(UNIT_PX_X, UNIT_PX_Y);
    DRAW_BY_VIEW[row.view](ctx, pose, { attachments: GUMGUM_ATTACHMENTS });
    drawShoes(ctx, carlView, pose, GUMGUM_SHOE);
  } finally {
    ctx.restore();
    resetCarlSkinHairRamp();
    resetCarlGarmentRamp();
    resetCarlTorsoCut();
    resetCarlSleeveCut();
    resetCarlExpression();
  }
}

const FRAME_COUNTS: Record<string, number> = Object.fromEntries(
  [...ROWS].map(([name, row]) => [name, row.frames]),
);

export const GUMGUM_FIGURE: FigureDef = {
  id: 'gumgum',
  frameWidth: CELL_WIDTH,
  frameHeight: CELL_HEIGHT,
  tileX: ORIGIN_X - HALF_TILE,
  tileY: GROUND_Y - GUMGUM_TILE_SCALE,
  tileScale: GUMGUM_TILE_SCALE,
  // Carl's painter composes on its own surface at the bake's density, with a
  // one-pixel outline; a supersampled bake would only smear it.
  skipSupersample: true,
  states: figureStates(FRAME_COUNTS),
  paintFrame: paintGumGumFrame,
};
