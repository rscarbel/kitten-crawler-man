/**
 * The Demon Liaison as a painted figure: the biped rig and its choreography
 * (`biped/figure.ts`, `human/`), in a dusky grey skin, slicked black hair and a
 * wine silk shirt, with the horns, wings, tail, sash, trousers and boots of
 * `demonLiaisonArt.ts` composed into it.
 *
 * A finished character asset with no placement yet: nothing in play draws it.
 * The `?demonliaison` preview and `npm run render:demon-liaison` are where it
 * is seen.
 *
 * Built on the biped rig rather than a rig of its own for the same reason the
 * town's residents are: it is the only figure in the game whose movement
 * convinces, and it puts him in the same drawing style as the humans around
 * him.
 *
 * Rows, in three views (profile drawn facing +X and mirrored at runtime):
 *    idle / idle_side / idle_away   — the figure's breathing idle, blink included
 *    walk / walk_side / walk_away   — the figure's walk, paced by ground covered
 *    talk / talk_side / talk_away   — the figure's talking gestures
 */

import { stillOutfit } from '../garments/human/humanDressing';
import { DAVE_JACKET } from '../garments/human/daveJacket';
import {
  resetTownsfolkLegwear,
  setTownsfolkLegwear,
  TOWNSFOLK_SHOES,
  TOWNSFOLK_TROUSERS,
} from '../garments/human/townsfolkLegwear';
import { outfitOf } from '../garments/outfit';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  type BipedComposeOptions,
  drawBipedBack,
  drawBipedFront,
  drawBipedSide,
} from './biped/figure';
import { type BipedPose } from './biped/rig';
import {
  FACING_BROW_DEFAULT,
  FLAT_MOUTH,
  PROFILE_BROW_DEFAULT,
  RIG_BROW_TONE,
  RIG_EYES,
} from './biped/head';
import { type HumanLook, lookPxPerUnit } from '../looks/humanLook';
import { RIG_LOOK } from '../looks/humans/rig';
import { RIG_GARMENT_CUT } from './biped/torso';
import { idleBack, idleExhale, idleFront, idleSide } from './human/idles';
import { walkFacing, walkSide } from './human/locomotion';
import { talkBack, talkFront, talkSide, TALK_FRAMES } from './human/actionsMisc';
import { IDLE_FRAMES, idleBlinkLid, idleBreathPhase, WALK_FRAMES } from './human/timing';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import {
  DEMON_LIAISON_HAIR,
  DEMON_LIAISON_LEGWEAR,
  DEMON_LIAISON_SHIRT,
  DEMON_LIAISON_SKIN,
  type DemonLiaisonMotion,
  demonLiaisonAttachments,
} from './demonLiaisonArt';
import { TWO_PI } from './biped/geometry';

type Ctx = CanvasRenderingContext2D;

export type DemonLiaisonView = 'front' | 'side' | 'away';
export type DemonLiaisonRole = 'idle' | 'walk' | 'talk';

const VIEW_SUFFIX: Readonly<Record<DemonLiaisonView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};

export const DEMON_LIAISON_VIEWS: readonly DemonLiaisonView[] = ['front', 'side', 'away'];
export const DEMON_LIAISON_ROLES: readonly DemonLiaisonRole[] = ['idle', 'walk', 'talk'];

export function demonLiaisonStateName(role: DemonLiaisonRole, view: DemonLiaisonView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * He stands a little taller than the human crawler and the townsfolk, and broader again
 * than that: a heroic frame reads by shoulders a size too big for the head,
 * never by a bigger head. Height is uniform scale; the extra width is
 * horizontal only.
 */
export const DEMON_LIAISON_HEIGHT_SCALE = 1.06;
const DEMON_LIAISON_WIDTH_SCALE = 1.14;

/**
 * A shirt cut just past the waist, with no zip or waistband of its own: the
 * sash is the waistband. Dave's jacket repainted in silk.
 */
const SHIRT_HEM_DROP = 0.06;
const SHIRT_HEM_FLARE = 1.04;

/** Calm and faintly amused: Dave's brow, with almost none of his combat scowl. */
const DEMON_LIAISON_ANGER_SCALE = 0.12;
/** Dave's own mouth, at its own width. */
const DEMON_LIAISON_LIP_FULLNESS = 1;

/**
 * The Demon Liaison on the rig: Dave's crop under his own hair, Dave's jacket
 * recut as the shirt, and nothing else of Dave's under it — not his jeans.
 */
const DEMON_LIAISON_LOOK: HumanLook = {
  ...RIG_LOOK,
  id: 'demon_liaison',
  skin: DEMON_LIAISON_SKIN,
  hair: DEMON_LIAISON_HAIR,
  garment: DEMON_LIAISON_SHIRT,
  garmentCut: {
    ...RIG_GARMENT_CUT,
    hemDrop: SHIRT_HEM_DROP,
    hasHardware: false,
    hemFlare: SHIRT_HEM_FLARE,
  },
  expression: {
    angerScale: DEMON_LIAISON_ANGER_SCALE,
    profileBrow: PROFILE_BROW_DEFAULT,
    facingBrow: FACING_BROW_DEFAULT,
    lipFullness: DEMON_LIAISON_LIP_FULLNESS,
    mouthSmile: FLAT_MOUTH,
    eyes: RIG_EYES,
    browTone: RIG_BROW_TONE,
  },
  heightScale: DEMON_LIAISON_HEIGHT_SCALE,
  // The extra breadth is measured against his own height, not the base figure's.
  widthScale: DEMON_LIAISON_HEIGHT_SCALE * DEMON_LIAISON_WIDTH_SCALE,
  baseGarments: [DAVE_JACKET],
};
const UNIT_PX = lookPxPerUnit(DEMON_LIAISON_LOOK, HUMAN_CELL_PX_PER_UNIT);

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / DEMON_LIAISON_TILE_SCALE`. */
const DEMON_LIAISON_TILE_SCALE = 64;
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
const HALF_TILE = DEMON_LIAISON_TILE_SCALE / 2;

// ── Secondary motion ─────────────────────────────────────────────────────────

/**
 * The folded wings settle and rise with the breath; the tail idles through a
 * slow half-sway. Both are sampled once per frame of a loop that holds each
 * frame close to half a second, so they are kept small: a big swing sampled
 * that coarsely strobes instead of moving.
 */
const IDLE_TAIL_SWAY = 0.6;
const IDLE_WING_LIFT = 0.5;
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

function idleMotion(phase: number): DemonLiaisonMotion {
  return {
    tailSway: Math.sin(phase * TWO_PI) * IDLE_TAIL_SWAY,
    wingLift: (1 - idleExhale(phase)) * IDLE_WING_LIFT,
  };
}

function walkMotion(phase: number): DemonLiaisonMotion {
  return {
    tailSway: Math.sin(phase * TWO_PI) * WALK_TAIL_SWAY,
    wingLift: breathOf(phase * FOOTFALLS_PER_STRIDE) * WALK_WING_LIFT,
  };
}

function talkMotion(phase: number): DemonLiaisonMotion {
  return {
    tailSway: Math.sin(phase * TWO_PI * TALK_TAIL_FLICKS) * TALK_TAIL_SWAY,
    wingLift: breathOf(phase) * TALK_WING_LIFT,
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

interface DemonLiaisonRow {
  readonly frames: number;
  readonly pose: (frame: number) => BipedPose;
  readonly motion: (frame: number) => DemonLiaisonMotion;
}

const IDLE_POSE: Readonly<Record<DemonLiaisonView, (phase: number, lid: number) => BipedPose>> = {
  front: idleFront,
  side: idleSide,
  away: idleBack,
};
const WALK_POSE: Readonly<Record<DemonLiaisonView, (phase: number) => BipedPose>> = {
  front: (phase) => walkFacing(phase, false),
  side: walkSide,
  away: (phase) => walkFacing(phase, true),
};
const TALK_POSE: Readonly<Record<DemonLiaisonView, (frame: number) => BipedPose>> = {
  front: talkFront,
  side: talkSide,
  away: talkBack,
};

function rowFor(role: DemonLiaisonRole, view: DemonLiaisonView): DemonLiaisonRow {
  if (role === 'idle') {
    return {
      frames: IDLE_FRAMES,
      pose: (frame) => IDLE_POSE[view](idleBreathPhase(frame), idleBlinkLid(frame)),
      motion: (frame) => idleMotion(idleBreathPhase(frame)),
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

interface NamedRow extends DemonLiaisonRow {
  readonly view: DemonLiaisonView;
}

const ROWS: ReadonlyMap<string, NamedRow> = new Map(
  DEMON_LIAISON_ROLES.flatMap((role) =>
    DEMON_LIAISON_VIEWS.map((view): [string, NamedRow] => [
      demonLiaisonStateName(role, view),
      { ...rowFor(role, view), view },
    ]),
  ),
);

const DRAW_BY_VIEW: Readonly<
  Record<DemonLiaisonView, (ctx: Ctx, pose: BipedPose, options: BipedComposeOptions) => void>
> = {
  front: drawBipedFront,
  side: drawBipedSide,
  away: drawBipedBack,
};

/**
 * His shirt — the rig's jacket, recut and recoloured by his look — and the
 * cast's trousers and shoes in his own colours. None of the crawler's gear.
 */
const DEMON_LIAISON_OUTFIT = stillOutfit(
  outfitOf(DEMON_LIAISON_LOOK, [TOWNSFOLK_TROUSERS, TOWNSFOLK_SHOES]),
);

function paintDemonLiaisonFrame(ctx: Ctx, state: string, frame: number): void {
  const row = ROWS.get(state);
  if (row === undefined) return;
  const pose: BipedPose = { ...row.pose(frame), outfit: DEMON_LIAISON_OUTFIT };
  const attachments = demonLiaisonAttachments(row.motion(frame));
  // Reset in `finally`: a painter that throws mid-bake must not leave the next
  // figure baked — the player or a resident — in this one's legwear.
  setTownsfolkLegwear(DEMON_LIAISON_LEGWEAR);
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, GROUND_Y);
    ctx.scale(UNIT_PX.x, UNIT_PX.y);
    DRAW_BY_VIEW[row.view](ctx, pose, { look: DEMON_LIAISON_LOOK, attachments });
  } finally {
    ctx.restore();
    resetTownsfolkLegwear();
  }
}

const FRAME_COUNTS: Record<string, number> = Object.fromEntries(
  [...ROWS].map(([name, row]) => [name, row.frames]),
);

export const DEMON_LIAISON_FIGURE: FigureDef = {
  id: 'demon_liaison',
  frameWidth: CELL_WIDTH,
  frameHeight: CELL_HEIGHT,
  tileX: ORIGIN_X - HALF_TILE,
  tileY: GROUND_Y - DEMON_LIAISON_TILE_SCALE,
  tileScale: DEMON_LIAISON_TILE_SCALE,
  // The biped painter composes on its own surface at the bake's density, with a
  // one-pixel outline; a supersampled bake would only smear it.
  skipSupersample: true,
  states: figureStates(FRAME_COUNTS),
  paintFrame: paintDemonLiaisonFrame,
};
