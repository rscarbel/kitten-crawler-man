/**
 * The city elf cultist — one of Miss Quill's hooded faithful — as a painted
 * figure: Carl's own rig and choreography (`carl/figure.ts`, `human/`), drawn
 * taller and narrower as an elf, in pale skin and an ankle-length violet robe,
 * with the hood, ears, stole, sigil, girdle and shoes of
 * `cityElfCultistArt.ts` composed into it.
 *
 * Built on Carl's rig for the reason every humanoid in the town is: it is the
 * only figure in the game whose movement convinces.
 *
 * Rows, in three views (profile drawn facing +X and mirrored at runtime):
 *    idle / idle_side / idle_away   — Carl's breathing idle, eyes smouldering
 *    walk / walk_side / walk_away   — Carl's walk, paced by ground covered
 *    cast / cast_side / cast_away   — a palm thrust at the target, the soul
 *                                     bolt's light flaring in it and in the eyes
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import { type CarlComposeOptions, drawCarlBack, drawCarlFront, drawCarlSide } from './carl/figure';
import { pt, TWO_PI } from './carl/geometry';
import {
  FEMININE_FACING_BROW,
  FEMININE_PROFILE_BROW,
  resetCarlExpression,
  setCarlExpression,
} from './carl/head';
import {
  resetCarlGarmentRamp,
  resetCarlSkinHairRamp,
  setCarlGarmentRamp,
  setCarlSkinHairRamp,
} from './carl/palette';
import { type CarlPose } from './carl/rig';
import { resetCarlSleeveCut, setCarlSleeveCut } from './carl/sleeve';
import { resetCarlTorsoCut, setCarlTorsoCut } from './carl/torso';
import { lerp } from './carlArt';
import {
  CULTIST_HAIR,
  CULTIST_ROBE,
  CULTIST_SKIN,
  type CultistMotion,
  cultistAttachments,
} from './cityElfCultistArt';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import { idleBack, idleFront, idleSide } from './human/idles';
import { walkFacing, walkSide } from './human/locomotion';
import { IDLE_FRAMES, idleBlinkLid, idleBreathPhase, WALK_FRAMES } from './human/timing';

type Ctx = CanvasRenderingContext2D;

export type CultistView = 'front' | 'side' | 'away';
export type CultistRole = 'idle' | 'walk' | 'cast';

const VIEW_SUFFIX: Readonly<Record<CultistView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};

export const CULTIST_VIEWS: readonly CultistView[] = ['front', 'side', 'away'];
export const CULTIST_ROLES: readonly CultistRole[] = ['idle', 'walk', 'cast'];

export function cultistStateName(role: CultistRole, view: CultistView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * An elf stands a little taller than the townsfolk and is cut much finer:
 * height is uniform scale, the slenderness horizontal only, so the narrow
 * shoulders and the narrow face come from the same squeeze.
 */
export const CULTIST_HEIGHT_SCALE = 1.08;
const CULTIST_WIDTH_SCALE = 0.76;
const UNIT_PX_Y = HUMAN_CELL_PX_PER_UNIT * CULTIST_HEIGHT_SCALE;
const UNIT_PX_X = UNIT_PX_Y * CULTIST_WIDTH_SCALE;

/**
 * The robe falls from the shoulders to just above the ankle — past the waist
 * by nearly the waist's whole height off the floor — flaring a little toward
 * the hem so it swings rather than hanging as a tube.
 */
const ROBE_HEM_DROP = 1.0;
const ROBE_HEM_FLARE = 1.3;
/**
 * The robe's sleeves run to the wrist and open into a wide cuff, so only the
 * hands show: an elf's forearm bared like Carl's reads as a brawler.
 */
const ROBE_SLEEVE_CUFF_ALONG = 0.92;
const ROBE_SLEEVE_CUFF_BULK = 5;

/** Cold and composed: thin arched brows, a measure of Carl's scowl, a fine mouth. */
const CULTIST_ANGER_SCALE = 0.3;
const CULTIST_LIP_FULLNESS = 0.8;
const CULTIST_EXPRESSION = {
  angerScale: CULTIST_ANGER_SCALE,
  profileBrow: FEMININE_PROFILE_BROW,
  facingBrow: FEMININE_FACING_BROW,
  lipFullness: CULTIST_LIP_FULLNESS,
} as const;

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / CULTIST_TILE_SCALE`. */
export const CULTIST_TILE_SCALE = 64;
/**
 * Room for the hood's peak and the ear tips above the head, the casting arm
 * and its glow out in front, and a stride. Re-measured by the harness: no
 * frame's ink may touch the cell's edge.
 */
const CELL_WIDTH = 156;
const CELL_HEIGHT = 196;
/** Floor below the soles, for the contact shadow. */
const GROUND_MARGIN = 12;
const GROUND_Y = CELL_HEIGHT - GROUND_MARGIN;
const ORIGIN_X = CELL_WIDTH / 2;
const HALF_TILE = CULTIST_TILE_SCALE / 2;

// ── Secondary motion ─────────────────────────────────────────────────────────

/** The eyes smoulder at rest and burn on a cast. */
const RESTING_EYE_GLOW = 0.65;
const IDLE_FETISH_SWAY = 0.3;
const WALK_FETISH_SWAY = 1;

// ── The cast ─────────────────────────────────────────────────────────────────

/**
 * The cast row's frames. The bolt leaves on the cast's first tick, so the row
 * is the thrust already landing and the follow-through: the palm is out by
 * frame one, held while the light burns off, and drawn back.
 */
export const CULTIST_CAST_FRAMES = 8;
/** How far out the casting arm is, 0 at rest to 1 locked toward the target, per frame. */
const CAST_REACH: readonly number[] = [0.55, 1, 1, 0.96, 0.85, 0.62, 0.35, 0.12];
/** How bright the palm burns per frame: the bolt's own light, leaving it. */
const CAST_GLOW: readonly number[] = [0.75, 1, 0.85, 0.6, 0.4, 0.22, 0.1, 0];

function castTrack(track: readonly number[], frame: number): number {
  return track[Math.min(Math.max(frame, 0), track.length - 1)];
}

/** Edge-on the casting arm comes up to straight out from the shoulder, the forearm a touch above it. */
const SIDE_CAST_UPPER = 1.42;
const SIDE_CAST_FORE = 1.55;
const SIDE_REST_UPPER = 0.04;
const SIDE_REST_FORE = 0.14;
/** The far hand draws back toward the hip as the near one drives out. */
const SIDE_OFF_HAND_UPPER = -0.32;
const SIDE_OFF_HAND_FORE = -0.12;
const SIDE_CAST_LEAN = 0.07;

/**
 * Toward the camera the palm is pushed straight at the viewer: the hand rises
 * to the chest and comes forward, the upper arm foreshortening as it turns
 * out of the picture.
 */
const FRONT_CAST_HAND = pt(0.2, -1.3);
const FRONT_CAST_DEPTH = 0.45;
const FRONT_CAST_UPPER_ARM_SCALE = 0.5;
/**
 * Away from the camera the arm drives out past the shoulder on the far side
 * of the body: what shows of it is the hand and the light over the shoulder.
 */
const AWAY_CAST_HAND = pt(0.26, -1.82);
const AWAY_CAST_DEPTH = 0.45;
const AWAY_CAST_UPPER_ARM_SCALE = 0.6;
/** A lean into the thrust, head-on, shown as the chest pitching toward the target. */
const FACING_CAST_PITCH = 0.12;

function castOpenHand(pose: CarlPose, glow: number): void {
  pose.rightHandShape = 'open';
  pose.palmGlow = { hand: 'right', strength: glow };
}

function castSide(frame: number): CarlPose {
  const pose = idleSide(0);
  const reach = castTrack(CAST_REACH, frame);
  pose.rightArmAngles = {
    upper: lerp(SIDE_REST_UPPER, SIDE_CAST_UPPER, reach),
    fore: lerp(SIDE_REST_FORE, SIDE_CAST_FORE, reach),
    foreScale: 1,
  };
  pose.leftArmAngles = {
    upper: SIDE_OFF_HAND_UPPER * reach,
    fore: SIDE_OFF_HAND_FORE * reach,
    foreScale: 1,
  };
  pose.lean += SIDE_CAST_LEAN * reach;
  castOpenHand(pose, castTrack(CAST_GLOW, frame));
  return pose;
}

function castFacing(frame: number, away: boolean): CarlPose {
  const pose = away ? idleBack(0) : idleFront(0);
  const reach = castTrack(CAST_REACH, frame);
  const rest = pose.rightHand;
  const target = away ? AWAY_CAST_HAND : FRONT_CAST_HAND;
  pose.rightArmAngles = null;
  pose.rightHand = pt(lerp(rest.x, target.x, reach), lerp(rest.y, target.y, reach));
  pose.rightHandDepth = (away ? AWAY_CAST_DEPTH : FRONT_CAST_DEPTH) * reach;
  pose.rightUpperArmScale = lerp(
    1,
    away ? AWAY_CAST_UPPER_ARM_SCALE : FRONT_CAST_UPPER_ARM_SCALE,
    reach,
  );
  pose.torsoPitch = FACING_CAST_PITCH * reach;
  castOpenHand(pose, castTrack(CAST_GLOW, frame));
  return pose;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

interface CultistRow {
  readonly frames: number;
  readonly pose: (frame: number) => CarlPose;
  readonly motion: (frame: number) => CultistMotion;
}

const IDLE_POSE: Readonly<Record<CultistView, (phase: number, lid: number) => CarlPose>> = {
  front: idleFront,
  side: idleSide,
  away: idleBack,
};
const WALK_POSE: Readonly<Record<CultistView, (phase: number) => CarlPose>> = {
  front: (phase) => walkFacing(phase, false),
  side: walkSide,
  away: (phase) => walkFacing(phase, true),
};
const CAST_POSE: Readonly<Record<CultistView, (frame: number) => CarlPose>> = {
  front: (frame) => castFacing(frame, false),
  side: castSide,
  away: (frame) => castFacing(frame, true),
};

function rowFor(role: CultistRole, view: CultistView): CultistRow {
  if (role === 'idle') {
    return {
      frames: IDLE_FRAMES,
      pose: (frame) => IDLE_POSE[view](idleBreathPhase(frame), idleBlinkLid(frame)),
      motion: (frame) => ({
        eyeGlow: RESTING_EYE_GLOW,
        fetishSway: Math.sin(idleBreathPhase(frame) * TWO_PI) * IDLE_FETISH_SWAY,
      }),
    };
  }
  if (role === 'walk') {
    return {
      frames: WALK_FRAMES,
      pose: (frame) => WALK_POSE[view](frame / WALK_FRAMES),
      motion: (frame) => ({
        eyeGlow: RESTING_EYE_GLOW,
        fetishSway: Math.sin((frame / WALK_FRAMES) * TWO_PI) * WALK_FETISH_SWAY,
      }),
    };
  }
  return {
    frames: CULTIST_CAST_FRAMES,
    pose: CAST_POSE[view],
    motion: (frame) => ({
      eyeGlow: lerp(RESTING_EYE_GLOW, 1, castTrack(CAST_GLOW, frame)),
      fetishSway: 0,
    }),
  };
}

interface NamedRow extends CultistRow {
  readonly view: CultistView;
}

const ROWS: ReadonlyMap<string, NamedRow> = new Map(
  CULTIST_ROLES.flatMap((role) =>
    CULTIST_VIEWS.map((view): [string, NamedRow] => [
      cultistStateName(role, view),
      { ...rowFor(role, view), view },
    ]),
  ),
);

const DRAW_BY_VIEW: Readonly<
  Record<CultistView, (ctx: Ctx, pose: CarlPose, options: CarlComposeOptions) => void>
> = {
  front: drawCarlFront,
  side: drawCarlSide,
  away: drawCarlBack,
};

/** No Carl gear: no cloak, no gauntlet, no trollskin band at the collar. */
const NO_GEAR = {} as const;

function paintCultistFrame(ctx: Ctx, state: string, frame: number): void {
  const row = ROWS.get(state);
  if (row === undefined) return;
  const pose: CarlPose = { ...row.pose(frame), gear: NO_GEAR };
  const attachments = cultistAttachments(row.motion(frame));
  // Reset in `finally`: a painter that throws mid-bake must not leave the next
  // figure baked — Carl or a resident — in this one's skin, robe or face.
  setCarlSkinHairRamp(CULTIST_SKIN, CULTIST_HAIR);
  setCarlGarmentRamp(CULTIST_ROBE);
  setCarlTorsoCut(ROBE_HEM_DROP, false, ROBE_HEM_FLARE);
  setCarlSleeveCut(ROBE_SLEEVE_CUFF_ALONG, ROBE_SLEEVE_CUFF_BULK);
  setCarlExpression(CULTIST_EXPRESSION);
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
    resetCarlSleeveCut();
    resetCarlExpression();
  }
}

const FRAME_COUNTS: Record<string, number> = Object.fromEntries(
  [...ROWS].map(([name, row]) => [name, row.frames]),
);

export const CITY_ELF_CULTIST_FIGURE: FigureDef = {
  id: 'city_elf_cultist',
  frameWidth: CELL_WIDTH,
  frameHeight: CELL_HEIGHT,
  tileX: ORIGIN_X - HALF_TILE,
  tileY: GROUND_Y - CULTIST_TILE_SCALE,
  tileScale: CULTIST_TILE_SCALE,
  // Carl's painter composes on its own surface at the bake's density, with a
  // one-pixel outline; a supersampled bake would only smear it.
  skipSupersample: true,
  states: figureStates(FRAME_COUNTS),
  paintFrame: paintCultistFrame,
};
