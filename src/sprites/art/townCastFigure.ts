/**
 * The human cast (`townCastLooks.ts`) as painted `FigureDef`s: one figure per
 * look. An adult look paints through Carl's own rig (`carl/figure.ts`) posed
 * by his own walk/idle/talk pose functions and dressed in his gear plus a
 * worn accessory (`human/townAccessories.ts`); a child look paints through
 * the simpler person skeleton (`townCastPaint.ts`'s outline-and-glaze
 * wrapper over `drawPerson.ts`), since Carl's rig is one fixed adult build.
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
  type CarlComposeOptions,
  drawCarlBack,
  drawCarlFront,
  drawCarlSide,
} from '../art/carl/figure';
import type { CarlPose, CarlView } from '../art/carl/rig';
import { idleBack, idleFront, idleSide } from '../art/human/idles';
import { walkFacing, walkSide } from '../art/human/locomotion';
import { talkBack, talkFront, talkSide } from '../art/human/actionsMisc';
import { dancePose } from '../art/human/dance';
import {
  DANCE_FRAMES,
  DANCE_STYLES,
  danceFacingAt,
  danceStateName,
  type DanceFacing,
} from '../art/danceStyles';
import { HUMAN_CELL_PX_PER_UNIT } from '../art/human/figureScale';
import {
  drawAccessory,
  drawHairStyleOverlay,
  drawShoes,
  drawTrousers,
} from '../art/human/townAccessories';
import {
  resetCarlGarmentRamp,
  resetCarlSkinHairRamp,
  setCarlGarmentRamp,
  setCarlSkinHairRamp,
} from '../art/carl/palette';
import { resetCarlTorsoCut, setCarlTorsoCut } from '../art/carl/torso';
import { resetCarlExpression, setCarlExpression } from '../art/carl/head';
import { WALK_FRAMES, IDLE_FRAMES, TALK_FRAMES, WORK_FRAMES } from './townCastFrameCounts';

export type TownCastView = 'down' | 'side' | 'up';

const VIEW_TO_FACING: Readonly<Record<TownCastView, Facing>> = {
  down: 'down',
  side: 'right',
  up: 'up',
};
const VIEW_TO_CARL_VIEW: Readonly<Record<TownCastView, CarlView>> = {
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
 * An adult look's fixed cell, in Carl's own unit space scaled by
 * `HUMAN_CELL_PX_PER_UNIT` and the look's build. Generous rather than
 * measured — Carl's own painter has no offline bounds sampler the way the
 * person painter does — and held to the ground line the same way every other
 * cast cell is: the tile's own 64px footprint sits bottom-centred under him.
 */
const CARL_CELL_WIDTH = 150;
const CARL_CELL_HEIGHT = 190;
const CARL_GROUND_MARGIN = 14;

function carlCellFor(): Cell & { groundY: number } {
  const halfTile = CAST_TILE_SCALE / 2;
  const groundY = CARL_CELL_HEIGHT - CARL_GROUND_MARGIN;
  return {
    frameWidth: CARL_CELL_WIDTH,
    frameHeight: CARL_CELL_HEIGHT,
    originX: CARL_CELL_WIDTH / 2,
    originY: groundY,
    groundY,
    tileX: CARL_CELL_WIDTH / 2 - halfTile,
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

// ── Carl-painter rows (adults) ──────────────────────────────────────────────

const IDLE_POSE_BY_VIEW: Readonly<Record<TownCastView, (phase: number) => CarlPose>> = {
  down: (phase) => idleFront(phase),
  side: (phase) => idleSide(phase),
  up: (phase) => idleBack(phase),
};
const WALK_POSE_BY_VIEW: Readonly<Record<TownCastView, (phase: number) => CarlPose>> = {
  down: (phase) => walkFacing(phase, false),
  side: (phase) => walkSide(phase),
  up: (phase) => walkFacing(phase, true),
};
const TALK_POSE_BY_VIEW: Readonly<Record<TownCastView, (frame: number) => CarlPose>> = {
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
const CARL_DRAW_BY_VIEW: Readonly<
  Record<
    CarlView,
    (ctx: CanvasRenderingContext2D, pose: CarlPose, options: CarlComposeOptions) => void
  >
> = {
  front: drawCarlFront,
  side: drawCarlSide,
  back: drawCarlBack,
};

interface CarlRowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: TownCastView;
  readonly poseAt: (frame: number) => CarlPose;
  /** For a row that turns as it plays (the spin), the facing each frame is painted in. */
  readonly facingAt?: (frame: number) => DanceFacing;
}

/**
 * The rows a Carl-painted look declares. `hasDance` is only true for the
 * Desperado Club's dancer looks — everything else gets the same base three
 * rows every prior round shipped.
 */
function carlRows(hasDance: boolean): CarlRowSpec[] {
  const rows: CarlRowSpec[] = [];
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
const CARL_ROWS: readonly CarlRowSpec[] = carlRows(false);

function buildCarlFigure(look: TownCastLook & { painter: 'carl' }): FigureDef {
  const cell = carlCellFor();
  const rows = look.hasDance === true ? carlRows(true) : CARL_ROWS;
  const rowsByName = new Map(rows.map((row) => [row.name, row]));
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  const unitScaleX = HUMAN_CELL_PX_PER_UNIT * look.buildWidthScale;
  const unitScaleY = HUMAN_CELL_PX_PER_UNIT;

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
      const carlView = VIEW_TO_CARL_VIEW[view];
      const mirror = facing === 'left' ? -1 : 1;
      const rowPose: CarlPose = { ...row.poseAt(frame), gear: look.gear };
      const pose = look.details?.posture(rowPose, carlView) ?? rowPose;
      // Reset in `finally`: a painter that throws mid-bake must not leave the
      // next figure baked — Carl or another look — in this look's skin, hair,
      // garment, torso cut or expression (the "a throwing painter poisons
      // every later frame" trap).
      setCarlSkinHairRamp(look.skinRamp, look.hairRamp);
      setCarlGarmentRamp(look.garmentRamp);
      setCarlTorsoCut(look.garmentHemDrop, look.garmentHasHardware, look.garmentHemFlare);
      setCarlExpression(look.expression);
      try {
        ctx.save();
        ctx.translate(cell.originX, cell.originY);
        ctx.scale(unitScaleX * mirror, unitScaleY);
        CARL_DRAW_BY_VIEW[carlView](ctx, pose, { attachments: look.details?.attachments });
        if (look.legwear === 'trousers') drawTrousers(ctx, carlView, pose, look.pantsColor);
        drawShoes(ctx, carlView, pose, look.pantsColor);
        look.details?.overShoes(ctx, carlView, pose);
        drawHairStyleOverlay(
          ctx,
          carlView,
          look.hairStyle,
          look.hairRamp,
          look.skinRamp,
          look.garmentRamp,
        );
        drawAccessory(ctx, carlView, look.accessory);
        ctx.restore();
      } finally {
        resetCarlSkinHairRamp();
        resetCarlGarmentRamp();
        resetCarlTorsoCut();
        resetCarlExpression();
      }
    },
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function buildFigure(look: TownCastLook): FigureDef {
  return look.painter === 'person' ? buildPersonFigure(look) : buildCarlFigure(look);
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
