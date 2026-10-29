/**
 * Big Rooster's kettlebell rain: once he heaves a rack's worth into the air,
 * bells come down across the gym for {@link KETTLEBELL_RAIN_FRAMES}, each on a
 * shadow that grows for {@link KETTLEBELL_FALL_FRAMES} before it lands.
 *
 * Pure: no canvas and no audio. The gym owns one, ticks it, and resolves what
 * each landing hits, so a rain he started keeps falling after he dies.
 */

import { TILE_SIZE } from '../../core/constants';
import type { TilePoint } from './bossRoomLayout';

/** How long one rain keeps falling: twelve seconds. */
export const KETTLEBELL_RAIN_FRAMES = 720;
/** How many bells one heave sends up; they land evenly across the rain. */
const KETTLEBELL_RAIN_COUNT = 72;
/** Frames from a bell's shadow appearing to its landing: its whole telegraph. */
export const KETTLEBELL_FALL_FRAMES = 60;
/** Every this-many landings, one is aimed where the active crawler stands. */
const KETTLEBELL_AIM_EVERY = 4;
/** How far a landing reaches from its tile's centre, in tiles. */
const KETTLEBELL_IMPACT_RADIUS_TILES = 0.75;
export const KETTLEBELL_IMPACT_RADIUS_PX = KETTLEBELL_IMPACT_RADIUS_TILES * TILE_SIZE;
/**
 * The ring of floor round the active crawler that must always keep one tile no
 * shadow covers, in tiles: a step or two away is always somewhere safe.
 */
const SAFE_TILE_REACH_TILES = 3;
/** Random tiles tried for one landing before it waits a frame. */
const LANDING_ATTEMPTS = 24;
const FRAMES_BETWEEN_LANDINGS = Math.max(
  1,
  Math.floor(KETTLEBELL_RAIN_FRAMES / KETTLEBELL_RAIN_COUNT),
);
const TILE_CENTRE = 0.5;

/** The floor a rain may land on: the gym's tiles and which of them a crawler can stand on. */
export interface KettlebellRainRoom {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  isWalkable(tileX: number, tileY: number): boolean;
}

/** One bell on its way down: its landing point's centre in world pixels. */
export interface FallingKettlebell {
  readonly x: number;
  readonly y: number;
  /** Frames until it lands; its shadow grows as this falls. */
  readonly framesLeft: number;
  /** Which weight band it is drawn in. */
  readonly band: number;
}

/** What a rain did in one frame. */
export interface KettlebellRainFrame {
  /** True when a new bell's shadow appeared. */
  readonly launched: boolean;
  /** The bells that hit the floor. */
  readonly landed: readonly FallingKettlebell[];
}

interface LiveBell {
  x: number;
  y: number;
  framesLeft: number;
  band: number;
}

const tileCentre = (tile: TilePoint): { x: number; y: number } => ({
  x: (tile.x + TILE_CENTRE) * TILE_SIZE,
  y: (tile.y + TILE_CENTRE) * TILE_SIZE,
});

function covers(bell: { x: number; y: number }, tile: TilePoint): boolean {
  const centre = tileCentre(tile);
  return Math.hypot(centre.x - bell.x, centre.y - bell.y) < KETTLEBELL_IMPACT_RADIUS_PX;
}

export class KettlebellRain {
  private readonly bells: LiveBell[] = [];
  private framesOfRainLeft = 0;
  private framesUntilNextLanding = 0;
  private landingsPlanned = 0;

  constructor(private readonly random: () => number = Math.random) {}

  /** Starts a fresh rain, or restarts the clock on one already falling. */
  start(): void {
    this.framesOfRainLeft = KETTLEBELL_RAIN_FRAMES;
    this.framesUntilNextLanding = 0;
  }

  /** No more bells go up; the ones already falling still come down. */
  stopNewBells(): void {
    this.framesOfRainLeft = 0;
  }

  /** Forgets every bell, falling or due: a checkpoint restore or a fight called off. */
  clear(): void {
    this.bells.length = 0;
    this.framesOfRainLeft = 0;
    this.framesUntilNextLanding = 0;
    this.landingsPlanned = 0;
  }

  /** True while bells are still due to go up. */
  get raining(): boolean {
    return this.framesOfRainLeft > 0;
  }

  /** Every bell still in the air. */
  get falling(): readonly FallingKettlebell[] {
    return this.bells;
  }

  /**
   * One frame: plans the next landing if one is due and lowers every bell.
   * `activeTile` is the tile the active crawler stands on, or null when there
   * is nobody to aim at.
   */
  tick(room: KettlebellRainRoom, activeTile: TilePoint | null): KettlebellRainFrame {
    let launched = false;
    if (this.framesOfRainLeft > 0) {
      this.framesOfRainLeft--;
      if (this.framesUntilNextLanding > 0) {
        this.framesUntilNextLanding--;
      } else {
        const landing = this.chooseLanding(room, activeTile);
        if (landing !== null) {
          const centre = tileCentre(landing);
          this.bells.push({
            x: centre.x,
            y: centre.y,
            framesLeft: KETTLEBELL_FALL_FRAMES,
            band: this.landingsPlanned,
          });
          this.landingsPlanned++;
          this.framesUntilNextLanding = FRAMES_BETWEEN_LANDINGS;
          launched = true;
        }
      }
    }
    const landed: FallingKettlebell[] = [];
    for (let index = this.bells.length - 1; index >= 0; index--) {
      const bell = this.bells[index];
      bell.framesLeft--;
      if (bell.framesLeft > 0) continue;
      landed.push({ ...bell });
      this.bells.splice(index, 1);
    }
    return { launched, landed };
  }

  /**
   * Where the next bell comes down: on the active crawler every
   * {@link KETTLEBELL_AIM_EVERY} landings, at random otherwise, and never
   * where it would leave the crawler no uncovered floor within
   * {@link SAFE_TILE_REACH_TILES} to step to.
   */
  private chooseLanding(room: KettlebellRainRoom, activeTile: TilePoint | null): TilePoint | null {
    const aimed = (this.landingsPlanned + 1) % KETTLEBELL_AIM_EVERY === 0;
    if (aimed && activeTile !== null && this.leavesSafeTile(room, activeTile, activeTile)) {
      return activeTile;
    }
    for (let attempt = 0; attempt < LANDING_ATTEMPTS; attempt++) {
      const candidate = {
        x: room.x + Math.floor(this.random() * room.w),
        y: room.y + Math.floor(this.random() * room.h),
      };
      if (!room.isWalkable(candidate.x, candidate.y)) continue;
      if (activeTile !== null && !this.leavesSafeTile(room, activeTile, candidate)) continue;
      return candidate;
    }
    return null;
  }

  /** Whether a bell on `candidate` still leaves some tile near `crawler` that no shadow covers. */
  private leavesSafeTile(
    room: KettlebellRainRoom,
    crawler: TilePoint,
    candidate: TilePoint,
  ): boolean {
    const shadows = [...this.bells, tileCentre(candidate)];
    return safeTileNear(room, crawler, shadows) !== null;
  }
}

/**
 * A tile within {@link SAFE_TILE_REACH_TILES} of `crawler` that no shadow in
 * `shadows` covers, or null.
 */
export function safeTileNear(
  room: KettlebellRainRoom,
  crawler: TilePoint,
  shadows: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): TilePoint | null {
  for (let dy = -SAFE_TILE_REACH_TILES; dy <= SAFE_TILE_REACH_TILES; dy++) {
    for (let dx = -SAFE_TILE_REACH_TILES; dx <= SAFE_TILE_REACH_TILES; dx++) {
      const tile = { x: crawler.x + dx, y: crawler.y + dy };
      const inside =
        tile.x >= room.x &&
        tile.y >= room.y &&
        tile.x < room.x + room.w &&
        tile.y < room.y + room.h;
      if (!inside || !room.isWalkable(tile.x, tile.y)) continue;
      if (shadows.some((shadow) => covers(shadow, tile))) continue;
      return tile;
    }
  }
  return null;
}
