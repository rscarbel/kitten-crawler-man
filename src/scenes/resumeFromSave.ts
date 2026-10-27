import { ABILITY_DEFS } from '../abilities/abilityDefs';
import type { DungeonSceneOptions } from './DungeonScene';
import type { GameProgressInput } from '../auth/AuthClient';
import type { LevelDef } from '../levels/types';
import { getLevelDef } from '../levels/index';
import { revivedSnapshot, withoutIncurableStatuses } from '../core/save/PlayerSnapshot';
import { AbilityManager } from '../core/skills/AbilityManager';
import { getMongoStats } from '../abilities/mongo';
import { createMongoPetState } from '../core/state/MongoPetState';
import { AchievementManager } from '../core/progression/AchievementManager';
import { GameStats } from '../core/progression/GameStats';
import { createWheelLedger } from '../core/save/WheelLedger';
import { createAttackCowState } from '../core/state/AttackCowState';
import { withDoubleDamageFrames } from '../core/save/doubleDamageSave';
import { MusicLibrary } from '../core/music/MusicLibrary';
import { viewerFavor } from '../core/progression/viewerFavor';

/**
 * An ability manager carrying a save's progress.
 *
 * The defs have to be registered here rather than left to `DungeonScene`:
 * restoring clamps each level against its def's maximum, so a manager with no
 * defs would discard every state it was handed. Registering the same defs again
 * in the scene constructor is harmless — `register` leaves existing state alone.
 */
function resumedAbilityManager(states: GameProgressInput['abilityStates']): AbilityManager {
  const manager = new AbilityManager();
  for (const def of Object.values(ABILITY_DEFS)) manager.register(def);
  manager.restoreSerializedStates(states);
  return manager;
}

/**
 * The save as a party respawning after a death comes back from it: the same
 * save with the `INCURABLE_STATUSES` a death clears taken off both
 * crawlers and their saved time zeroed, so the respawn and the next save both
 * show them gone. A reload or a Continue is not a death and restores the save
 * as written.
 */
export function progressForRespawn(progress: GameProgressInput): GameProgressInput {
  return {
    ...progress,
    humanSnap: withoutIncurableStatuses(progress.humanSnap),
    catSnap: withoutIncurableStatuses(progress.catSnap),
    doubleDamageRemaining: { human: 0, cat: 0 },
  };
}

/** The floor a save stands on and the scene options that rebuild it there. */
export interface SceneSetupFromSave {
  levelDef: LevelDef;
  options: DungeonSceneOptions;
}

/**
 * The scene a save describes, with its party, abilities and pet restored — a
 * page reload and a death that respawns from the save both start here, so the
 * two cannot drift apart.
 *
 * Works on copies of both arguments: the caller keeps handing the same
 * `baseOptions` to later launches, and a restored party leaking into those would
 * start a fresh run with the old run's characters; and the save itself stays
 * the scene's respawn point, which the scene built from it must not be able to
 * edit through a shared array.
 */
export function sceneSetupFromSave(
  baseOptions: DungeonSceneOptions,
  save: GameProgressInput,
): SceneSetupFromSave {
  const progress = structuredClone(save);
  const options: DungeonSceneOptions = { ...baseOptions };
  // Loading straight into a wipe is never recoverable — the same save would
  // reload into the same wipe — so a resumed party always arrives on its feet.
  options.humanSnap = withDoubleDamageFrames(
    revivedSnapshot(progress.humanSnap),
    progress.doubleDamageRemaining.human,
  );
  options.catSnap = withDoubleDamageFrames(
    revivedSnapshot(progress.catSnap),
    progress.doubleDamageRemaining.cat,
  );
  options.wheelLedger = createWheelLedger(
    progress.wheelPrizesWon,
    progress.pendingWheelOutcome,
    progress.wheelFreeSpinBet,
    progress.wheelOwedFreeze,
    progress.wheelQuestFreeSpins,
  );
  // A cow saved resting has had her rest by the time the game is loaded again:
  // she comes back whole, as she would on the next floor.
  const savedCowHp = progress.attackCowHp ?? null;
  const cowRested = progress.attackCowResting || (savedCowHp !== null && savedCowHp <= 0);
  options.attackCowState = createAttackCowState(
    progress.attackCowOwned,
    cowRested ? null : savedCowHp,
    false,
  );
  options.abilityManager = resumedAbilityManager(progress.abilityStates);
  options.mongoUnlocked = progress.mongoUnlocked;
  options.partyCrafts = progress.crafts;
  options.humanAchievements = AchievementManager.fromSerialized(progress.humanAchievements);
  options.catAchievements = AchievementManager.fromSerialized(progress.catAchievements);
  // A death that respawns here hands over the run's live library: a song is
  // no less heard for the death, and rewinding it would announce its unlock
  // and its credit a second time.
  options.musicLibrary ??= MusicLibrary.fromSerialized(progress.musicLibrary);
  viewerFavor.restore(progress.viewerFavor);
  // Clamped against the maximum the restored ability level implies, which the
  // save does not store.
  const petMaxHp = getMongoStats(options.abilityManager.getLevel('mongo')).maxHp;
  options.mongoPetState = createMongoPetState(
    Math.min(petMaxHp, progress.mongoPetHp),
    petMaxHp,
    progress.mongoPetResting,
  );
  const levelDef = getLevelDef(progress.levelId);
  const savedWorld = progress.world;
  if (savedWorld !== undefined) {
    options.worldSeed = savedWorld.worldSeed;
    options.artSeed = savedWorld.artSeed;
    options.spawnAt = savedWorld.resumeTile ?? undefined;
    options.levelTimerFrames = savedWorld.levelTimerFrames ?? undefined;
    options.persistedWorldState = savedWorld.persisted;
  }
  const stats = GameStats.fromSnapshot(progress.gameStats);
  // A death that respawns here hands over the run still in progress, whose
  // deaths and time played are newer than the save's — including the death
  // that brought the party back.
  if (baseOptions.gameStats !== undefined) stats.carryRunHistoryFrom(baseOptions.gameStats);
  options.gameStats = stats;
  // The scene starts standing on this save, so a death before it takes another
  // comes straight back here rather than to the floor's entry.
  options.lastSave = save;
  return { levelDef, options };
}
