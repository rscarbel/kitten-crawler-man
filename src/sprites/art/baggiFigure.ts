/**
 * Baggi as a painted figure: the biped rig and its choreography
 * (`biped/figure.ts`, `human/`), in her green skin, mustard coat-dress and apron, with the hair,
 * ears, tusks, apron and bodice of `baggiArt.ts` composed into it.
 *
 * Her own figure rather than a street-cast look, because the cast's paint path
 * has no hook for the sleeve: Dave's shoved-up sleeve, bunched at the elbow,
 * squares off the shoulders and reads as a man's arm, so her look gives her a
 * long sleeve and a soft cuff.
 *
 * Rows, in three views (profile drawn facing +X and mirrored at runtime):
 *    idle / idle_side / idle_away   — the figure's breathing idle
 *    walk / walk_side / walk_away   — the figure's walk
 *    talk / talk_side / talk_away   — the figure's talk
 */

import { stillOutfit } from '../garments/human/humanDressing';
import { outfitOf } from '../garments/outfit';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  type BipedComposeOptions,
  drawBipedBack,
  drawBipedFront,
  drawBipedSide,
} from './biped/figure';
import type { BipedPose } from './biped/rig';
import { type CardinalView } from '../facingView';
import { pt } from './biped/geometry';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import { type HumanLook, lookPxPerUnit } from '../looks/humanLook';
import { DAVE_JACKET } from '../garments/human/daveJacket';
import { RIG_LOOK } from '../looks/humans/rig';
import { idleBack, idleFront, idleSide } from './human/idles';
import { walkFacing, walkSide } from './human/locomotion';
import { talkBack, talkFront, talkSide, TALK_FRAMES } from './human/actionsMisc';
import { IDLE_FRAMES, idleBlinkLid, idleBreathPhase, WALK_FRAMES } from './human/timing';
import { drawShoes } from './human/townAccessories';
import {
  BAGGI_ATTACHMENTS,
  BAGGI_COAT_RAMP,
  BAGGI_DRESS_CUT,
  BAGGI_EXPRESSION,
  BAGGI_HAIR,
  BAGGI_SHOE,
  BAGGI_SKIN,
  BAGGI_SLEEVE_CUT,
  baggiPosture,
} from './baggiArt';

type Ctx = CanvasRenderingContext2D;

export type BaggiView = 'front' | 'side' | 'away';
export type BaggiRole = 'idle' | 'walk' | 'talk';

const VIEW_SUFFIX: Readonly<Record<BaggiView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};
const BIPED_VIEW: Readonly<Record<BaggiView, CardinalView>> = {
  front: 'front',
  side: 'side',
  away: 'back',
};

export const BAGGI_VIEWS: readonly BaggiView[] = ['front', 'side', 'away'];
export const BAGGI_ROLES: readonly BaggiRole[] = ['idle', 'walk', 'talk'];

export function baggiStateName(role: BaggiRole, view: BaggiView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * The base figure's height and, sideways, a shade under its width: stout and matronly.
 * The breadth she needs is in the bell skirt, not the shoulders — widening the
 * whole figure further squares the shoulders and reads as a man.
 */
const BAGGI_WIDTH_SCALE = 0.84;

/**
 * Her look on the rig: Dave's crop and eyes under her own hair, skin, coat
 * and face, so the hair and ears painted over them are hers. Of Dave's base
 * garments she keeps only the jacket, recut as her coat: under the skirt her
 * legs are her own.
 */
const BAGGI_LOOK: HumanLook = {
  ...RIG_LOOK,
  id: 'baggi',
  skin: BAGGI_SKIN,
  hair: BAGGI_HAIR,
  garment: BAGGI_COAT_RAMP,
  garmentCut: BAGGI_DRESS_CUT,
  sleeveCut: BAGGI_SLEEVE_CUT,
  expression: BAGGI_EXPRESSION,
  widthScale: BAGGI_WIDTH_SCALE,
  baseGarments: [DAVE_JACKET],
};
const UNIT_PX = lookPxPerUnit(BAGGI_LOOK, HUMAN_CELL_PX_PER_UNIT);

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / BAGGI_TILE_SCALE`. */
export const BAGGI_TILE_SCALE = 64;
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
const HALF_TILE = BAGGI_TILE_SCALE / 2;

// ── Rows ─────────────────────────────────────────────────────────────────────

interface Row {
  readonly frames: number;
  readonly view: BaggiView;
  readonly pose: (frame: number) => BipedPose;
}

const IDLE_POSE: Readonly<Record<BaggiView, (phase: number, lid: number) => BipedPose>> = {
  front: idleFront,
  side: idleSide,
  away: idleBack,
};
const WALK_POSE: Readonly<Record<BaggiView, (phase: number) => BipedPose>> = {
  front: (phase) => walkFacing(phase, false),
  side: walkSide,
  away: (phase) => walkFacing(phase, true),
};
const TALK_POSE: Readonly<Record<BaggiView, (frame: number) => BipedPose>> = {
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
 * behind the arms hang as the base figure's do.
 */
const FOLDED_HANDS_Y = -1.0;
const FOLDED_HAND_SPREAD = 0.05;
const FOLDED_HANDS_DEPTH = 0.2;
const FOLDED_HAND_FIST = 0.35;
const PROFILE_FOLDED_HANDS_X = 0.2;

function foldHands(pose: BipedPose, view: BaggiView): BipedPose {
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

function rowFor(role: BaggiRole, view: BaggiView): Row {
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
  BAGGI_ROLES.flatMap((role) =>
    BAGGI_VIEWS.map((view): [string, Row] => [baggiStateName(role, view), rowFor(role, view)]),
  ),
);

const DRAW_BY_VIEW: Readonly<
  Record<BaggiView, (ctx: Ctx, pose: BipedPose, options: BipedComposeOptions) => void>
> = {
  front: drawBipedFront,
  side: drawBipedSide,
  away: drawBipedBack,
};

/** Nothing over her base garments: none of the crawler's gear. */
const NOTHING_OVER_HER_BASE = stillOutfit(outfitOf(BAGGI_LOOK, []));

function paintBaggiFrame(ctx: Ctx, state: string, frame: number): void {
  const row = ROWS.get(state);
  if (row === undefined) return;
  const bipedView = BIPED_VIEW[row.view];
  const pose = baggiPosture({ ...row.pose(frame), outfit: NOTHING_OVER_HER_BASE }, bipedView);
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, GROUND_Y);
    ctx.scale(UNIT_PX.x, UNIT_PX.y);
    DRAW_BY_VIEW[row.view](ctx, pose, { look: BAGGI_LOOK, attachments: BAGGI_ATTACHMENTS });
    drawShoes(ctx, bipedView, pose, BAGGI_SHOE);
  } finally {
    ctx.restore();
  }
}

const FRAME_COUNTS: Record<string, number> = Object.fromEntries(
  [...ROWS].map(([name, row]) => [name, row.frames]),
);

export const BAGGI_FIGURE: FigureDef = {
  id: 'baggi',
  frameWidth: CELL_WIDTH,
  frameHeight: CELL_HEIGHT,
  tileX: ORIGIN_X - HALF_TILE,
  tileY: GROUND_Y - BAGGI_TILE_SCALE,
  tileScale: BAGGI_TILE_SCALE,
  // The biped painter composes on its own surface at the bake's density, with a
  // one-pixel outline; a supersampled bake would only smear it.
  skipSupersample: true,
  states: figureStates(FRAME_COUNTS),
  paintFrame: paintBaggiFrame,
};
