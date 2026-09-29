import {
  drawRatKinSprite,
  prewarmRatKinSprite,
  RAT_KIN_TILES_PER_WALK_CYCLE,
} from './ratKinSprite';
import {
  drawIncubusSprite,
  INCUBUS_TILES_PER_WALK_CYCLE,
  incubusHeadClearanceTiles,
  prewarmIncubusSprite,
} from './incubusSprite';
import { bugabooHeadClearanceTiles, drawBugabooSprite } from './bugabooSprite';

/**
 * How much room above the tile origin the tile-anchored overhead UI already
 * reserves for itself. The "…" bubble and the Space prompt both hang off the
 * NPC's tile, and half a tile is enough to clear the Rat Kin, who is roughly
 * tile-tall.
 */
const TILE_ANCHORED_UI_CLEARANCE_TILES = 0.5;

/** Everything the Mordecai variants need to animate, whichever one is drawn. */
export interface MordecaiSpriteState {
  /**
   * Walk-cycle angle in radians, advanced by the ground he has actually covered
   * rather than by elapsed frames. The Rat Kin and the Bugaboo are frame-indexed
   * whose stance foot is planted, so anything else skates.
   */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  /** True while the player is in conversation with him; only the Incubus has a talking row. */
  readonly isTalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /**
   * The last left/right he committed to, never 0. Every form has its own
   * head-on and away rows and takes `facingX`/`facingY` directly; this is only
   * what decides which way a profile row is mirrored when he stands still.
   */
  readonly lastHorizontalFacing: number;
  /** Offset into the idle loops, so safe rooms do not idle in unison. */
  readonly idleOffsetSeconds: number;
}

/**
 * Extra pixels that overhead UI must rise by to clear the Mordecai variant this
 * level draws, beyond the clearance a tile-anchored bubble or prompt already
 * assumes. Zero for the Rat Kin; the Bugaboo and the Incubus both stand taller
 * than a tile, so their heads overlap anything anchored on the tile.
 */
export function mordecaiOverheadLift(levelId: string, tileSize: number): number {
  const headClearanceTiles =
    levelId === 'level2'
      ? bugabooHeadClearanceTiles()
      : levelId === 'level3'
        ? incubusHeadClearanceTiles()
        : 0;
  const excessTiles = headClearanceTiles - TILE_ANCHORED_UI_CLEARANCE_TILES;
  return Math.max(0, excessTiles * tileSize);
}

/** The highest his art reaches for a figure whose tile top is at `sy`. */
export function mordecaiHeadTop(levelId: string, sy: number, tileSize: number): number {
  return sy - mordecaiOverheadLift(levelId, tileSize) - TILE_ANCHORED_UI_CLEARANCE_TILES * tileSize;
}

/**
 * Warms the cached rows of whichever Mordecai variant this level draws, at the
 * moment his room is built rather than on his first frame.
 *
 * Branches on the same level IDs {@link drawMordecaiForLevel} does, so a level
 * cannot be warmed for a shape it never draws. The Bugaboo is not painted
 * through the figure cache here, so it has nothing to warm.
 */
export function prewarmMordecaiForLevel(levelId: string): void {
  if (levelId === 'level2') return;
  if (levelId === 'level3') {
    prewarmIncubusSprite();
    return;
  }
  prewarmRatKinSprite();
}

/**
 * Ground one cycle of this level's Mordecai walk covers, in tiles, so the
 * wander can pace it by distance and the planted foot holds still. The
 * Bugaboo's walk was tuned against the Rat Kin's pacing and shares it.
 */
export function mordecaiTilesPerWalkCycle(levelId: string): number {
  return levelId === 'level3' ? INCUBUS_TILES_PER_WALK_CYCLE : RAT_KIN_TILES_PER_WALK_CYCLE;
}

/**
 * Dispatcher: picks the correct Mordecai variant sprite for the given level ID.
 * Level 3 (the Over City) gets the Incubus; level 2 gets the Bugaboo; others
 * use the Rat Kin.
 */
export function drawMordecaiForLevel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: MordecaiSpriteState,
  levelId: string,
) {
  const { walkPhase, isWalking, facingY, lastHorizontalFacing, idleOffsetSeconds } = state;
  if (levelId === 'level3') {
    drawIncubusSprite(ctx, sx, sy, s, {
      walkPhase,
      isWalking,
      isTalking: state.isTalking,
      facingX: state.facingX === 0 && facingY === 0 ? lastHorizontalFacing : state.facingX,
      facingY,
      idleOffsetSeconds,
    });
  } else if (levelId === 'level2') {
    // Never a swipe, a breach or an emergence: this one is a shopkeeper wearing
    // the shape, and the only rows he has any business in are stance and walk.
    drawBugabooSprite(ctx, sx, sy, s, {
      walkFrame: walkPhase,
      isMoving: isWalking,
      // The raw axis, not the substituted one: his wander commits to a single
      // axis at a time, so folding `lastHorizontalFacing` in here makes
      // `|facingX|` 1 on every frame and the sprite never leaves its profile
      // row — he walks up and down the safe room side-on. The last committed
      // facing is only a fallback for standing still having never moved.
      facingX: state.facingX === 0 && facingY === 0 ? lastHorizontalFacing : state.facingX,
      facingY,
      loopOffsetSeconds: idleOffsetSeconds,
    });
  } else {
    drawRatKinSprite(ctx, sx, sy, s, state);
  }
}
