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
import { AuthClient } from './auth/AuthClient';
import type { GameProgress } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';
import { loadSprites } from './core/SpriteLoader';
import { AudioManager } from './audio/AudioManager';

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
  if (states !== undefined) manager.restoreSerializedStates(states);
  return manager;
}

const input = new InputManager();
const audio = new AudioManager();
// Begin decoding all audio assets in the background immediately.
void audio.preload();

(async () => {
  await loadSprites();

  if (!__AI_ENABLED__) {
    // AI/backend disabled at build time — run as a pure static game with no server calls.
    const sceneManager = new SceneManager();
    const onResetGame = () => {
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

  const sceneManager = new SceneManager();

  const saveProgress = (data: {
    humanSnap: GameProgress['humanSnap'];
    catSnap: GameProgress['catSnap'];
    levelId: string;
    abilityStates: GameProgress['abilityStates'];
  }) => {
    authClient.saveProgress({ ...data, savedAt: new Date().toISOString() }).catch(() => {
      void 0;
    });
  };

  const onResetGame = () => {
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
