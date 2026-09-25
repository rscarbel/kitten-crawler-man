/**
 * The people of Briar Hollow as painted figures: one `FigureDef` per character,
 * each wearing its outfit from `ratkin/cast.ts` on the shared ratkin rig.
 *
 * **One figure per character, never a per-instance colour.** A cached cell is
 * keyed on `(figure, state, frame)`, so a painter that read a villager's look
 * off the villager would serve the first one's clothes to everybody. The cast
 * is a closed set of twenty-one, so each gets its own `FigureId`
 * (`ratkin_<id>`), exactly as the sky fowl's palettes do.
 *
 * Rows every character paints:
 *    walk / walk_side / walk_away     16 frames, Mordecai's gait
 *    idle / idle_side / idle_away      8 frames
 *    talk / talk_side                  8 frames, looping
 * Civilians add:
 *    cower                             8 frames, head-on, looping
 * Workers add (one trade each):
 *    work / work_side                  8 frames, looping
 * The militia add, in all three views:
 *    strike*  8 frames, impact on `STRIKE_IMPACT_FRAME`
 *    hurt*    4 frames
 *    down*    8 frames, holding the last
 *    rise*    8 frames
 *
 * Only the side rows are mirrored at runtime; asymmetric details are placed per
 * view by the garment layers. The art invariants live in
 * `scripts/gates-ratkin-cast.ts`: `npm run render:ratkin-cast`.
 */

import type { RatKinPose, RatKinView } from './ratKinArt';
import { drawRatkin, GROUND_Y } from './ratKinArt';
import {
  GROUND_OFFSET_IN_TILE,
  IDLE_FRAMES,
  RAT_KIN_SCALE,
  WALK_FRAMES,
  cyclePhase,
} from './ratKinFigure';
import { RATKIN_BUILDS, type HeldPropKind, type RatkinOutfit } from './ratkin/outfit';
import {
  RATKIN_CAST_IDS,
  RATKIN_CAST_OUTFITS,
  type RatkinCastId,
  isRatkinSoldier,
} from './ratkin/cast';
import {
  HAMMER_STRIKE_PHASE,
  STRIKE_IMPACT_FRAME,
  type WorkMotion,
  castCowerPose,
  castDownPose,
  castHurtPose,
  castIdlePose,
  castRisePose,
  castStrikePose,
  castTalkPose,
  castWalkPose,
  castWorkPose,
} from './ratkin/castRows';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const RATKIN_CAST_TILE_SCALE = 64;

/**
 * The cast's cell: wider and taller than Mordecai's, because the cast carries
 * things. A spear stands a full figure-height above the paw and levels out
 * past the muzzle on the thrust, and a hoe swings overhead. His tile sits
 * centred along the bottom, with the same ground margin his cell has, so a
 * villager and Mordecai standing on one tile put their feet on one line.
 */
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 128;
const TILE_X = (FRAME_WIDTH - RATKIN_CAST_TILE_SCALE) / 2;
/** Ground margin below the soles, matched to Mordecai's cell. */
const GROUND_MARGIN = 13.4;
const ORIGIN_X = FRAME_WIDTH / 2;
const ORIGIN_Y = FRAME_HEIGHT - GROUND_MARGIN;
const TILE_Y = Math.round(ORIGIN_Y - RATKIN_CAST_TILE_SCALE * GROUND_OFFSET_IN_TILE);

export const TALK_FRAMES = 8;
export const WORK_FRAMES = 8;
export const COWER_FRAMES = 8;
export const STRIKE_FRAMES = 8;
export const HURT_FRAMES = 4;
export const DOWN_FRAMES = 8;
export const RISE_FRAMES = 8;

// ── Rows ─────────────────────────────────────────────────────────────────────

/** What a row is for, so the runtime picks rows by purpose rather than by name. */
export type CastRowRole =
  'walk' | 'idle' | 'talk' | 'work' | 'cower' | 'strike' | 'hurt' | 'down' | 'rise';

/** Frames a runtime system syncs an effect to. */
export interface CastRowEvents {
  /** The spear is fully out: resolve the hit here. */
  readonly impact?: number;
  /** The hammer meets the anvil: throw sparks here. */
  readonly strike?: number;
}

export interface CastRowSpec {
  readonly name: string;
  readonly role: CastRowRole;
  readonly view: RatKinView;
  readonly frameCount: number;
  /** True when the last frame runs back into the first. */
  readonly loops: boolean;
  readonly events?: CastRowEvents;
  readonly pose: (frame: number) => RatKinPose;
}

/** Which trade each worker loops at their post. */
export const RATKIN_WORK_MOTIONS: Readonly<Partial<Record<RatkinCastId, WorkMotion>>> = {
  oren: 'hammer',
  pipkin: 'stir',
  merrit: 'hoe',
  fenna: 'push',
  wicker: 'plane',
  cricket: 'crank',
  nella: 'sew',
  tikka: 'sketch',
};

/**
 * What a worker holds while working, where it is not what they carry. The
 * carpenter walks about with his hammer but planes with a plane.
 */
const WORK_PROPS: Readonly<Partial<Record<RatkinCastId, HeldPropKind>>> = {
  wicker: 'plane',
};

/** The frame of the work loop on which the hammer lands. */
const HAMMER_STRIKE_FRAME = Math.round(HAMMER_STRIKE_PHASE * WORK_FRAMES);

const VIEW_SUFFIX: Readonly<Record<RatKinView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};
const ALL_VIEWS: readonly RatKinView[] = ['front', 'side', 'away'];
const WORK_VIEWS: readonly RatKinView[] = ['front', 'side'];

/** The state name for a role in a view: `walk`, `walk_side`, `walk_away`… */
export function castStateName(role: CastRowRole, view: RatKinView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

/** A soldier's rows only: carried spears are what the fighting rows animate. */
function soldierRows(prop: HeldPropKind): CastRowSpec[] {
  return ALL_VIEWS.flatMap((view): CastRowSpec[] => [
    {
      name: castStateName('strike', view),
      role: 'strike',
      view,
      frameCount: STRIKE_FRAMES,
      loops: false,
      events: { impact: STRIKE_IMPACT_FRAME },
      pose: (f) => castStrikePose(f, view),
    },
    {
      name: castStateName('hurt', view),
      role: 'hurt',
      view,
      frameCount: HURT_FRAMES,
      loops: false,
      pose: (f) => castHurtPose(f, view, prop),
    },
    {
      name: castStateName('down', view),
      role: 'down',
      view,
      frameCount: DOWN_FRAMES,
      loops: false,
      pose: (f) => castDownPose(f, DOWN_FRAMES, view, prop),
    },
    {
      name: castStateName('rise', view),
      role: 'rise',
      view,
      frameCount: RISE_FRAMES,
      loops: false,
      pose: (f) => castRisePose(f, RISE_FRAMES, view, prop),
    },
  ]);
}

/** Builds one character's row table; `castRowsFor` serves the cached copy. */
function buildCastRows(id: RatkinCastId): readonly CastRowSpec[] {
  const outfit = RATKIN_CAST_OUTFITS[id];
  const prop = outfit.heldProp ?? 'none';
  const rows: CastRowSpec[] = [];
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('walk', view),
      role: 'walk',
      view,
      frameCount: WALK_FRAMES,
      loops: true,
      pose: (f) => castWalkPose(cyclePhase(f, WALK_FRAMES), view, prop),
    });
  }
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('idle', view),
      role: 'idle',
      view,
      frameCount: IDLE_FRAMES,
      loops: true,
      pose: (f) => castIdlePose(cyclePhase(f, IDLE_FRAMES), view, prop),
    });
  }
  for (const view of WORK_VIEWS) {
    rows.push({
      name: castStateName('talk', view),
      role: 'talk',
      view,
      frameCount: TALK_FRAMES,
      loops: true,
      pose: (f) => castTalkPose(cyclePhase(f, TALK_FRAMES), view, prop),
    });
  }
  const motion = RATKIN_WORK_MOTIONS[id];
  if (motion !== undefined) {
    for (const view of WORK_VIEWS) {
      rows.push({
        name: castStateName('work', view),
        role: 'work',
        view,
        frameCount: WORK_FRAMES,
        loops: true,
        events: motion === 'hammer' ? { strike: HAMMER_STRIKE_FRAME } : undefined,
        pose: (f) => castWorkPose(cyclePhase(f, WORK_FRAMES), view, motion),
      });
    }
  }
  if (isRatkinSoldier(id)) {
    rows.push(...soldierRows(prop));
  } else {
    rows.push({
      name: castStateName('cower', 'front'),
      role: 'cower',
      view: 'front',
      frameCount: COWER_FRAMES,
      loops: true,
      pose: (f) => castCowerPose(cyclePhase(f, COWER_FRAMES), prop),
    });
  }
  return rows;
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** The outfit a row paints in: the work rows may swap the prop for a tool of the trade. */
function outfitForRow(id: RatkinCastId, row: CastRowSpec): RatkinOutfit {
  const outfit = RATKIN_CAST_OUTFITS[id];
  const workProp = WORK_PROPS[id];
  if (row.role !== 'work' || workProp === undefined) return outfit;
  return { ...outfit, heldProp: workProp };
}

/** Everything the cell painter needs for one character, fixed at construction. */
function castPainter(id: RatkinCastId) {
  const byName = RATKIN_CAST_ROWS_BY_NAME.get(id) ?? new Map<string, CastRowSpec>();
  const scale = RAT_KIN_SCALE * RATKIN_BUILDS[RATKIN_CAST_OUTFITS[id].build].scale;
  return (ctx: CanvasRenderingContext2D, state: string, frame: number): void => {
    const row = byName.get(state);
    if (row === undefined) return;
    const pose = row.pose(frame);
    ctx.save();
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(RATKIN_CAST_TILE_SCALE, RATKIN_CAST_TILE_SCALE);
    ctx.translate(0, GROUND_Y);
    ctx.scale(scale, scale);
    ctx.translate(0, -GROUND_Y);
    drawRatkin(ctx, row.view, pose, outfitForRow(id, row));
    ctx.restore();
  };
}

/**
 * Every cast member's row table, built once. The runtime looks rows up per
 * soldier per frame for their event frames, and a table rebuilt on each look-up
 * would allocate every row spec and pose closure each time.
 */
const RATKIN_CAST_ROWS: ReadonlyMap<RatkinCastId, readonly CastRowSpec[]> = new Map(
  RATKIN_CAST_IDS.map((id) => [id, buildCastRows(id)]),
);

const RATKIN_CAST_ROWS_BY_NAME: ReadonlyMap<
  RatkinCastId,
  ReadonlyMap<string, CastRowSpec>
> = new Map(
  [...RATKIN_CAST_ROWS].map(([id, rows]) => [id, new Map(rows.map((row) => [row.name, row]))]),
);

/** Every row one character paints, in a stable order. */
export function castRowsFor(id: RatkinCastId): readonly CastRowSpec[] {
  return RATKIN_CAST_ROWS.get(id) ?? [];
}

function castFigureOf(id: RatkinCastId): FigureDef {
  const rows = castRowsFor(id);
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return {
    id: `ratkin_${id}`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: RATKIN_CAST_TILE_SCALE,
    states: figureStates(frames),
    paintFrame: castPainter(id),
  };
}

/**
 * A figure outside the cast — a summoned ghost, say — wearing `outfit` on the
 * cast's own cell and scale, so it stands on a tile exactly as a villager
 * does. Like a cast member it is its own `FigureId`: the outfit is baked in.
 */
export function ratkinOutfitFigure(
  figureId: string,
  outfit: RatkinOutfit,
  rows: readonly CastRowSpec[],
): FigureDef {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const scale = RAT_KIN_SCALE * RATKIN_BUILDS[outfit.build].scale;
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return {
    id: figureId,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: RATKIN_CAST_TILE_SCALE,
    states: figureStates(frames),
    paintFrame: (ctx, state, frame) => {
      const row = byName.get(state);
      if (row === undefined) return;
      const pose = row.pose(frame);
      ctx.save();
      ctx.translate(ORIGIN_X, ORIGIN_Y);
      ctx.scale(RATKIN_CAST_TILE_SCALE, RATKIN_CAST_TILE_SCALE);
      ctx.translate(0, GROUND_Y);
      ctx.scale(scale, scale);
      ctx.translate(0, -GROUND_Y);
      drawRatkin(ctx, row.view, pose, outfit);
      ctx.restore();
    },
  };
}

/** One figure per cast member. */
export const RATKIN_CAST_FIGURES: ReadonlyMap<RatkinCastId, FigureDef> = new Map(
  RATKIN_CAST_IDS.map((id) => [id, castFigureOf(id)]),
);

/** The figure for one cast member. */
export function ratkinCastFigure(id: RatkinCastId): FigureDef {
  const figure = RATKIN_CAST_FIGURES.get(id);
  if (figure === undefined) throw new Error(`no ratkin cast figure for "${id}"`);
  return figure;
}

/** The row table of one cast member's figure, for the runtime's event frames and the gates. */
export function ratkinCastRow(id: RatkinCastId, state: string): CastRowSpec | undefined {
  return RATKIN_CAST_ROWS_BY_NAME.get(id)?.get(state);
}
