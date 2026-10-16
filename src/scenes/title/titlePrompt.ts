/**
 * The quiet line that explains the silence before the first gesture. It is a
 * hint, never a gate: it registers no region and takes no keys, so every press
 * still reaches the menu, and the gesture that unlocks audio is whatever the
 * browser accepts as one.
 */

import { byInputMode } from '../../ui/core/inputMode';
import type { Rect } from '../../ui/core/geom';
import type { Surface, Ui } from '../../ui/core/UiRoot';
import { skinsFor } from '../../ui/theme/skins';
import { text } from '../../ui/widgets/text';
import { stageRectInUi, type TitleStage } from './titleStage';

export const TITLE_PROMPT_SURFACE_ID = 'title-prompt';

const PROMPT_COPY = {
  touch: 'Tap anywhere for sound',
  pointer: 'Press any key for sound',
} as const;

/** One slow breath of the hint's brightness. */
const PULSE_PERIOD_MS = 2600;
/** The dimmest the hint fades to between breaths: still readable at its faintest. */
const PULSE_MIN_ALPHA = 0.6;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

export interface TitlePromptDeps {
  readonly showing: () => boolean;
  readonly stage: () => TitleStage;
  /** The menu's strip this frame, in UI units: held upright, the hint sits just above it. */
  readonly menuStrip: (ui: Ui) => Rect;
}

function pulseAlpha(nowMs: number): number {
  const wave = HALF + HALF * Math.sin((nowMs / PULSE_PERIOD_MS) * FULL_TURN);
  return PULSE_MIN_ALPHA + (1 - PULSE_MIN_ALPHA) * wave;
}

function promptRect(ui: Ui, deps: TitlePromptDeps, lineHeight: number): Rect {
  const stage = deps.stage();
  if (stage.composition !== 'portrait') return stageRectInUi(stage.promptRect, ui.uiScale);
  const strip = deps.menuStrip(ui);
  return { x: strip.x, y: strip.y - ui.theme.space.sm - lineHeight, w: strip.w, h: lineHeight };
}

export function titlePromptSurface(deps: TitlePromptDeps): Surface {
  return {
    id: TITLE_PROMPT_SURFACE_ID,
    band: 'hud',
    haltsWorld: false,
    isOpen: deps.showing,
    render: (ui) => {
      const { ctx } = ui;
      const skin = skinsFor(ui.theme).soundHint;
      ctx.save();
      ctx.globalAlpha *= pulseAlpha(ui.now);
      text(ui, promptRect(ui, deps, skin.text.style.lineHeight), {
        text: byInputMode(ui.density, PROMPT_COPY),
        style: skin.text.style,
        color: skin.text.color,
        halo: skin.halo,
        align: 'center',
      });
      ctx.restore();
    },
  };
}
