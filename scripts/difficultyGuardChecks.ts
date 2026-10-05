/**
 * Checks that a running difficulty-change guard holds the Settings page's
 * difficulty choices behind a restart confirmation, and that nothing else is
 * held.
 *
 * Drives the real `PauseScreen` through a headless `UiRoot`: it is opened on
 * the Settings page and its controls are tapped by region, so a choice that
 * stops consulting the guard, a confirm that does not take the keyboard, or a
 * menu route that leaves a confirm pending, fails here.
 *
 * Import only after the canvas and audio globals are installed: the settings,
 * audio and render modules read `window` and `document` when they load.
 */

import { AudioManager } from '../src/audio/AudioManager.js';
import { AbilityManager } from '../src/core/AbilityManager.js';
import { AchievementManager } from '../src/core/AchievementManager.js';
import { GameStats } from '../src/core/GameStats.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { TILE_SIZE } from '../src/core/constants.js';
import {
  activeDifficultyChangeGuard,
  clearDifficultyChangeGuard,
  registerDifficultyChangeGuard,
  type DifficultyChangeGuard,
  type DifficultyGuardHandle,
} from '../src/core/difficultyChangeGuard.js';
import { settings } from '../src/core/Settings.js';
import type { Difficulty } from '../src/core/difficultyProfiles.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { MOUSE_POINTER_ID, PRIMARY_BUTTON } from '../src/ui/core/pointer.js';
import { UiRoot, type HitRegion } from '../src/ui/core/UiRoot.js';
import { NO_INSETS, type ViewportInput } from '../src/ui/core/viewport.js';
import { PAUSE_CONFIRM_SURFACE_IDS, PauseScreen } from '../src/ui/screens/pause/PauseScreen.js';
import { gameContext } from './nodeGameContext.js';

/** Faults a run can inject to prove the checks can fail. */
export type DifficultyGuardFault = 'unguarded-difficulty';

/** A desktop window: the Settings page shows beside the sidebar. */
const CANVAS_W = 1024;
const CANVAS_H = 900;
const FRAME_MS = 16;
const HALF = 0.5;

const PAUSE_SURFACE_ID = 'pause';
const CONFIRM_SURFACE_ID = PAUSE_CONFIRM_SURFACE_IDS.difficulty;
const KEEP_PLAYING_ID = 'keep';
const CHANGE_AND_RESTART_ID = 'restart';
const CONFIRM_BUTTON_COUNT = 2;

const STARTING_DIFFICULTY: Difficulty = 'normal';
const CHOSEN_DIFFICULTY: Difficulty = 'hard';

setViewportSize(CANVAS_W, CANVAS_H);
const ctx = gameContext(CANVAS_W, CANVAS_H);
const human = new HumanPlayer(0, 0, TILE_SIZE);
const cat = new CatPlayer(0, 0, TILE_SIZE);

let clock = 0;
const viewport = (): ViewportInput => ({
  cssWidth: CANVAS_W,
  cssHeight: CANVAS_H,
  density: 'pointer',
  uiSize: 'medium',
  safeArea: NO_INSETS,
});
const root = new UiRoot({ audio: null, viewport, now: () => clock, warn: () => undefined });
const menu = new PauseScreen({
  party: () => ({ human, cat }),
  abilities: new AbilityManager(),
  audio: new AudioManager(),
  guides: {},
});
// Music pausing is not under test, and the silent audio shim has no voices to pause.
menu.skipAudioPause = () => true;
const frameData = {
  humanAchievements: new AchievementManager(),
  catAchievements: new AchievementManager(),
  gameStats: new GameStats(),
};
root.mount(
  menu.surface({
    frame: () => frameData,
    onEscape: () => menu.close(),
    openInventory: () => undefined,
  }),
);
for (const surface of menu.confirmSurfaces()) root.mount(surface);

function frame(): void {
  clock += FRAME_MS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  root.frame(ctx);
}

/** The live regions of `surfaceId` whose id ends with `/suffix`, after a fresh frame. */
function regionsOf(surfaceId: string): readonly HitRegion[] {
  frame();
  return root.regions().filter((region) => region.surfaceId === surfaceId);
}

function findRegion(surfaceId: string, suffix: string): HitRegion | null {
  return (
    regionsOf(surfaceId).find(
      (region) => region.id === suffix || region.id.endsWith(`/${suffix}`),
    ) ?? null
  );
}

/** Taps the region of `surfaceId` named `suffix` with the mouse; false when it is not drawn. */
function press(surfaceId: string, suffix: string): boolean {
  const region = findRegion(surfaceId, suffix);
  if (region === null) return false;
  const x = region.rect.x + region.rect.w * HALF;
  const y = region.rect.y + region.rect.h * HALF;
  for (const kind of ['down', 'up'] as const) {
    root.pointer({
      kind,
      pointerId: MOUSE_POINTER_ID,
      source: 'mouse',
      x,
      y,
      cssX: x * root.uiScale,
      cssY: y * root.uiScale,
      button: PRIMARY_BUTTON,
      deltaY: 0,
    });
  }
  frame();
  return true;
}

function promptIsUp(): boolean {
  frame();
  return root.isOpen(CONFIRM_SURFACE_ID);
}

/** Opens the pause screen on the Settings page with the starting tier in play. */
function openSettings(): boolean {
  menu.close();
  settings.setDifficulty(STARTING_DIFFICULTY);
  menu.open('settings');
  frame();
  return menu.currentSection === 'settings';
}

/** Records every restart the guard is asked for. */
function recordingGuard(): { guard: DifficultyChangeGuard; restarts: Difficulty[] } {
  const restarts: Difficulty[] = [];
  return {
    restarts,
    guard: {
      restartWithDifficulty: (next) => {
        restarts.push(next);
        settings.setDifficulty(next);
      },
    },
  };
}

type Register = (guard: DifficultyChangeGuard) => DifficultyGuardHandle;

/**
 * Runs every check and returns the failures, empty when all pass. `fault`
 * sabotages the guard registration so a caller can watch the checks go red.
 */
export function runDifficultyGuardChecks(fault: DifficultyGuardFault | null): string[] {
  const failures: string[] = [];
  const check = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message);
  };

  const register: Register =
    fault === 'unguarded-difficulty'
      ? () => ({ registration: 0 })
      : (guard) => registerDifficultyChangeGuard(guard);

  const chosenId = `difficulty/${CHOSEN_DIFFICULTY}`;
  const pickChosen = (): boolean => press(PAUSE_SURFACE_ID, chosenId);

  // With no guard, a pick applies at once and raises no prompt.
  check(openSettings(), 'could not open the pause screen on the Settings page');
  check(activeDifficultyChangeGuard() === null, 'a guard was active before any registration');
  check(pickChosen(), `no "${chosenId}" control drawn with no guard`);
  check(
    settings.difficulty === CHOSEN_DIFFICULTY,
    `unguarded pick left difficulty at ${settings.difficulty}`,
  );
  check(!promptIsUp(), 'an unguarded pick raised the restart prompt');

  // A guarded pick is held, and the prompt owns the clicks and the keyboard.
  const run = recordingGuard();
  const handle = register(run.guard);
  openSettings();
  check(pickChosen(), `no "${chosenId}" control drawn under a guard`);
  check(
    settings.difficulty === STARTING_DIFFICULTY,
    `guarded pick applied at once (difficulty is ${settings.difficulty})`,
  );
  check(promptIsUp(), 'a guarded pick raised no restart prompt');
  const promptButtons = regionsOf(CONFIRM_SURFACE_ID)
    .filter((region) => region.focusable)
    .map((region) => region.id);
  check(
    promptButtons.length === CONFIRM_BUTTON_COUNT &&
      promptButtons.some((id) => id.endsWith(`/${KEEP_PLAYING_ID}`)) &&
      promptButtons.some((id) => id.endsWith(`/${CHANGE_AND_RESTART_ID}`)),
    `the prompt does not offer exactly its two buttons: [${promptButtons.join(', ')}]`,
  );
  check(
    root.focusSurfaceId() === CONFIRM_SURFACE_ID,
    `the keyboard went to "${root.focusSurfaceId() ?? 'none'}", not the prompt`,
  );

  // Keep playing changes nothing.
  check(press(CONFIRM_SURFACE_ID, KEEP_PLAYING_ID), 'no Keep playing button on the prompt');
  check(
    settings.difficulty === STARTING_DIFFICULTY,
    `Keep playing changed difficulty to ${settings.difficulty}`,
  );
  check(run.restarts.length === 0, 'Keep playing asked the guard to restart');
  check(!promptIsUp(), 'the prompt stayed up after Keep playing');

  // Closing the menu drops a pending prompt: it must not greet the next opening.
  openSettings();
  pickChosen();
  check(promptIsUp(), 'guarded pick raised no prompt before closing the menu');
  menu.close();
  menu.open('settings');
  check(!promptIsUp(), 'a pending prompt survived closing the pause menu');

  // Escape on the prompt cancels the prompt and leaves the menu open.
  openSettings();
  pickChosen();
  root.key('Escape');
  check(!promptIsUp(), 'Escape left the restart prompt up');
  check(menu.isOpen, 'Escape on the prompt closed the pause menu as well');
  check(
    settings.difficulty === STARTING_DIFFICULTY && run.restarts.length === 0,
    'Escape on the prompt changed the difficulty',
  );

  // Change and restart hands the new tier to the guard, once.
  openSettings();
  pickChosen();
  check(
    press(CONFIRM_SURFACE_ID, CHANGE_AND_RESTART_ID),
    'no Change and restart button on the prompt',
  );
  check(
    run.restarts.length === 1 && run.restarts[0] === CHOSEN_DIFFICULTY,
    `Change and restart asked the guard for [${run.restarts.join(', ')}], expected [${CHOSEN_DIFFICULTY}]`,
  );
  check(
    settings.difficulty === CHOSEN_DIFFICULTY,
    `difficulty after Change and restart is ${settings.difficulty}`,
  );

  // Dev presets play a session tier without a running guard's say.
  settings.setDifficulty(STARTING_DIFFICULTY);
  const restartsBeforeSession = run.restarts.length;
  settings.setDifficultyForSession(CHOSEN_DIFFICULTY);
  check(settings.difficulty === CHOSEN_DIFFICULTY, 'setDifficultyForSession was held by the guard');
  check(
    run.restarts.length === restartsBeforeSession,
    'setDifficultyForSession asked the guard to restart',
  );
  clearDifficultyChangeGuard(handle);

  // A stale owner's clear cannot release a newer registration.
  const olderHandle = register(recordingGuard().guard);
  const newer = recordingGuard();
  const newerHandle = register(newer.guard);
  clearDifficultyChangeGuard(olderHandle);
  check(
    activeDifficultyChangeGuard() === newer.guard,
    'clearing a replaced guard released the newer one',
  );
  clearDifficultyChangeGuard(newerHandle);
  check(activeDifficultyChangeGuard() === null, 'clearing the live guard left it active');

  menu.close();
  settings.setDifficulty(STARTING_DIFFICULTY);
  return failures;
}
