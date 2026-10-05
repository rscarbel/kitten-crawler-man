import { skinsFor } from './theme/skins';
import { resolveTheme, type Theme } from './theme/tokens';

/** Period of the prompt's bob, in ms per radian. */
export const PROMPT_BOB_PERIOD_MS = 400;
/** How far the prompt bobs above and below its rest height, in UI units. */
export const PROMPT_BOB_AMPLITUDE = 2;
/** Gap between the prompted object's top edge and the bottom of the pill, in UI units. */
export const PROMPT_LIFT = 12;

/** Before the first prompt frame there is no live theme; the pill's geometry is the same at either density. */
const DEFAULT_THEME = resolveTheme('pointer');
const DEFAULT_UI_SCALE = 1;

/** The pill's height: a keycap with its pressed-edge depth, padded on both sides. */
export function promptPillHeight(theme: Theme): number {
  const keycap = skinsFor(theme).keycap;
  return keycap.height + keycap.depth + theme.space.xs * 2;
}

/** A prompt waiting to be drawn, anchored at the top-centre of its object in canvas pixels. */
export interface QueuedPrompt {
  readonly canvasX: number;
  readonly canvasY: number;
  readonly label: string | null;
  readonly keyOverride: string | null;
}

const queue: QueuedPrompt[] = [];
let promptsSuppressed = false;
let promptsDrawnThisFrame = 0;
let lastUiScale = DEFAULT_UI_SCALE;
let lastTheme = DEFAULT_THEME;

/**
 * Silences every floating prompt for the frame.
 *
 * Prompts are drawn from two dozen systems that each know only about their own
 * object, so none of them can tell whether a dialog is already covering the
 * screen — and a per-system list of dialog flags goes stale the moment a new
 * dialog system is added. A scene instead answers the question once per frame
 * from its `UiRoot`'s surface stack, in one call for every prompt.
 *
 * Call it at the top of every scene render that draws prompts: the flag is
 * module state, so a scene that never sets it inherits the last scene's answer.
 * It also drops anything still queued, so a scene without the prompt surface
 * mounted never accumulates prompts.
 */
export function setInteractionPromptsSuppressed(suppressed: boolean): void {
  promptsSuppressed = suppressed;
  promptsDrawnThisFrame = 0;
  queue.length = 0;
}

/**
 * Prompts raised since the frame began — the frame being the last
 * {@link setInteractionPromptsSuppressed} call, which every prompting scene
 * makes at the top of its render.
 *
 * For a prompt that stands for the last link of a scene's Space chain: raised
 * after every other prompt, it can show only when none of them did, and so
 * never promises a press that an earlier link would take.
 */
export function interactionPromptsDrawnThisFrame(): number {
  return promptsDrawnThisFrame;
}

/**
 * Whether prompts are suppressed for the frame — a dialog has the screen, or
 * the game is over. For a prompt drawn with something other than
 * {@link drawInteractionPrompt} itself (a structure's own hint text, say)
 * that still needs to honor the same one answer everything else does.
 */
export function interactionPromptsSuppressed(): boolean {
  return promptsSuppressed;
}

/**
 * The highest pixel a prompt anchored at `sy` reaches, bob included, for
 * world art stacked above it. The pill is sized in UI units, so the reach is
 * converted with the UI scale of the last frame that drew prompts.
 */
export function interactionPromptTop(sy: number): number {
  const reachUnits = PROMPT_LIFT + promptPillHeight(lastTheme) + PROMPT_BOB_AMPLITUDE;
  return sy - reachUnits * lastUiScale;
}

/**
 * Raises a floating interaction prompt above an object in world space: a
 * keycap ("SPACE", or "TAP" on touch) with an optional action label, bobbing
 * gently to draw the player's eye.
 *
 * Nothing is painted here. The prompt is queued with its position mapped
 * through the context's current transform, and the scene's prompt surface
 * draws the whole queue above the world, its darkness and fog, in the same
 * frame — so it must be raised before the scene's `ui.frame`.
 *
 * Does nothing while {@link setInteractionPromptsSuppressed} is set for the frame.
 *
 * @param ctx      Canvas context the object is being drawn with
 * @param sx       X of the object's top-left corner in `ctx`'s current space
 * @param sy       Y of the object's top-left corner in `ctx`'s current space
 * @param objW     Width of the object in that space (the prompt is centred above it)
 * @param label    Optional action label shown beside the key, e.g. "Talk"
 * @param keyOverride  Optional key text override (default: the attack key, or "TAP" on touch)
 */
export function drawInteractionPrompt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  objW: number,
  label?: string,
  keyOverride?: string,
): void {
  if (promptsSuppressed) return;
  promptsDrawnThisFrame++;
  const anchorX = sx + objW / 2;
  const m = ctx.getTransform();
  queue.push({
    canvasX: m.a * anchorX + m.c * sy + m.e,
    canvasY: m.b * anchorX + m.d * sy + m.f,
    label: label === undefined || label === '' ? null : label,
    keyOverride: keyOverride ?? null,
  });
}

/** The prompts raised so far this frame and not yet drawn. */
export function queuedPrompts(): readonly QueuedPrompt[] {
  return queue;
}

/** Whether any prompt is waiting to be drawn this frame. */
export function hasQueuedPrompts(): boolean {
  return queue.length > 0;
}

/**
 * Hands every queued prompt to `draw` and empties the queue. `uiScale` and
 * `theme` are what the prompts are being drawn at, remembered for
 * {@link interactionPromptTop}.
 */
export function drainQueuedPrompts(
  uiScale: number,
  theme: Theme,
  draw: (prompt: QueuedPrompt) => void,
): void {
  lastUiScale = uiScale;
  lastTheme = theme;
  for (const prompt of queue) draw(prompt);
  queue.length = 0;
}
