/**
 * What the town remembers about the player between visits.
 *
 * Both interiors and the overworld rebuild their whole system stack every time
 * a door opens — `BuildingInteriorScene` is constructed fresh on entry and its
 * `InteriorOccupantSystem` builds brand-new `Townsperson`s — so anything that is
 * supposed to accumulate has to live outside those objects. Like
 * `ClubMembership` and the questline progress records, this is a plain mutable
 * object threaded by reference through the `DungeonScene` ↔
 * `BuildingInteriorScene` constructors.
 *
 * Two things need it, and both were broken without it:
 *
 *  - **Resident stories.** A resident's lore list is walked one conversation per
 *    talk. Held on the `Townsperson`, that counter reset on every entry, so
 *    pages two and three were only reachable by standing in the room talking
 *    repeatedly — and every visit re-told page one before the shop would open.
 *  - **The apothecary's batch.** Fen's cheap poultices are meant to be rationed.
 *    Held on the scene, the batch refilled by stepping out of the door and back
 *    in, which made a 4-coin health potion unlimited and the General Store's
 *    5-coin one pointless.
 */

import type { ResidentId } from '../systems/townResidents';

export interface TownMemory {
  /** How many times the player has talked to each named resident. */
  residentTalks: Map<ResidentId, number>;
  /** Poultices left in Apothecary Fen's current batch. */
  poulticesLeft: number;
  /**
   * Rooms whose hostile occupants have already been dealt with, keyed by
   * `<building name>#<floor>`.
   *
   * The third thing that needs this record. An interior map is regenerated on
   * every entry, so a room that spawns its hostiles from its own layout would
   * restock them the moment the player stepped back through the door — turning
   * a fight into a farm.
   */
  clearedRooms: Set<string>;
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
  paidOutInteriorProps: Set<string>;
}

/** How many poultices Fen has made up, and does not remake while you wait. */
export const APOTHECARY_BATCH_SIZE = 3;

export function createTownMemory(): TownMemory {
  return {
    residentTalks: new Map(),
    poulticesLeft: APOTHECARY_BATCH_SIZE,
    clearedRooms: new Set(),
    clearedCamps: new Set(),
    paidOutInteriorProps: new Set(),
  };
}

const ROOM_KEY_SEPARATOR = '#';

/** The key a room is remembered under. A tower's storeys are separate rooms. */
export function roomKey(buildingName: string, floor: number): string {
  return `${buildingName}${ROOM_KEY_SEPARATOR}${floor}`;
}

/**
 * Buildings that have been renamed, from the name an older save may hold to
 * the name the town uses now.
 *
 * Room and prop records are keyed by building name, so without this a save
 * taken before a rename would forget every room the player cleared or searched
 * there — re-stocking its loot. Entries are never removed: a save can sit
 * unloaded for any length of time.
 */
export const RENAMED_BUILDINGS: ReadonlyMap<string, string> = new Map([
  ["Shepherd's Cabin", 'Plumbline Farm'],
]);

/**
 * `key` (a {@link roomKey} or {@link interiorPropPayoutKey}) with its building
 * name brought up to date. A building name never contains the separator, so
 * everything before the first one is the name.
 */
export function migrateRoomKey(key: string): string {
  const separatorAt = key.indexOf(ROOM_KEY_SEPARATOR);
  if (separatorAt < 0) return key;
  const buildingName = key.slice(0, separatorAt);
  const currentName = RENAMED_BUILDINGS.get(buildingName);
  if (currentName === undefined) return key;
  return `${currentName}${key.slice(separatorAt)}`;
}

/**
 * The key a placed interior prop's first-time payout is remembered under —
 * a room key plus the prop's own id, which is stable across the room's
 * regeneration (derived from its layout entry, never from scan order or a
 * counter).
 */
export function interiorPropPayoutKey(buildingName: string, floor: number, propId: string): string {
  return `${roomKey(buildingName, floor)}${ROOM_KEY_SEPARATOR}${propId}`;
}

/** Every prop below stands on its building's ground floor. */
const RENAMED_PROP_FLOOR = 0;

/**
 * Breakable interior props whose layout entry was given an explicit id after
 * saves had already keyed them by position (`propId@x,y`), as
 * `[buildingName, positional id, explicit id]`.
 *
 * Without this, a prop a player broke under its positional id would pay out
 * again under its explicit one. Only breakables are listed: nothing else
 * ever writes a payout record. Entries are never removed, for the same
 * reason as {@link RENAMED_BUILDINGS}.
 */
const RENAMED_INTERIOR_PROPS: ReadonlyArray<readonly [string, string, string]> = [
  ["Cartwright's Workshop", 'glue_pot@10,3', 'contract:cartwrights_workshop:glue_hearth'],
  ['General Store', 'shelving_unit@5,1', 'contract:general_store:storeroom_shelf'],
  ['Herb & Remedy', 'live_herb_pots@1,12', 'contract:herb_and_remedy:planters'],
  ['Herb & Remedy', 'potting_bench@2,1', 'contract:herb_and_remedy:potting_bench'],
  ['Herb & Remedy', 'sorting_table@6,3', 'contract:herb_and_remedy:sorting_table'],
  ["Miller's Farm", 'farm_table@2,3', 'contract:millers_farm:farm_table'],
  ["Miller's Farm", 'grain_bin@10,9', 'contract:millers_farm:grain_bin'],
  ["Miller's Farm", 'larder_shelf@11,1', 'contract:millers_farm:larder_shelf'],
  ["Old Hilda's Cottage", 'crockery_shelf@10,5', 'contract:old_hildas_cottage:crockery_shelf'],
  ["Old Hilda's Cottage", 'jar_dresser@1,1', 'contract:old_hildas_cottage:jar_dresser'],
  ["Old Hilda's Cottage", 'witch_worktable@4,5', 'contract:old_hildas_cottage:worktable'],
  ['Temple of the Sky', 'pew@14,9', 'contract:temple_of_the_sky:pew'],
  ['The Barracks', 'forge_brazier@3,16', 'contract:barracks:brazier'],
  ['The Barracks', 'water_trough@14,1', 'contract:barracks:trough'],
  ['The Horned Flagon', 'feast_table@10,6', 'contract:horned_flagon:feast_table'],
  ['The Horned Flagon', 'trestle_table@6,11', 'contract:horned_flagon:trestle'],
  ['The Quiet Needle', 'grinding_bench@9,1', 'contract:quiet_needle:grinding_bench'],
  ['The Quiet Needle', 'low_table@2,10', 'contract:quiet_needle:low_table'],
  ['The Quiet Needle', 'settee@1,9', 'contract:quiet_needle:settee'],
  ['The Sleeping Cat Inn', 'inn_bench@14,16', 'contract:sleeping_cat_inn:bench'],
  ['The Sleeping Cat Inn', 'inn_dresser@1,9', 'contract:sleeping_cat_inn:dresser'],
  ['The Sunken Stump Pub', 'keg_stack@8,1', 'contract:sunken_stump_pub:keg_cradle'],
  ['The Sunken Stump Pub', 'smoky_lamp@13,1', 'contract:sunken_stump_pub:lamp'],
  ['The Sunken Stump Pub', 'stump_back_shelf@1,1', 'contract:sunken_stump_pub:back_shelf'],
  ['The Sunken Stump Pub', 'stump_table@4,6', 'contract:sunken_stump_pub:stump_table'],
];

const RENAMED_INTERIOR_PROP_KEYS: ReadonlyMap<string, string> = new Map(
  RENAMED_INTERIOR_PROPS.map(([buildingName, positionalId, explicitId]) => [
    interiorPropPayoutKey(buildingName, RENAMED_PROP_FLOOR, positionalId),
    interiorPropPayoutKey(buildingName, RENAMED_PROP_FLOOR, explicitId),
  ]),
);

/**
 * `key` (an {@link interiorPropPayoutKey}) with its building name and its
 * prop id both brought up to date.
 */
export function migrateInteriorPropPayoutKey(key: string): string {
  const withCurrentBuilding = migrateRoomKey(key);
  return RENAMED_INTERIOR_PROP_KEYS.get(withCurrentBuilding) ?? withCurrentBuilding;
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
  poulticesLeft: number;
  clearedRooms: ReadonlyArray<string>;
  clearedCamps: ReadonlyArray<string>;
  paidOutInteriorProps: ReadonlyArray<string>;
}

/**
 * Snapshots the town so a death rewinds it along with the coins that paid for
 * it — the batch especially, since restoring a purse without restoring the
 * stock it bought would hand the player free poultices on every death.
 */
export function captureTownMemory(memory: TownMemory): TownMemoryCheckpoint {
  return {
    residentTalks: [...memory.residentTalks],
    poulticesLeft: memory.poulticesLeft,
    clearedRooms: [...memory.clearedRooms],
    clearedCamps: [...memory.clearedCamps],
    paidOutInteriorProps: [...memory.paidOutInteriorProps],
  };
}

/**
 * Mutates in place: the same `TownMemory` object is threaded by reference
 * through every scene, so rebinding a fresh one would strand every holder.
 */
export function restoreTownMemory(memory: TownMemory, snapshot: TownMemoryCheckpoint): void {
  memory.residentTalks = new Map(snapshot.residentTalks);
  memory.poulticesLeft = snapshot.poulticesLeft;
  memory.clearedRooms = new Set(snapshot.clearedRooms);
  memory.clearedCamps = new Set(snapshot.clearedCamps);
  memory.paidOutInteriorProps = new Set(snapshot.paidOutInteriorProps);
}
