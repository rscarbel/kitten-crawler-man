/**
 * Ivy Ashgrove, the Barracks Mercenaries' archer, as a painted figure: the
 * biped rig and its choreography (`biped/figure.ts`, `human/`) in her own
 * look, with the quiver, strap and ponytail of `ivyAshgroveArt.ts` composed
 * into it and the longbow in her left fist on every row.
 *
 * Rows, in three views (profile drawn facing +X and mirrored at runtime):
 *    idle / idle_side / idle_away    — the rig's breathing idle, the bow carried
 *    walk / walk_side / walk_away    — the rig's walk, paced by ground covered
 *    shoot / shoot_side / shoot_away — nock, draw, aim, loose and recover
 *                                      (`human/actionsBow.ts`)
 *    hurt / hurt_side / hurt_away    — the rig's flinch, its recoil only: the
 *                                      rig's guard coming back up after it
 *                                      reads as a hand held to her face
 *    death_side                      — the rig's fall, ending lying still; she
 *                                      falls in profile whichever way she faced,
 *                                      as the human crawler does
 */

import { HIRELING_ARMBAND } from '../garments/human/hirelingArmband';
import { stillOutfit } from '../garments/human/humanDressing';
import { DAVE_JACKET } from '../garments/human/daveJacket';
import { IVY_BOOTS, IVY_BRACER, IVY_TROUSERS } from '../garments/human/ivyAshgroveClothes';
import { outfitOf } from '../garments/outfit';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { type CardinalView } from '../facingView';
import {
  type BipedComposeOptions,
  drawBipedBack,
  drawBipedFront,
  drawBipedSide,
} from './biped/figure';
import {
  type EyeStyle,
  FEMININE_FACING_BROW,
  FEMININE_PROFILE_BROW,
  type HeadFeaturePainter,
  RIG_BROW_TONE,
  RIG_EYES,
} from './biped/head';
import type { LimbBuild } from './biped/limbs';
import { FACING_SHOULDER_SPREAD } from './biped/proportions';
import { type BipedPose } from './biped/rig';
import { COTTON_SLEEVE_CONTRAST, LEVEL_CAP, PADDED_SLEEVE } from './biped/sleeve';
import { RIG_GARMENT_CUT } from './biped/torso';
import { type HumanLook, lookPxPerUnit } from '../looks/humanLook';
import { RIG_LOOK } from '../looks/humans/rig';
import {
  bowGoingDown,
  bowShotBack,
  bowShotFront,
  bowShotSide,
  carryBow,
  FLINCH_BOW_FIST,
  FLINCH_BOW_LEAN,
} from './human/actionsBow';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import { idleBack, idleFront, idleSide } from './human/idles';
import { walkFacing, walkSide } from './human/locomotion';
import { HURT_RECOIL_FRAMES, REACTION_ROW_TABLE } from './human/reactions';
import {
  BOW_SHOT_FRAMES,
  IDLE_FRAMES,
  idleBlinkLid,
  idleBreathPhase,
  WALK_FRAMES,
} from './human/timing';
import { IVY_ATTACHMENTS, IVY_HAIR, IVY_JERKIN, IVY_SKIN } from './ivyAshgroveArt';

type Ctx = CanvasRenderingContext2D;

export type IvyView = 'front' | 'side' | 'away';
export type IvyRole = 'idle' | 'walk' | 'shoot' | 'hurt' | 'death';

const VIEW_SUFFIX: Readonly<Record<IvyView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};
const CARDINAL: Readonly<Record<IvyView, CardinalView>> = {
  front: 'front',
  side: 'side',
  away: 'back',
};

const IVY_VIEWS: readonly IvyView[] = ['front', 'side', 'away'];
export const IVY_ROLES: readonly IvyRole[] = ['idle', 'walk', 'shoot', 'hurt', 'death'];

/** The views each role is painted in: the fall is profile only. */
export const IVY_ROLE_VIEWS: Readonly<Record<IvyRole, readonly IvyView[]>> = {
  idle: IVY_VIEWS,
  walk: IVY_VIEWS,
  shoot: IVY_VIEWS,
  hurt: IVY_VIEWS,
  death: ['side'],
};

export function ivyStateName(role: IvyRole, view: IvyView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

// ── Build ────────────────────────────────────────────────────────────────────

/** A shade shorter than the rig, who stands a big man's height. */
export const IVY_HEIGHT_SCALE = 0.96;
/** Lean and narrow-shouldered, an archer's frame rather than a brawler's. */
const IVY_WIDTH_SCALE = 0.84;
/** Head-on her shoulders stand a little past her chest, not in the rig's heavy V. */
const IVY_SHOULDER_SPREAD_SHARE = 0.78;
/** Her hips sit nearly as wide as the rig's under a narrower frame. */
const IVY_HIP_SPREAD = 0.95;
/** A narrower face than the rig's broad-jawed one, which read as a man's even under long hair. */
const IVY_HEAD_BREADTH = 0.82;
/** A slender neck that rounds softly into the jaw, where the rig's is a heavy, muscled column. */
const IVY_NECK_GIRTH = 0.72;
const IVY_NECK_SOFTNESS = 3;
/**
 * Her chest narrower than the rig's barrel and her shoulders sloping from the
 * neck: a square-shouldered block reads as a man's torso at the tile.
 */
const IVY_CHEST_ACROSS = 0.86;
const IVY_SHOULDER_DROP = 0.06;

const IVY_LIMBS: LimbBuild = {
  thighGirth: 0.84,
  shinGirth: 0.8,
  legDepth: 0.86,
  upperArmGirth: 0.74,
  upperArmDepth: 0.78,
  forearmGirth: 0.82,
  footWidth: 0.8,
  footLength: 0.88,
  handLength: 0.86,
  handBreadth: 0.78,
  forearmTerminator: 0.5,
};

/**
 * A jerkin cut to the top of the thigh and belted at the waist, its skirt
 * flaring out over the hips: the waist pinched between shoulders and hips is
 * what reads as a woman's figure at the tile, where a straight-cut jerkin
 * reads as a man's block.
 */
const JERKIN_HEM_DROP = 0.32;
const JERKIN_HEM_FLARE = 1.3;
/** Fitted sleeves to the wrist: only her hands show, the bracer and armband over the cloth. */
const SLEEVE_CUFF_ALONG = 0.9;
const SLEEVE_CUFF_BULK = 1.4;

/** Steady and composed: a feminine brow, only a trace of the rig's scowl even at the aim. */
const IVY_ANGER_SCALE = 0.1;
const IVY_LIP_FULLNESS = 1.2;
/** The corners of her mouth turned up a hair: calm, not grim. */
const IVY_MOUTH_SMILE = 0.006;

/**
 * Open eyes with the whites showing head-on and a lid line lightened toward
 * the skin: the rig's own heavy-lidded slit reads at the tile as a man's
 * squint, and that squint was most of what made her face read as a man's.
 */
const IVY_EYES: EyeStyle = {
  ...RIG_EYES,
  facingSclera: true,
  lidWeight: 0.8,
  lidInk: 0.45,
  openness: 1.25,
};

/** The rig paints none of its own hair on her: her ponytail is an attachment. */
const HAIR_PAINTED_BY_ATTACHMENT: HeadFeaturePainter = () => undefined;

/**
 * Ivy on the rig: Dave's jacket recut as her jerkin, with a woman's face and
 * an archer's lean build; her trousers, boots and bracer are worn over it.
 */
const IVY_LOOK: HumanLook = {
  ...RIG_LOOK,
  id: 'ivy_ashgrove',
  skin: IVY_SKIN,
  hair: IVY_HAIR,
  garment: IVY_JERKIN,
  garmentCut: {
    ...RIG_GARMENT_CUT,
    hemDrop: JERKIN_HEM_DROP,
    hasHardware: false,
    hemFlare: JERKIN_HEM_FLARE,
    chestAcross: IVY_CHEST_ACROSS,
    shoulderDrop: IVY_SHOULDER_DROP,
  },
  sleeveCut: {
    cuffAlongForearm: SLEEVE_CUFF_ALONG,
    cuffBulk: SLEEVE_CUFF_BULK,
    padding: PADDED_SLEEVE,
    capSwell: PADDED_SLEEVE,
    capSlope: LEVEL_CAP,
    shadeContrast: COTTON_SLEEVE_CONTRAST,
  },
  hairstyle: HAIR_PAINTED_BY_ATTACHMENT,
  expression: {
    angerScale: IVY_ANGER_SCALE,
    profileBrow: FEMININE_PROFILE_BROW,
    facingBrow: FEMININE_FACING_BROW,
    lipFullness: IVY_LIP_FULLNESS,
    mouthSmile: IVY_MOUTH_SMILE,
    eyes: IVY_EYES,
    browTone: RIG_BROW_TONE,
  },
  heightScale: IVY_HEIGHT_SCALE,
  // Her narrowness is measured against her own height, not the base figure's.
  widthScale: IVY_HEIGHT_SCALE * IVY_WIDTH_SCALE,
  limbs: IVY_LIMBS,
  shoulderSpread: FACING_SHOULDER_SPREAD * IVY_SHOULDER_SPREAD_SHARE,
  hipSpread: IVY_HIP_SPREAD,
  headBreadth: IVY_HEAD_BREADTH,
  neckGirth: IVY_NECK_GIRTH,
  neckSoftness: IVY_NECK_SOFTNESS,
  baseGarments: [DAVE_JACKET],
};
const UNIT_PX = lookPxPerUnit(IVY_LOOK, HUMAN_CELL_PX_PER_UNIT);

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / IVY_TILE_SCALE`. */
export const IVY_TILE_SCALE = 64;
/**
 * Room for the bow's upper limb standing above her head at the aim, the
 * string drawn back past her shoulder, a stride, and the length of her lying
 * on the floor. Re-measured by the harness: no frame's ink may touch an edge.
 */
const CELL_WIDTH = 192;
const CELL_HEIGHT = 188;
/** Floor below her soles, for the contact shadow. */
const GROUND_MARGIN = 28;
const GROUND_Y = CELL_HEIGHT - GROUND_MARGIN;
const ORIGIN_X = CELL_WIDTH / 2;
const HALF_TILE = IVY_TILE_SCALE / 2;

// ── Rows ─────────────────────────────────────────────────────────────────────

interface IvyRow {
  readonly frames: number;
  readonly view: IvyView;
  readonly pose: (frame: number) => BipedPose;
}

const IDLE_POSE: Readonly<Record<IvyView, (phase: number, lid: number) => BipedPose>> = {
  front: idleFront,
  side: idleSide,
  away: idleBack,
};
const WALK_POSE: Readonly<Record<IvyView, (phase: number) => BipedPose>> = {
  front: (phase) => walkFacing(phase, false),
  side: walkSide,
  away: (phase) => walkFacing(phase, true),
};
const SHOOT_POSE: Readonly<Record<IvyView, (frame: number) => BipedPose>> = {
  front: bowShotFront,
  side: bowShotSide,
  away: bowShotBack,
};
const HURT_ROW = {
  front: REACTION_ROW_TABLE.hurt,
  side: REACTION_ROW_TABLE.hurt_side,
  away: REACTION_ROW_TABLE.hurt_away,
} as const;
const DEATH_ROW = REACTION_ROW_TABLE.death_side;

/** The bow carried on a row whose own arms are the rig's, its turn measured on the standing pose. */
function carrying(view: IvyView, pose: (frame: number) => BipedPose): (frame: number) => BipedPose {
  const rest = IDLE_POSE[view](0, 0);
  return (frame) => carryBow(pose(frame), CARDINAL[view], rest);
}

function rowFor(role: IvyRole, view: IvyView): IvyRow {
  switch (role) {
    case 'idle':
      return {
        frames: IDLE_FRAMES,
        view,
        pose: carrying(view, (frame) =>
          IDLE_POSE[view](idleBreathPhase(frame), idleBlinkLid(frame)),
        ),
      };
    case 'walk':
      return {
        frames: WALK_FRAMES,
        view,
        pose: carrying(view, (frame) => WALK_POSE[view](frame / WALK_FRAMES)),
      };
    case 'shoot':
      return { frames: BOW_SHOT_FRAMES, view, pose: SHOOT_POSE[view] };
    case 'hurt':
      return {
        frames: HURT_RECOIL_FRAMES,
        view,
        pose: (frame) =>
          carryBow(HURT_ROW[view].pose(frame), CARDINAL[view], IDLE_POSE[view](0, 0), {
            swingShare: 0,
            fist: FLINCH_BOW_FIST[CARDINAL[view]],
            lean: FLINCH_BOW_LEAN[CARDINAL[view]],
            edgeOn: true,
          }),
      };
    case 'death':
      return {
        frames: DEATH_ROW.frameCount,
        view,
        pose: (frame) => bowGoingDown(DEATH_ROW.pose(frame), CARDINAL[view], IDLE_POSE[view](0, 0)),
      };
    default: {
      const unhandled: never = role;
      throw new Error(`Ivy Ashgrove has no row for ${String(unhandled)}`);
    }
  }
}

const ROWS: ReadonlyMap<string, IvyRow> = new Map(
  IVY_ROLES.flatMap((role) =>
    IVY_ROLE_VIEWS[role].map((view): [string, IvyRow] => [
      ivyStateName(role, view),
      rowFor(role, view),
    ]),
  ),
);

const DRAW_BY_VIEW: Readonly<
  Record<IvyView, (ctx: Ctx, pose: BipedPose, options: BipedComposeOptions) => void>
> = {
  front: drawBipedFront,
  side: drawBipedSide,
  away: drawBipedBack,
};

/** Her own clothes and the hirelings' armband over the rig's base: none of the crawler's gear. */
const IVY_OUTFIT = stillOutfit(
  outfitOf(IVY_LOOK, [IVY_TROUSERS, IVY_BOOTS, IVY_BRACER, HIRELING_ARMBAND]),
);

function paintIvyFrame(ctx: Ctx, state: string, frame: number): void {
  const row = ROWS.get(state);
  if (row === undefined) return;
  const pose: BipedPose = { ...row.pose(frame), outfit: IVY_OUTFIT };
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, GROUND_Y);
    ctx.scale(UNIT_PX.x, UNIT_PX.y);
    DRAW_BY_VIEW[row.view](ctx, pose, { look: IVY_LOOK, attachments: IVY_ATTACHMENTS });
  } finally {
    ctx.restore();
  }
}

const FRAME_COUNTS: Record<string, number> = Object.fromEntries(
  [...ROWS].map(([name, row]) => [name, row.frames]),
);

export const IVY_ASHGROVE_FIGURE: FigureDef = {
  id: 'ivy_ashgrove',
  frameWidth: CELL_WIDTH,
  frameHeight: CELL_HEIGHT,
  tileX: ORIGIN_X - HALF_TILE,
  tileY: GROUND_Y - IVY_TILE_SCALE,
  tileScale: IVY_TILE_SCALE,
  // The biped painter composes on its own surface at the bake's density, with a
  // one-pixel outline; a supersampled bake would only smear it.
  skipSupersample: true,
  states: figureStates(FRAME_COUNTS),
  paintFrame: paintIvyFrame,
};
