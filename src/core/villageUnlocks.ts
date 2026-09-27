/**
 * What Briar Hollow has opened up to the crawlers so far. Each flag is granted
 * by a step of a questline and never revoked; systems ask here rather than
 * reading the quest phase, so a later questline can grant a new unlock without
 * every consumer learning its phases.
 */

import { phaseAtLeast, type VillageQuestPhase } from './villageQuestPhase';

/** Construction recipes a quest can open up, one at a time. */
export type ConstructionUnlockId =
  'wooden_wall' | 'stone_wall' | 'fortified_wall' | 'trebuchet' | 'snare' | 'spikes';

export const CONSTRUCTION_UNLOCK_IDS: readonly ConstructionUnlockId[] = [
  'wooden_wall',
  'stone_wall',
  'fortified_wall',
  'trebuchet',
  'snare',
  'spikes',
];

/** Tikka's plans: everything the first Construction lesson opens. */
export const TIKKA_PLANS_UNLOCKS: readonly ConstructionUnlockId[] = CONSTRUCTION_UNLOCK_IDS;

export interface VillageUnlocks {
  /** Fenna has let the crawlers use the saw and the rope walk. */
  processingStations: boolean;
  /** The Mayor has placed the militia under the crawlers' command. */
  soldierCommands: boolean;
  /** Construction recipes the crawlers hold plans for. Empty means the menu stays shut. */
  construction: ConstructionUnlockId[];
}

export function createVillageUnlocks(): VillageUnlocks {
  return { processingStations: false, soldierCommands: false, construction: [] };
}

/**
 * The unlocks a save written before unlocks were recorded had earned, read off
 * how far its questline had got.
 */
export function unlocksImpliedByPhase(phase: VillageQuestPhase): VillageUnlocks {
  return {
    processingStations: phaseAtLeast(phase, 'processing'),
    soldierCommands: phaseAtLeast(phase, 'fortifying'),
    construction: phaseAtLeast(phase, 'build_trebuchet') ? [...TIKKA_PLANS_UNLOCKS] : [],
  };
}

export function hasConstructionUnlock(unlocks: VillageUnlocks, id: ConstructionUnlockId): boolean {
  return unlocks.construction.includes(id);
}

/** Grants each of `ids` not already held. */
export function grantConstructionUnlocks(
  unlocks: VillageUnlocks,
  ids: readonly ConstructionUnlockId[],
): void {
  for (const id of ids) {
    if (!unlocks.construction.includes(id)) unlocks.construction.push(id);
  }
}
