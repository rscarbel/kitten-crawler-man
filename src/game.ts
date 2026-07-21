import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import type { DungeonSceneOptions } from './scenes/DungeonScene';
import { PostSignupScene } from './scenes/PostSignupScene';
import { PersonPreviewScene } from './scenes/PersonPreviewScene';
import { tutorialLevel, getLevelDef } from './levels/index';
import { createCircusQuestProgress, type CircusQuestStage } from './core/CircusQuestProgress';
import { aiAdapter } from './ai/AIAdapter';
import { AuthClient } from './auth/AuthClient';
import type { GameProgress } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';
import { loadSprites } from './core/SpriteLoader';
import { AudioManager } from './audio/AudioManager';

declare const __AI_ENABLED__: boolean;

/** HTTP status code for unauthorized. */
const HTTP_UNAUTHORIZED = 401;

const CIRCUS_STAGES: ReadonlyArray<CircusQuestStage> = [
  'not_started',
  'ritual_defense',
  'heather_hunt',
  'assault',
  'bigtop_ready',
  'grimaldi_slain',
  'complete',
];

/**
 * Dev-only bootstrap: `?level=level3&quest=bigtop_ready` jumps straight to a
 * level (optionally seeding circus-quest state) so quest stages can be
 * iterated on without replaying earlier floors. Localhost only.
 */
function devBootScene(sceneManager: SceneManager, options: DungeonSceneOptions): boolean {
  const isLocalDev =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isLocalDev) return false;
  const params = new URLSearchParams(window.location.search);

  if (params.get('people') !== null) {
    sceneManager.replace(new PersonPreviewScene(sceneManager));
    return true;
  }

  const levelId = params.get('level');
  if (levelId === null) return false;

  const questStage = params.get('quest');
  if (questStage !== null && CIRCUS_STAGES.some((s) => s === questStage)) {
    const progress = createCircusQuestProgress();
    // The check above proves membership; find() re-derives the narrow type.
    const stage = CIRCUS_STAGES.find((s) => s === questStage);
    if (stage !== undefined) progress.stage = stage;
    if (stage === 'heather_hunt' && params.get('heatherSlain') === '1') {
      progress.heatherSlain = true;
    }
    options.circusQuestProgress = progress;
  }

  if (params.get('spawn') === 'circus') options.spawnAtCircus = true;

  try {
    const levelDef = getLevelDef(levelId);
    sceneManager.replace(new DungeonScene(levelDef, input, sceneManager, options));
    return true;
  } catch {
    return false;
  }
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
    if (devBootScene(sceneManager, { audio, onResetGame })) return;
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

  if (devBootScene(sceneManager, options)) return;

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
