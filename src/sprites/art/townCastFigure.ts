/**
 * The human cast (`townCastLooks.ts`) as painted `FigureDef`s: one figure per
 * look. An adult look paints through the biped rig (`biped/figure.ts`) posed
 * by its own walk/idle/talk pose functions, but dressed and groomed as itself
 * (`castAttachments` below) plus a worn accessory
 * (`human/townAccessories.ts`); a child look paints through
 * the simpler person skeleton (`townCastPaint.ts`'s outline-and-glaze
 * wrapper over `drawPerson.ts`), since the biped rig is one fixed adult build.
 *
 * Rows every look paints, in three views (down, side, up — `left` is `side`
 * mirrored at runtime, never baked separately):
 *    walk / walk_side / walk_away
 *    idle / idle_side / idle_away
 *    talk / talk_side / talk_away
 * No `work` row: nothing drives a citizen's `work` action, and every baked
 * row costs figure-cache budget across the whole closed set.
 */

import type { Facing, Pose } from '../person/skeleton';
import { poseForMotion } from '../person/gait';
import { talkPose as personTalkPose } from '../person/townCastPoses';
import { personCellGeometry } from '../person/personCellBounds';
import { outlinePx, paintTownCastFrame } from '../person/townCastPaint';
import { TOWN_CAST_LOOKS, type TownCastLook } from '../person/townCastLooks';
import { HUMANOID_NPC_SCALE } from '../humanoidScale';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  type BipedAttachments,
  type BipedComposeOptions,
  drawBipedBack,
  drawBipedFront,
  drawBipedSide,
} from './biped/figure';
import type { BipedPose, ViewSpec } from './biped/rig';
import { stillOutfit } from '../garments/human/humanDressing';
import { DAVE_JACKET } from '../garments/human/daveJacket';
import {
  resetTownsfolkLegwear,
  setTownsfolkLegwear,
  TOWNSFOLK_SHOES,
  TOWNSFOLK_TROUSERS,
} from '../garments/human/townsfolkLegwear';
import { outfitOf } from '../garments/outfit';
import { type CardinalView } from '../facingView';
import { idleBack, idleFront, idleSide } from './human/idles';
import { walkFacing, walkSide } from './human/locomotion';
import { talkBack, talkFront, talkSide } from './human/actionsMisc';
import { dancePose } from './human/dance';
import {
  DANCE_FRAMES,
  DANCE_STYLES,
  danceFacingAt,
  danceStateName,
  type DanceFacing,
} from './danceStyles';
import { HUMAN_CELL_PX_PER_UNIT } from './human/figureScale';
import { drawAccessory, drawHeadAccessory } from './human/townAccessories';
import { castHeadReach, paintCastHead } from './human/castHead';
import { paintTrouserSeat } from './human/legwear';
import { deriveGlossRamp, deriveRamp } from './biped/palette';
import type { HeadFeaturePainter } from './biped/head';
import { type HumanLook, lookPxPerUnit } from '../looks/humanLook';
import { RIG_LOOK } from '../looks/humans/rig';
import { RIG_GARMENT_CUT } from './biped/torso';
import { WALK_FRAMES, IDLE_FRAMES, TALK_FRAMES, WORK_FRAMES } from './townCastFrameCounts';

export type TownCastView = 'down' | 'side' | 'up';

const VIEW_TO_FACING: Readonly<Record<TownCastView, Facing>> = {
  down: 'down',
  side: 'right',
  up: 'up',
};
const VIEW_TO_BIPED_VIEW: Readonly<Record<TownCastView, CardinalView>> = {
  down: 'front',
  side: 'side',
  up: 'back',
};

const VIEW_SUFFIX: Readonly<Record<TownCastView, string>> = {
  down: '',
  side: '_side',
  up: '_away',
};

export const ALL_TOWN_CAST_VIEWS: readonly TownCastView[] = ['down', 'side', 'up'];
/** No look paints a `work` row (see the module doc); an empty set keeps the sprite wrapper's view lookup uniform. */
export const WORK_TOWN_CAST_VIEWS: readonly TownCastView[] = [];

export { WALK_FRAMES, IDLE_FRAMES, TALK_FRAMES, WORK_FRAMES };

export type TownCastRowRole = 'walk' | 'idle' | 'talk' | 'work' | 'dance';

export function townCastStateName(role: TownCastRowRole, view: TownCastView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

/**
 * The draw size a look is painted at, in cell pixels: the person renderer's
 * own "one tile" span, grown by the same humanoid boost every non-combatant
 * NPC in the game already draws at, so the closed set's crowd density and
 * doorway clearance stay exactly what they were tuned against.
 */
const CAST_TILE_SCALE = 64;
export const TOWN_CAST_PAINT_SIZE = CAST_TILE_SCALE * HUMANOID_NPC_SCALE;

interface Cell {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly originX: number;
  readonly originY: number;
  readonly tileX: number;
  readonly tileY: number;
}

/** How far a talk gesture reaches beyond the walk/idle envelope `personCellGeometry` samples, as a share of the paint size. */
const GESTURE_MARGIN_SHARE = 0.16;

/** A child look's fixed cell, measured from its own genome plus the outline and gesture margins. */
function personCellFor(look: TownCastLook & { painter: 'person' }): Cell {
  const geometry = personCellGeometry(look.appearance, TOWN_CAST_PAINT_SIZE);
  const margin =
    outlinePx(TOWN_CAST_PAINT_SIZE) + Math.round(TOWN_CAST_PAINT_SIZE * GESTURE_MARGIN_SHARE);
  const halfTile = CAST_TILE_SCALE / 2;
  const originX = geometry.originX + margin;
  const originY = geometry.originY + margin;
  return {
    frameWidth: geometry.cellWidth + margin * 2,
    frameHeight: geometry.cellHeight + margin * 2,
    originX,
    originY,
    tileX: originX + TOWN_CAST_PAINT_SIZE / 2 - halfTile,
    tileY: originY + TOWN_CAST_PAINT_SIZE - CAST_TILE_SCALE,
  };
}

/**
 * An adult look's fixed cell, in the rig's own unit space scaled by
 * `HUMAN_CELL_PX_PER_UNIT` and the look's build. Generous rather than
 * measured — the biped painter has no offline bounds sampler the way the
 * person painter does — and held to the ground line the same way every other
 * cast cell is: the tile's own 64px footprint sits bottom-centred under the figure.
 */
const BIPED_CELL_WIDTH = 150;
const BIPED_CELL_HEIGHT = 190;
const BIPED_GROUND_MARGIN = 14;

function bipedCellFor(): Cell & { groundY: number } {
  const halfTile = CAST_TILE_SCALE / 2;
  const groundY = BIPED_CELL_HEIGHT - BIPED_GROUND_MARGIN;
  return {
    frameWidth: BIPED_CELL_WIDTH,
    frameHeight: BIPED_CELL_HEIGHT,
    originX: BIPED_CELL_WIDTH / 2,
    originY: groundY,
    groundY,
    tileX: BIPED_CELL_WIDTH / 2 - halfTile,
    tileY: groundY - CAST_TILE_SCALE,
  };
}

function viewOf(state: string): TownCastView {
  return state.endsWith('_side') ? 'side' : state.endsWith('_away') ? 'up' : 'down';
}

// ── Person-painter rows (children) ──────────────────────────────────────────

interface PersonRowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly pose: (frame: number, facing: Facing) => Pose;
}

function personRows(look: TownCastLook & { painter: 'person' }): PersonRowSpec[] {
  const rows: PersonRowSpec[] = [];
  for (const view of ALL_TOWN_CAST_VIEWS) {
    const facing = VIEW_TO_FACING[view];
    rows.push({
      name: townCastStateName('walk', view),
      frameCount: WALK_FRAMES,
      pose: (frame) => poseForMotion(look.appearance, facing, frame / WALK_FRAMES, true),
    });
    rows.push({
      name: townCastStateName('idle', view),
      frameCount: IDLE_FRAMES,
      // A plain sine settle repeats a value at phase 0 and 0.5 exactly; the
      // offset keeps every sample off that symmetry.
      pose: (frame) => poseForMotion(look.appearance, facing, (frame + 0.1) / IDLE_FRAMES, false),
    });
    rows.push({
      name: townCastStateName('talk', view),
      frameCount: TALK_FRAMES,
      pose: (frame) => personTalkPose(look.appearance, facing, frame / TALK_FRAMES),
    });
  }
  return rows;
}

function buildPersonFigure(look: TownCastLook & { painter: 'person' }): FigureDef {
  const cell = personCellFor(look);
  const rows = personRows(look);
  const byName = new Map(rows.map((row) => [row.name, row]));
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;

  return {
    id: `human_${look.id}`,
    frameWidth: cell.frameWidth,
    frameHeight: cell.frameHeight,
    tileX: cell.tileX,
    tileY: cell.tileY,
    tileScale: CAST_TILE_SCALE,
    // A citizen's cell is already baked well past its 32px-tile screen size
    // (the closed set's own generous ground-truth for a stroll-past look, not
    // a texture meant to be inspected close up) — a further supersampled bake
    // on top of that buys antialiasing nobody at that size can see, at roughly
    // twice the paint cost. `skipSupersample` bakes at the cell's own density.
    skipSupersample: true,
    states: figureStates(frames),
    paintFrame: (ctx, state, frame) => {
      const row = byName.get(state);
      if (row === undefined) return;
      const facing = VIEW_TO_FACING[viewOf(state)];
      const pose = row.pose(frame, facing);
      paintTownCastFrame(
        ctx,
        cell.frameWidth,
        cell.frameHeight,
        cell.originX,
        cell.originY,
        TOWN_CAST_PAINT_SIZE,
        look.appearance,
        pose,
        facing,
      );
    },
  };
}

// ── Biped-painter rows (adults) ─────────────────────────────────────────────

const IDLE_POSE_BY_VIEW: Readonly<Record<TownCastView, (phase: number) => BipedPose>> = {
  down: (phase) => idleFront(phase),
  side: (phase) => idleSide(phase),
  up: (phase) => idleBack(phase),
};
const WALK_POSE_BY_VIEW: Readonly<Record<TownCastView, (phase: number) => BipedPose>> = {
  down: (phase) => walkFacing(phase, false),
  side: (phase) => walkSide(phase),
  up: (phase) => walkFacing(phase, true),
};
const TALK_POSE_BY_VIEW: Readonly<Record<TownCastView, (frame: number) => BipedPose>> = {
  down: talkFront,
  side: talkSide,
  up: talkBack,
};
const DANCE_FACING_VIEW: Readonly<Record<DanceFacing, TownCastView>> = {
  down: 'down',
  right: 'side',
  up: 'up',
  left: 'side',
};
const BIPED_DRAW_BY_VIEW: Readonly<
  Record<
    CardinalView,
    (ctx: CanvasRenderingContext2D, pose: BipedPose, options: BipedComposeOptions) => void
  >
> = {
  front: drawBipedFront,
  side: drawBipedSide,
  back: drawBipedBack,
};

interface BipedRowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: TownCastView;
  readonly poseAt: (frame: number) => BipedPose;
  /** For a row that turns as it plays (the spin), the facing each frame is painted in. */
  readonly facingAt?: (frame: number) => DanceFacing;
}

/**
 * The rows a rig-painted look declares. `hasDance` is only true for the
 * Desperado Club's dancer looks — everything else gets the same base three
 * rows every prior round shipped.
 */
function bipedRows(hasDance: boolean): BipedRowSpec[] {
  const rows: BipedRowSpec[] = [];
  for (const view of ALL_TOWN_CAST_VIEWS) {
    rows.push({
      name: townCastStateName('walk', view),
      frameCount: WALK_FRAMES,
      view,
      poseAt: (frame) => WALK_POSE_BY_VIEW[view](frame / WALK_FRAMES),
    });
    rows.push({
      name: townCastStateName('idle', view),
      frameCount: IDLE_FRAMES,
      view,
      poseAt: (frame) => IDLE_POSE_BY_VIEW[view](frame / IDLE_FRAMES),
    });
    rows.push({
      name: townCastStateName('talk', view),
      frameCount: TALK_FRAMES,
      view,
      poseAt: (frame) => TALK_POSE_BY_VIEW[view](frame),
    });
  }
  if (hasDance) {
    for (const style of DANCE_STYLES) {
      rows.push({
        name: danceStateName(style),
        frameCount: DANCE_FRAMES,
        view: 'down',
        facingAt: (frame) => danceFacingAt(style, frame),
        poseAt: (frame) => dancePose(style, frame),
      });
    }
  }
  return rows;
}

/** The base rows shared by every look that doesn't dance — built once. */
const BIPED_ROWS: readonly BipedRowSpec[] = bipedRows(false);

/**
 * The rig paints no hair on a cast look: its own hairstyle is painted over
 * the head by {@link castAttachments}, in the slab over the torso, where a hat
 * or hood can sit on it.
 */
const HAIR_PAINTED_BY_ATTACHMENT: HeadFeaturePainter = () => undefined;

/**
 * A cast look on the biped rig: Dave's jacket, recut and recoloured as the
 * look's garment, and nothing else of Dave's or the crawler's — not Dave's
 * jeans, which the cast's own trousers replace, none of the crawler's loot —
 * with the look's own skin, face and build.
 */
function castHumanLook(look: TownCastLook & { painter: 'biped' }): HumanLook {
  return {
    ...RIG_LOOK,
    id: look.id,
    skin: look.skinRamp,
    hair: look.hairRamp,
    garment: look.garmentRamp,
    garmentCut: {
      ...RIG_GARMENT_CUT,
      hemDrop: look.garmentHemDrop,
      hasHardware: look.garmentHasHardware,
      hemFlare: look.garmentHemFlare,
    },
    hairstyle: HAIR_PAINTED_BY_ATTACHMENT,
    expression: look.expression,
    widthScale: look.buildWidthScale,
    baseGarments: [DAVE_JACKET],
  };
}

/**
 * What every adult of the cast wears over the base: the cast's own trousers
 * or stockings and shoes over Dave's bare legs and feet, in the colours
 * `setTownsfolkLegwear` sets for the look.
 */
const TOWNSFOLK_LEGWEAR = [TOWNSFOLK_TROUSERS, TOWNSFOLK_SHOES];

function cardinalOf(view: ViewSpec): CardinalView {
  if (view.profile) return 'side';
  return view.showsBack ? 'back' : 'front';
}

/**
 * Everything a look wears past Dave's recoloured jacket, painted inside the
 * figure's composition from the solved skeleton: the seat of a pair of
 * trousers over the hips, the look's own hair and facial hair in
 * place of Dave's crop, a hat or hood on the head, and whatever a named
 * resident's own details add.
 */
function castAttachments(look: TownCastLook & { painter: 'biped' }): BipedAttachments {
  const cloth = deriveGlossRamp(look.pantsColor);
  const head = {
    hairStyle: look.hairStyle,
    facialHair: look.facialHair,
    hair: look.hairRamp,
    // Cut from the accessory's cloth, so a kerchief matches the shawl worn with it.
    scarf: deriveRamp(look.accessory.color),
  };
  const own = look.details?.attachments;
  return {
    behind: own?.behind,
    overLegs: (ctx, skeleton, view, pose, humanLook) => {
      if (look.legwear === 'trousers') paintTrouserSeat(ctx, skeleton, view, cloth);
      own?.overLegs?.(ctx, skeleton, view, pose, humanLook);
    },
    over: (ctx, skeleton, view, pose, humanLook) => {
      paintCastHead(ctx, skeleton, view, pose, head);
      own?.over?.(ctx, skeleton, view, pose, humanLook);
      drawHeadAccessory(ctx, cardinalOf(view), look.accessory, skeleton.headCentre);
    },
    reach: (skeleton, view, pose, humanLook) => [
      ...castHeadReach(skeleton),
      ...(own?.reach(skeleton, view, pose, humanLook) ?? []),
    ],
  };
}

function buildBipedFigure(look: TownCastLook & { painter: 'biped' }): FigureDef {
  const cell = bipedCellFor();
  const rows = look.hasDance === true ? bipedRows(true) : BIPED_ROWS;
  const rowsByName = new Map(rows.map((row) => [row.name, row]));
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  const humanLook = castHumanLook(look);
  const unitPx = lookPxPerUnit(humanLook, HUMAN_CELL_PX_PER_UNIT);
  const castOutfit = stillOutfit(outfitOf(humanLook, TOWNSFOLK_LEGWEAR));
  const attachments = castAttachments(look);
  const legwear = {
    cloth: deriveGlossRamp(look.pantsColor),
    cut: look.legwear,
    footwear: deriveGlossRamp(look.shoeColor),
    muddy: look.details?.muddyShoes ?? false,
  };

  return {
    id: `human_${look.id}`,
    frameWidth: cell.frameWidth,
    frameHeight: cell.frameHeight,
    tileX: cell.tileX,
    tileY: cell.tileY,
    tileScale: CAST_TILE_SCALE,
    // A citizen's cell is already baked well past its 32px-tile screen size
    // (the closed set's own generous ground-truth for a stroll-past look, not
    // a texture meant to be inspected close up) — a further supersampled bake
    // on top of that buys antialiasing nobody at that size can see, at roughly
    // twice the paint cost. `skipSupersample` bakes at the cell's own density.
    skipSupersample: true,
    states: figureStates(frames),
    paintFrame: (ctx, state, frame) => {
      const row = rowsByName.get(state);
      if (row === undefined) return;
      const facing = row.facingAt?.(frame);
      const view = facing === undefined ? row.view : DANCE_FACING_VIEW[facing];
      const bipedView = VIEW_TO_BIPED_VIEW[view];
      const mirror = facing === 'left' ? -1 : 1;
      const rowPose: BipedPose = { ...row.poseAt(frame), outfit: castOutfit };
      const pose = look.details?.posture(rowPose, bipedView) ?? rowPose;
      // Reset in `finally`: a painter that throws mid-bake must not leave the
      // next figure baked — the player or another look — in this look's legwear (the
      // "a throwing painter poisons every later frame" trap).
      setTownsfolkLegwear(legwear);
      try {
        ctx.save();
        ctx.translate(cell.originX, cell.originY);
        ctx.scale(unitPx.x * mirror, unitPx.y);
        BIPED_DRAW_BY_VIEW[bipedView](ctx, pose, { look: humanLook, attachments });
        drawAccessory(ctx, bipedView, look.accessory);
        ctx.restore();
      } finally {
        resetTownsfolkLegwear();
      }
    },
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function buildFigure(look: TownCastLook): FigureDef {
  return look.painter === 'person' ? buildPersonFigure(look) : buildBipedFigure(look);
}

const FIGURES_BY_LOOK = new Map<string, FigureDef>(
  TOWN_CAST_LOOKS.map((look) => [look.id, buildFigure(look)]),
);

/**
 * The figure painted for one look: a closed-set crowd look, or a look
 * registered outside the set by {@link townCastOutfitFigure} (built the first
 * time it is asked for and cached from then on, since most such looks are
 * never asked for in a given session).
 */
export function townCastFigure(lookId: string): FigureDef {
  const figure = FIGURES_BY_LOOK.get(lookId);
  if (figure === undefined) throw new Error(`no town cast figure for look "${lookId}"`);
  return figure;
}

/**
 * A figure outside the closed crowd set — a fixed, named individual (the
 * spider lab's scientist) — wearing its own outfit on the cast's own rig and
 * paint pipeline, so it stands on a tile exactly as the crowd does. Idempotent:
 * a second call for the same `look.id` returns the same figure rather than
 * rebuilding it.
 */
export function townCastOutfitFigure(look: TownCastLook): FigureDef {
  const known = FIGURES_BY_LOOK.get(look.id);
  if (known !== undefined) return known;
  const figure = buildFigure(look);
  FIGURES_BY_LOOK.set(look.id, figure);
  return figure;
}
