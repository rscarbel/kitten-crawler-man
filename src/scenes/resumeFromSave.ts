import type { DungeonSceneOptions } from './DungeonScene';
import type { GameProgressInput } from '../auth/AuthClient';
import type { LevelDef } from '../levels/types';
import { getLevelDef, tutorialLevel } from '../levels/index';
import { revivedSnapshot } from '../core/PlayerSnapshot';
import { AbilityManager } from '../core/AbilityManager';
import { MAGIC_MISSILE_DEF } from '../abilities/magicMissile';
import { PROTECTIVE_SHELL_DEF } from '../abilities/protectiveShell';
import { SMUSH_DEF } from '../abilities/smush';
import { MONGO_DEF, getMongoStats } from '../abilities/mongo';
import { createMongoPetState } from '../core/MongoPetState';
import { parseSavedWorld } from '../core/SavedWorld';
import { AchievementManager } from '../core/AchievementManager';

/**
 * An ability manager carrying a save's progress, or a fresh one at level 1.
 *
 * The defs have to be registered here rather than left to `DungeonScene`:
 * restoring clamps each level against its def's maximum, so a manager with no
 * defs would discard every state it was handed. Registering the same defs again
 * in the scene constructor is harmless — `register` leaves existing state alone.
 */
function resumedAbilityManager(states: GameProgressInput['abilityStates']): AbilityManager {
  const manager = new AbilityManager();
  manager.register(MAGIC_MISSILE_DEF);
  manager.register(PROTECTIVE_SHELL_DEF);
  manager.register(SMUSH_DEF);
  manager.register(MONGO_DEF);
  if (states !== undefined) manager.restoreSerializedStates(states);
  return manager;
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
  options.humanSnap = revivedSnapshot(progress.humanSnap);
  options.catSnap = revivedSnapshot(progress.catSnap);
  options.abilityManager = resumedAbilityManager(progress.abilityStates);
  options.mongoUnlocked = progress.mongoUnlocked ?? false;
  if (progress.humanAchievements !== undefined) {
    options.humanAchievements = AchievementManager.fromSerialized(progress.humanAchievements);
  }
  if (progress.catAchievements !== undefined) {
    options.catAchievements = AchievementManager.fromSerialized(progress.catAchievements);
  }
  if (progress.mongoPetHp !== undefined && Number.isFinite(progress.mongoPetHp)) {
    // Clamped against the maximum the *restored* level implies: this arrives
    // as unvalidated JSON, and a value above the maximum renders as a
    // permanently full bar that never regenerates down to the truth.
    const petMaxHp = getMongoStats(options.abilityManager.getLevel('mongo')).maxHp;
    const restoredHp = Math.max(0, Math.min(petMaxHp, progress.mongoPetHp));
    options.mongoPetState = createMongoPetState(
      restoredHp,
      petMaxHp,
      // Absent from saves written before the rest latch existed, where a zeroed
      // pet is exactly the case the latch is for.
      progress.mongoPetResting ?? restoredHp <= 0,
    );
  }
  // progress.levelId is unvalidated JSON — a save written against a
  // since-renamed level must fall back rather than throw at boot.
  let levelDef: LevelDef;
  let levelResolved = true;
  try {
    levelDef = getLevelDef(progress.levelId);
  } catch {
    levelDef = tutorialLevel;
    levelResolved = false;
  }
  // A fallback level has no relationship to the saved seed, and a seed replayed
  // against different level options would land the safe room in a wall.
  const savedWorld = levelResolved ? parseSavedWorld(progress.world) : undefined;
  if (savedWorld !== undefined) {
    options.worldSeed = savedWorld.worldSeed;
    options.artSeed = savedWorld.artSeed;
    options.spawnAt = savedWorld.safeRoomTile ?? undefined;
    options.levelTimerFrames = savedWorld.levelTimerFrames ?? undefined;
    options.persistedWorldState = savedWorld.persisted;
  }
  // The scene starts standing on this save, so a death before it takes another
  // comes straight back here rather than to the floor's entry.
  options.lastSave = save;
  return { levelDef, options };
}
