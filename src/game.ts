import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import type { DungeonSceneOptions } from './scenes/DungeonScene';
import { PostSignupScene } from './scenes/PostSignupScene';
import { tutorialLevel, getLevelDef } from './levels/index';
import { aiAdapter } from './ai/AIAdapter';
import { revivedSnapshot } from './core/PlayerSnapshot';
import { devBootScene } from './dev/devBoot';
import { AbilityManager } from './core/AbilityManager';
import { MAGIC_MISSILE_DEF } from './abilities/magicMissile';
import { PROTECTIVE_SHELL_DEF } from './abilities/protectiveShell';
import { SMUSH_DEF } from './abilities/smush';
import { MONGO_DEF, getMongoStats } from './abilities/mongo';
import { createMongoPetState } from './core/MongoPetState';
import { AuthClient } from './auth/AuthClient';
import type { GameProgress } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';
import { prewarmGroups } from './core/SpriteLoader';
import { AudioManager } from './audio/AudioManager';
import { CORE_SFX_IDS } from './audio/sfxGroups';
import { showLoadingScreen } from './ui/LoadingScreen';
import { difficultyStats } from './core/DifficultyStats';
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
    const onResetGame = () => {
      difficultyStats.beginRun();
      sceneManager.replace(new PostSignupScene(input, sceneManager, { audio, onResetGame }));
    };
    if (devBootScene(sceneManager, input, { audio, onResetGame })) return;
    sceneManager.replace(new PostSignupScene(input, sceneManager, { audio, onResetGame }));
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

  const saveProgress = (data: {
    humanSnap: GameProgress['humanSnap'];
    catSnap: GameProgress['catSnap'];
    levelId: string;
    abilityStates: GameProgress['abilityStates'];
    mongoUnlocked: boolean;
    mongoPetHp: number;
    mongoPetResting: boolean;
  }) => {
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
    // Loading straight into a wipe is never recoverable — the same save would
    // reload into the same wipe — so a resumed party always arrives on its feet.
    options.humanSnap = revivedSnapshot(progress.humanSnap);
    options.catSnap = revivedSnapshot(progress.catSnap);
    options.abilityManager = resumedAbilityManager(progress.abilityStates);
    options.mongoUnlocked = progress.mongoUnlocked ?? false;
    if (progress.mongoPetHp !== undefined && Number.isFinite(progress.mongoPetHp)) {
      // Clamped against the maximum the *restored* level implies: this arrives
      // as unvalidated server JSON, and a value above the maximum renders as a
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
    // progress.levelId is unvalidated server JSON — a save written against a
    // since-renamed level must fall back rather than throw at boot.
    let resumeLevel;
    try {
      resumeLevel = getLevelDef(progress.levelId);
    } catch {
      resumeLevel = tutorialLevel;
    }
    sceneManager.replace(new DungeonScene(resumeLevel, input, sceneManager, options));
  } else {
    sceneManager.replace(new PostSignupScene(input, sceneManager, options));
  }

  // Fire-and-forget: if the AI server isn't running the adapter stays silent.
  aiAdapter.initialize().catch(() => {
    void 0;
  });
})().catch(console.error);
