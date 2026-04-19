import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import type { DungeonSceneOptions } from './scenes/DungeonScene';
import { level1 } from './levels/index';
import { aiAdapter } from './ai/AIAdapter';
import { AuthClient } from './auth/AuthClient';
import type { GameProgress } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';

const input = new InputManager();
const authClient = new AuthClient();

function launchGame(options?: DungeonSceneOptions): void {
  const sceneManager = new SceneManager();
  sceneManager.replace(new DungeonScene(level1, input, sceneManager, options));
  // Fire-and-forget: if the AI server isn't running the adapter stays silent.
  aiAdapter.initialize().catch(() => {});
}

(async () => {
  try {
    await authClient.getMe();
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 401) {
      // Auth server is up but no session — show login/register screen.
      const ui = new LoginUI(authClient);
      await ui.show();
    } else {
      // Server unavailable — start immediately without authentication.
      launchGame();
      return;
    }
  }

  // Load any previously saved progress for this user.
  const progress = (await authClient.loadProgress().catch(() => null)) as GameProgress | null;

  const saveProgress = (data: {
    humanSnap: GameProgress['humanSnap'];
    catSnap: GameProgress['catSnap'];
    levelId: string;
  }) => {
    authClient.saveProgress({ ...data, savedAt: new Date().toISOString() }).catch(() => {});
  };

  const options: DungeonSceneOptions = { saveProgress };
  if (progress) {
    options.humanSnap = progress.humanSnap;
    options.catSnap = progress.catSnap;
  }

  launchGame(options);
})().catch(console.error);
