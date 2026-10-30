/**
 * The floating "SPACE — Talk" prompts, drawn as one world-band surface.
 *
 * Systems raise prompts mid world-render with `drawInteractionPrompt`, which
 * only queues them. This surface draws the queue once the world, its darkness
 * and its fog are down, so a prompt is never dimmed or painted out, and every
 * prompt shares the HUD's keycap and glass.
 *
 * The HUD draws over this band, so a prompt never sits under its chrome: a
 * pill that would reach under a top-band card, the unit frames, the minimap
 * or a dock button is set down just below it, slid sideways out of its
 * column, or hung under its object instead (`placePromptPill`).
 */

import { keybindings } from '../../core/input/Keybindings';
import type { Rect } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import {
  drainQueuedPrompts,
  hasQueuedPrompts,
  PROMPT_BOB_AMPLITUDE,
  PROMPT_BOB_PERIOD_MS,
  PROMPT_LIFT,
  promptKeepClear,
  promptPillHeight,
  type PromptKeepClear,
  type QueuedPrompt,
} from '../InteractionPrompt';
import { isRequirementMet, requirementEntryText, type Requirement } from '../RequirementRow';
import { skinsFor } from '../theme/skins';
import { keycap, keycapSize } from '../widgets/keycap';
import { drawGlass } from '../widgets/paint';
import { measureText, text } from '../widgets/text';

export const PROMPT_SURFACE_ID = 'interaction-prompts';

const TOUCH_KEY_LABEL = 'TAP';

/** A cost checklist's entries share the pill label's type; only their colour changes. */
const CAPTION_TEXT = { role: 'label' } as const;

function defaultKeyLabel(ui: Ui): string {
  return ui.density === 'touch' ? TOUCH_KEY_LABEL : keybindings.labelFor('attack').toUpperCase();
}

/** The pill's horizontal span and height, and how much stands stacked over it (its cost caption). */
interface PillBlock {
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly above: number;
}

/** Everything a pill's placement answers to, in UI units. */
interface PromptPlacementInput {
  readonly viewport: Rect;
  /** The clear space kept between the bobbing pill and the edges and boxes it stays off. */
  readonly margin: number;
  /** The pill as it would stand centred on its anchor. */
  readonly block: PillBlock;
  /** The top of the prompted object's art, which the pill rests `PROMPT_LIFT` above. */
  readonly targetTop: number;
  /** The bottom of the prompted object, which the pill may never be moved onto. */
  readonly targetBottom: number;
  /** Boxes the pill should not cross: figures already standing there. */
  readonly keepClear: readonly Rect[];
  /** The HUD's chrome, which draws over the world band and so over any pill under it. */
  readonly hudKeepOuts: readonly Rect[];
}

/** Where the pill block's left edge and the pill's top stand at rest, before the bob. */
interface PromptPlacement {
  readonly left: number;
  readonly top: number;
}

/**
 * Edges computed as one box's edge plus a gap and compared with that box
 * again can differ in the last bits; a box this close counts as touching.
 */
const TOUCH_TOLERANCE = 1e-6;

/** The pill and its caption with the pill's rest top at `top`, over the whole height they bob through. */
function footprint(block: PillBlock, left: number, top: number): Rect {
  return {
    x: left,
    y: top - block.above - PROMPT_BOB_AMPLITUDE,
    w: block.width,
    h: block.above + block.height + PROMPT_BOB_AMPLITUDE * 2,
  };
}

/**
 * Whether `rect` stands across the footprint's column and within `margin` of
 * it up or down. Only a box sharing the column counts: chrome beside the pill
 * never moves it.
 */
function crowds(foot: Rect, rect: Rect, margin: number): boolean {
  const reach = margin - TOUCH_TOLERANCE;
  const across =
    foot.x < rect.x + rect.w - TOUCH_TOLERANCE && foot.x + foot.w > rect.x + TOUCH_TOLERANCE;
  const down = foot.y - reach < rect.y + rect.h && foot.y + foot.h + reach > rect.y;
  return across && down;
}

/** The rest top that puts the footprint's top `margin` below `rect`. */
function topBelow(input: PromptPlacementInput, rect: Rect): number {
  return rect.y + rect.h + input.margin + input.block.above + PROMPT_BOB_AMPLITUDE;
}

/** The rest top that puts the footprint's bottom `margin` above `rect`. */
function topAbove(input: PromptPlacementInput, rect: Rect): number {
  return rect.y - input.margin - PROMPT_BOB_AMPLITUDE - input.block.height;
}

/**
 * Moves the pill's top one way only, past every box in `boxes` that crowds it
 * in its column, until a sweep moves it no further: clearing one box can bring
 * it onto another.
 */
function sweepTop(
  input: PromptPlacementInput,
  left: number,
  start: number,
  boxes: readonly Rect[],
  way: 'up' | 'down',
): number {
  let top = start;
  for (let pass = 0; pass <= boxes.length; pass++) {
    let moved = false;
    for (const box of boxes) {
      if (!crowds(footprint(input.block, left, top), box, input.margin)) continue;
      top =
        way === 'up' ? Math.min(top, topAbove(input, box)) : Math.max(top, topBelow(input, box));
      moved = true;
    }
    if (!moved) break;
  }
  return top;
}

/**
 * Whether the pill at `left`, `top` holds every rule at once: wholly on
 * screen, off the prompted object's rows, under none of the HUD's chrome and
 * across none of `keepClear`.
 */
function fits(
  input: PromptPlacementInput,
  keepClear: readonly Rect[],
  left: number,
  top: number,
): boolean {
  const { viewport, margin } = input;
  const foot = footprint(input.block, left, top);
  const onScreen =
    foot.x >= viewport.x - TOUCH_TOLERANCE &&
    foot.x + foot.w <= viewport.x + viewport.w + TOUCH_TOLERANCE &&
    foot.y - margin >= viewport.y - TOUCH_TOLERANCE &&
    foot.y + foot.h <= viewport.y + viewport.h + TOUCH_TOLERANCE;
  const offTarget =
    foot.y + foot.h <= input.targetTop + TOUCH_TOLERANCE ||
    foot.y >= input.targetBottom - TOUCH_TOLERANCE;
  const clear = (box: Rect): boolean => !crowds(foot, box, margin);
  return onScreen && offTarget && input.hudKeepOuts.every(clear) && keepClear.every(clear);
}

/**
 * The nearest left edge, sliding the pill sideways from `origin`, at which it
 * fits with its top found by `topAt` for that column, or null where neither
 * way finds one on screen.
 */
function nearestSideways(
  input: PromptPlacementInput,
  keepClear: readonly Rect[],
  origin: number,
  topAt: (left: number) => number,
): number | null {
  const { block, margin } = input;
  const obstacles = [...input.hudKeepOuts, ...keepClear];
  const found: number[] = [];
  for (const way of ['left', 'right'] as const) {
    let left = origin;
    for (let step = 0; step <= obstacles.length; step++) {
      const foot = footprint(block, left, topAt(left));
      const blockers = obstacles.filter((box) => crowds(foot, box, margin));
      if (blockers.length === 0) break;
      left =
        way === 'left'
          ? Math.min(...blockers.map((box) => box.x - margin - block.width))
          : Math.max(...blockers.map((box) => box.x + box.w + margin));
    }
    if (fits(input, keepClear, left, topAt(left))) found.push(left);
  }
  if (found.length === 0) return null;
  return found.reduce((best, left) =>
    Math.abs(left - origin) < Math.abs(best - origin) ? left : best,
  );
}

/**
 * The first placement, in order of preference, that holds every rule with
 * `keepClear` as the boxes to stay off: resting over the object; set down
 * just under chrome it would reach up under, as long as it still clears the
 * object's top; slid sideways out of the chrome's column; then under the
 * object, where it stands or slid sideways; and last, under the object and
 * every piece of chrome below it in its column, for an object wedged between
 * chrome on both sides. Null when none holds.
 */
function firstFit(
  input: PromptPlacementInput,
  keepClear: readonly Rect[],
  origin: number,
): PromptPlacement | null {
  const { block, viewport } = input;
  const screenTop = viewport.y + input.margin + block.above + PROMPT_BOB_AMPLITUDE;
  const restingTop = input.targetTop - PROMPT_LIFT - block.height;
  const overTarget = (left: number): number => sweepTop(input, left, restingTop, keepClear, 'up');
  const restingUnderTop = input.targetBottom + input.margin + block.above + PROMPT_BOB_AMPLITUDE;
  const underTarget = (left: number): number =>
    sweepTop(input, left, restingUnderTop, keepClear, 'down');

  const lifted = overTarget(origin);
  if (fits(input, keepClear, origin, lifted)) return { left: origin, top: lifted };

  const settled = sweepTop(
    input,
    origin,
    Math.max(lifted, screenTop),
    [...input.hudKeepOuts, ...keepClear],
    'down',
  );
  const settledFoot = footprint(block, origin, settled);
  const settledClearsTargetTop = settledFoot.y + settledFoot.h <= input.targetTop + TOUCH_TOLERANCE;
  if (settledClearsTargetTop && fits(input, keepClear, origin, settled)) {
    return { left: origin, top: settled };
  }

  const sidewaysOver = nearestSideways(input, keepClear, origin, overTarget);
  if (sidewaysOver !== null) return { left: sidewaysOver, top: overTarget(sidewaysOver) };

  const dropped = underTarget(origin);
  if (fits(input, keepClear, origin, dropped)) return { left: origin, top: dropped };

  const sidewaysUnder = nearestSideways(input, keepClear, origin, underTarget);
  if (sidewaysUnder !== null) return { left: sidewaysUnder, top: underTarget(sidewaysUnder) };

  const sunk = sweepTop(input, origin, dropped, [...input.hudKeepOuts, ...keepClear], 'down');
  return fits(input, keepClear, origin, sunk) ? { left: origin, top: sunk } : null;
}

/**
 * Where a pill goes: never across its own object, never off screen, never
 * under the HUD's chrome, and across no `keepClear` box where it can help it.
 * The preferred spots are tried with every rule ({@link firstFit}), then again
 * letting the pill cross the boxes, then once more with no margin, so a pill
 * in a gap narrower than its margins sits flush beside the chrome rather than
 * under it; if even that fails, it rests over its object pulled onto the
 * screen. The pill is first pulled in from a screen
 * edge it would hang over.
 */
export function placePromptPill(input: PromptPlacementInput): PromptPlacement {
  const { block, viewport } = input;
  const rightmostLeft = viewport.x + viewport.w - block.width;
  const origin = Math.max(viewport.x, Math.min(block.left, rightmostLeft));
  const placed =
    firstFit(input, input.keepClear, origin) ??
    firstFit(input, [], origin) ??
    firstFit({ ...input, margin: 0 }, [], origin);
  if (placed !== null) return placed;
  const screenTop = viewport.y + input.margin + block.above + PROMPT_BOB_AMPLITUDE;
  const screenBottomTop = viewport.y + viewport.h - block.height - PROMPT_BOB_AMPLITUDE;
  const restingTop = input.targetTop - PROMPT_LIFT - block.height;
  return { left: origin, top: Math.max(screenTop, Math.min(restingTop, screenBottomTop)) };
}

/** A keep-clear box, given in canvas pixels, in UI units. */
function keepClearInUi(inverse: DOMMatrix, box: PromptKeepClear): Rect {
  const leftX = inverse.a * box.canvasLeft + inverse.c * box.canvasTop + inverse.e;
  const rightX = inverse.a * box.canvasRight + inverse.c * box.canvasTop + inverse.e;
  const topY = inverse.b * box.canvasLeft + inverse.d * box.canvasTop + inverse.f;
  const bottomY = inverse.b * box.canvasLeft + inverse.d * box.canvasBottom + inverse.f;
  const x = Math.min(leftX, rightX);
  const y = Math.min(topY, bottomY);
  return { x, y, w: Math.max(leftX, rightX) - x, h: Math.max(topY, bottomY) - y };
}

function requirementColor(ui: Ui, requirement: Requirement): string {
  const ink = ui.theme.palette.requirement;
  return isRequirementMet(requirement) ? ink.met : ink.short;
}

/** The checklist's width: every entry and the gaps between them. */
function captionWidth(ui: Ui, requirements: readonly Requirement[]): number {
  const { space } = ui.theme;
  let width = 0;
  requirements.forEach((requirement, index) => {
    if (index > 0) width += space.sm;
    width += Math.ceil(measureText(ui, requirementEntryText(requirement), CAPTION_TEXT));
  });
  return width;
}

/**
 * The cost checklist, bare over the world as the world-drawn checklist is,
 * `width` wide and centred on `centreX` with its bottom at `bottomY`.
 */
function drawCaption(
  ui: Ui,
  requirements: readonly Requirement[],
  centreX: number,
  width: number,
  bottomY: number,
  height: number,
): void {
  const { space, palette } = ui.theme;
  const top = bottomY - height;
  let x = Math.round(centreX - width / 2);
  for (const requirement of requirements) {
    const entry = requirementEntryText(requirement);
    const entryWidth = Math.ceil(measureText(ui, entry, CAPTION_TEXT));
    text(
      ui,
      { x, y: top, w: entryWidth, h: height },
      {
        ...CAPTION_TEXT,
        text: entry,
        color: requirementColor(ui, requirement),
        halo: palette.requirement.halo,
      },
    );
    x += entryWidth + space.sm;
  }
}

function drawPrompt(
  ui: Ui,
  inverse: DOMMatrix,
  prompt: QueuedPrompt,
  bob: number,
  keepClear: readonly Rect[],
  hudKeepOuts: readonly Rect[],
): void {
  const { theme } = ui;
  const { space, radius } = theme;
  const anchorX = inverse.a * prompt.canvasX + inverse.c * prompt.canvasY + inverse.e;
  const anchorY = inverse.b * prompt.canvasX + inverse.d * prompt.canvasY + inverse.f;
  const targetBottomY = inverse.b * prompt.canvasX + inverse.d * prompt.canvasBottom + inverse.f;
  const keyLabel = prompt.keyOverride ?? defaultKeyLabel(ui);
  const key = keycapSize(ui, { label: keyLabel });
  const height = promptPillHeight(theme);
  const label = prompt.label;
  const labelWidth = label === null ? 0 : Math.ceil(measureText(ui, label, { role: 'label' }));
  const labelBlock = label === null ? 0 : space.sm + labelWidth + space.sm;
  const width = space.xs + key.w + (label === null ? space.xs : labelBlock);
  const requirements = prompt.requirements;
  const captionHeight = theme.type.label.lineHeight;
  const captionW = requirements === null ? 0 : captionWidth(ui, requirements);
  const above = requirements === null ? 0 : captionHeight + space.xs;
  const blockWidth = Math.max(width, captionW);
  const block: PillBlock = { left: anchorX - blockWidth / 2, width: blockWidth, height, above };
  const placement = placePromptPill({
    viewport: ui.viewport,
    margin: space.xs,
    block,
    targetTop: anchorY,
    targetBottom: targetBottomY,
    keepClear,
    hudKeepOuts,
  });
  const centreX = anchorX + placement.left - block.left;
  const pill: Rect = {
    x: Math.round(centreX - width / 2),
    y: Math.round(placement.top + bob),
    w: width,
    h: height,
  };
  drawGlass(ui, pill, skinsFor(theme).panel.hud, radius.pill);
  keycap(ui, { x: pill.x + space.xs, y: pill.y, w: key.w, h: pill.h }, { label: keyLabel });
  if (label !== null) {
    text(
      ui,
      { x: pill.x + space.xs + key.w + space.sm, y: pill.y, w: labelWidth, h: pill.h },
      { text: label, role: 'label' },
    );
  }
  if (requirements !== null) {
    drawCaption(ui, requirements, centreX, captionW, pill.y - space.xs, captionHeight);
  }
}

/**
 * The surface that draws every prompt queued this frame. Open while the queue
 * holds anything; it registers no hit regions, so the world keeps every press.
 * Mount it in each scene that raises prompts, and raise them before `ui.frame`.
 * `hudKeepOuts` is the scene's HUD chrome as last drawn, in UI units
 * (`HudSurface.promptKeepOuts`), which no pill is drawn under.
 */
export function promptSurface(hudKeepOuts: () => readonly Rect[]): Surface {
  return {
    id: PROMPT_SURFACE_ID,
    band: 'world',
    haltsWorld: false,
    isOpen: hasQueuedPrompts,
    render(ui: Ui): void {
      const inverse = ui.ctx.getTransform().inverse();
      const bob = Math.sin(ui.now / PROMPT_BOB_PERIOD_MS) * PROMPT_BOB_AMPLITUDE;
      const keepClear = promptKeepClear().map((box) => keepClearInUi(inverse, box));
      const chrome = hudKeepOuts();
      drainQueuedPrompts((prompt) => {
        drawPrompt(ui, inverse, prompt, bob, keepClear, chrome);
      });
    },
  };
}
