/**
 * The death screen: the world darkens, then "YOU DIED", where the party
 * will wake, what killed them, and the one button that wakes them.
 *
 * The darkening runs on {@link DeathScreen}'s own fade, one step per render
 * frame. The text fades in only once the backdrop is dark enough to hold it,
 * and the button accepts a press only once the model calls the screen
 * visible, so a press already on its way when the party fell cannot respawn
 * them before they have seen why they died.
 *
 * - Band `modal`; halts the world and locks the keyboard.
 * - Escape is blocked: the only way on is the button.
 * - Enter or Space presses the button (it is the primary control) once it
 *   shows; a key already held when the screen appeared does nothing.
 * - A tap anywhere but the button does nothing.
 */

import type { DeathScreen, RespawnMode } from '../../DeathScreen';
import { splitV, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import {
  panel,
  panelChromeHeight,
  type FooterButton,
  type PanelOptions,
} from '../../widgets/panel';
import { measureTextHeight, text } from '../../widgets/text';
import { drawBackdrop, fitPanelBody, glowText, headlineStyle } from './endScreenParts';

const HEADLINE = 'YOU DIED';

const RESPAWN_BUTTON_LABEL: Readonly<Record<RespawnMode, string>> = {
  floorRestart: 'Restart Level',
  checkpoint: 'Return to Checkpoint',
};

const RESPAWN_SUBTITLE: Readonly<Record<RespawnMode, string>> = {
  floorRestart: 'Respawning at floor start — progress from previous floors kept.',
  checkpoint: 'Respawning where you last saved — the floor rewinds to how you left it.',
};

const HEADLINE_GLOW_ALPHA = 0.55;
const VIGNETTE_ALPHA = 0.28;
/** Where the red vignette starts to show, as a fraction of the screen's half-diagonal. */
const VIGNETTE_INNER_FRACTION = 0.35;

export interface DeathScreenSurfaceOptions {
  readonly id?: string;
  /** Whether the scene is in its game-over state. */
  readonly isOpen: () => boolean;
  /** What the scene does when the button is pressed. */
  readonly onRespawn: () => void;
}

interface DeathLayout {
  readonly tracks: readonly number[];
}

function layout(ui: Ui, model: DeathScreen, width: number): DeathLayout {
  const headline = headlineStyle(ui, HEADLINE, width).lineHeight;
  const explanation = model.explanation;
  const tracks = [
    headline,
    measureTextHeight(ui, width, { text: RESPAWN_SUBTITLE[model.respawnMode], role: 'muted' }),
  ];
  if (explanation.length > 0) {
    tracks.push(measureTextHeight(ui, width, { text: explanation, role: 'body' }));
  }
  return { tracks };
}

function contentHeight(ui: Ui, tracks: readonly number[]): number {
  return tracks.reduce((sum, h) => sum + h, 0) + ui.theme.space.md * (tracks.length - 1);
}

function drawVignette(ui: Ui, alpha: number): void {
  const { ctx, screen } = ui;
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2;
  const outer = Math.hypot(screen.w, screen.h) / 2;
  const danger = ui.theme.palette.state.danger;
  const gradient = ctx.createRadialGradient(cx, cy, outer * VIGNETTE_INNER_FRACTION, cx, cy, outer);
  gradient.addColorStop(0, withAlpha(danger, 0));
  gradient.addColorStop(1, withAlpha(danger, VIGNETTE_ALPHA * alpha));
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  ctx.restore();
}

function render(
  ui: Ui,
  model: DeathScreen,
  opts: DeathScreenSurfaceOptions,
  panelId: string,
): void {
  if (!model.isActive) return;
  model.tick();
  drawBackdrop(ui, model.fadeAlpha);
  const contentAlpha = model.contentAlpha;
  if (contentAlpha <= 0) return;
  drawVignette(ui, contentAlpha);

  const { ctx, theme } = ui;
  const { palette, space } = theme;
  const ready = model.isVisible;
  const footer: FooterButton[] = [
    {
      id: 'respawn',
      label: RESPAWN_BUTTON_LABEL[model.respawnMode],
      variant: 'danger',
      primary: true,
      onTap: () => {
        if (model.isVisible) opts.onRespawn();
      },
    },
  ];
  const panelOpts: Pick<PanelOptions, 'width' | 'footer' | 'footerSize'> = {
    width: 'sm',
    footer,
    footerSize: 'lg',
  };
  const fit = fitPanelBody(ui, panelOpts, (width) =>
    contentHeight(ui, layout(ui, model, width).tracks),
  );

  // Until the button answers it is left out rather than disabled, so a press during the fade is not refused
  // with the error cue; its slot stays reserved so the card does not jump when it appears.
  const footerSlot = panelChromeHeight(ui, panelOpts) - panelChromeHeight(ui, {});
  ctx.globalAlpha *= contentAlpha;
  panel(ui, {
    ...panelOpts,
    footer: ready ? footer : [],
    id: panelId,
    height: 'content',
    contentHeight: ready ? fit.contentHeight : fit.contentHeight + footerSlot,
    footerLayout: 'fill',
    scrim: false,
    scrollBody: fit.scroll,
    content: (body: Rect) => {
      const { tracks } = layout(ui, model, body.w);
      const rows = splitV(body, tracks, space.md);
      let index = 0;
      const next = (): Rect => rows[index++] ?? { ...body, h: 0 };
      glowText(ui, next(), {
        text: HEADLINE,
        style: headlineStyle(ui, HEADLINE, body.w),
        color: palette.state.danger,
        glow: withAlpha(palette.state.danger, HEADLINE_GLOW_ALPHA),
        glowBlur: space.lg,
      });
      // Where the party wakes goes above the flavour text, so a long explanation scrolling on a short screen never hides it.
      text(ui, next(), {
        text: RESPAWN_SUBTITLE[model.respawnMode],
        role: 'muted',
        align: 'center',
        wrap: true,
      });
      if (model.explanation.length > 0) {
        text(ui, next(), { text: model.explanation, role: 'body', align: 'center', wrap: true });
      }
    },
  });
}

/** The death screen over `model`, which the scene raises with `activate` and clears with `reset`. */
export function deathScreenSurface(model: DeathScreen, opts: DeathScreenSurfaceOptions): Surface {
  const id = opts.id ?? 'death-screen';
  return {
    id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    blocksEscape: true,
    isOpen: () => opts.isOpen(),
    render: (ui) => render(ui, model, opts, 'death'),
  };
}
