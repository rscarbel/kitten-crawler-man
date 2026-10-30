/**
 * Converts the live systems' checkpoints to and from the parts of them a save
 * keeps (`PersistedWorldState.ts`): live creatures are dropped on the way out
 * and stood in for on the way back.
 */

import type { BountyCheckpoint } from '../../systems/BountySystem';
import type { DefendQuestCheckpoint } from '../../systems/DefendQuestSystem';
import type { SpiderQuestCheckpoint } from '../../systems/SpiderQuestSystem';
import {
  lockProgressOf,
  type TreasureChest,
  type TreasureChestCheckpoint,
  type TreasureChestProgressSnapshot,
} from '../../systems/TreasureChestSystem';
import type {
  PersistedBountyCheckpoint,
  PersistedDefendQuestCheckpoint,
  PersistedSpiderQuestCheckpoint,
  PersistedTreasureChestCheckpoint,
} from './PersistedWorldState';

export function toPersistedTreasureChestCheckpoint(
  cp: TreasureChestCheckpoint,
): PersistedTreasureChestCheckpoint {
  return {
    chests: cp.chests.map((entry) => ({
      tileX: entry.chest.tileX,
      tileY: entry.chest.tileY,
      state: entry.state,
      loot: entry.loot,
      unlockFrame: entry.unlockFrame,
      tryLockedTimer: entry.tryLockedTimer,
      lock: entry.lock,
    })),
  };
}

/**
 * Matches each saved entry to the chest the regenerated floor put on the same
 * tile. An entry with no chest there, or whose lock is of another kind than
 * that chest's, is dropped.
 */
export function fromPersistedTreasureChestCheckpoint(
  persisted: PersistedTreasureChestCheckpoint,
  liveChests: readonly TreasureChest[],
): TreasureChestCheckpoint {
  const chests: TreasureChestProgressSnapshot[] = [];
  const matched = new Set<TreasureChest>();
  for (const entry of persisted.chests) {
    const chest = liveChests.find((c) => c.tileX === entry.tileX && c.tileY === entry.tileY);
    if (chest === undefined) continue;
    if (entry.lock.kind !== chest.lock.kind) {
      console.warn(
        `[persistedWorldCapture] Saved chest at ${entry.tileX},${entry.tileY} has a ${entry.lock.kind} lock; the chest there has a ${chest.lock.kind} lock. Dropped.`,
      );
      continue;
    }
    matched.add(chest);
    chests.push({
      chest,
      state: entry.state,
      loot: entry.loot,
      unlockFrame: entry.unlockFrame,
      tryLockedTimer: entry.tryLockedTimer,
      lock: entry.lock,
    });
  }
  // `restoreCheckpoint` replaces the whole chest list, so a chest the save
  // does not know about has to be listed as it is or it disappears.
  for (const chest of liveChests) {
    if (matched.has(chest)) continue;
    chests.push({
      chest,
      state: chest.state,
      loot: chest.loot,
      unlockFrame: chest.unlockFrame,
      tryLockedTimer: chest.tryLockedTimer,
      lock: lockProgressOf(chest.lock),
    });
  }
  return { chests };
}

export function toPersistedDefendQuestCheckpoint(
  cp: DefendQuestCheckpoint,
): PersistedDefendQuestCheckpoint {
  return {
    questStatuses: cp.questStatuses,
    phase: cp.phase,
    approachTimer: cp.approachTimer,
    defenseTimer: cp.defenseTimer,
    spawnTimer: cp.spawnTimer,
    woodRespawnTimer: cp.woodRespawnTimer,
    woodPileAvailable: cp.woodPileAvailable,
    barriers: cp.barriers,
    pendingBuild: cp.pendingBuild,
    audienceAbsenceFrames: cp.audienceAbsenceFrames,
    encounterAborted: cp.encounterAborted,
    npcHp: cp.npcHp,
    npcMarkerType: cp.npcMarkerType,
  };
}

export function fromPersistedDefendQuestCheckpoint(
  persisted: PersistedDefendQuestCheckpoint,
): DefendQuestCheckpoint {
  return { ...persisted, questMobs: [] };
}

export function toPersistedSpiderQuestCheckpoint(
  cp: SpiderQuestCheckpoint,
): PersistedSpiderQuestCheckpoint {
  return {
    phase: cp.phase,
    spiderEggOpened: cp.spiderEggOpened,
    scientistDead: cp.scientistDead,
    hackingDone: cp.hackingDone,
    machineryForcedOff: cp.machineryForcedOff,
    playerLocked: cp.playerLocked,
    roomLocked: cp.roomLocked,
    fightAborted: cp.fightAborted,
    entryWindowTimer: cp.entryWindowTimer,
    humanIsInsider: cp.humanIsInsider,
    catIsInsider: cp.catIsInsider,
    lifeMachines: cp.lifeMachines,
    keyboardHero: cp.keyboardHero,
  };
}

export function fromPersistedSpiderQuestCheckpoint(
  persisted: PersistedSpiderQuestCheckpoint,
): SpiderQuestCheckpoint {
  return { ...persisted, grotesqueSpider: null, smallSpiders: [] };
}

export function toPersistedBountyCheckpoint(cp: BountyCheckpoint): PersistedBountyCheckpoint {
  return {
    aggroReleased: cp.aggroReleased,
    // A mark still at large has no mob to point at after a reload, so it is
    // re-staged the same way a pending respawn is.
    respawnPending: cp.respawnPending || cp.boss !== null,
    markers: cp.markers,
    collectPointWorld: cp.collectPointWorld,
  };
}

export function fromPersistedBountyCheckpoint(
  persisted: PersistedBountyCheckpoint,
): BountyCheckpoint {
  return { ...persisted, boss: null, encounter: [], shady: null };
}
