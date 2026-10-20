import { InputManager } from './core/InputManager';
import { SceneManager } from './core/Scene';
import { DungeonScene } from './scenes/DungeonScene';
import type { DungeonSceneOptions } from './scenes/DungeonScene';
import { TitleScene } from './scenes/title/TitleScene';
import { sceneSetupFromSave } from './scenes/resumeFromSave';
import { aiAdapter } from './ai/AIAdapter';
import { devBootScene, installDevLoopFallback } from './dev/devBoot';
import { AuthClient, isUnauthorizedError, type AuthUser } from './auth/AuthClient';
import type { GameProgress, GameProgressInput } from './auth/AuthClient';
import { LoginUI } from './auth/LoginUI';
import { prewarmGroups } from './core/SpriteLoader';
import { AudioManager } from './audio/AudioManager';
import { CORE_SFX_IDS } from './audio/sfxGroups';
import { showLoadingScreen } from './ui/LoadingScreen';
import { dismissBootSplash } from './ui/bootSplash';
import { LOCAL_PROGRESS_STORAGE, readLocalProgress } from './core/LocalProgress';
import {
  PAGE_SAVE_LATCH,
  ProgressPersistence,
  bootProgress,
  reloadPage,
} from './core/progressPersistence';
import type { OwedWipe, ProgressStorage, WipeAccount } from './core/progressPersistence';
import { LOCAL_WIPE_MARKER } from './core/wipeMarker';
import { WipeHoldScene } from './scenes/WipeHoldScene';
import { loadUiFont } from './ui/theme/fonts';
import { prewarmTitleCast } from './scenes/title/titleCast';
import { prewarmTitleHall } from './scenes/title/layers/dungeonHallLayer';

declare const __AI_ENABLED__: boolean;

/** Starts the scene on the floor a save was written on, with its party, abilities and pet restored. */
function resumeFromProgress(baseOptions: DungeonSceneOptions, progress: GameProgress): void {
  const { levelDef, options } = sceneSetupFromSave(baseOptions, progress);
  sceneManager.replace(new DungeonScene(levelDef, input, sceneManager, options));
}

/**
 * Erases the run for good: latches every save write on this page, waits out
 * any save already sent, then deletes the save slot, retrying until it is
 * gone. Resolves once the delete has landed. Reset Game and the Nothing both
 * run it behind a blocking hold and reload the page afterwards, so nothing
 * held in memory can outlive the wipe.
 */
function wipeAllProgress(persistence: ProgressPersistence): Promise<void> {
  // Not awaited: the AI forgetting the player must never hold up, or fail, the wipe itself.
  void aiAdapter.forgetPlayer();
  return persistence.wipe();
}

/** How a save slot behind a sign-in reaches its account. */
interface SignedInSlot {
  /** Whoever is signed in on this page right now, or null when unknown. */
  account: () => WipeAccount | null;
  /** Asks the server who is signed in, rejecting when it cannot say. */
  identify: () => Promise<WipeAccount>;
  reauthenticate: () => Promise<WipeAccount>;
  signOut: () => Promise<unknown>;
}

function wipeAccountOf(user: AuthUser): WipeAccount {
  return { id: String(user.id), label: user.username };
}

/**
 * The page's door to one save slot. `owed` is a wipe a previous page left
 * unfinished, which this one completes for the account it was owed to.
 */
function pagePersistence(
  storage: ProgressStorage,
  signedIn: SignedInSlot | undefined,
  owed?: OwedWipe,
): ProgressPersistence {
  return new ProgressPersistence(storage, {
    onWipeRetry: (attempt, err) => {
      console.error(`Failed to delete saved progress (attempt ${attempt}):`, err);
    },
    isAuthFailure: isUnauthorizedError,
    reauthenticate: signedIn?.reauthenticate,
    signOut: signedIn?.signOut,
    account: signedIn?.account,
    identify: signedIn?.identify,
    owedAccount: owed?.account,
    marker: LOCAL_WIPE_MARKER,
  });
}

/**
 * Loads the save through {@link bootProgress}: a wipe a previous page left
 * owed is finished first, behind a blocking hold, and the page then reloads
 * clean instead of loading anything.
 */
async function loadUnlessWipeOwed<T>(
  storage: ProgressStorage,
  signedIn: SignedInSlot | undefined,
  load: () => Promise<T | null>,
): Promise<T | null | 'reloading'> {
  const boot = await bootProgress({
    marker: LOCAL_WIPE_MARKER,
    latch: PAGE_SAVE_LATCH,
    finishWith: (owed) => pagePersistence(storage, signedIn, owed),
    onOwedWipe: (persistence) => {
      const hold = new WipeHoldScene(audio);
      sceneManager.replace(hold);
      hold.holdOn(persistence);
    },
    load,
  });
  if (boot.kind === 'wipeFinished') {
    reloadPage();
    return 'reloading';
  }
  return boot.progress;
}

/**
 * Scene options every launch shares: the save and wipe paths for one save slot.
 * `signedIn` is for a slot behind a sign-in, where a delete refused for an
 * expired session would otherwise retry forever.
 */
function persistenceOptions(
  storage: ProgressStorage,
  signedIn?: SignedInSlot,
): DungeonSceneOptions {
  const persistence = pagePersistence(storage, signedIn);
  return {
    audio,
    saveProgress: (data: GameProgressInput) => persistence.save(data),
    progressWipe: {
      wipe: () => wipeAllProgress(persistence),
      get wipeStatus() {
        return persistence.wipeStatus;
      },
      get wipeAccountLabel() {
        return persistence.wipeAccountLabel;
      },
      get refusedOtherAccount() {
        return persistence.refusedOtherAccount;
      },
    },
    onResetGame: reloadPage,
  };
}

// Before anything can save: a wipe a previous page left unfinished means no
// write may land until boot has finished it.
if (LOCAL_WIPE_MARKER.read() !== null) PAGE_SAVE_LATCH.engage();

const input = new InputManager();
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
sceneManager.setTransitionHooks({
  begin: () => audio.music.beginHandover(),
  end: () => audio.music.endHandover(),
});
const loadingScreen = showLoadingScreen(sceneManager.ctx);
// Queued after the loading screen's own first frame, so in that same frame the
// canvas is already painted underneath when the splash starts to fade.
requestAnimationFrame(() => dismissBootSplash());

(async () => {
  // Queued now so the figure cache bakes the title's cast behind this loading
  // screen, and the first title frame finds every row it draws already warm.
  prewarmTitleCast();
  // Only the group every scene needs decodes before the first frame; the rest
  // loads lazily on demand (SpriteLoader.getSpriteDef schedules a load on a
  // miss). This is what turns the ~2.3s blank-page boot into a loading screen.
  // `prewarmGroups` (not `loadGroups`) also forces the GPU texture upload for
  // each sprite behind this same loading screen, so `core`'s sheets don't
  // hitch on the first frame that actually draws them.
  await Promise.all([
    prewarmGroups(['core'], (loaded, total) => loadingScreen.setProgress(loaded, total)),
    loadUiFont(),
  ]);
  // The hall's stone is painted pixel by pixel; doing it under the loading screen keeps that cost off the title's first frame.
  prewarmTitleHall();
  loadingScreen.stop();

  if (!__AI_ENABLED__) {
    // AI/backend disabled at build time — run as a pure static game with no server calls.
    const staticBoot = await loadUnlessWipeOwed(LOCAL_PROGRESS_STORAGE, undefined, () =>
      Promise.resolve(null),
    );
    if (staticBoot === 'reloading') return;
    const options = persistenceOptions(LOCAL_PROGRESS_STORAGE);
    const showStartMenu = () => {
      const saved = readLocalProgress();
      const onContinue = saved === null ? undefined : () => resumeFromProgress(options, saved);
      sceneManager.replace(new TitleScene(input, sceneManager, options, onContinue));
    };
    if (devBootScene(sceneManager, input, options)) return;
    showStartMenu();
    return;
  }

  const authClient = new AuthClient();

  let signedInAs: AuthUser | null = null;
  try {
    signedInAs = await authClient.getMe();
  } catch (err: unknown) {
    if (isUnauthorizedError(err)) {
      // Auth server is up but no session — show login/register screen.
      const ui = new LoginUI(authClient);
      signedInAs = await ui.show();
    }
    // Any other error: server had an issue — proceed without forcing login.
  }

  const serverSlot = authClient.asProgressStorage();
  const signedIn: SignedInSlot = {
    account: () => (signedInAs === null ? null : wipeAccountOf(signedInAs)),
    identify: async () => {
      signedInAs = await authClient.getMe();
      return wipeAccountOf(signedInAs);
    },
    reauthenticate: async () => {
      signedInAs = await new LoginUI(authClient).show();
      aiAdapter.accountChanged();
      return wipeAccountOf(signedInAs);
    },
    signOut: async () => {
      await authClient.logout();
      signedInAs = null;
      aiAdapter.accountChanged();
    },
  };

  const progress = await loadUnlessWipeOwed(serverSlot, signedIn, () =>
    authClient.loadProgress().catch(() => null),
  );
  if (progress === 'reloading') return;

  const options = persistenceOptions(serverSlot, signedIn);

  if (devBootScene(sceneManager, input, options)) return;

  if (progress) {
    resumeFromProgress(options, progress);
  } else {
    sceneManager.replace(new TitleScene(input, sceneManager, options));
  }

  // Fire-and-forget: if the AI server isn't running the adapter stays silent.
  aiAdapter.initialize().catch(() => {
    void 0;
  });
})().catch(console.error);
