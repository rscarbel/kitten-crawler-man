/**
 * What the town remembers about the player between visits.
 *
 * Both interiors and the overworld rebuild their whole system stack every time
 * a door opens — `BuildingInteriorScene` is constructed fresh on entry and its
 * `InteriorOccupantSystem` builds brand-new `Townsperson`s — so anything that is
 * supposed to accumulate has to live outside those objects. Like
 * `CasinoState` and the questline progress records, this is a plain mutable
 * object threaded by reference through the `DungeonScene` ↔
 * `BuildingInteriorScene` constructors.
 *
 * Each of its records was broken without it. For example:
 *
 *  - **Resident stories.** A resident's lore list is walked one conversation per
 *    talk. Held on the `Townsperson`, that counter reset on every entry, so
 *    pages two and three were only reachable by standing in the room talking
 *    repeatedly — and every visit re-told page one before the shop would open.
 */

import type { ResidentId } from './residentIds';
import { BUILDING_IDS, isBuildingId, type BuildingId } from '../../map/buildingIds';

/** Places whose first visit opens something: a travel destination, a playlist. */
export const VISITED_PLACE_IDS = ['circus_grounds', 'starlight_tent'] as const;
export type VisitedPlaceId = (typeof VISITED_PLACE_IDS)[number];

export interface TownMemory {
  /** How many times the player has talked to each named resident. */
  residentTalks: Map<ResidentId, number>;
  /**
   * Rooms whose hostile occupants have already been dealt with, keyed by
   * `roomKey`.
   *
   * An interior map is regenerated on every entry, so a room that spawns its hostiles from its own layout would
   * restock them the moment the player stepped back through the door — turning
   * a fight into a farm.
   */
  clearedRooms: Set<RoomKey>;
  /**
   * Wilderness camps whose every resident has been killed, keyed by
   * `campSiteKey`.
   *
   * The overworld has the same problem as an interior: leaving a building
   * rebuilds the whole floor scene and reruns the spawner, so a camp cleared
   * before the door re-stocks behind it — at the party's new level, which made
   * a camp and a doorway an XP farm. Only a camp emptied outright is recorded;
   * one left half-fought comes back whole, as it always has.
   *
   * Rewound with the rest of this record on a checkpoint restore, which is what
   * keeps it honest: the same restore revives every resident killed since the
   * checkpoint, and a camp remembered as empty while its residents stand again
   * would vanish at the next doorway, along with the XP the rewind just took
   * back from the party.
   */
  clearedCamps: Set<string>;
  /**
   * Placed interior props (breakables and searched containers) that have
   * already paid out their first-time loot, keyed by `interiorPropPayoutKey`
   * (a room key plus the prop's own layout-stable id).
   *
   * A room's furniture is rebuilt standing on every entry — nothing records
   * *whether* a prop is currently broken — but the loot itself must not be:
   * without this, leaving and re-entering a room re-stocks every barrel,
   * exactly the way a cleared room would re-stock its hostiles without
   * `clearedRooms`.
   */
  paidOutInteriorProps: Set<InteriorPropPayoutKey>;
  /** Places the party has set foot in at least once. */
  visitedPlaces: Set<VisitedPlaceId>;
}

export function createTownMemory(): TownMemory {
  return {
    residentTalks: new Map(),
    clearedRooms: new Set(),
    clearedCamps: new Set(),
    paidOutInteriorProps: new Set(),
    visitedPlaces: new Set(),
  };
}

const ROOM_KEY_SEPARATOR = '#';

/** A room as the town remembers it: its building and storey. A tower's storeys are separate rooms. */
export type RoomKey = `${BuildingId}${typeof ROOM_KEY_SEPARATOR}${number}`;

/** A placed interior prop as the town remembers its payout: its room and the prop's layout id. */
export type InteriorPropPayoutKey = `${RoomKey}${typeof ROOM_KEY_SEPARATOR}${string}`;

export function roomKey(buildingId: BuildingId, floor: number): RoomKey {
  return `${buildingId}${ROOM_KEY_SEPARATOR}${floor}`;
}

/** The building a room or prop-payout key was recorded in. */
export function buildingOfRoomKey(key: RoomKey | InteriorPropPayoutKey): BuildingId | undefined {
  return BUILDING_IDS.find((id) => key.startsWith(`${id}${ROOM_KEY_SEPARATOR}`));
}

/**
 * The key a placed interior prop's first-time payout is remembered under:
 * its room plus the id its layout gives it, so the record survives the room
 * being rebuilt and the prop being moved.
 */
export function interiorPropPayoutKey(
  buildingId: BuildingId,
  floor: number,
  propId: string,
): InteriorPropPayoutKey {
  return `${roomKey(buildingId, floor)}${ROOM_KEY_SEPARATOR}${propId}`;
}

const FLOOR_INDEX_PATTERN = /^\d+$/;

/** Narrows a room key read from a save. */
export function isRoomKey(value: unknown): value is RoomKey {
  if (typeof value !== 'string') return false;
  const separatorAt = value.indexOf(ROOM_KEY_SEPARATOR);
  if (separatorAt < 0) return false;
  const building = value.slice(0, separatorAt);
  const floor = value.slice(separatorAt + ROOM_KEY_SEPARATOR.length);
  return isBuildingId(building) && FLOOR_INDEX_PATTERN.test(floor);
}

/**
 * Narrows a prop-payout key read from a save. Split at the room key's end
 * only: everything after it is the prop's layout id, whatever it contains.
 */
export function isInteriorPropPayoutKey(value: unknown): value is InteriorPropPayoutKey {
  if (typeof value !== 'string') return false;
  const buildingEnd = value.indexOf(ROOM_KEY_SEPARATOR);
  if (buildingEnd < 0) return false;
  const floorEnd = value.indexOf(ROOM_KEY_SEPARATOR, buildingEnd + ROOM_KEY_SEPARATOR.length);
  if (floorEnd < 0) return false;
  const propId = value.slice(floorEnd + ROOM_KEY_SEPARATOR.length);
  return isRoomKey(value.slice(0, floorEnd)) && propId.length > 0;
}

/** How many conversations this resident has already had with the player. */
export function residentTalkCount(memory: TownMemory, id: ResidentId): number {
  return memory.residentTalks.get(id) ?? 0;
}

export function noteResidentTalk(memory: TownMemory, id: ResidentId): void {
  memory.residentTalks.set(id, residentTalkCount(memory, id) + 1);
}

/** All the camp bookkeeping needs to know about a mob. */
interface CampResident {
  readonly campKey: string | null;
  readonly isAlive: boolean;
}

/**
 * Records `killed`'s camp as cleared when it was that camp's last resident
 * standing. Returns whether this kill was the one that cleared it.
 *
 * `population` is the whole live roster rather than a per-camp tally, so a
 * resident that wandered off or was walked back home by its leash still counts
 * as standing — only a death takes one off the camp's books. `killed` is
 * skipped by identity rather than trusted to read as dead: a mob playing out a
 * death animation can still report itself alive on the frame it is announced.
 */
export function noteCampCasualty(
  memory: TownMemory,
  killed: CampResident,
  population: Iterable<CampResident>,
): boolean {
  const key = killed.campKey;
  if (key === null || memory.clearedCamps.has(key)) return false;
  for (const mob of population) {
    if (mob !== killed && mob.campKey === key && mob.isAlive) return false;
  }
  memory.clearedCamps.add(key);
  return true;
}

/**
 * Drops every remembered camp. For a floor that is being regenerated from a
 * fresh seed, whose camps are new places — a key that happened to coincide
 * with an old site would otherwise leave a brand-new camp standing empty.
 */
export function forgetClearedCamps(memory: TownMemory): void {
  memory.clearedCamps.clear();
}

/** A point-in-time copy of the town's memory. */
export interface TownMemoryCheckpoint {
  residentTalks: ReadonlyArray<readonly [ResidentId, number]>;
  clearedRooms: ReadonlyArray<RoomKey>;
  clearedCamps: ReadonlyArray<string>;
  paidOutInteriorProps: ReadonlyArray<InteriorPropPayoutKey>;
  visitedPlaces: ReadonlyArray<VisitedPlaceId>;
}

/**
 * Snapshots the town so a death rewinds it with everything else since the
 * checkpoint: a room cleared or a prop looted after it is fought or looted
 * again, rather than left empty while the rewind takes back what it paid.
 */
export function captureTownMemory(memory: TownMemory): TownMemoryCheckpoint {
  return {
    residentTalks: [...memory.residentTalks],
    clearedRooms: [...memory.clearedRooms],
    clearedCamps: [...memory.clearedCamps],
    paidOutInteriorProps: [...memory.paidOutInteriorProps],
    visitedPlaces: [...memory.visitedPlaces],
  };
}

/**
 * Mutates in place: the same `TownMemory` object is threaded by reference
 * through every scene, so rebinding a fresh one would strand every holder.
 */
export function restoreTownMemory(memory: TownMemory, snapshot: TownMemoryCheckpoint): void {
  memory.residentTalks = new Map(snapshot.residentTalks);
  memory.clearedRooms = new Set(snapshot.clearedRooms);
  memory.clearedCamps = new Set(snapshot.clearedCamps);
  memory.paidOutInteriorProps = new Set(snapshot.paidOutInteriorProps);
  memory.visitedPlaces = new Set(snapshot.visitedPlaces);
}
