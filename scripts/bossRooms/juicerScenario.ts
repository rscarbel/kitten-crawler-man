/**
 * Set pieces for the Juicer's gym that both the room review and its gates put
 * together: the boss enraged beside a loaded squat rack, a crawler down the
 * room from him, and the frames run until he starts to bowl.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import type { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import { Juicer } from '../../src/creatures/Juicer.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import type { JuicerRoomSystem } from '../../src/systems/JuicerRoomSystem.js';
import type { TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';

/** Enraged: under the share of max HP his enrage fires at. */
const ENRAGED_HP_SHARE = 0.3;
/** How many tiles down the room from him the crawler stands for a plate roll. */
export const PLATE_TARGET_DISTANCE_TILES = 7;
/** The most frames spent waiting for him to start bowling before giving up. */
const PLATE_START_MAX_FRAMES = 30;

/** The rack whose front tile is nearest a loaded squat rack, and that front tile. */
function rackFrontBesideSquat(room: JuicerRoomSystem): TilePoint | null {
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
  room: JuicerRoomSystem,
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
  readonly juicer: Juicer;
  /** Frames run from placing him until the wind-up began. */
  readonly framesToStart: number;
}

/**
 * Seals the gym, puts an enraged Juicer empty-handed at the rack beside a
 * squat rack, stands the active crawler down the room from him, and runs his
 * AI until he starts to bowl a plate. Null when this floor's gym cannot stage
 * it (no rack beside a squat rack, or no open floor down the room).
 */
export function stagePlateRoll(
  room: JuicerRoomSystem,
  frame: SystemContext,
): PlateRollSetup | null {
  const front = rackFrontBesideSquat(room);
  if (front === null) return null;
  const crawler = frame.human;
  if (!placeDownRoom(room, frame, front, crawler, PLATE_TARGET_DISTANCE_TILES)) return null;
  room.onSeal();
  let juicer = frame.roster.mobs.find((mob): mob is Juicer => mob instanceof Juicer);
  if (juicer === undefined) {
    juicer = new Juicer(front.x, front.y, TILE_SIZE);
    juicer.setMap(frame.gameMap);
    frame.roster.add(juicer);
  }
  juicer.x = front.x * TILE_SIZE;
  juicer.y = front.y * TILE_SIZE;
  juicer.hp = Math.floor(juicer.maxHp * ENRAGED_HP_SHARE);
  juicer.forceAggro = true;
  for (let tick = 0; tick < PLATE_START_MAX_FRAMES; tick++) {
    room.update(frame);
    // Kept empty-handed, so the only attack he can open with from here is the plate.
    juicer.heldDumbbell = false;
    juicer.nearestDumbbellPos = null;
    juicer.updateAI([crawler]);
    if (juicer.behaviour === 'plate_windup') return { juicer, framesToStart: tick };
  }
  return null;
}
