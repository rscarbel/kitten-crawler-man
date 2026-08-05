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
}

/** How many poultices Fen has made up, and does not remake while you wait. */
export const APOTHECARY_BATCH_SIZE = 3;

export function createTownMemory(): TownMemory {
  return { residentTalks: new Map(), poulticesLeft: APOTHECARY_BATCH_SIZE };
}

/** How many conversations this resident has already had with the player. */
export function residentTalkCount(memory: TownMemory, id: ResidentId): number {
  return memory.residentTalks.get(id) ?? 0;
}

export function noteResidentTalk(memory: TownMemory, id: ResidentId): void {
  memory.residentTalks.set(id, residentTalkCount(memory, id) + 1);
}

/** A point-in-time copy of the town's memory. */
export interface TownMemoryCheckpoint {
  residentTalks: ReadonlyArray<readonly [ResidentId, number]>;
  poulticesLeft: number;
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
  };
}

/**
 * Mutates in place: the same `TownMemory` object is threaded by reference
 * through every scene, so rebinding a fresh one would strand every holder.
 */
export function restoreTownMemory(memory: TownMemory, snapshot: TownMemoryCheckpoint): void {
  memory.residentTalks = new Map(snapshot.residentTalks);
  memory.poulticesLeft = snapshot.poulticesLeft;
}
