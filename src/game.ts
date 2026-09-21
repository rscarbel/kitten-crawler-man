import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import type { DungeonSceneOptions } from './scenes/DungeonScene';
import { PostSignupScene } from './scenes/PostSignupScene';
import { tutorialLevel, getLevelDef } from './levels/index';
import { aiAdapter } from './ai/AIAdapter';
import { revivedSnapshot } from './core/PlayerSnapshot';
import { devBootScene, installDevLoopFallback } from './dev/devBoot';
import { AbilityManager } from './core/AbilityManager';
import { MAGIC_MISSILE_DEF } from './abilities/magicMissile';
import { PROTECTIVE_SHELL_DEF } from './abilities/protectiveShell';
import { SMUSH_DEF } from './abilities/smush';
import { MONGO_DEF, getMongoStats } from './abilities/mongo';
import { createMongoPetState } from './core/MongoPetState';
import { AuthClient } from './auth/AuthClient';
import type { GameProgress, GameProgressInput } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';
import { prewarmGroups } from './core/SpriteLoader';
import { AudioManager } from './audio/AudioManager';
import { CORE_SFX_IDS } from './audio/sfxGroups';
import { showLoadingScreen } from './ui/LoadingScreen';
import { difficultyStats } from './core/DifficultyStats';
import { parseSavedWorld } from './core/SavedWorld';
import { clearLocalProgress, readLocalProgress, writeLocalProgress } from './core/LocalProgress';
import { setSearchCaptureHeldKeyRelease } from './ui/SearchField';

declare const __AI_ENABLED__: boolean;

/** HTTP status code for unauthorized. */
const HTTP_UNAUTHORIZED = 401;

/**
 * An ability manager carrying a save's progress, or a fresh one at level 1.
 *
 * The defs have to be registered here rather than left to `DungeonScene`:
 * restoring clamps each level against its def's maximum, so a manager with no
 * defs would discard every state it was handed. Registering the same defs again
 * in the scene constructor is harmless — `register` leaves existing state alone.
 */
function resumedAbilityManager(states: GameProgress['abilityStates']): AbilityManager {
  const manager = new AbilityManager();
  manager.register(MAGIC_MISSILE_DEF);
  manager.register(PROTECTIVE_SHELL_DEF);
  manager.register(SMUSH_DEF);
  manager.register(MONGO_DEF);
  if (states !== undefined) manager.restoreSerializedStates(states);
  return manager;
}

/**
 * Starts the scene on the floor a save was written on, with its party, abilities
 * and pet restored.
 *
 * Works on a copy of `baseOptions`: the caller keeps handing the same object to
 * later new-game launches, and a restored party leaking into those would start a
 * fresh run with the old run's characters.
 */
function resumeFromProgress(baseOptions: DungeonSceneOptions, progress: GameProgress): void {
  const options: DungeonSceneOptions = { ...baseOptions };
  // Loading straight into a wipe is never recoverable — the same save would
  // reload into the same wipe — so a resumed party always arrives on its feet.
  options.humanSnap = revivedSnapshot(progress.humanSnap);
  options.catSnap = revivedSnapshot(progress.catSnap);
  options.abilityManager = resumedAbilityManager(progress.abilityStates);
  options.mongoUnlocked = progress.mongoUnlocked ?? false;
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
  let resumeLevel;
  let levelResolved = true;
  try {
    resumeLevel = getLevelDef(progress.levelId);
  } catch {
    resumeLevel = tutorialLevel;
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
  }
  sceneManager.replace(new DungeonScene(resumeLevel, input, sceneManager, options));
}

const input = new InputManager();
setSearchCaptureHeldKeyRelease(() => input.clear());
const audio = new AudioManager();
// Only the universal group (menu/UI + generic player-combat cues) decodes at
// boot now; per-floor and per-interior SFX preload additively as the player
// reaches them (DungeonScene / BuildingInteriorScene constructors), so a
// floor's sounds are never paid for until that floor is actually visited.
void audio.preload(CORE_SFX_IDS);

// Created before any sprite has loaded so the loading screen below has a
// canvas to draw on immediately.
// Before the manager, because its constructor arms the first frame.
installDevLoopFallback();
const sceneManager = new SceneManager();
const loadingScreen = showLoadingScreen(sceneManager.ctx);

(async () => {
  // Only the group every scene needs decodes before the first frame; the rest
  // loads lazily on demand (SpriteLoader.getSpriteDef schedules a load on a
  // miss). This is what turns the ~2.3s blank-page boot into a loading screen.
  // `prewarmGroups` (not `loadGroups`) also forces the GPU texture upload for
  // each sprite behind this same loading screen, so `core`'s sheets don't
  // hitch on the first frame that actually draws them.
  await prewarmGroups(['core'], (loaded, total) => loadingScreen.setProgress(loaded, total));
  loadingScreen.stop();

  if (!__AI_ENABLED__) {
    // AI/backend disabled at build time — run as a pure static game with no server calls.
    const options: DungeonSceneOptions = {
      audio,
      saveProgress: writeLocalProgress,
      onResetGame: () => {
        difficultyStats.beginRun();
        clearLocalProgress();
        showStartMenu();
      },
    };
    const showStartMenu = () => {
      const saved = readLocalProgress();
      const onContinue = saved === null ? undefined : () => resumeFromProgress(options, saved);
      sceneManager.replace(new PostSignupScene(input, sceneManager, options, onContinue));
    };
    if (devBootScene(sceneManager, input, options)) return;
    showStartMenu();
    return;
  }

  const authClient = new AuthClient();

  try {
    await authClient.getMe();
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      err.status === HTTP_UNAUTHORIZED
    ) {
      // Auth server is up but no session — show login/register screen.
      const ui = new LoginUI(authClient);
      await ui.show();
    }
    // Any other error: server had an issue — proceed without forcing login.
  }

  // Load any previously saved progress for this user.
  const progress = await authClient.loadProgress().catch(() => null);

  const saveProgress = (data: GameProgressInput) => {
    authClient.saveProgress({ ...data, savedAt: new Date().toISOString() }).catch(() => {
      void 0;
    });
  };

  const onResetGame = () => {
    // The difficulty counters are run-scoped, and a reset is where one run ends
    // and the next begins. Without this a second playthrough in the same page
    // session starts on floor 1 already classified as post-Juicer.
    difficultyStats.beginRun();
    authClient.deleteProgress().catch((err: unknown) => {
      console.error('Failed to delete server progress on reset:', err);
    });
    sceneManager.replace(
      new PostSignupScene(input, sceneManager, { audio, saveProgress, onResetGame }),
    );
  };

  const options: DungeonSceneOptions = { saveProgress, audio, onResetGame };

  if (devBootScene(sceneManager, input, options)) return;

  if (progress) {
    resumeFromProgress(options, progress);
  } else {
    sceneManager.replace(new PostSignupScene(input, sceneManager, options));
  }

  // Fire-and-forget: if the AI server isn't running the adapter stays silent.
  aiAdapter.initialize().catch(() => {
    void 0;
  });
})().catch(console.error);
