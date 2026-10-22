import {
  MILLISECONDS_PER_SECOND,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';
import {
  drawFigureCached,
  pinFigureState,
  prewarmFigureState,
  unpinFigureState,
} from './figure/figureFrameCache';
import type { EyePlacement } from './eyePlacement';
import {
  GORE_STATES,
  GREMLIN_SCALE,
  GROUND_OFFSET_PX,
  IDLE_FRAMES,
  SCURRY_FRAMES,
  SCURRY_GROUND_PER_CYCLE,
  SUMMON_EVENT_FRAME,
  SUMMON_FRAMES,
  TILE_SCALE,
  TRASH_GREMLIN_FIGURE,
  TRASH_GREMLIN_ROWS,
  VOMIT_FRAMES,
  VOMIT_RELEASE_FRAME,
  shotProgress,
} from './art/trashGremlinFigure';
import { eyeCentres } from './art/trashGremlinArt';

/**
 * The Trash Gremlin's runtime wrapper. It paints three views of every action,
 * so which row is drawn is decided here rather than in the creature.
 *
 * Every row length and event frame is read from the figure's own row table in
 * `src/sprites/art/trashGremlinFigure.ts`: one module holds the choreography's
 * numbers, and an art gate holds the state names composed here to the states
 * the figure paints.
 */

type TrashGremlinView = 'front' | 'side' | 'away';
type TrashGremlinAction = 'idle' | 'scurry' | 'vomit' | 'summon';
type TrashGremlinState =
  | 'idle'
  | 'idle_side'
  | 'idle_back'
  | 'scurry'
  | 'scurry_side'
  | 'scurry_back'
  | 'vomit'
  | 'vomit_side'
  | 'vomit_back'
  | 'summon'
  | 'summon_side'
  | 'summon_back';

export const TRASH_GREMLIN_IDLE_FRAMES = IDLE_FRAMES;
export const TRASH_GREMLIN_SCURRY_FRAMES = SCURRY_FRAMES;
export const TRASH_GREMLIN_VOMIT_FRAMES = VOMIT_FRAMES;
export const TRASH_GREMLIN_SUMMON_FRAMES = SUMMON_FRAMES;

/**
 * The progress through the spit at which the bolus leaves its mouth, the jaw
 * at full gape; the creature fires the projectile here.
 */
export const TRASH_GREMLIN_VOMIT_RELEASE_PROGRESS = shotProgress(VOMIT_RELEASE_FRAME, VOMIT_FRAMES);

/**
 * The progress through the summon at which its shriek peaks: the moment the
 * piles start to rustle, so the creature hatches the roaches here.
 */
export const TRASH_GREMLIN_SUMMON_EVENT_PROGRESS = shotProgress(SUMMON_EVENT_FRAME, SUMMON_FRAMES);

/**
 * Tiles of ground one scurry cycle covers. A creature advancing its walk phase
 * by `2π / this` per tile it moves keeps a planted foot on the floor.
 */
export const TRASH_GREMLIN_SCURRY_GROUND_TILES = SCURRY_GROUND_PER_CYCLE * GREMLIN_SCALE;

/** Every state name this wrapper can compose, spelled out so a gate can check each one. */
const STATE_OF: Record<TrashGremlinAction, Record<TrashGremlinView, TrashGremlinState>> = {
  idle: { front: 'idle', side: 'idle_side', away: 'idle_back' },
  scurry: { front: 'scurry', side: 'scurry_side', away: 'scurry_back' },
  vomit: { front: 'vomit', side: 'vomit_side', away: 'vomit_back' },
  summon: { front: 'summon', side: 'summon_side', away: 'summon_back' },
};

/** Every state the runtime can ask the figure for, for the art gates. */
export const TRASH_GREMLIN_RUNTIME_STATES: readonly TrashGremlinState[] = Object.values(
  STATE_OF,
).flatMap((views) => Object.values(views));

function frameCountOf(state: TrashGremlinState): number {
  const row = TRASH_GREMLIN_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) throw new Error(`the trash gremlin figure paints no row "${state}"`);
  return row.frameCount;
}

/** Row lengths by state, read once from the figure's row table. */
const TRASH_GREMLIN_FRAME_COUNT: Record<TrashGremlinState, number> = {
  idle: frameCountOf('idle'),
  idle_side: frameCountOf('idle_side'),
  idle_back: frameCountOf('idle_back'),
  scurry: frameCountOf('scurry'),
  scurry_side: frameCountOf('scurry_side'),
  scurry_back: frameCountOf('scurry_back'),
  vomit: frameCountOf('vomit'),
  vomit_side: frameCountOf('vomit_side'),
  vomit_back: frameCountOf('vomit_back'),
  summon: frameCountOf('summon'),
  summon_side: frameCountOf('summon_side'),
  summon_back: frameCountOf('summon_back'),
};

/**
 * The six pieces it comes apart into, in the order the figure paints them.
 * `BodyPartGoreSystem` reads this list.
 */
export const TRASH_GREMLIN_GORE_PARTS: ReadonlyArray<string> = GORE_STATES;

export const TRASH_GREMLIN_BODY_PART_KEY = 'trash_gremlin';

/** How far down its own tile the gremlin's soles stand, in tiles. */
const GROUND_LINE_TILE_Y = GROUND_OFFSET_PX / TILE_SCALE;

function eyePlacement(): EyePlacement {
  const idle = TRASH_GREMLIN_ROWS.find((row) => row.name === STATE_OF.idle.front);
  if (idle === undefined) throw new Error('the trash gremlin figure paints no idle row');
  const idlePose = idle.pose(0);
  const front = eyeCentres(idlePose, 'front');
  const side = eyeCentres(idlePose, 'side');
  return {
    sideForward: side.right.x * GREMLIN_SCALE,
    sideHeight: GROUND_LINE_TILE_Y + side.right.y * GREMLIN_SCALE,
    sideSpacing: SIDE_EYE_SPACING,
    frontMirrors: false,
    frontAcross: ((front.left.x + front.right.x) / 2) * GREMLIN_SCALE,
    frontHeight: GROUND_LINE_TILE_Y + ((front.left.y + front.right.y) / 2) * GREMLIN_SCALE,
    frontSpacing: Math.abs(front.left.x - front.right.x) * GREMLIN_SCALE,
  };
}

/** Edge-on the far eye is hidden behind the flat face, so the pair all but overlaps. */
const SIDE_EYE_SPACING = 0.04;

/**
 * Where its eyes sit for the eye-shine the dark shows of it, derived from the
 * same head the painter draws in its idle crouch.
 */
export const TRASH_GREMLIN_EYES: EyePlacement = eyePlacement();

export interface TrashGremlinSpriteState {
  walkFrame?: number;
  isMoving?: boolean;
  facingX?: number;
  facingY?: number;
  /** Progress through the vomit row, or null when it is not spitting. */
  vomitProgress?: number | null;
  /** Progress through the summon row, or null when it is not summoning. */
  summonProgress?: number | null;
  /** Pins the idle clock, for the preview harness and the intro portrait. */
  idleFrame?: number | null;
}

/** Side wins ties: a diagonal reads better as a profile than as a head-on. */
function viewFor(facingX: number, facingY: number): TrashGremlinView {
  if (Math.abs(facingX) >= Math.abs(facingY)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/** Painted frames a second of the idle, which runs on a clock rather than on its walk. */
export const TRASH_GREMLIN_IDLE_FPS = 7;

export function drawTrashGremlinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: TrashGremlinSpriteState,
): void {
  const facingX = state.facingX ?? 1;
  const facingY = state.facingY ?? 0;
  const view = viewFor(facingX, facingY);
  // Only the profile is mirrored: flipping a head-on view would move its torn
  // ear to the other side every time it turned round.
  const flipX = view === 'side' && facingX < 0;
  const draw = (key: TrashGremlinState, frame: number): void =>
    drawFigureCached(ctx, TRASH_GREMLIN_FIGURE, key, frame, sx, sy, tileSize, { flipX });

  if (state.summonProgress !== null && state.summonProgress !== undefined) {
    const key = STATE_OF.summon[view];
    draw(key, progressFrameIndex(state.summonProgress, TRASH_GREMLIN_FRAME_COUNT[key]));
    return;
  }
  if (state.vomitProgress !== null && state.vomitProgress !== undefined) {
    const key = STATE_OF.vomit[view];
    draw(key, progressFrameIndex(state.vomitProgress, TRASH_GREMLIN_FRAME_COUNT[key]));
    return;
  }
  if (state.isMoving === true) {
    const key = STATE_OF.scurry[view];
    draw(key, walkFrameIndex(state.walkFrame ?? 0, TRASH_GREMLIN_FRAME_COUNT[key]));
    return;
  }
  const key = STATE_OF.idle[view];
  const frames = TRASH_GREMLIN_FRAME_COUNT[key];
  // Clock-driven rather than tied to its own walk phase, so two of them do not
  // breathe in lockstep.
  const idleFrame =
    state.idleFrame ??
    timeFrameIndex(performance.now() / MILLISECONDS_PER_SECOND, TRASH_GREMLIN_IDLE_FPS, frames);
  draw(key, idleFrame % frames);
}

/**
 * The three views of an action, warmed together rather than the one it faces
 * now: a wind-up lasts long enough for the player to walk round it, and the
 * frames the cache must have ready are whichever view it is in when the action
 * lands.
 */
function prewarmAction(action: TrashGremlinAction): void {
  for (const state of Object.values(STATE_OF[action]))
    prewarmFigureState(TRASH_GREMLIN_FIGURE, state);
}

/**
 * The rows it stands and scurries in, plus the one the boss-intro panel draws
 * its portrait from. Asked for as a crawler comes within sight of it, when its
 * room seals and when its intro starts.
 */
export function prewarmTrashGremlinLocomotion(): void {
  prewarmAction('idle');
  prewarmAction('scurry');
}

/**
 * The spit. Asked for when its room seals and again through the fight, so it
 * is resident before the wind-up, which is the whole warning the player gets;
 * the telegraph asks once more.
 */
export function prewarmTrashGremlinVomit(): void {
  prewarmAction('vomit');
}

/**
 * The summon. Asked for when its room seals and again through the fight, so it
 * is resident before the shriek; the start of the shriek asks once more.
 */
export function prewarmTrashGremlinSummon(): void {
  prewarmAction('summon');
}

/**
 * Its severed pieces, asked for when its room seals and again from the enrage
 * until it dies. They are drawn all at once on the frame it dies with no
 * telegraph of their own.
 */
export function prewarmTrashGremlinGore(): void {
  for (const part of TRASH_GREMLIN_GORE_PARTS) prewarmFigureState(TRASH_GREMLIN_FIGURE, part);
}

const ENCOUNTER_STATES: readonly string[] = [
  ...TRASH_GREMLIN_RUNTIME_STATES,
  ...TRASH_GREMLIN_GORE_PARTS,
];

/**
 * Exempts every row it can be drawn in, gore included, from the cache's idle
 * sweep for as long as its fight is sealed. The sweep counts frames the world
 * spends halted behind a menu too, and a fight paused longer than the sweep
 * would otherwise come back to a spit, a shriek or a death painted cold.
 * Pinning bakes nothing; the rows are still warmed by their own requests.
 */
export function pinTrashGremlinEncounterRows(): void {
  for (const state of ENCOUNTER_STATES) pinFigureState(TRASH_GREMLIN_FIGURE, state);
}

/** Undoes {@link pinTrashGremlinEncounterRows}. */
export function unpinTrashGremlinEncounterRows(): void {
  for (const state of ENCOUNTER_STATES) unpinFigureState(TRASH_GREMLIN_FIGURE, state);
}
