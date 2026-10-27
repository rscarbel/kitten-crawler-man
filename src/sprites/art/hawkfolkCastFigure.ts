/**
 * The Hawkfolk street cast as painted figures: one `FigureDef` per look from
 * `hawkfolk/cast.ts`, each wearing its outfit on the shared Hawkfolk rig.
 *
 * **One figure per look, never a per-instance colour.** A cached cell is keyed
 * on `(figure, state, frame)`, so a painter that read a citizen's plumage off
 * the citizen would serve the first instance's look to every Hawkfolk after it.
 * The cast is a closed, curated set, so each look gets its own `FigureId`
 * (`hawkfolk_<id>`), exactly as the ratkin cast does.
 *
 * Rows every look paints:
 *    walk / walk_side / walk_away     16 frames
 *    idle / idle_side / idle_away      8 frames
 *    talk / talk_side / talk_away      8 frames
 * A stationed role adds:
 *    work / work_side                  8 frames, looping
 * A Cloak & Dagger dancer look adds, facing the camera (the spin paints its
 * own turn frame by frame):
 *    dance_pump / dance_shimmy / dance_spin   16 frames, looping
 * The fightable street-tough family adds, in all three views:
 *    run*      16 frames, looping — the angry sprint, too fast for the walk's stride
 *    strike*   8 frames, impact on `STRIKE_IMPACT_FRAME`
 *    aggro*    8 frames, looping
 *    hurt*     4 frames
 *    death*    8 frames, holding the last
 */

import type { HawkfolkPose, HawkfolkView } from './hawkfolk/rig';
import { drawHawkfolk } from './hawkfolk/rig';
import {
  AGGRESSIVE_FRAMES,
  DEATH_FRAMES,
  HURT_FRAMES,
  STRIKE_FRAMES,
  STRIKE_IMPACT_FRAME,
  WORK_STRIKE_PHASE,
  applyPosture,
  cyclePhase,
  hawkfolkAggressivePose,
  hawkfolkDancePose,
  hawkfolkDeathPose,
  hawkfolkHurtPose,
  hawkfolkIdlePose,
  hawkfolkRunPose,
  hawkfolkStrikePose,
  hawkfolkTalkPose,
  hawkfolkWalkPose,
  hawkfolkWorkPose,
  type HawkfolkWorkMotion,
} from './hawkfolk/rows';
import {
  HAWKFOLK_RUN,
  HAWKFOLK_RUN_GROUND_PER_CYCLE,
  HAWKFOLK_WALK,
  HAWKFOLK_WALK_GROUND_PER_CYCLE,
} from './hawkfolk/gait';
import { HAWKFOLK_BUILDS } from './hawkfolk/palette';
import {
  HAWKFOLK_LOOKS,
  type HawkfolkLook,
  type HawkfolkLookId,
  type HawkfolkRole,
} from './hawkfolk/cast';
import {
  DANCE_FRAMES,
  DANCE_STYLES,
  danceFacingAt,
  danceStateName,
  type DanceFacing,
  type DanceStyle,
} from './danceStyles';
import {
  BAR_STOOL_SEAT_HEIGHT_TILES,
  SEAT_POSE_FRAMES,
  SEAT_POSE_LOOPS,
  SEAT_POSES,
  SEAT_VIEWS,
  seatStateName,
} from './seatPoses';
import { hawkfolkSeatedPose } from './hawkfolk/seated';
import type { FigureDef } from '../figure/figureDef';
import { figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / HAWKFOLK_CAST_TILE_SCALE. */
export const HAWKFOLK_CAST_TILE_SCALE = 64;

/**
 * The cast's cell: a spread wing on the aggressive stance or a levelled spear
 * reaches well past the body, so the cell is sized for those, not for idle.
 */
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 128;
const TILE_X = (FRAME_WIDTH - HAWKFOLK_CAST_TILE_SCALE) / 2;
const GROUND_MARGIN = 13.4;
const ORIGIN_X = FRAME_WIDTH / 2;
const ORIGIN_Y = FRAME_HEIGHT - GROUND_MARGIN;
/** How far down its own tile a hawkfolk's feet sit; matched to the rest of the cast. */
export const GROUND_OFFSET_IN_TILE = 0.9;
const TILE_Y = Math.round(ORIGIN_Y - HAWKFOLK_CAST_TILE_SCALE * GROUND_OFFSET_IN_TILE);
/**
 * How much of a tile a standard-build Hawkfolk fills, ground-anchored.
 * Measured against the human cast at identical `tileScale` (both 64): a
 * baked idle-down cell's own silhouette height, divided by `tileScale`, gave
 * a human adult (`resident_wendell`) at 1.656 tiles and a standard-build
 * Hawkfolk adult at only 1.547 tiles at this constant's
 * previous value of 0.72 — shorter than a human, when a Hawkfolk adult is
 * meant to stand slightly taller than one. Raised only as far as every look's
 * every state and frame still bakes inside its own 128×128 cell without
 * touching the edge (checked directly, not just idle/walk — the guard and
 * dancer looks' own idle/talk/dance reach are what cap it): 0.80 already
 * clips several looks, so 0.78 is the highest safe value, landing a Hawkfolk
 * adult a little past a human adult's own measured height (about 1.68 tiles)
 * rather than the fuller margin a taller cell would allow.
 */
export const HAWKFOLK_CAST_SCALE = 0.78;

export const WALK_FRAMES = HAWKFOLK_WALK.frames;
export const RUN_FRAMES = HAWKFOLK_RUN.frames;
export const IDLE_FRAMES = 8;
export const TALK_FRAMES = 8;
export const WORK_FRAMES = 8;

// ── Rows ─────────────────────────────────────────────────────────────────────

export type CastRowRole =
  | 'walk'
  | 'run'
  | 'idle'
  | 'talk'
  | 'work'
  | 'dance'
  | 'strike'
  | 'aggro'
  | 'hurt'
  | 'death'
  | 'sit';

export interface CastRowEvents {
  readonly impact?: number;
  readonly strike?: number;
}

export interface CastRowSpec {
  readonly name: string;
  readonly role: CastRowRole;
  readonly view: HawkfolkView;
  readonly frameCount: number;
  readonly loops: boolean;
  readonly events?: CastRowEvents;
  readonly pose: (frame: number) => HawkfolkPose;
  /**
   * For a row that turns as it plays (the spin), the facing each frame is
   * painted in; `view` is then only the facing it starts in. Absent, every
   * frame is painted in `view`.
   */
  readonly facingAt?: (frame: number) => DanceFacing;
  /** The dance routine a `dance` row plays; absent on every other row. */
  readonly danceStyle?: DanceStyle;
}

const VIEW_SUFFIX: Readonly<Record<HawkfolkView, string>> = {
  down: '',
  side: '_side',
  up: '_away',
};
const ALL_VIEWS: readonly HawkfolkView[] = ['down', 'side', 'up'];
const WORK_VIEWS: readonly HawkfolkView[] = ['down', 'side'];

export function castStateName(role: CastRowRole, view: HawkfolkView): string {
  return `${role}${VIEW_SUFFIX[view]}`;
}

/** Which trade a stationed role loops at their post. `undefined` gets no work row. */
const ROLE_WORK_MOTIONS: Readonly<Partial<Record<HawkfolkRole, HawkfolkWorkMotion>>> = {
  merchant: 'weigh',
  laborer: 'hammer',
  clerk: 'stir',
  temple: 'sweep',
};

const HAMMER_WORK_STRIKE_FRAME = Math.round(WORK_STRIKE_PHASE * WORK_FRAMES);

function buildCastRows(look: HawkfolkLook): readonly CastRowSpec[] {
  const rows: CastRowSpec[] = [];
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('walk', view),
      role: 'walk',
      view,
      frameCount: WALK_FRAMES,
      loops: true,
      pose: (f) => applyPosture(hawkfolkWalkPose(cyclePhase(f, WALK_FRAMES)), look.posture),
    });
  }
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('idle', view),
      role: 'idle',
      view,
      frameCount: IDLE_FRAMES,
      loops: true,
      pose: (f) => applyPosture(hawkfolkIdlePose(cyclePhase(f, IDLE_FRAMES)), look.posture),
    });
  }
  for (const view of ALL_VIEWS) {
    rows.push({
      name: castStateName('talk', view),
      role: 'talk',
      view,
      frameCount: TALK_FRAMES,
      loops: true,
      pose: (f) => applyPosture(hawkfolkTalkPose(cyclePhase(f, TALK_FRAMES)), look.posture),
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
          applyPosture(hawkfolkWorkPose(cyclePhase(f, WORK_FRAMES), motion), look.posture),
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
        pose: (f) => applyPosture(hawkfolkDancePose(style, f), look.posture),
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
        pose: (f) => applyPosture(hawkfolkRunPose(cyclePhase(f, RUN_FRAMES)), look.posture),
      });
      rows.push({
        name: castStateName('strike', view),
        role: 'strike',
        view,
        frameCount: STRIKE_FRAMES,
        loops: false,
        events: { impact: STRIKE_IMPACT_FRAME },
        pose: (f) => applyPosture(hawkfolkStrikePose(f), look.posture),
      });
      rows.push({
        name: castStateName('aggro', view),
        role: 'aggro',
        view,
        frameCount: AGGRESSIVE_FRAMES,
        loops: true,
        pose: (f) =>
          applyPosture(hawkfolkAggressivePose(cyclePhase(f, AGGRESSIVE_FRAMES)), look.posture),
      });
      rows.push({
        name: castStateName('hurt', view),
        role: 'hurt',
        view,
        frameCount: HURT_FRAMES,
        loops: false,
        pose: (f) => applyPosture(hawkfolkHurtPose(f), look.posture),
      });
      rows.push({
        name: castStateName('death', view),
        role: 'death',
        view,
        frameCount: DEATH_FRAMES,
        loops: false,
        pose: (f) => applyPosture(hawkfolkDeathPose(f), look.posture),
      });
    }
  }
  return rows;
}

const HAWKFOLK_CAST_ROWS: ReadonlyMap<HawkfolkLookId, readonly CastRowSpec[]> = new Map(
  HAWKFOLK_LOOKS.map((look) => [look.id, buildCastRows(look)]),
);

const HAWKFOLK_CAST_ROWS_BY_NAME: ReadonlyMap<
  HawkfolkLookId,
  ReadonlyMap<string, CastRowSpec>
> = new Map(
  [...HAWKFOLK_CAST_ROWS].map(([id, rows]) => [id, new Map(rows.map((row) => [row.name, row]))]),
);

export function castRowsFor(id: HawkfolkLookId): readonly CastRowSpec[] {
  return HAWKFOLK_CAST_ROWS.get(id) ?? [];
}

export function castRow(id: HawkfolkLookId, state: string): CastRowSpec | undefined {
  return HAWKFOLK_CAST_ROWS_BY_NAME.get(id)?.get(state);
}

// ── Painting ─────────────────────────────────────────────────────────────────

const LOOKS_BY_ID: ReadonlyMap<HawkfolkLookId, HawkfolkLook> = new Map(
  HAWKFOLK_LOOKS.map((look) => [look.id, look]),
);

function lookOf(id: HawkfolkLookId): HawkfolkLook {
  const found = LOOKS_BY_ID.get(id);
  if (found === undefined) throw new Error(`no Hawkfolk look "${id}"`);
  return found;
}

const FACING_VIEW: Readonly<Record<DanceFacing, HawkfolkView>> = {
  down: 'down',
  right: 'side',
  up: 'up',
  left: 'side',
};

interface CastCell {
  readonly frameHeight: number;
  readonly originY: number;
  readonly tileY: number;
}

const STANDING_CELL: CastCell = { frameHeight: FRAME_HEIGHT, originY: ORIGIN_Y, tileY: TILE_Y };

/**
 * A seated patron's cell: the seat lifts the whole figure about a third of a
 * tile and a cheer raises both wings over the head, so it is taller than the
 * standing cell — kept on its own figure rather than growing every crowd
 * cell to fit a pose only the club's gamblers strike.
 */
const SEATED_FRAME_HEIGHT = 176;
const SEATED_ORIGIN_Y = SEATED_FRAME_HEIGHT - GROUND_MARGIN;
const SEATED_CELL: CastCell = {
  frameHeight: SEATED_FRAME_HEIGHT,
  originY: SEATED_ORIGIN_Y,
  tileY: Math.round(SEATED_ORIGIN_Y - HAWKFOLK_CAST_TILE_SCALE * GROUND_OFFSET_IN_TILE),
};

function castPainter(look: HawkfolkLook, rows: ReadonlyMap<string, CastRowSpec>, cell: CastCell) {
  const scale = HAWKFOLK_CAST_SCALE * HAWKFOLK_BUILDS[look.outfit.build].scale;
  return (ctx: CanvasRenderingContext2D, state: string, frame: number): void => {
    const row = rows.get(state);
    if (row === undefined) return;
    const pose = row.pose(frame);
    const facing = row.facingAt?.(frame);
    const view = facing === undefined ? row.view : FACING_VIEW[facing];
    const mirror = facing === 'left' ? -1 : 1;
    ctx.save();
    ctx.translate(ORIGIN_X, cell.originY);
    ctx.scale(HAWKFOLK_CAST_TILE_SCALE * scale * mirror, HAWKFOLK_CAST_TILE_SCALE * scale);
    drawHawkfolk(ctx, view, pose, look.outfit);
    ctx.restore();
  };
}

function castFigureOf(id: HawkfolkLookId): FigureDef {
  const rows = castRowsFor(id);
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return {
    id: `hawkfolk_${id}`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: HAWKFOLK_CAST_TILE_SCALE,
    // Baked well past the cell's own 32px-tile screen size already; a further
    // supersampled pass buys antialiasing invisible at that size for roughly
    // 1.6x the paint cost. `skipSupersample` bakes at the cell's own density.
    skipSupersample: true,
    states: figureStates(frames),
    paintFrame: castPainter(
      lookOf(id),
      HAWKFOLK_CAST_ROWS_BY_NAME.get(id) ?? new Map<string, CastRowSpec>(),
      STANDING_CELL,
    ),
  };
}

/** The seat a look sits on, in its own rig units above the ground its feet stand on. */
function seatHeightOf(look: HawkfolkLook): number {
  const groundAboveTileBottom = 1 - GROUND_OFFSET_IN_TILE;
  const seatTiles = BAR_STOOL_SEAT_HEIGHT_TILES - groundAboveTileBottom;
  return seatTiles / (HAWKFOLK_CAST_SCALE * HAWKFOLK_BUILDS[look.outfit.build].scale);
}

function seatedRowsOf(look: HawkfolkLook): readonly CastRowSpec[] {
  const seatHeight = seatHeightOf(look);
  return SEAT_POSES.flatMap((seatPose) =>
    SEAT_VIEWS.map((view): CastRowSpec => ({
      name: seatStateName(seatPose, view),
      role: 'sit',
      view,
      frameCount: SEAT_POSE_FRAMES[seatPose],
      loops: SEAT_POSE_LOOPS[seatPose],
      pose: (frame) =>
        applyPosture(
          hawkfolkSeatedPose(seatPose, view, seatHeight, look.outfit.build, frame),
          look.posture,
        ),
    })),
  );
}

function seatedFigureOf(id: HawkfolkLookId): FigureDef {
  const look = lookOf(id);
  const rows = seatedRowsOf(look);
  const frames: Record<string, number> = {};
  for (const row of rows) frames[row.name] = row.frameCount;
  return {
    id: `hawkfolk_${id}_seated`,
    frameWidth: FRAME_WIDTH,
    frameHeight: SEATED_CELL.frameHeight,
    tileX: TILE_X,
    tileY: SEATED_CELL.tileY,
    tileScale: HAWKFOLK_CAST_TILE_SCALE,
    skipSupersample: true,
    states: figureStates(frames),
    paintFrame: castPainter(look, new Map(rows.map((row) => [row.name, row])), SEATED_CELL),
  };
}

const SEATED_FIGURES = new Map<HawkfolkLookId, FigureDef>();

/**
 * A look's seated figure, on a club bar stool, built the first time it is
 * asked for: only the looks a club seats ever need one.
 */
export function hawkfolkSeatedFigure(id: HawkfolkLookId): FigureDef {
  const known = SEATED_FIGURES.get(id);
  if (known !== undefined) return known;
  const figure = seatedFigureOf(id);
  SEATED_FIGURES.set(id, figure);
  return figure;
}

/**
 * World pixels one walk cycle of a look covers at a given tile size: the
 * gait's own ground per cycle, in rig units, carried through the same scale
 * the figure is drawn at. The walk's cadence is distance over this number, so
 * a stance foot slides back through the cell exactly as fast as the sprite
 * is carried over the floor.
 */
export function hawkfolkWalkCyclePx(id: HawkfolkLookId, tileSize: number): number {
  return HAWKFOLK_WALK_GROUND_PER_CYCLE * rigUnitPx(id, tileSize);
}

/** World pixels one run cycle of a look covers at a given tile size. */
export function hawkfolkRunCyclePx(id: HawkfolkLookId, tileSize: number): number {
  return HAWKFOLK_RUN_GROUND_PER_CYCLE * rigUnitPx(id, tileSize);
}

/** World pixels one rig unit spans for a look drawn at `tileSize`. */
function rigUnitPx(id: HawkfolkLookId, tileSize: number): number {
  return tileSize * HAWKFOLK_CAST_SCALE * HAWKFOLK_BUILDS[lookOf(id).outfit.build].scale;
}

/** One figure per look. */
export const HAWKFOLK_CAST_FIGURES: ReadonlyMap<HawkfolkLookId, FigureDef> = new Map(
  HAWKFOLK_LOOKS.map((look) => [look.id, castFigureOf(look.id)]),
);

export function hawkfolkCastFigure(id: HawkfolkLookId): FigureDef {
  const figure = HAWKFOLK_CAST_FIGURES.get(id);
  if (figure === undefined) throw new Error(`no Hawkfolk cast figure for "${id}"`);
  return figure;
}
