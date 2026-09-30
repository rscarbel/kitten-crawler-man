/**
 * Checks that a running difficulty-change guard holds the Settings tab's
 * difficulty buttons behind a restart confirmation, and that nothing else is
 * held.
 *
 * Drives the real `PauseMenu` against a node canvas: it is opened, walked to
 * the Settings tab and clicked through `handleClick` at each button's centre,
 * so a button that stops consulting the guard, a prompt whose click list and
 * focus ring disagree, or a menu route that leaves a prompt pending, fails here.
 *
 * Import only after the canvas and audio globals are installed: the settings,
 * audio and render modules read `window` and `document` when they load.
 */

import { AudioManager } from '../src/audio/AudioManager.js';
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
import { DIFFICULTY_LABELS, type Difficulty } from '../src/core/difficultyProfiles.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { menuFocusContextId, menuFocusRingSize } from '../src/ui/Button.js';
import { PauseMenu } from '../src/ui/PauseMenu.js';
import { gameContext } from './nodeGameContext.js';

/** Faults a run can inject to prove the checks can fail. */
export type DifficultyGuardFault = 'unguarded-difficulty';

/** Tall enough that the pause box is not clamped and the difficulty row sits in the scroll band unscrolled. */
const CANVAS_W = 420;
const CANVAS_H = 940;

const SETTINGS_LABEL = 'Settings';
const KEEP_PLAYING_LABEL = 'Keep playing';
const CHANGE_AND_RESTART_LABEL = 'Change and restart';
const CONFIRM_FOCUS_CONTEXT = 'pause-difficulty-confirm';
const CONFIRM_BUTTON_COUNT = 2;
const HALF = 0.5;

const STARTING_DIFFICULTY: Difficulty = 'normal';
const CHOSEN_DIFFICULTY: Difficulty = 'hard';

setViewportSize(CANVAS_W, CANVAS_H);
const ctx = gameContext(CANVAS_W, CANVAS_H);
const human = new HumanPlayer(0, 0, TILE_SIZE);
const cat = new CatPlayer(0, 0, TILE_SIZE);

const menu = new PauseMenu();
menu.audio = new AudioManager();
// Music pausing is not under test, and the silent audio shim has no voices to pause.
menu.skipAudioPause = () => true;

function renderMenu(): string[] {
  menu.render(ctx, human, cat);
  return menu.renderedButtons.flatMap((button) =>
    button.label === undefined ? [] : [button.label],
  );
}

/** Clicks the button labelled `label` on a fresh frame; false when no such button is drawn. */
function press(label: string): boolean {
  renderMenu();
  const button = menu.renderedButtons.find((candidate) => candidate.label === label);
  if (button === undefined) return false;
  menu.handleClick(button.x + button.w * HALF, button.y + button.h * HALF);
  return true;
}

function promptIsUp(): boolean {
  return renderMenu().includes(CHANGE_AND_RESTART_LABEL);
}

/** Opens the pause menu on the Settings tab with the starting tier in play. */
function openSettings(): boolean {
  menu.close();
  settings.setDifficulty(STARTING_DIFFICULTY);
  menu.open();
  return press(SETTINGS_LABEL) && menu.currentTab === 'settings';
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

  const chosenLabel = DIFFICULTY_LABELS[CHOSEN_DIFFICULTY];

  // With no guard, a pick applies at once and raises no prompt.
  check(openSettings(), 'could not reach the Settings tab from the pause menu');
  check(activeDifficultyChangeGuard() === null, 'a guard was active before any registration');
  check(press(chosenLabel), `no "${chosenLabel}" button drawn with no guard`);
  check(
    settings.difficulty === CHOSEN_DIFFICULTY,
    `unguarded pick left difficulty at ${settings.difficulty}`,
  );
  check(!promptIsUp(), 'an unguarded pick raised the restart prompt');

  // A guarded pick is held, and the prompt owns the clicks and the focus ring.
  const run = recordingGuard();
  const handle = register(run.guard);
  openSettings();
  check(press(chosenLabel), `no "${chosenLabel}" button drawn under a guard`);
  check(
    settings.difficulty === STARTING_DIFFICULTY,
    `guarded pick applied at once (difficulty is ${settings.difficulty})`,
  );
  const promptButtons = renderMenu();
  check(
    promptButtons.length === CONFIRM_BUTTON_COUNT &&
      promptButtons.includes(KEEP_PLAYING_LABEL) &&
      promptButtons.includes(CHANGE_AND_RESTART_LABEL),
    `guarded pick did not leave only the prompt's buttons clickable: [${promptButtons.join(', ')}]`,
  );
  check(
    menuFocusContextId() === CONFIRM_FOCUS_CONTEXT,
    `prompt declared focus ring "${menuFocusContextId() ?? 'none'}"`,
  );
  check(
    menuFocusRingSize() === CONFIRM_BUTTON_COUNT,
    `prompt focus ring holds ${menuFocusRingSize()} buttons, click list holds ${CONFIRM_BUTTON_COUNT}`,
  );

  // Keep playing changes nothing.
  check(press(KEEP_PLAYING_LABEL), 'no Keep playing button on the prompt');
  check(
    settings.difficulty === STARTING_DIFFICULTY,
    `Keep playing changed difficulty to ${settings.difficulty}`,
  );
  check(run.restarts.length === 0, 'Keep playing asked the guard to restart');
  check(!promptIsUp(), 'the prompt stayed up after Keep playing');

  // Closing the menu drops a pending prompt: it must not greet the next opening.
  openSettings();
  press(chosenLabel);
  check(promptIsUp(), 'guarded pick raised no prompt before closing the menu');
  menu.close();
  menu.open();
  press(SETTINGS_LABEL);
  check(!promptIsUp(), 'a pending prompt survived closing the pause menu');

  // Change and restart hands the new tier to the guard, once.
  openSettings();
  press(chosenLabel);
  check(press(CHANGE_AND_RESTART_LABEL), 'no Change and restart button on the prompt');
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
