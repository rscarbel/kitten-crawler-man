/**
 * Set pieces for Big Rooster's gym that both the room review and its gates put
 * together: the boss enraged beside a loaded squat rack, a crawler down the
 * room from him, and the frames run until he starts to bowl.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import type { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import { BigRooster, ENRAGE_THRESHOLD, FURY_HP_SHARE } from '../../src/creatures/BigRooster.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import type { GymRoomSystem } from '../../src/systems/GymRoomSystem.js';
import type { TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';

/**
 * Enraged and not yet in his fury: between the share of max HP his enrage
 * fires at and the one his fury does, where the plate roll is his to throw.
 */
const ENRAGED_HP_SHARE = (ENRAGE_THRESHOLD + FURY_HP_SHARE) / 2;
/** How many tiles down the room from him the crawler stands for a plate roll. */
export const PLATE_TARGET_DISTANCE_TILES = 7;
/**
 * The most frames spent waiting for him to start bowling before giving up:
 * long enough for the crow he lets out on first seeing a crawler and on
 * enraging, both of which come before the plate.
 */
const PLATE_START_MAX_FRAMES = 60;

/** The rack whose front tile is nearest a loaded squat rack, and that front tile. */
function rackFrontBesideSquat(room: GymRoomSystem): TilePoint | null {
  const layout = room.layout;
  if (layout === null) return null;
  for (const position of room.getActiveDumbbellPositions()) {
    const front = {
      x: Math.floor(position.x / TILE_SIZE),
      y: Math.floor(position.y / TILE_SIZE),
    };
    const besideSquat = layout.squatRacks.some(
      (squat) => Math.abs(squat.x - front.x) <= 1 && Math.abs(squat.y - front.y) <= 1,
    );
    if (besideSquat) return front;
  }
  return null;
}

/**
 * A crawler stood `distance` tiles from `from` toward the middle of the room,
 * on open floor, with a clear walk between them.
 */
function placeDownRoom(
  room: GymRoomSystem,
  frame: SystemContext,
  from: TilePoint,
  crawler: HumanPlayer,
  distance: number,
): boolean {
  const layout = room.layout;
  if (layout === null) return false;
  const dx = layout.spawn.x - from.x;
  const dy = layout.spawn.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  const tile = {
    x: Math.round(from.x + (dx / length) * distance),
    y: Math.round(from.y + (dy / length) * distance),
  };
  if (!frame.gameMap.isWalkable(tile.x, tile.y)) return false;
  crawler.x = tile.x * TILE_SIZE;
  crawler.y = tile.y * TILE_SIZE;
  return true;
}

export interface PlateRollSetup {
  readonly bigRooster: BigRooster;
}

/**
 * Seals the gym, puts an enraged Big Rooster empty-handed at the rack beside a
 * squat rack, stands the active crawler down the room from him, and runs his
 * AI until he starts to bowl a plate. Null when this floor's gym cannot stage
 * it (no rack beside a squat rack, or no open floor down the room).
 */
export function stagePlateRoll(room: GymRoomSystem, frame: SystemContext): PlateRollSetup | null {
  const front = rackFrontBesideSquat(room);
  if (front === null) return null;
  const crawler = frame.human;
  if (!placeDownRoom(room, frame, front, crawler, PLATE_TARGET_DISTANCE_TILES)) return null;
  room.onSeal();
  let bigRooster = frame.roster.mobs.find((mob): mob is BigRooster => mob instanceof BigRooster);
  if (bigRooster === undefined) {
    bigRooster = new BigRooster(front.x, front.y, TILE_SIZE);
    bigRooster.setMap(frame.gameMap);
    frame.roster.add(bigRooster);
  }
  bigRooster.x = front.x * TILE_SIZE;
  bigRooster.y = front.y * TILE_SIZE;
  bigRooster.hp = Math.floor(bigRooster.maxHp * ENRAGED_HP_SHARE);
  bigRooster.forceAggro = true;
  for (let tick = 0; tick < PLATE_START_MAX_FRAMES; tick++) {
    room.update(frame);
    // Kept empty-handed, so the only attack he can open with from here is the plate.
    bigRooster.heldDumbbell = false;
    bigRooster.nearestDumbbellPos = null;
    bigRooster.updateAI([crawler]);
    if (bigRooster.behaviour === 'plate_windup') return { bigRooster };
  }
  return null;
}
