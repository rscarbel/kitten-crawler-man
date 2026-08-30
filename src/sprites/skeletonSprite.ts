import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import {
  SKELETON_ARCHER_FIGURE,
  SKELETON_LORD_FIGURE,
  SKELETON_SWORD_FIGURE,
} from './art/skeletonFigure';

/**
 * Draw wrappers for the three skeleton sheets — the Skeleton Lord and his sword
 * and bow warriors.
 *
 * Painted by the three `FigureDef`s in `art/skeletonFigure.ts`. All three
 * figures share a row vocabulary (`walk`/`idle` × toward/side/away, plus one
 * attack row per variant in the same three views) so the view selection is
 * written once per figure as a template-literal lookup over a state union, which
 * keeps the names checked by the compiler rather than assembled as loose
 * strings. `scripts/gates-skeletons.ts` holds those unions and the figures'
 * declared rows equal.
 */

type LordBase = 'walk' | 'idle' | 'cast' | 'hands_cast';
type SwordBase = 'walk' | 'idle' | 'slash';
type ArcherBase = 'walk' | 'idle' | 'draw_loose';

type Viewed<B extends string> = B | `${B}_side` | `${B}_away`;

type LordState = Viewed<LordBase> | 'summon';
type SwordState = Viewed<SwordBase> | 'rise';
type ArcherState = Viewed<ArcherBase> | 'rise';

/** Which of a sheet's three viewpoints a facing vector selects. */
type SkeletonView = 'front' | 'side' | 'away';

/** Loop speed for the idles, which are driven by the clock rather than a timer. */
const IDLE_FPS = 5;
const MS_PER_SECOND = 1000;

/** The climb out of the ground, baked toward the camera only. */
const RISE_STATE = 'rise';

/**
 * The seven pieces a skeleton comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `art/skeletonGore.ts`
 * paints them in this order and `BodyPartGoreSystem` spawns them in it, so a
 * rename in one place is a missing bone rather than a silent no-op.
 */
export const SKELETON_GORE_PARTS: ReadonlyArray<string> = [
  'gore_skull',
  'gore_ribcage',
  'gore_pelvis',
  'gore_femur',
  'gore_tibia',
  'gore_forearm',
  'gore_hand',
];

/** `BodyPartGoreSystem` registry keys — one per variant, so the bones match. */
export const SKELETON_LORD_BODY_PART_KEY = 'skeleton_lord';
export const SKELETON_SWORD_BODY_PART_KEY = 'skeleton_sword';
export const SKELETON_ARCHER_BODY_PART_KEY = 'skeleton_archer';

/**
 * How many frames a state actually holds, read from the figure itself.
 *
 * Not a hand-copied table: the draw call *clamps* the frame index, so a row
 * that got shorter would silently freeze on its last frame rather than throw.
 * There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(figure: FigureDef, state: string): number {
  return figureFrameCount(figure, state);
}

/** Views split on whichever axis the skeleton is facing hardest along. */
function viewFor(facingX: number, facingY: number): SkeletonView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/**
 * Only the profile art is mirrored. Flipping a head-on view would put the
 * shield, the bow and the quiver on the wrong side every time the mob turned.
 */
function flipFor(view: SkeletonView, facingX: number): boolean {
  return view === 'side' && facingX < 0;
}

function lordState(base: LordBase, view: SkeletonView): LordState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

function swordState(base: SwordBase, view: SkeletonView): SwordState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

function archerState(base: ArcherBase, view: SkeletonView): ArcherState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the movement rows need to pick a pose. */
interface SkeletonMotionState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
}

/**
 * Draws whichever of a resolved walk/idle pair the motion state calls for.
 *
 * The idle is clock-driven rather than `walkFrame`-driven because `walkFrame`
 * resets to 0 the moment a mob stops, which would freeze every stationary
 * skeleton on the same frame of its loop.
 */
function drawMovement(
  ctx: CanvasRenderingContext2D,
  figure: FigureDef,
  walk: string,
  idle: string,
  flipX: boolean,
  state: SkeletonMotionState,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  const { walkFrame = 0, isMoving = false } = state;
  if (isMoving) {
    drawFigureCached(
      ctx,
      figure,
      walk,
      walkFrameIndex(walkFrame, frameCountOf(figure, walk)),
      sx,
      sy,
      tileSize,
      { flipX },
    );
    return;
  }
  const nowSeconds = performance.now() / MS_PER_SECOND;
  drawFigureCached(
    ctx,
    figure,
    idle,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(figure, idle)),
    sx,
    sy,
    tileSize,
    { flipX },
  );
}

function drawOneShot(
  ctx: CanvasRenderingContext2D,
  figure: FigureDef,
  state: string,
  progress: number,
  flipX: boolean,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  drawFigureCached(
    ctx,
    figure,
    state,
    progressFrameIndex(progress, frameCountOf(figure, state)),
    sx,
    sy,
    tileSize,
    { flipX },
  );
}

/** What the Skeleton Lord is doing this frame. */
export interface SkeletonLordSpriteState extends SkeletonMotionState {
  /** 0 at the first frame of a soul-bolt cast, 1 at the last; null when not casting. */
  readonly castProgress?: number | null;
  /** 0 to 1 across the grasping-hands wind-up; null when not winding up. */
  readonly handsProgress?: number | null;
  /** 0 to 1 across the summon; null when not summoning. */
  readonly summonProgress?: number | null;
}

/**
 * Draw the Skeleton Lord.
 *
 * Priority runs summon → grasping hands → cast → walk → idle: a committed
 * attack always wins over the drift it interrupted.
 */
export function drawSkeletonLordSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: SkeletonLordSpriteState = {},
): void {
  const { facingX = 1, facingY = 0 } = state;
  const view = viewFor(facingX, facingY);
  const flipX = flipFor(view, facingX);

  const summon = state.summonProgress;
  if (summon !== null && summon !== undefined) {
    // Painted in one facing only — a held, symmetrical, arms-overhead pose is
    // two sleeves on top of each other in profile and a plain robe from behind.
    // Drawn unmirrored whichever way he is turned, because summoning turns him
    // to face the party by definition.
    drawOneShot(ctx, SKELETON_LORD_FIGURE, 'summon', summon, false, sx, sy, tileSize);
    return;
  }

  const hands = state.handsProgress;
  if (hands !== null && hands !== undefined) {
    drawOneShot(
      ctx,
      SKELETON_LORD_FIGURE,
      lordState('hands_cast', view),
      hands,
      flipX,
      sx,
      sy,
      tileSize,
    );
    return;
  }

  const cast = state.castProgress;
  if (cast !== null && cast !== undefined) {
    drawOneShot(ctx, SKELETON_LORD_FIGURE, lordState('cast', view), cast, flipX, sx, sy, tileSize);
    return;
  }

  drawMovement(
    ctx,
    SKELETON_LORD_FIGURE,
    lordState('walk', view),
    lordState('idle', view),
    flipX,
    state,
    sx,
    sy,
    tileSize,
  );
}

/** What a skeleton warrior is doing this frame. */
export interface SkeletonWarriorSpriteState extends SkeletonMotionState {
  /** 0 to 1 across the attack animation; null when not attacking. */
  readonly attackProgress?: number | null;
  /** 0 to 1 across the climb out of the ground; null once risen. */
  readonly riseProgress?: number | null;
}

/**
 * The rise is painted toward the camera only: it is a whole-body climb out of
 * the ground with a soil mound painted at the ground line, and a profile of it
 * shows one arm and a heap of dirt.
 */
function drawRise(
  ctx: CanvasRenderingContext2D,
  figure: FigureDef,
  progress: number,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  drawOneShot(ctx, figure, RISE_STATE, progress, false, sx, sy, tileSize);
}

/** Draw the sword skeleton. */
export function drawSkeletonWarriorSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: SkeletonWarriorSpriteState = {},
): void {
  const { facingX = 1, facingY = 0 } = state;
  const view = viewFor(facingX, facingY);
  const flipX = flipFor(view, facingX);

  const rise = state.riseProgress;
  if (rise !== null && rise !== undefined) {
    drawRise(ctx, SKELETON_SWORD_FIGURE, rise, sx, sy, tileSize);
    return;
  }
  const attack = state.attackProgress;
  if (attack !== null && attack !== undefined) {
    drawOneShot(
      ctx,
      SKELETON_SWORD_FIGURE,
      swordState('slash', view),
      attack,
      flipX,
      sx,
      sy,
      tileSize,
    );
    return;
  }
  drawMovement(
    ctx,
    SKELETON_SWORD_FIGURE,
    swordState('walk', view),
    swordState('idle', view),
    flipX,
    state,
    sx,
    sy,
    tileSize,
  );
}

/** Draw the bow skeleton. */
export function drawSkeletonArcherSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: SkeletonWarriorSpriteState = {},
): void {
  const { facingX = 1, facingY = 0 } = state;
  const view = viewFor(facingX, facingY);
  const flipX = flipFor(view, facingX);

  const rise = state.riseProgress;
  if (rise !== null && rise !== undefined) {
    drawRise(ctx, SKELETON_ARCHER_FIGURE, rise, sx, sy, tileSize);
    return;
  }
  const attack = state.attackProgress;
  if (attack !== null && attack !== undefined) {
    drawOneShot(
      ctx,
      SKELETON_ARCHER_FIGURE,
      archerState('draw_loose', view),
      attack,
      flipX,
      sx,
      sy,
      tileSize,
    );
    return;
  }
  drawMovement(
    ctx,
    SKELETON_ARCHER_FIGURE,
    archerState('walk', view),
    archerState('idle', view),
    flipX,
    state,
    sx,
    sy,
    tileSize,
  );
}

// ── Prewarm ──────────────────────────────────────────────────────────────────

/**
 * Every row a variant can be drawn in, warmed as one set at the moment it is
 * scheduled to appear.
 *
 * All of them rather than just the walk: a skeleton is over the paint-cost line
 * a direct-paint fallback can absorb, escorts arrive two and three at a time,
 * and the Lich's summons arrive in the middle of a fight that is already
 * running — so the first frame of an attack is the worst possible moment to be
 * painting one from scratch. Each variant's whole set is a few megabytes, well
 * inside what the cache holds for one figure.
 *
 * The loose bones are deliberately absent: they are one cell each, entered only
 * once, and a single direct paint is cheaper than warming seven rows nothing
 * may ever play.
 */
const LORD_STATES: ReadonlyArray<LordState> = [
  'walk',
  'walk_side',
  'walk_away',
  'idle',
  'idle_side',
  'idle_away',
  'cast',
  'cast_side',
  'cast_away',
  'hands_cast',
  'hands_cast_side',
  'hands_cast_away',
  'summon',
];

const SWORD_STATES: ReadonlyArray<SwordState> = [
  'walk',
  'walk_side',
  'walk_away',
  'idle',
  'idle_side',
  'idle_away',
  'slash',
  'slash_side',
  'slash_away',
  'rise',
];

const ARCHER_STATES: ReadonlyArray<ArcherState> = [
  'walk',
  'walk_side',
  'walk_away',
  'idle',
  'idle_side',
  'idle_away',
  'draw_loose',
  'draw_loose_side',
  'draw_loose_away',
  'rise',
];

/** Warms the Skeleton Lord's rows. Called where his encounter is placed. */
export function prewarmSkeletonLordSprite(): void {
  for (const state of LORD_STATES) prewarmFigureState(SKELETON_LORD_FIGURE, state);
}

/**
 * Warms both warriors' rows.
 *
 * Called where a wave of them is *scheduled* rather than where it is created —
 * a summon's cast, a bounty's placement — because that is the only point far
 * enough ahead of the first draw for a spread bake to finish.
 */
export function prewarmSkeletonEscortSprites(): void {
  for (const state of SWORD_STATES) prewarmFigureState(SKELETON_SWORD_FIGURE, state);
  for (const state of ARCHER_STATES) prewarmFigureState(SKELETON_ARCHER_FIGURE, state);
}

/** Every row a prewarm names, per variant, for the gate that checks they exist. */
export const SKELETON_PREWARMED_STATES: Readonly<Record<string, ReadonlyArray<string>>> = {
  skeleton_lord: LORD_STATES,
  skeleton_sword: SWORD_STATES,
  skeleton_archer: ARCHER_STATES,
};
