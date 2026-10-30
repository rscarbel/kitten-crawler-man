import { TILE_SIZE } from '../core/constants';
import {
  chooseFocus,
  stanceAllows,
  type FocusCandidate,
  type InteractableKind,
  type InteractionStance,
  type PromptOwner,
} from './interactionFocus';
import type { Requirement } from './RequirementRow';
import { skinsFor } from './theme/skins';
import type { Theme } from './theme/tokens';

/** Period of the prompt's bob, in ms per radian. */
export const PROMPT_BOB_PERIOD_MS = 400;
/** How far the prompt bobs above and below its rest height, in UI units. */
export const PROMPT_BOB_AMPLITUDE = 2;
/** Gap between the prompted object's top edge and the bottom of the pill, in UI units. */
export const PROMPT_LIFT = 12;

/** The pill's height: a keycap with its pressed-edge depth, padded on both sides. */
export function promptPillHeight(theme: Theme): number {
  const keycap = skinsFor(theme).keycap;
  return keycap.height + keycap.depth + theme.space.xs * 2;
}

/** A prompt waiting to be drawn, anchored at the top-centre of its object's art in canvas pixels. */
export interface QueuedPrompt {
  readonly canvasX: number;
  readonly canvasY: number;
  /** The canvas y of the bottom of the object the prompt names; nothing may move the pill onto it. */
  readonly canvasBottom: number;
  readonly label: string | null;
  readonly keyOverride: string | null;
  /** What the press costs, shown over the pill wherever the pill ends up; null for a free press. */
  readonly requirements: readonly Requirement[] | null;
  /** Who raised it, through {@link raisePromptsFor}; null for a prompt raised outside one. */
  readonly owner: PromptOwner | null;
  /** Canvas distance from the steering crawler to the prompted object's foot, for ranking it. */
  readonly focusDistance: number;
}

/**
 * Something drawn taller than its tile that a prompt can float over — a
 * character, a citizen, a villager. Its tile is `TILE_SIZE` square with its
 * top-left at (`x`, `y`) in world pixels.
 */
export interface PromptFigure {
  readonly x: number;
  readonly y: number;
  /**
   * The screen y that anything hung over this figure must stay above, for a
   * figure whose tile top is at screen `sy`: the top of its art, or of
   * whatever it already wears over its head.
   */
  overheadTop(ctx: CanvasRenderingContext2D, sy: number): number;
}

/** A box in canvas pixels that no prompt may be drawn across. */
export interface PromptKeepClear {
  readonly canvasLeft: number;
  readonly canvasRight: number;
  readonly canvasTop: number;
  readonly canvasBottom: number;
}

const queue: QueuedPrompt[] = [];
const keepClear: PromptKeepClear[] = [];
/** Every box ever handed out, reused frame to frame so keeping clear allocates nothing. */
const keepClearPool: Array<{ -readonly [K in keyof PromptKeepClear]: PromptKeepClear[K] }> = [];
let promptsSuppressed = false;
let stance: InteractionStance = 'clear';
let promptsDrawnThisFrame = 0;
let raisingFor: PromptOwner | null = null;
let focusOrigin: { x: number; y: number } | null = null;
let shownOwner: PromptOwner | null = null;

/**
 * Silences every floating prompt for the frame.
 *
 * Prompts are drawn from two dozen systems that each know only about their own
 * object, so none of them can tell whether a dialog is already covering the
 * screen — and a per-system list of dialog flags goes stale the moment a new
 * dialog system is added. A scene instead answers the question once per frame
 * from its `UiRoot`'s surface stack, in one call for every prompt.
 *
 * `frameStance` is the fight around the steering crawler this frame: a prompt
 * for something it keeps a press from reaching is never raised, so the prompt
 * on screen always names what the press does.
 *
 * Call it at the top of every scene render that draws prompts: the flag is
 * module state, so a scene that never sets it inherits the last scene's answer.
 * It also drops anything still queued, so a scene without the prompt surface
 * mounted never accumulates prompts.
 */
export function setInteractionPromptsSuppressed(
  suppressed: boolean,
  frameStance: InteractionStance,
): void {
  promptsSuppressed = suppressed;
  stance = frameStance;
  promptsDrawnThisFrame = 0;
  queue.length = 0;
  keepClear.length = 0;
  focusOrigin = null;
  shownOwner = null;
}

/**
 * Sets where the crawler the player is steering stands this frame, so the
 * prompts in reach can be ranked by how near they are. `sx`, `sy` are the
 * centre of the crawler's tile in `ctx`'s current space.
 *
 * Call it once per frame after {@link setInteractionPromptsSuppressed} and
 * before any prompt is raised.
 */
export function anchorInteractionFocus(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
): void {
  const m = ctx.getTransform();
  focusOrigin = { x: m.a * sx + m.c * sy + m.e, y: m.b * sx + m.d * sy + m.f };
}

/**
 * Raises whatever prompts `raise` raises on behalf of `owner`, so the prompt
 * surface can rank them and the scene's next press can go to whichever one
 * was shown. Returns what `raise` returns.
 */
export function raisePromptsFor<T>(owner: PromptOwner, raise: () => T): T {
  const outer = raisingFor;
  raisingFor = owner;
  try {
    return raise();
  } finally {
    raisingFor = outer;
  }
}

/**
 * Hands an interact press to whatever the one interact prompt on screen
 * names, when `owners` — the scene's own — raised it and `pressStance`, the
 * fight as the press lands, still lets a press reach it. Returns whether it
 * took the press. A scene calls this ahead of the rest of its interact chain,
 * so the press always reaches the thing the prompt named; owners from another
 * scene are ignored, since the prompt last shown may be from the scene this
 * one replaced.
 */
export function pressFocusedPrompt(
  owners: Readonly<Record<string, PromptOwner>>,
  pressStance: InteractionStance,
): boolean {
  const owner = shownOwner;
  if (owner === null || !Object.values(owners).includes(owner)) return false;
  return stanceAllows(pressStance, owner.kind) && owner.act();
}

/** The owner of the interact prompt the prompt surface last showed; null when it showed none. */
export function shownPromptOwner(): PromptOwner | null {
  return shownOwner;
}

/**
 * Keeps every prompt this frame off a crawler: a tile-wide box from `top`,
 * the highest thing over their head, down to `bottom`, their tile's foot. A
 * prompt hangs over the thing it names, and the crawler the player is
 * steering is always standing right beside that thing, with the companion
 * often close behind, so a prompt over anything shorter than them would
 * otherwise sit across a head. A prompt that would overlap one is raised
 * clear of it instead.
 *
 * Call it for each crawler once per frame after
 * {@link setInteractionPromptsSuppressed}, with `ctx` in the same space the
 * world is drawn in.
 */
export function keepInteractionPromptsClearOf(
  ctx: CanvasRenderingContext2D,
  sx: number,
  top: number,
  bottom: number,
): void {
  const m = ctx.getTransform();
  const leftX = m.a * sx + m.c * top + m.e;
  const rightX = m.a * (sx + TILE_SIZE) + m.c * top + m.e;
  const topY = m.b * sx + m.d * top + m.f;
  const bottomY = m.b * sx + m.d * bottom + m.f;
  const index = keepClear.length;
  const box = keepClearPool[index] ?? {
    canvasLeft: 0,
    canvasRight: 0,
    canvasTop: 0,
    canvasBottom: 0,
  };
  keepClearPool[index] = box;
  box.canvasLeft = Math.min(leftX, rightX);
  box.canvasRight = Math.max(leftX, rightX);
  box.canvasTop = Math.min(topY, bottomY);
  box.canvasBottom = Math.max(topY, bottomY);
  keepClear.push(box);
}

/** The boxes set by {@link keepInteractionPromptsClearOf} this frame. */
export function promptKeepClear(): readonly PromptKeepClear[] {
  return keepClear;
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
 * Raises a floating interaction prompt over a figure that stands taller than
 * its tile, clear of the top of its art rather than of its tile.
 */
export function drawInteractionPromptOver(
  ctx: CanvasRenderingContext2D,
  figure: PromptFigure,
  camX: number,
  camY: number,
  label?: string,
  keyOverride?: string,
): void {
  const sy = figure.y - camY;
  const artTop = figure.overheadTop(ctx, sy);
  queuePrompt(ctx, figure.x - camX, artTop, TILE_SIZE, sy + TILE_SIZE, label, keyOverride, null);
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
 * A figure goes through {@link drawInteractionPromptOver} instead, which
 * knows how tall it is drawn.
 *
 * @param ctx      Canvas context the object is being drawn with
 * @param sx       X of the object's left edge in `ctx`'s current space
 * @param artTop   Y of the highest pixel the object draws, in `ctx`'s current
 *                 space — its tile's top only when it is drawn no taller than its tile
 * @param objW     Width of the object in that space (the prompt is centred above it)
 * @param objBottom  Y of the bottom of the object's footprint in that space: the
 *                 pill is never moved down onto anything between it and `artTop`
 * @param label    Optional action label shown beside the key, e.g. "Talk"
 * @param keyOverride  Optional key text override (default: the attack key, or "TAP" on touch)
 */
export function drawInteractionPrompt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  artTop: number,
  objW: number,
  objBottom: number,
  label?: string,
  keyOverride?: string,
): void {
  queuePrompt(ctx, sx, artTop, objW, objBottom, label, keyOverride, null);
}

/**
 * {@link drawInteractionPrompt} for a press that costs something: the
 * prompt surface sets `requirements` as a checklist over the pill, wherever
 * the pill itself ends up.
 */
export function drawInteractionPromptWithCost(
  ctx: CanvasRenderingContext2D,
  sx: number,
  artTop: number,
  objW: number,
  objBottom: number,
  label: string,
  requirements: readonly Requirement[],
): void {
  queuePrompt(ctx, sx, artTop, objW, objBottom, label, undefined, requirements);
}

function queuePrompt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  artTop: number,
  objW: number,
  objBottom: number,
  label: string | undefined,
  keyOverride: string | undefined,
  requirements: readonly Requirement[] | null,
): void {
  if (promptsSuppressed) return;
  const interactKey = keyOverride === undefined;
  if (interactKey && !stanceAllows(stance, raisedKind(raisingFor))) return;
  promptsDrawnThisFrame++;
  const anchorX = sx + objW / 2;
  const m = ctx.getTransform();
  const footX = m.a * anchorX + m.c * objBottom + m.e;
  const footY = m.b * anchorX + m.d * objBottom + m.f;
  queue.push({
    canvasX: m.a * anchorX + m.c * artTop + m.e,
    canvasY: m.b * anchorX + m.d * artTop + m.f,
    canvasBottom: footY,
    label: label === undefined || label === '' ? null : label,
    keyOverride: keyOverride ?? null,
    requirements,
    owner: raisingFor,
    focusDistance:
      focusOrigin === null ? 0 : Math.hypot(footX - focusOrigin.x, footY - focusOrigin.y),
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
 * Hands `draw` the prompts to show and empties the queue: of every prompt for
 * the interact key, only the one {@link chooseFocus} ranks first, so the
 * player is never offered several presses when a press reaches one; a prompt
 * for some other key names a different press and is always shown.
 */
export function drainQueuedPrompts(draw: (prompt: QueuedPrompt) => void): void {
  const interactPrompts = queue.filter((prompt) => prompt.keyOverride === null);
  const focusIndex = chooseFocus(interactPrompts.map(focusCandidate), stance);
  const focus: QueuedPrompt | null = focusIndex < 0 ? null : interactPrompts[focusIndex];
  shownOwner = focus === null ? null : focus.owner;
  for (const prompt of queue) {
    if (prompt.keyOverride === null && prompt !== focus) continue;
    draw(prompt);
  }
  queue.length = 0;
}

/** A prompt raised outside any owner ranks, and is held back, as an unnamed thing. */
function raisedKind(owner: PromptOwner | null): InteractableKind {
  return owner?.kind ?? 'other';
}

function focusCandidate(prompt: QueuedPrompt): FocusCandidate {
  return { kind: raisedKind(prompt.owner), distance: prompt.focusDistance };
}
