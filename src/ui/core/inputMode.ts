/**
 * Copy that depends on how the player is pointing: "Tap" on a touch screen,
 * "Click" or a key name with a mouse and keyboard.
 *
 * Inside a surface, pass `ui.density`. Code that runs outside a surface (a
 * prompt drawn in the world pass, a tutorial line built in `update`) asks
 * {@link activeInputMode}, which is the density the most recently drawn
 * `UiRoot` resolved for its last frame. Every `UiRoot.frame` records it, so
 * a headless script that frames a touch root gets touch copy, and one that
 * never frames a root gets the detected density (a pointer, in node). The
 * record lasts until that root is disposed or {@link resetInputMode} runs.
 */

import { keybindings, type GameAction } from '../../core/Keybindings';
import type { Density } from '../theme/tokens';
import { detectDensity } from './viewport';

/** How the player is pointing. The same axis the UI's density is decided on. */
export type InputMode = Density;

let lastFrameMode: InputMode | null = null;
let lastFrameOwner: object | null = null;

/** Called by `UiRoot.frame` with the density it resolved; nothing else should call it. */
export function noteFrameInputMode(mode: InputMode, owner: object): void {
  lastFrameMode = mode;
  lastFrameOwner = owner;
}

/**
 * Called by `UiRoot.dispose`: a root that is gone stops speaking for the
 * input mode, so a touch-framed root in one headless scenario does not hand
 * touch copy to the next.
 */
export function forgetFrameInputMode(owner: object): void {
  if (owner !== lastFrameOwner) return;
  resetInputMode();
}

/**
 * Forgets the recorded mode, so {@link activeInputMode} falls back to the
 * detected density until a root frames again. For headless scripts that
 * run scenarios with different densities in one process.
 */
export function resetInputMode(): void {
  lastFrameMode = null;
  lastFrameOwner = null;
}

/** The input mode of the last frame any `UiRoot` drew, or the detected one before the first frame. */
export function activeInputMode(): InputMode {
  return lastFrameMode ?? detectDensity();
}

/** Picks the value for `mode`: `byInputMode(mode, { touch: 'Tap the bell', pointer: 'Click the bell' })`. */
export function byInputMode<T>(mode: InputMode, choices: Readonly<Record<InputMode, T>>): T {
  return choices[mode];
}

/** The verb for a single press on a control: "Tap" or "Click". */
export function tapVerb(mode: InputMode): 'Tap' | 'Click' {
  return mode === 'touch' ? 'Tap' : 'Click';
}

/** The touch gestures prompts name, as the player reads them. */
export const TOUCH_GESTURES = {
  tap: 'Tap',
  doubleTap: 'Double tap',
  longPress: 'Long-press',
  holdAndDrag: 'Hold and drag',
} as const;

export type TouchGesture = keyof typeof TOUCH_GESTURES;

/** The key currently bound to `action`, as the player reads it ("E", "Space"). */
export function keyLabel(action: GameAction): string {
  return keybindings.labelFor(action);
}

/** The bound key in brackets, for inline mentions: "[E]". */
export function keycapLabel(action: GameAction): string {
  return `[${keyLabel(action)}]`;
}

export interface ActionPromptOptions {
  /** What the press does, lower-case, completing "… to ___": "repair the wall". */
  readonly deed: string;
  /** The key that does it with a keyboard. */
  readonly action: GameAction;
  /** The gesture that does it on touch. Defaults to a tap. */
  readonly gesture?: TouchGesture;
}

/**
 * The standard "how do I do this" line: "Double tap to reload" on touch,
 * "Press R to reload" with a keyboard.
 */
export function actionPrompt(mode: InputMode, opts: ActionPromptOptions): string {
  if (mode === 'touch') return `${TOUCH_GESTURES[opts.gesture ?? 'tap']} to ${opts.deed}`;
  return `Press ${keyLabel(opts.action)} to ${opts.deed}`;
}
