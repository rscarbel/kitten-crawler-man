/**
 * Hostiles that stand in an ordinary interior room, outside any scripted
 * encounter.
 *
 * This is content, not wiring. Every mob it produces joins the room through the
 * `MobRoster` the scene already built, is fought with the `CombatKit` that room
 * already had, and drops loot through the `DestructionKit` that room already
 * had — the whole point of the kits being that a place gains a fight by having
 * something to fight, rather than by growing a combat stack of its own.
 *
 * A room is remembered as cleared in `TownMemory`, which outlives the scene:
 * interiors are regenerated on every entry, so without that a room would restock
 * its guards the moment the player stepped back through the door.
 */

import { TILE_SIZE } from '../core/constants';
import { roomKey, type TownMemory } from '../core/TownMemory';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import { CityElfCultist } from '../creatures/CityElfCultist';
import { CULT_HIDEOUT_CULTIST_LEVEL } from './CultHideoutSystem';
import type { Mob } from '../creatures/Mob';
import type { GameMap } from '../map/GameMap';
import { findNearbyWalkableTile } from '../map/findWalkableTile';

/** How far from its intended tile a guard may be nudged to find open floor. */
const SPAWN_SEARCH_RADIUS_TILES = 4;

/**
 * The cult posts its faithful on the stairs once the party is coming for Miss
 * Quill. Matched to the hideout's congregation, so the climb is the same fight
 * the Blackwood Lodge was rather than a softer rerun of it.
 */
const STAIR_GUARD_LEVEL = CULT_HIDEOUT_CULTIST_LEVEL;

/**
 * Where each guard waits, measured from the stair *up*.
 *
 * Both stairs sit on the same row near the north wall, at opposite ends of it —
 * a climbing party arrives beside the stair down and crosses the storey to reach
 * the stair up. The three offsets therefore spread back along that crossing
 * rather than ringing the step, so the party meets the line rather than walking
 * past one end of it.
 *
 * They are casters who come to you, not doormen: `forceAggro` starts the fight
 * the moment the party sets foot on the floor and each guard closes under its
 * own AI, so what the offsets have to get right is *where* rather than *whether*
 * — spread along the storey's middle band, spanning the crossing, and no closer
 * than a few tiles to either stair, since the party arrives at one of them
 * whichever way they came.
 *
 * Measured from the stair up rather than from the map's `startTile`, which on a
 * tower is the ground floor's door and means nothing on the storeys above it.
 */
export const STAIR_GUARD_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -1, dy: 4 },
  { dx: -4, dy: 3 },
  { dx: -8, dy: 4 },
];

/**
 * The tower storeys the cult holds. Not the ground floor — the party has to be
 * able to walk in and out — and not the top, where Quill's own confrontation
 * spawns its guard.
 */
const GUARDED_TOWER_FLOORS: ReadonlySet<number> = new Set([1, 2]);

export interface InteriorHostileContext {
  readonly buildingName: string;
  readonly buildingType: string;
  readonly floor: number;
  readonly map: GameMap;
  readonly memory: TownMemory;
  /** Absent in a scene with no murder questline threaded through it. */
  readonly murderQuest: MurderQuestProgress | undefined;
}

/**
 * Everything hostile that belongs in this room right now, or an empty list.
 *
 * The caller adds them through its roster; nothing here touches a scene.
 */
export function interiorHostilesFor(ctx: InteriorHostileContext): Mob[] {
  if (ctx.memory.clearedRooms.has(roomKey(ctx.buildingName, ctx.floor))) return [];
  if (!holdsStairGuards(ctx)) return [];

  const anchor = wayOnwardFrom(ctx.map);
  const wanted = STAIR_GUARD_OFFSETS.map((offset) => ({
    x: anchor.x + offset.dx,
    y: anchor.y + offset.dy,
  }));
  return distinctSpawnTiles(ctx.map, wanted, SPAWN_SEARCH_RADIUS_TILES).map((tile) => {
    const guard = new CityElfCultist(tile.x, tile.y, TILE_SIZE);
    guard.applyMobLevel(STAIR_GUARD_LEVEL);
    // No boss room exists indoors, so nothing else would ever wake them, and a
    // guard that has to be walked up to is not a guard.
    guard.forceAggro = true;
    return guard;
  });
}

/**
 * Somewhere open to stand for each tile asked for, no two the same.
 *
 * The search nudges a request that lands in furniture, and two nudged the same
 * way would stack into one body with a doubled health bar. A request with
 * nowhere to go is dropped rather than doubled up, so the caller gets fewer
 * bodies rather than overlapping ones.
 */
export function distinctSpawnTiles(
  map: GameMap,
  wanted: ReadonlyArray<{ x: number; y: number }>,
  searchRadiusTiles: number,
): Array<{ x: number; y: number }> {
  const claimed = new Set<string>();
  const placed: Array<{ x: number; y: number }> = [];
  for (const target of wanted) {
    const tile = findNearbyWalkableTile(
      map,
      target.x,
      target.y,
      searchRadiusTiles,
      (x, y) => !claimed.has(`${x},${y}`),
    );
    if (tile === null) continue;
    claimed.add(`${tile.x},${tile.y}`);
    placed.push(tile);
  }
  return placed;
}

/**
 * The way onward from this storey — what the guards are standing between the
 * party and.
 *
 * The stair up, falling back to the stair down for a storey with no way onward
 * and to the start tile for one with neither. Length-tested rather than
 * indexed-and-defaulted, because an index into an empty list reads as
 * `undefined` at runtime whatever the element type says.
 */
function wayOnwardFrom(map: GameMap): { x: number; y: number } {
  if (map._interiorStairUpTiles.length > 0) return map._interiorStairUpTiles[0];
  if (map._interiorStairDownTiles.length > 0) return map._interiorStairDownTiles[0];
  return map.startTile;
}

/**
 * True while Miss Quill's cult is holding this storey against the party.
 *
 * Only during the confrontation stage: before it the party has no reason to be
 * climbing, and after it Quill is dead and her faithful have scattered.
 */
function holdsStairGuards(ctx: InteriorHostileContext): boolean {
  if (ctx.buildingType !== 'tower') return false;
  if (!GUARDED_TOWER_FLOORS.has(ctx.floor)) return false;
  return ctx.murderQuest?.stage === 'confrontation';
}

/** Marks this room quiet, so re-entering it does not restock the fight. */
export function noteRoomCleared(memory: TownMemory, buildingName: string, floor: number): void {
  memory.clearedRooms.add(roomKey(buildingName, floor));
}
