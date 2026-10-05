/**
 * The floating "SPACE — Talk" prompts, drawn as one world-band surface.
 *
 * Systems raise prompts mid world-render with `drawInteractionPrompt`, which
 * only queues them. This surface draws the queue once the world, its darkness
 * and its fog are down, so a prompt is never dimmed or painted out, and every
 * prompt shares the HUD's keycap and glass.
 */

import { keybindings } from '../../core/Keybindings';
import type { Rect } from '../core/geom';
import type { Surface, Ui } from '../core/UiRoot';
import {
  drainQueuedPrompts,
  hasQueuedPrompts,
  PROMPT_BOB_AMPLITUDE,
  PROMPT_BOB_PERIOD_MS,
  PROMPT_LIFT,
  promptPillHeight,
  type QueuedPrompt,
} from '../InteractionPrompt';
import { skinsFor } from '../theme/skins';
import { keycap, keycapSize } from '../widgets/keycap';
import { drawGlass } from '../widgets/paint';
import { measureText, text } from '../widgets/text';

export const PROMPT_SURFACE_ID = 'interaction-prompts';

const TOUCH_KEY_LABEL = 'TAP';

function defaultKeyLabel(ui: Ui): string {
  return ui.density === 'touch' ? TOUCH_KEY_LABEL : keybindings.labelFor('attack').toUpperCase();
}

function drawPrompt(ui: Ui, inverse: DOMMatrix, prompt: QueuedPrompt, bob: number): void {
  const { theme } = ui;
  const { space, radius } = theme;
  const anchorX = inverse.a * prompt.canvasX + inverse.c * prompt.canvasY + inverse.e;
  const anchorY = inverse.b * prompt.canvasX + inverse.d * prompt.canvasY + inverse.f;
  const keyLabel = prompt.keyOverride ?? defaultKeyLabel(ui);
  const key = keycapSize(ui, { label: keyLabel });
  const height = promptPillHeight(theme);
  const label = prompt.label;
  const labelWidth = label === null ? 0 : Math.ceil(measureText(ui, label, { role: 'label' }));
  const labelBlock = label === null ? 0 : space.sm + labelWidth + space.sm;
  const width = space.xs + key.w + (label === null ? space.xs : labelBlock);
  const pill: Rect = {
    x: Math.round(anchorX - width / 2),
    y: Math.round(anchorY - PROMPT_LIFT - height + bob),
    w: width,
    h: height,
  };
  drawGlass(ui, pill, skinsFor(theme).panel.hud, radius.pill);
  keycap(ui, { x: pill.x + space.xs, y: pill.y, w: key.w, h: pill.h }, { label: keyLabel });
  if (label === null) return;
  text(
    ui,
    { x: pill.x + space.xs + key.w + space.sm, y: pill.y, w: labelWidth, h: pill.h },
    { text: label, role: 'label' },
  );
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
      drainQueuedPrompts(ui.uiScale, ui.theme, (prompt) => {
        drawPrompt(ui, inverse, prompt, bob);
      });
    },
  };
}
