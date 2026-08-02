import { TILE_SIZE } from '../core/constants';
import { clamp } from '../utils';

/**
 * Mordecai's amble around his safe room.
 *
 * He picks a spot, walks to it, stands about for a moment, and picks another —
 * inside a small patch of floor around his home tile and nowhere else. He is a
 * fixture, not a mob: nothing outside this class writes his position, and the
 * roam rectangle is re-imposed after every step, so there is no path by which
 * the player, a shove, or a pathfinder can move him out of his room.
 */

/** How far from his home tile he is willing to stray, in tiles. */
const ROAM_RADIUS_TILES = 2;
/** Tiles kept clear of the room's walls, so he never stands inside one. */
const WALL_MARGIN_TILES = 1;
const SPEED_PX_PER_FRAME = 0.34;
/** Below this he counts as arrived; smaller and he jitters on the spot. */
const ARRIVAL_EPSILON_PX = 0.6;
/** A new target must be at least this far off, or he twitches in place. */
const MIN_TARGET_DISTANCE_TILES = 0.9;
const MIN_TARGET_DISTANCE_PX = TILE_SIZE * MIN_TARGET_DISTANCE_TILES;
const PAUSE_MIN_FRAMES = 70;
/** Exported so the preview harness can size a wheel-step to clear one pause. */
export const MORDECAI_MAX_PAUSE_FRAMES = 240;
const PAUSE_MAX_FRAMES = MORDECAI_MAX_PAUSE_FRAMES;
/** Tries at finding a reachable target before he simply stands still longer. */
const TARGET_ATTEMPTS = 12;
/** Spread of the per-room idle phase offset, comfortably over one idle loop. */
const IDLE_STAGGER_SECONDS = 4;

export interface WanderTile {
  readonly x: number;
  readonly y: number;
}

export interface MordecaiWanderState {
  /** Screen-space top-left of the tile he occupies, which is what draws him. */
  readonly x: number;
  readonly y: number;
  readonly isWalking: boolean;
  /** +1 faces right, −1 left, 0 while he is walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /**
   * The last left/right he committed to, never 0.
   *
   * Mordecai's other two forms are procedural sprites with no vertical art at
   * all: they mirror on `facingX < 0` and nothing else, so the axis-committed
   * `facingX` going to 0 on a vertical step reads to them as "face right" and
   * snaps them round mid-stride. They follow this instead.
   */
  readonly lastHorizontalFacing: number;
  /** Fixed offset into the idle loop, so rooms do not breathe in unison. */
  readonly idleOffsetSeconds: number;
  /** Walk-cycle angle in radians, advanced by the ground he has covered. */
  readonly walkPhase: number;
}

interface RoamRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export class MordecaiWanderer {
  private x: number;
  private y: number;
  private targetX: number;
  private targetY: number;
  private pauseFrames: number;
  private facingX = 1;
  private facingY = 0;
  private lastHorizontalFacing = 1;
  /**
   * A fixed offset into the idle loop. The idle animates off the wall clock,
   * which is the same for every safe room on a floor, so without this two
   * Mordecais breathe and blink in perfect unison.
   */
  private readonly idleOffsetSeconds = randomBetween(0, IDLE_STAGGER_SECONDS);
  private walkPhase = 0;
  private readonly roam: RoamRect;

  /**
   * @param room       Safe-room bounds in tiles.
   * @param home       His home tile — the centre of the patch he wanders.
   * @param pixelsPerWalkCycle  Ground one cycle of the sprite's walk covers, so
   *   the phase advances with distance and his planted foot does not skate.
   * @param canStand   Whether a tile is floor he may stand on. Consulted for
   *   every candidate target, which is what keeps him out of the bed, the
   *   Bopca's counter and the furniture.
   */
  constructor(
    room: { x: number; y: number; w: number; h: number },
    home: WanderTile,
    private readonly pixelsPerWalkCycle: number,
    private readonly canStand: (tileX: number, tileY: number) => boolean,
  ) {
    // The intersection of "near home" and "inside this room's walls". Taking
    // either alone is how a wanderer ends up in a corridor or in a wall.
    const interiorMinX = room.x + WALL_MARGIN_TILES;
    const interiorMinY = room.y + WALL_MARGIN_TILES;
    const interiorMaxX = room.x + room.w - 1 - WALL_MARGIN_TILES;
    const interiorMaxY = room.y + room.h - 1 - WALL_MARGIN_TILES;
    const minTileX = Math.max(interiorMinX, home.x - ROAM_RADIUS_TILES);
    const minTileY = Math.max(interiorMinY, home.y - ROAM_RADIUS_TILES);
    const maxTileX = Math.min(interiorMaxX, home.x + ROAM_RADIUS_TILES);
    const maxTileY = Math.min(interiorMaxY, home.y + ROAM_RADIUS_TILES);
    // A room too small for the margin inverts the rect, and a clamp against an
    // inverted rect would place him on its corner — a tile that is neither his
    // home nor necessarily standable. Collapsing onto his home tile is the
    // honest answer: he simply stands still.
    const degenerate = maxTileX < minTileX || maxTileY < minTileY;
    this.roam = degenerate
      ? {
          minX: home.x * TILE_SIZE,
          minY: home.y * TILE_SIZE,
          maxX: home.x * TILE_SIZE,
          maxY: home.y * TILE_SIZE,
        }
      : {
          minX: minTileX * TILE_SIZE,
          minY: minTileY * TILE_SIZE,
          maxX: maxTileX * TILE_SIZE,
          maxY: maxTileY * TILE_SIZE,
        };
    this.x = clamp(home.x * TILE_SIZE, this.roam.minX, this.roam.maxX);
    this.y = clamp(home.y * TILE_SIZE, this.roam.minY, this.roam.maxY);
    this.targetX = this.x;
    this.targetY = this.y;
    // Staggered, so several safe rooms on one floor do not amble in lockstep.
    this.pauseFrames = randomFrames(0, PAUSE_MAX_FRAMES);
  }

  get state(): MordecaiWanderState {
    return {
      x: this.x,
      y: this.y,
      isWalking: this.pauseFrames <= 0,
      facingX: this.facingX,
      facingY: this.facingY,
      lastHorizontalFacing: this.lastHorizontalFacing,
      idleOffsetSeconds: this.idleOffsetSeconds,
      walkPhase: this.walkPhase,
    };
  }

  /**
   * Stops him where he is, standing, until `update` is called again.
   *
   * Called *in place of* `update`, not alongside it. Simply skipping the update
   * is not enough on its own: that leaves `isWalking` true with the phase
   * frozen, so the sprite holds a single mid-swing frame — one foot in the air —
   * for as long as the hold lasts. Putting a pause on the clock instead makes
   * him read as standing, and one frame of `update` afterwards resumes him.
   */
  hold(): void {
    this.pauseFrames = Math.max(this.pauseFrames, 1);
  }

  update(): void {
    if (this.pauseFrames > 0) {
      this.pauseFrames -= 1;
      if (this.pauseFrames <= 0) {
        this.pauseFrames = 0;
        this.chooseTarget();
      }
      return;
    }

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const remaining = Math.hypot(dx, dy);
    if (remaining <= ARRIVAL_EPSILON_PX) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.pauseFrames = randomFrames(PAUSE_MIN_FRAMES, PAUSE_MAX_FRAMES);
      return;
    }

    const step = Math.min(SPEED_PX_PER_FRAME, remaining);
    const stepX = (dx / remaining) * step;
    const stepY = (dy / remaining) * step;
    // The *path* is checked, not only the destination. Vetting the target alone
    // stops him finishing inside the bed or the counter but happily walks him
    // straight through either on the way to somewhere else — and in a small safe
    // room the bed sits exactly on the edge of his roam rect.
    if (!this.canStand(tileOf(this.x + stepX), tileOf(this.y + stepY))) {
      this.pauseFrames = randomFrames(PAUSE_MIN_FRAMES, PAUSE_MAX_FRAMES);
      return;
    }
    this.x += stepX;
    this.y += stepY;
    this.setFacing(stepX, stepY);
    // The cycle is advanced by ground covered, never by elapsed frames: the
    // sheet's stance foot is planted, so anything else makes him skate.
    this.walkPhase += (step / this.pixelsPerWalkCycle) * Math.PI * 2;

    // Belt and braces. Nothing above can leave the rectangle, and nothing
    // outside this class touches his position — but he must be *inside his safe
    // room*, and a clamp is a guarantee where an argument is only a hope.
    this.x = clamp(this.x, this.roam.minX, this.roam.maxX);
    this.y = clamp(this.y, this.roam.minY, this.roam.maxY);
  }

  /**
   * The dominant axis wins outright rather than blending, because the sprite has
   * three views and no diagonal: a figure walking down-left has to commit to
   * being seen either from the side or from the front.
   */
  private setFacing(stepX: number, stepY: number): void {
    if (Math.abs(stepX) >= Math.abs(stepY)) {
      this.facingX = stepX >= 0 ? 1 : -1;
      this.facingY = 0;
      this.lastHorizontalFacing = this.facingX;
      return;
    }
    this.facingX = 0;
    this.facingY = stepY >= 0 ? 1 : -1;
  }

  private chooseTarget(): void {
    for (let attempt = 0; attempt < TARGET_ATTEMPTS; attempt++) {
      const x = randomBetween(this.roam.minX, this.roam.maxX);
      const y = randomBetween(this.roam.minY, this.roam.maxY);
      if (Math.hypot(x - this.x, y - this.y) < MIN_TARGET_DISTANCE_PX) continue;
      if (!this.canStand(tileOf(x), tileOf(y))) continue;
      this.targetX = x;
      this.targetY = y;
      return;
    }
    // Nowhere to go — a cramped or cluttered room. Stand still and try later
    // rather than walking to a spot that was rejected for a reason.
    this.pauseFrames = randomFrames(PAUSE_MIN_FRAMES, PAUSE_MAX_FRAMES);
  }
}

/**
 * The tile a pixel position falls on.
 *
 * Rounded, matching `SafeRoomSystem`'s own tile lookup and the anchor he is
 * drawn from — so the tile this reports is the tile he visually occupies. The
 * consequence is that he crosses the halfway line of a blocked tile before the
 * path check refuses it; his sprite overhangs its own tile by more than that in
 * every direction anyway.
 */
function tileOf(px: number): number {
  return Math.round(px / TILE_SIZE);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * A whole number of frames. The countdown decrements by one per frame and the
 * target is chosen when it runs out, so a fractional pause skips past the moment
 * it expires — and a wanderer that never picks a target simply never moves.
 */
function randomFrames(min: number, max: number): number {
  return Math.round(randomBetween(min, max));
}
