/**
 * The receding dungeon hall the title is staged in, as one-point perspective
 * derived from the stage. Every environment layer that has to agree on where a
 * wall, the floor or the doorway is — the hall itself, the vault behind it,
 * the torches on its walls and the light they throw — reads it from here
 * rather than measuring the picture itself.
 *
 * Distances are in game tiles. A "scale" is how much nearer than the far wall
 * a point is: 1 on the far wall, growing toward the viewer, so a tile at scale
 * `s` is `farPxPerTile * s` CSS pixels across.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Rect } from '../../ui/core/geom';
import type { TitleDepth, TitlePoint } from './titleLayer';
import type { TitleComposition, TitleStage } from './titleStage';

/** The parallax plane the hall and everything fixed to its walls sit on. */
export const HALL_DEPTH: TitleDepth = 0.35;

/**
 * How far above the far floor line the eye's vanishing point sits, as a share
 * of the height. It is chosen so the stage's torch mounts on each side wall lie
 * on one line through it, which is what makes them read as a row of sconces
 * at one height rather than as scattered lights.
 */
const VANISH_Y_FRACTION: Readonly<Record<TitleComposition, number>> = {
  landscape: 0.42,
  portrait: 0.385,
};

/** The far wall's half-width as a multiple of the drop from the vanishing point to the far floor. */
const FAR_HALF_WIDTH_PER_DROP: Readonly<Record<TitleComposition, number>> = {
  landscape: 1.6,
  portrait: 0.9,
};

/** The eye's height above the floor is held inside this range whatever the hero scale asks for. */
const MIN_EYE_HEIGHT_TILES = 2;
const MAX_EYE_HEIGHT_TILES = 4.5;

/** From the heroes' feet to the far wall. */
const HALL_LENGTH_TILES = 14;

/** How tall the walls stand before they are lost in the dark of the vault. */
export const WALL_HEIGHT_TILES = 7;
/** Below this height a wall is fully lit stone; above it the stone falls away into the vault's dark. */
export const WALL_FADE_START_TILES = 3.2;

/** The doorway in the far wall the stairwell descends through. */
const DOOR_WIDTH_TILES = 2.2;
const DOOR_HEIGHT_TILES = 3.4;

/** Pilasters, and the vault ribs that spring from them, stand this far apart down the hall. */
const RIB_SPACING_TILES = 4;
/** The nearest rib is this far behind the heroes, so one never cuts across the front of the cast. */
const NEAREST_RIB_BEHIND_HEROES_TILES = 1;

/** Smaller than any drop a real viewport produces; guards the divisions below. */
const MIN_DROP_PX = 1;

export interface TitleHall {
  /** Where every line running down the hall meets. */
  readonly vanish: TitlePoint;
  /** Where the far wall meets the floor. */
  readonly farFloorY: number;
  /** From the vanishing point down to the far floor line. */
  readonly drop: number;
  readonly farHalfWidth: number;
  readonly farPxPerTile: number;
  readonly eyeHeightTiles: number;
  readonly halfWidthTiles: number;
  readonly wallHeightTiles: number;
  /** From the eye to the far wall. */
  readonly farDistanceTiles: number;
  /** From the eye to the heroes' feet. */
  readonly heroDistanceTiles: number;
  /** The doorway's bounding box; its top is a round arch. */
  readonly door: Rect;
  /** Eye distances of the pilasters down each side wall, nearest first. */
  readonly ribDistancesTiles: readonly number[];
}

/** The hall a stage is staged in. */
export function titleHall(stage: TitleStage): TitleHall {
  const composition = stage.composition;
  const vanish = { x: stage.width / 2, y: VANISH_Y_FRACTION[composition] * stage.height };
  const drop = Math.max(MIN_DROP_PX, stage.horizonY - vanish.y);
  const heroPxPerTile = stage.heroScale * TILE_SIZE;
  const heroDrop = Math.max(drop, stage.floorY - vanish.y);
  const eyeHeightTiles = clamp(
    heroDrop / heroPxPerTile,
    MIN_EYE_HEIGHT_TILES,
    MAX_EYE_HEIGHT_TILES,
  );
  const farPxPerTile = drop / eyeHeightTiles;
  const farHalfWidth = drop * FAR_HALF_WIDTH_PER_DROP[composition];

  const heroScale = heroDrop / drop;
  const heroDistanceTiles = HALL_LENGTH_TILES / Math.max(Number.EPSILON, heroScale - 1);
  const farDistanceTiles = heroDistanceTiles * heroScale;

  const doorWidth = DOOR_WIDTH_TILES * farPxPerTile;
  const doorHeight = DOOR_HEIGHT_TILES * farPxPerTile;
  const door = {
    x: vanish.x - doorWidth / 2,
    y: stage.horizonY - doorHeight,
    w: doorWidth,
    h: doorHeight,
  };

  const ribDistancesTiles: number[] = [];
  for (
    let distance = heroDistanceTiles + NEAREST_RIB_BEHIND_HEROES_TILES;
    distance < farDistanceTiles;
    distance += RIB_SPACING_TILES
  ) {
    ribDistancesTiles.push(distance);
  }

  return {
    vanish,
    farFloorY: stage.horizonY,
    drop,
    farHalfWidth,
    farPxPerTile,
    eyeHeightTiles,
    halfWidthTiles: farHalfWidth / farPxPerTile,
    wallHeightTiles: WALL_HEIGHT_TILES,
    farDistanceTiles,
    heroDistanceTiles,
    door,
    ribDistancesTiles,
  };
}

/** The scale at which a side wall stands at screen column `x`; 1 at the corner with the far wall. */
export function sideWallScaleAt(hall: TitleHall, x: number): number {
  return Math.max(1, Math.abs(x - hall.vanish.x) / hall.farHalfWidth);
}

/** The scale of the floor at screen row `y`, below the far floor line. */
export function floorScaleAt(hall: TitleHall, y: number): number {
  return Math.max(1, (y - hall.vanish.y) / hall.drop);
}

/** The eye distance of anything at `scale`. */
export function distanceAtScale(hall: TitleHall, scale: number): number {
  return hall.farDistanceTiles / scale;
}

/** The scale of anything at eye distance `distanceTiles`. */
export function scaleAtDistance(hall: TitleHall, distanceTiles: number): number {
  return hall.farDistanceTiles / Math.max(Number.EPSILON, distanceTiles);
}

/** The screen row of a point `heightTiles` above the floor at `scale`. */
export function rowAtHeight(hall: TitleHall, scale: number, heightTiles: number): number {
  return hall.vanish.y + hall.farPxPerTile * scale * (hall.eyeHeightTiles - heightTiles);
}

/** The screen column of the left (`-1`) or right (`1`) side wall at `scale`. */
export function sideWallColumn(hall: TitleHall, scale: number, side: -1 | 1): number {
  return hall.vanish.x + side * hall.farHalfWidth * scale;
}

/**
 * The scale of a point fixed to the hall's walls: 1 on the far wall, and the
 * side wall's own scale past either corner.
 */
export function wallScaleAt(hall: TitleHall, point: TitlePoint): number {
  return sideWallScaleAt(hall, point.x);
}

/** How many CSS pixels a tile spans at a point on the walls. */
export function pxPerTileAt(hall: TitleHall, point: TitlePoint): number {
  return hall.farPxPerTile * wallScaleAt(hall, point);
}

/** The floor line directly below a point on the walls. */
export function floorRowBelow(hall: TitleHall, point: TitlePoint): number {
  return rowAtHeight(hall, wallScaleAt(hall, point), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
