/**
 * The skyfowl street cast as painted figures: one `FigureDef` per look from
 * `skyfowl/cast.ts`, each wearing its outfit on the shared skyfowl rig.
 *
 * **One figure per look, never a per-instance colour.** A cached cell is keyed
 * on `(figure, state, frame)`, so a painter that read a citizen's plumage off
 * the citizen would serve the first instance's look to every skyfowl after it.
 * The cast is a closed, curated set, so each look gets its own `FigureId`
 * (`skyfowl_<id>`), exactly as the ratkin cast does.
 *
 * Rows every look paints:
 *    walk / walk_side / walk_away     16 frames
 *    idle / idle_side / idle_away      8 frames
 *    talk / talk_side / talk_away      8 frames
 * A stationed role adds:
 *    work / work_side                  8 frames, looping
 * A Desperado Club dancer look adds, facing the camera (the spin paints its
 * own turn frame by frame):
 *    dance_pump / dance_shimmy / dance_spin   16 frames, looping
 * The fightable street-tough family adds, in all three views:
 *    run*      16 frames, looping — the angry sprint, too fast for the walk's stride
 *    strike*   8 frames, impact on `STRIKE_IMPACT_FRAME`
 *    aggro*    8 frames, looping
 *    hurt*     4 frames
 *    death*    8 frames, holding the last
 */

import type { SkyfowlPose, SkyfowlView } from './skyfowl/rig';
import { drawSkyfowl } from './skyfowl/rig';
import {
  AGGRESSIVE_FRAMES,
  DEATH_FRAMES,
  HURT_FRAMES,
  STRIKE_FRAMES,
  STRIKE_IMPACT_FRAME,
  WORK_STRIKE_PHASE,
  applyPosture,
  cyclePhase,
  skyfowlAggressivePose,
  skyfowlDancePose,
  skyfowlDeathPose,
  skyfowlHurtPose,
  skyfowlIdlePose,
  skyfowlRunPose,
  skyfowlStrikePose,
  skyfowlTalkPose,
  skyfowlWalkPose,
  skyfowlWorkPose,
  type SkyfowlWorkMotion,
} from './skyfowl/rows';
import {
  SKYFOWL_RUN,
  SKYFOWL_RUN_GROUND_PER_CYCLE,
  SKYFOWL_WALK,
  SKYFOWL_WALK_GROUND_PER_CYCLE,
} from './skyfowl/gait';
import { SKYFOWL_BUILDS } from './skyfowl/palette';
import {
  SKYFOWL_LOOKS,
  type SkyfowlLook,
  type SkyfowlLookId,
  type SkyfowlRole,
} from './skyfowl/cast';
import {
  DANCE_FRAMES,
  DANCE_STYLES,
  danceFacingAt,
  danceStateName,
  type DanceFacing,
  type DanceStyle,
} from './danceStyles';
import type { FigureDef } from '../figure/figureDef';
import { figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / SKYFOWL_CAST_TILE_SCALE. */
export const SKYFOWL_CAST_TILE_SCALE = 64;

/**
 * The cast's cell: a spread wing on the aggressive stance or a levelled spear
 * reaches well past the body, so the cell is sized for those, not for idle.
 */
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 128;
const TILE_X = (FRAME_WIDTH - SKYFOWL_CAST_TILE_SCALE) / 2;
const GROUND_MARGIN = 13.4;
const ORIGIN_X = FRAME_WIDTH / 2;
const ORIGIN_Y = FRAME_HEIGHT - GROUND_MARGIN;
/** How far down its own tile a skyfowl's feet sit; matched to the rest of the cast. */
export const GROUND_OFFSET_IN_TILE = 0.9;
const TILE_Y = Math.round(ORIGIN_Y - SKYFOWL_CAST_TILE_SCALE * GROUND_OFFSET_IN_TILE);
/**
 * How much of a tile a standard-build skyfowl fills, ground-anchored.
 * Measured against the human cast at identical `tileScale` (both 64): a
 * baked idle-down cell's own silhouette height, divided by `tileScale`, gave
 * a human adult (`resident_wendell`) at 1.656 tiles and a skyfowl adult
 * (`resident_brann_cartwright`) at only 1.547 tiles at this constant's
 * previous value of 0.72 — shorter than a human, when a skyfowl adult is
 * meant to stand slightly taller than one. Raised only as far as every look's
 * every state and frame still bakes inside its own 128×128 cell without
 * touching the edge (checked directly, not just idle/walk — the guard and
 * dancer looks' own idle/talk/dance reach are what cap it): 0.80 already
 * clips several looks, so 0.78 is the highest safe value, landing a skyfowl
 * adult a little past a human adult's own measured height (about 1.68 tiles)
 * rather than the fuller margin a taller cell would allow.
 */
export const SKYFOWL_CAST_SCALE = 0.78;

export const WALK_FRAMES = SKYFOWL_WALK.frames;
export const RUN_FRAMES = SKYFOWL_RUN.frames;
export const IDLE_FRAMES = 8;
export const TALK_FRAMES = 8;
export const WORK_FRAMES = 8;

// ── Rows ─────────────────────────────────────────────────────────────────────

export type CastRowRole =
  'walk' | 'run' | 'idle' | 'talk' | 'work' | 'dance' | 'strike' | 'aggro' | 'hurt' | 'death';

export interface CastRowEvents {
  readonly impact?: number;
  readonly strike?: number;
}

export interface CastRowSpec {
  readonly name: string;
  readonly role: CastRowRole;
  readonly view: SkyfowlView;
  readonly frameCount: number;
  readonly loops: boolean;
  readonly events?: CastRowEvents;
  readonly pose: (frame: number) => SkyfowlPose;
  /**
   * For a row that turns as it plays (the spin), the facing each frame is
   * painted in; `view` is then only the facing it starts in. Absent, every
   * frame is painted in `view`.
   */
  readonly facingAt?: (frame: number) => DanceFacing;
  /** The dance routine a `dance` row plays; absent on every other row. */
  readonly danceStyle?: DanceStyle;
}

const VIEW_SUFFIX: Readonly<Record<SkyfowlView, string>> = { down: '', side: '_side', up: '_away' };
const ALL_VIEWS: readonly SkyfowlView[] = ['down', 'side', 'up'];
const WORK_VIEWS: readonly SkyfowlView[] = ['down', 'side'];

export function castStateName(role: CastRowRole, view: SkyfowlView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

/** Which trade a stationed role loops at their post. `undefined` gets no work row. */
const ROLE_WORK_MOTIONS: Readonly<Partial<Record<SkyfowlRole, SkyfowlWorkMotion>>> = {
  merchant: 'weigh',
  laborer: 'hammer',
  clerk: 'stir',
  temple: 'sweep',
};

const HAMMER_WORK_STRIKE_FRAME = Math.round(WORK_STRIKE_PHASE * WORK_FRAMES);

function buildCastRows(look: SkyfowlLook): readonly CastRowSpec[] {
  const rows: CastRowSpec[] = [];
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('walk', view),
      role: 'walk',
      view,
      frameCount: WALK_FRAMES,
      loops: true,
      pose: (f) => applyPosture(skyfowlWalkPose(cyclePhase(f, WALK_FRAMES)), look.posture),
    });
  }
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('idle', view),
      role: 'idle',
      view,
      frameCount: IDLE_FRAMES,
      loops: true,
      pose: (f) => applyPosture(skyfowlIdlePose(cyclePhase(f, IDLE_FRAMES)), look.posture),
    });
  }
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('talk', view),
      role: 'talk',
      view,
      frameCount: TALK_FRAMES,
      loops: true,
      pose: (f) => applyPosture(skyfowlTalkPose(cyclePhase(f, TALK_FRAMES)), look.posture),
    });
  }
  const motion = ROLE_WORK_MOTIONS[look.role];
  if (motion !== undefined) {
    for (const view of WORK_VIEWS) {
      rows.push({
        name: castStateName('work', view),
        role: 'work',
        view,
        frameCount: WORK_FRAMES,
        loops: true,
        events: motion === 'hammer' ? { strike: HAMMER_WORK_STRIKE_FRAME } : undefined,
        pose: (f) =>
          applyPosture(skyfowlWorkPose(cyclePhase(f, WORK_FRAMES), motion), look.posture),
      });
    }
  }
  if (look.dances === true) {
    for (const style of DANCE_STYLES) {
      rows.push({
        name: danceStateName(style),
        role: 'dance',
        view: 'down',
        frameCount: DANCE_FRAMES,
        loops: true,
        danceStyle: style,
        facingAt: (f) => danceFacingAt(style, f),
        pose: (f) => applyPosture(skyfowlDancePose(style, f), look.posture),
      });
    }
  }
  if (look.fightable) {
    for (const view of ALL_VIEWS) {
      rows.push({
        name: castStateName('run', view),
        role: 'run',
        view,
        frameCount: RUN_FRAMES,
        loops: true,
        pose: (f) => applyPosture(skyfowlRunPose(cyclePhase(f, RUN_FRAMES)), look.posture),
      });
      rows.push({
        name: castStateName('strike', view),
        role: 'strike',
        view,
        frameCount: STRIKE_FRAMES,
        loops: false,
        events: { impact: STRIKE_IMPACT_FRAME },
        pose: (f) => applyPosture(skyfowlStrikePose(f), look.posture),
      });
      rows.push({
        name: castStateName('aggro', view),
        role: 'aggro',
        view,
        frameCount: AGGRESSIVE_FRAMES,
        loops: true,
        pose: (f) =>
          applyPosture(skyfowlAggressivePose(cyclePhase(f, AGGRESSIVE_FRAMES)), look.posture),
      });
      rows.push({
        name: castStateName('hurt', view),
        role: 'hurt',
        view,
        frameCount: HURT_FRAMES,
        loops: false,
        pose: (f) => applyPosture(skyfowlHurtPose(f), look.posture),
      });
      rows.push({
        name: castStateName('death', view),
        role: 'death',
        view,
        frameCount: DEATH_FRAMES,
        loops: false,
        pose: (f) => applyPosture(skyfowlDeathPose(f), look.posture),
      });
    }
  }
  return rows;
}

const SKYFOWL_CAST_ROWS: ReadonlyMap<SkyfowlLookId, readonly CastRowSpec[]> = new Map(
  SKYFOWL_LOOKS.map((look) => [look.id, buildCastRows(look)]),
);

const SKYFOWL_CAST_ROWS_BY_NAME: ReadonlyMap<
  SkyfowlLookId,
  ReadonlyMap<string, CastRowSpec>
> = new Map(
  [...SKYFOWL_CAST_ROWS].map(([id, rows]) => [id, new Map(rows.map((row) => [row.name, row]))]),
);

export function castRowsFor(id: SkyfowlLookId): readonly CastRowSpec[] {
  return SKYFOWL_CAST_ROWS.get(id) ?? [];
}

export function castRow(id: SkyfowlLookId, state: string): CastRowSpec | undefined {
  return SKYFOWL_CAST_ROWS_BY_NAME.get(id)?.get(state);
}

// ── Painting ─────────────────────────────────────────────────────────────────

const LOOKS_BY_ID: ReadonlyMap<SkyfowlLookId, SkyfowlLook> = new Map(
  SKYFOWL_LOOKS.map((look) => [look.id, look]),
);

function lookOf(id: SkyfowlLookId): SkyfowlLook {
  const found = LOOKS_BY_ID.get(id);
  if (found === undefined) throw new Error(`no skyfowl look "${id}"`);
  return found;
}

const FACING_VIEW: Readonly<Record<DanceFacing, SkyfowlView>> = {
  down: 'down',
  right: 'side',
  up: 'up',
  left: 'side',
};

function castPainter(id: SkyfowlLookId) {
  const rows = SKYFOWL_CAST_ROWS_BY_NAME.get(id) ?? new Map<string, CastRowSpec>();
  const look = lookOf(id);
  const scale = SKYFOWL_CAST_SCALE * SKYFOWL_BUILDS[look.outfit.build].scale;
  return (ctx: CanvasRenderingContext2D, state: string, frame: number): void => {
    const row = rows.get(state);
    if (row === undefined) return;
    const pose = row.pose(frame);
    const facing = row.facingAt?.(frame);
    const view = facing === undefined ? row.view : FACING_VIEW[facing];
    const mirror = facing === 'left' ? -1 : 1;
    ctx.save();
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(SKYFOWL_CAST_TILE_SCALE * scale * mirror, SKYFOWL_CAST_TILE_SCALE * scale);
    drawSkyfowl(ctx, view, pose, look.outfit);
    ctx.restore();
  };
}

function castFigureOf(id: SkyfowlLookId): FigureDef {
  const rows = castRowsFor(id);
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return {
    id: `skyfowl_${id}`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: SKYFOWL_CAST_TILE_SCALE,
    // Baked well past the cell's own 32px-tile screen size already; a further
    // supersampled pass buys antialiasing invisible at that size for roughly
    // 1.6x the paint cost. `skipSupersample` bakes at the cell's own density.
    skipSupersample: true,
    states: figureStates(frames),
    paintFrame: castPainter(id),
  };
}

/**
 * World pixels one walk cycle of a look covers at a given tile size: the
 * gait's own ground per cycle, in rig units, carried through the same scale
 * the figure is drawn at. The walk's cadence is distance over this number, so
 * a stance foot slides back through the cell exactly as fast as the sprite
 * is carried over the floor.
 */
export function skyfowlWalkCyclePx(id: SkyfowlLookId, tileSize: number): number {
  return SKYFOWL_WALK_GROUND_PER_CYCLE * rigUnitPx(id, tileSize);
}

/** World pixels one run cycle of a look covers at a given tile size. */
export function skyfowlRunCyclePx(id: SkyfowlLookId, tileSize: number): number {
  return SKYFOWL_RUN_GROUND_PER_CYCLE * rigUnitPx(id, tileSize);
}

/** World pixels one rig unit spans for a look drawn at `tileSize`. */
function rigUnitPx(id: SkyfowlLookId, tileSize: number): number {
  return tileSize * SKYFOWL_CAST_SCALE * SKYFOWL_BUILDS[lookOf(id).outfit.build].scale;
}

/** One figure per look. */
export const SKYFOWL_CAST_FIGURES: ReadonlyMap<SkyfowlLookId, FigureDef> = new Map(
  SKYFOWL_LOOKS.map((look) => [look.id, castFigureOf(look.id)]),
);

export function skyfowlCastFigure(id: SkyfowlLookId): FigureDef {
  const figure = SKYFOWL_CAST_FIGURES.get(id);
  if (figure === undefined) throw new Error(`no skyfowl cast figure for "${id}"`);
  return figure;
}
