import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import type { DungeonSceneOptions } from './scenes/DungeonScene';
import { PostSignupScene } from './scenes/PostSignupScene';
import { tutorialLevel } from './levels/index';
import { aiAdapter } from './ai/AIAdapter';
import { AuthClient } from './auth/AuthClient';
import type { GameProgress } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';
import { loadSprites } from './core/SpriteLoader';
import { AudioManager } from './audio/AudioManager';

/** HTTP status code for unauthorized. */
const HTTP_UNAUTHORIZED = 401;

const input = new InputManager();
const authClient = new AuthClient();
const audio = new AudioManager();
// Begin decoding all audio assets in the background immediately.
void audio.preload();

(async () => {
  await loadSprites();

  const aiServerRunning = await aiAdapter.checkServerAvailable();

  if (!aiServerRunning) {
    // No AI server — skip auth and start fresh without save/load capability.
    const sceneManager = new SceneManager();
    const onResetGame = () => {
      sceneManager.replace(new PostSignupScene(input, sceneManager, { audio, onResetGame }));
    };
    sceneManager.replace(new PostSignupScene(input, sceneManager, { audio, onResetGame }));
    return;
  }

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
  }) => {
    authClient.saveProgress({ ...data, savedAt: new Date().toISOString() }).catch(() => {
      void 0;
    });
  };

  const onResetGame = () => {
    authClient.deleteProgress().catch(() => void 0);
    sceneManager.replace(
      new PostSignupScene(input, sceneManager, { audio, saveProgress, onResetGame }),
    );
  };

  const options: DungeonSceneOptions = { saveProgress, audio, onResetGame };

  if (progress) {
    options.humanSnap = progress.humanSnap;
    options.catSnap = progress.catSnap;
    sceneManager.replace(new DungeonScene(tutorialLevel, input, sceneManager, options));
  } else {
    sceneManager.replace(new PostSignupScene(input, sceneManager, options));
  }

  // Fire-and-forget: if the AI server isn't running the adapter stays silent.
  aiAdapter.initialize().catch(() => {
    void 0;
  });
})().catch(console.error);
