import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import type { DungeonSceneOptions } from './scenes/DungeonScene';
import { PostSignupScene } from './scenes/PostSignupScene';
import { sceneSetupFromSave } from './scenes/resumeFromSave';
import { aiAdapter } from './ai/AIAdapter';
import { devBootScene, installDevLoopFallback } from './dev/devBoot';
import { AuthClient } from './auth/AuthClient';
import type { GameProgress, GameProgressInput } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';
import { prewarmGroups } from './core/SpriteLoader';
import { AudioManager } from './audio/AudioManager';
import { CORE_SFX_IDS } from './audio/sfxGroups';
import { showLoadingScreen } from './ui/LoadingScreen';
import { difficultyStats } from './core/DifficultyStats';
import { clearLocalProgress, readLocalProgress, writeLocalProgress } from './core/LocalProgress';
import { setSearchCaptureHeldKeyRelease } from './ui/SearchField';

declare const __AI_ENABLED__: boolean;

/** HTTP status code for unauthorized. */
const HTTP_UNAUTHORIZED = 401;

/** Starts the scene on the floor a save was written on, with its party, abilities and pet restored. */
function resumeFromProgress(baseOptions: DungeonSceneOptions, progress: GameProgress): void {
  const { levelDef, options } = sceneSetupFromSave(baseOptions, progress);
  sceneManager.replace(new DungeonScene(levelDef, input, sceneManager, options));
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
