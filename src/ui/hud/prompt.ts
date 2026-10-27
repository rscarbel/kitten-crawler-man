/**
 * The floating "SPACE — Talk" prompts, drawn as one world-band surface.
 *
 * Systems raise prompts mid world-render with `drawInteractionPrompt`, which
 * only queues them. This surface draws the queue once the world, its darkness
 * and its fog are down, so a prompt is never dimmed or painted out, and every
 * prompt shares the HUD's keycap and glass.
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

/**
 * The pill's top: `PROMPT_LIFT` over its anchor, raised further while it or
 * its caption would cross any `keepClear` box. A lift that would carry it off
 * the top of the screen — where a prompt promises nothing — is lowered back
 * on, then dropped below any box it lands across; a drop that would land on
 * the prompted object itself or off the bottom of the screen is abandoned,
 * and the pill keeps the clamped height across the crawler instead.
 */
function pillTop(
  ui: Ui,
  inverse: DOMMatrix,
  anchorY: number,
  targetBottomY: number,
  block: PillBlock,
  bob: number,
  keepClear: readonly PromptKeepClear[],
): number {
  const gap = ui.theme.space.xs + PROMPT_BOB_AMPLITUDE;
  let top = anchorY - PROMPT_LIFT - block.height;
  // Moving clear of one box can carry the pill into another, so the boxes are
  // swept until a whole pass leaves it where it is; each sweep moves one way only.
  for (let pass = 0; pass <= keepClear.length; pass++) {
    let moved = false;
    for (const box of keepClear) {
      if (!crossesBox(inverse, box, top, block)) continue;
      const clearedTop = boxTopInUi(inverse, box) - gap - block.height;
      if (clearedTop < top) {
        top = clearedTop;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const clampedTop = ui.viewport.y + gap + block.above;
  if (top >= clampedTop) return top + bob;
  top = clampedTop;
  for (let pass = 0; pass <= keepClear.length; pass++) {
    let moved = false;
    for (const box of keepClear) {
      if (!crossesBox(inverse, box, top, block)) continue;
      const belowTop = boxBottomInUi(inverse, box) + gap + block.above;
      if (belowTop > top) {
        top = belowTop;
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (top === clampedTop) return top + bob;
  const droppedBlockTop = top - block.above - PROMPT_BOB_AMPLITUDE;
  const droppedBottom = top + block.height + PROMPT_BOB_AMPLITUDE;
  const landsOnTarget = droppedBlockTop < targetBottomY && droppedBottom > anchorY;
  const leavesScreen = droppedBottom > ui.viewport.y + ui.viewport.h;
  return (landsOnTarget || leavesScreen ? clampedTop : top) + bob;
}

function boxTopInUi(inverse: DOMMatrix, box: PromptKeepClear): number {
  const topY = inverse.b * box.canvasLeft + inverse.d * box.canvasTop + inverse.f;
  const bottomY = inverse.b * box.canvasLeft + inverse.d * box.canvasBottom + inverse.f;
  return Math.min(topY, bottomY);
}

function boxBottomInUi(inverse: DOMMatrix, box: PromptKeepClear): number {
  const topY = inverse.b * box.canvasLeft + inverse.d * box.canvasTop + inverse.f;
  const bottomY = inverse.b * box.canvasLeft + inverse.d * box.canvasBottom + inverse.f;
  return Math.max(topY, bottomY);
}

/** Whether the pill with its top at `top` and its caption, bobbing either way, cross `box`. */
function crossesBox(
  inverse: DOMMatrix,
  box: PromptKeepClear,
  top: number,
  block: PillBlock,
): boolean {
  const clearLeft = inverse.a * box.canvasLeft + inverse.c * box.canvasTop + inverse.e;
  const clearRight = inverse.a * box.canvasRight + inverse.c * box.canvasTop + inverse.e;
  const overlapsAcross =
    block.left < Math.max(clearLeft, clearRight) &&
    block.left + block.width > Math.min(clearLeft, clearRight);
  const highestBobbedTop = top - block.above - PROMPT_BOB_AMPLITUDE;
  const lowestBobbedBottom = top + block.height + PROMPT_BOB_AMPLITUDE;
  const overlapsDown =
    highestBobbedTop < boxBottomInUi(inverse, box) && lowestBobbedBottom > boxTopInUi(inverse, box);
  return overlapsAcross && overlapsDown;
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
  keepClear: readonly PromptKeepClear[],
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
  const pillLeft = Math.round(anchorX - width / 2);
  const blockWidth = Math.max(width, captionW);
  const block: PillBlock = { left: anchorX - blockWidth / 2, width: blockWidth, height, above };
  const pill: Rect = {
    x: pillLeft,
    y: Math.round(pillTop(ui, inverse, anchorY, targetBottomY, block, bob, keepClear)),
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
    drawCaption(ui, requirements, anchorX, captionW, pill.y - space.xs, captionHeight);
  }
}

/**
 * The surface that draws every prompt queued this frame. Open while the queue
 * holds anything; it registers no hit regions, so the world keeps every press.
 * Mount it in each scene that raises prompts, and raise them before `ui.frame`.
 */
export function promptSurface(): Surface {
  return {
    id: PROMPT_SURFACE_ID,
    band: 'world',
    haltsWorld: false,
    isOpen: hasQueuedPrompts,
    render(ui: Ui): void {
      const inverse = ui.ctx.getTransform().inverse();
      const bob = Math.sin(ui.now / PROMPT_BOB_PERIOD_MS) * PROMPT_BOB_AMPLITUDE;
      const keepClear = promptKeepClear();
      drainQueuedPrompts((prompt) => {
        drawPrompt(ui, inverse, prompt, bob, keepClear);
      });
    },
  };
}
