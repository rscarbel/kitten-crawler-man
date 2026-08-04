import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteKey, type SpriteStates } from '../core/SpriteLoader';

/**
 * Draw wrappers for the three skeleton sheets — the Skeleton Lord and his sword
 * and bow warriors.
 *
 * Baked by `npm run gen:skeletons` from `scripts/skeletonArt.ts`. All three
 * sheets share a row vocabulary (`walk`/`idle` × toward/side/away, plus one
 * attack row per variant in the same three views) so the view selection is
 * written once per sheet as a template-literal lookup — which keeps the state
 * names checked against the manifest rather than assembled as loose strings.
 */

type LordState = SpriteStates['skeleton_lord'];
type SwordState = SpriteStates['skeleton_sword'];
type ArcherState = SpriteStates['skeleton_archer'];

/** Which of a sheet's three viewpoints a facing vector selects. */
type SkeletonView = 'front' | 'side' | 'away';

/** Loop speed for the idles, which are driven by the clock rather than a timer. */
const IDLE_FPS = 5;

/**
 * The seven pieces a skeleton comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `scripts/skeletonGore.ts`
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
 * How many frames a state actually holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a row that
 * got shorter in a rebake would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(key: string, state: string): number {
  return getSpriteDefByKey(key)?.states.get(state)?.frameCount ?? 1;
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

function lordState(base: 'walk' | 'idle' | 'cast' | 'hands_cast', view: SkeletonView): LordState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

function swordState(base: 'walk' | 'idle' | 'slash', view: SkeletonView): SwordState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

function archerState(base: 'walk' | 'idle' | 'draw_loose', view: SkeletonView): ArcherState {
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
function drawMovement<K extends SpriteKey>(
  ctx: CanvasRenderingContext2D,
  key: K,
  walk: SpriteStates[K],
  idle: SpriteStates[K],
  flipX: boolean,
  state: SkeletonMotionState,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  const { walkFrame = 0, isMoving = false } = state;
  if (isMoving) {
    drawSpriteKey(
      ctx,
      key,
      walk,
      walkFrameIndex(walkFrame, frameCountOf(key, walk)),
      sx,
      sy,
      tileSize,
      {
        flipX,
      },
    );
    return;
  }
  const nowSeconds = performance.now() / 1000;
  drawSpriteKey(
    ctx,
    key,
    idle,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(key, idle)),
    sx,
    sy,
    tileSize,
    { flipX },
  );
}

function drawOneShot<K extends SpriteKey>(
  ctx: CanvasRenderingContext2D,
  key: K,
  state: SpriteStates[K],
  progress: number,
  flipX: boolean,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  drawSpriteKey(
    ctx,
    key,
    state,
    progressFrameIndex(progress, frameCountOf(key, state)),
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

const LORD_KEY = 'skeleton_lord' as const;

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
    // Baked in one facing only — see the note on `summonFront` in the generator.
    // Drawn unmirrored whichever way he is turned, because summoning turns him
    // to face the party by definition.
    drawOneShot(ctx, LORD_KEY, 'summon', summon, false, sx, sy, tileSize);
    return;
  }

  const hands = state.handsProgress;
  if (hands !== null && hands !== undefined) {
    drawOneShot(ctx, LORD_KEY, lordState('hands_cast', view), hands, flipX, sx, sy, tileSize);
    return;
  }

  const cast = state.castProgress;
  if (cast !== null && cast !== undefined) {
    drawOneShot(ctx, LORD_KEY, lordState('cast', view), cast, flipX, sx, sy, tileSize);
    return;
  }

  drawMovement(
    ctx,
    LORD_KEY,
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

const SWORD_KEY = 'skeleton_sword' as const;
const ARCHER_KEY = 'skeleton_archer' as const;

/**
 * The rise is baked toward the camera only: it is a whole-body climb out of the
 * ground with a soil mound painted at the ground line, and a profile of it shows
 * one arm and a heap of dirt.
 */
function drawRise<K extends SpriteKey>(
  ctx: CanvasRenderingContext2D,
  key: K,
  rise: SpriteStates[K],
  progress: number,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  drawOneShot(ctx, key, rise, progress, false, sx, sy, tileSize);
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
    drawRise(ctx, SWORD_KEY, 'rise', rise, sx, sy, tileSize);
    return;
  }
  const attack = state.attackProgress;
  if (attack !== null && attack !== undefined) {
    drawOneShot(ctx, SWORD_KEY, swordState('slash', view), attack, flipX, sx, sy, tileSize);
    return;
  }
  drawMovement(
    ctx,
    SWORD_KEY,
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
    drawRise(ctx, ARCHER_KEY, 'rise', rise, sx, sy, tileSize);
    return;
  }
  const attack = state.attackProgress;
  if (attack !== null && attack !== undefined) {
    drawOneShot(ctx, ARCHER_KEY, archerState('draw_loose', view), attack, flipX, sx, sy, tileSize);
    return;
  }
  drawMovement(
    ctx,
    ARCHER_KEY,
    archerState('walk', view),
    archerState('idle', view),
    flipX,
    state,
    sx,
    sy,
    tileSize,
  );
}
