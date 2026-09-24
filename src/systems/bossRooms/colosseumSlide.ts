import { TILE_SIZE } from '../../core/constants';
import { ARENA_DOOR_COLUMN_OFFSETS } from '../../map/arenaGeometry';
import type { GameMap } from '../../map/GameMap';
import { ARENA_FLOOR, ARENA_MUD } from '../../map/tileTypes';
import {
  COLOSSEUM_BODY_LIMIT_TILES,
  COLOSSEUM_BODY_MARGIN_TILES,
} from '../../map/tiles/bossRooms/colosseumGeometry';

/** How far inside the drum's floor radius a body's centre is held, in pixels. */
export const ENTITY_ARENA_MARGIN_PX = COLOSSEUM_BODY_MARGIN_TILES * TILE_SIZE;

/** The circle a body's centre is held inside, in pixels from the drum's centre. */
export const ARENA_SLIDE_LIMIT_PX = COLOSSEUM_BODY_LIMIT_TILES * TILE_SIZE;

/**
 * Share of a step the clamp must take back for a charging body to count as
 * having hit the wall. The tile test sees a wall when neither axis moved, which
 * a curve never produces; this is the same test with the curve's own slack: a
 * body that kept less than a tenth of its step has stopped against the iron,
 * while one glancing along it keeps most of its step and slides on, exactly as
 * it would along a straight wall.
 */
export const DRUM_BONK_STEP_SHARE = 0.9;

const HALF_TILE = 0.5;
const DOOR_LEFT_PX = (Math.min(...ARENA_DOOR_COLUMN_OFFSETS) - HALF_TILE) * TILE_SIZE;
const DOOR_RIGHT_PX = (Math.max(...ARENA_DOOR_COLUMN_OFFSETS) + HALF_TILE) * TILE_SIZE;

/** An arena's centre tile, as `GameMap.arenaExteriors` records it. */
export interface DrumCentre {
  readonly x: number;
  readonly y: number;
}

/** What a clamp did to one body this frame. */
export interface DrumClamp {
  /** How far the body was pulled back toward the middle, in pixels. */
  readonly pulledPx: number;
}

const NO_CLAMP: DrumClamp = { pulledPx: 0 };

/**
 * Holds a body inside the drum's curve, keeping whatever of its motion runs
 * along the wall.
 *
 * Only a body standing on the drum's own floor is held. The concourse outside
 * the wall comes within a couple of tiles of the curve, and a radius test
 * alone would reach through the iron and pull a crawler walking round the
 * outside into the fight. The doorway's own columns are left to the tiles too:
 * they are the one way in and out.
 *
 * Only ever pulls toward the middle, so it can never put a body anywhere the
 * tiles would not: every point inside the limit is floor.
 */
export function clampIntoDrum(
  body: { x: number; y: number },
  centre: DrumCentre,
  map: Pick<GameMap, 'structure'>,
): DrumClamp {
  const anchorX = Math.floor((body.x + HALF_TILE * TILE_SIZE) / TILE_SIZE);
  const anchorY = Math.floor((body.y + HALF_TILE * TILE_SIZE) / TILE_SIZE);
  const footing = map.structure[anchorY]?.[anchorX]?.type;
  if (footing !== ARENA_FLOOR && footing !== ARENA_MUD) return NO_CLAMP;
  // Both measured from tile top-left corners, so the offset is centre to centre.
  const offsetX = body.x - centre.x * TILE_SIZE;
  const offsetY = body.y - centre.y * TILE_SIZE;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance <= ARENA_SLIDE_LIMIT_PX) return NO_CLAMP;
  const inDoorColumns = offsetY > 0 && offsetX >= DOOR_LEFT_PX && offsetX <= DOOR_RIGHT_PX;
  if (inDoorColumns) return NO_CLAMP;
  const pullBack = ARENA_SLIDE_LIMIT_PX / distance;
  body.x = centre.x * TILE_SIZE + offsetX * pullBack;
  body.y = centre.y * TILE_SIZE + offsetY * pullBack;
  return { pulledPx: distance - ARENA_SLIDE_LIMIT_PX };
}

/**
 * Whether a step the clamp cut short counts as running into the wall: what
 * the body kept of it, after the tiles and the clamp, is under a tenth.
 */
export function clampEndedStep(
  clamp: DrumClamp,
  movedX: number,
  movedY: number,
  stepX: number,
  stepY: number,
): boolean {
  if (clamp.pulledPx <= 0) return false;
  const requested = Math.hypot(stepX, stepY);
  if (requested === 0) return false;
  return Math.hypot(movedX, movedY) < requested * (1 - DRUM_BONK_STEP_SHARE);
}
