/**
 * The floor-cleared card: fireworks over a darkened world, "LEVEL COMPLETE!",
 * the floor's name, and — once the celebration has had a moment — the button
 * that takes the party down to the next floor.
 *
 * The timeline advances one step per render frame, because the card owns the
 * screen and the world beneath it is halted.
 *
 * - Band `modal`; halts the world. It does not lock the keyboard on its own
 *   account (halting already keeps every key from gameplay).
 * - Escape is blocked: the only way on is the button.
 * - The button appears `BUTTON_APPEAR_FRAMES` in and fades in; a press before
 *   then, on it or anywhere, does nothing. Enter or Space presses it once it
 *   is up (it is the primary control).
 */

import { splitV, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { button, buttonHeight } from '../../widgets/button';
import { panel, panelBodyWidth } from '../../widgets/panel';
import { lineHeightOf, text } from '../../widgets/text';
import {
  clamp01,
  drawBackdrop,
  drawDivider,
  drawRuneCorners,
  glowText,
  headlineStyle,
  seconds,
  sparkleColors,
  Sparkles,
} from './endScreenParts';

const HEADLINE = 'LEVEL COMPLETE!';
const CAPTION = 'Floor cleared — progress saved.';
const CONTINUE_LABEL = 'Continue';

const FADE_IN_FRAMES = 45;
const BUTTON_APPEAR_FRAMES = 90;
const BUTTON_FADE_FRAMES = 18;
/** The panel is not drawn at all until the backdrop has come this far in. */
const PANEL_ALPHA_THRESHOLD = 0.2;
const OVERLAY_ALPHA = 0.8;

const FIRST_BURST_COUNT = 40;
const EARLY_BURST_INTERVAL = 8;
const EARLY_BURST_COUNT = 10;
const EARLY_BURST_RING = { min: 40, range: 120 } as const;
const LATE_BURSTS_FROM_FRAME = 240;
const LATE_BURST_INTERVAL = 20;
const LATE_BURST_COUNT = 5;
const LATE_BURST_RING = { min: 60, range: 100 } as const;

const HEADLINE_PULSE_MIN = 0.97;
const HEADLINE_PULSE_RANGE = 0.03;
const HEADLINE_PULSE_FREQ = 2.4;
const HEADLINE_GLOW_ALPHA = 0.6;
const DIVIDER_ALPHA = 0.35;
const LEVEL_NAME_GLOW_ALPHA = 0.5;

/** The model the scene holds: raised with {@link activate}, drawn by {@link surface}. */
export class LevelCompleteScreen {
  private active = false;
  private frame = 0;
  private levelName = '';
  private nextLevelName: string | null = null;
  private onContinue: (() => void) | null = null;
  private readonly sparkles = new Sparkles();

  get isActive(): boolean {
    return this.active;
  }

  activate(levelName: string, nextLevelName: string | null, onContinue: () => void): void {
    this.active = true;
    this.frame = 0;
    this.sparkles.clear();
    this.levelName = levelName;
    this.nextLevelName = nextLevelName;
    this.onContinue = onContinue;
  }

  /** Leaves for the next floor, once the button is up. */
  continueOn(): void {
    if (!this.active || this.frame < BUTTON_APPEAR_FRAMES) return;
    this.active = false;
    this.onContinue?.();
  }

  private get buttonLabel(): string {
    return this.nextLevelName === null ? CONTINUE_LABEL : `Descend to ${this.nextLevelName}`;
  }

  private tickEffects(ui: Ui): void {
    const view = ui.viewport;
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const colors = sparkleColors(ui.theme);
    if (this.frame === 1) this.sparkles.burst(cx, cy, FIRST_BURST_COUNT, colors);
    if (this.frame < LATE_BURSTS_FROM_FRAME && this.frame % EARLY_BURST_INTERVAL === 0) {
      this.sparkles.burstAround(cx, cy, EARLY_BURST_RING, EARLY_BURST_COUNT, colors);
    }
    if (this.frame >= LATE_BURSTS_FROM_FRAME && this.frame % LATE_BURST_INTERVAL === 0) {
      this.sparkles.burstAround(cx, cy, LATE_BURST_RING, LATE_BURST_COUNT, colors);
    }
    this.sparkles.tick();
  }

  private render(ui: Ui): void {
    if (!this.active) return;
    this.frame++;
    this.tickEffects(ui);
    const { ctx, theme } = ui;
    const { palette, space } = theme;
    const now = seconds(ui);
    const alpha = clamp01(this.frame / FADE_IN_FRAMES);
    const buttonAlpha = clamp01((this.frame - BUTTON_APPEAR_FRAMES) / BUTTON_FADE_FRAMES);

    drawBackdrop(ui, alpha * OVERLAY_ALPHA);
    this.sparkles.draw(ctx, alpha, now);
    if (alpha < PANEL_ALPHA_THRESHOLD) return;

    const bodyW = panelBodyWidth(ui, 'sm');
    const headline = headlineStyle(ui, HEADLINE, bodyW);
    const titleH = lineHeightOf(ui, 'title');
    const captionH = lineHeightOf(ui, 'muted');
    const buttonH = buttonHeight(ui, 'lg');
    const tracks = [headline.lineHeight, titleH, space.md, captionH, buttonH];
    const contentHeight = tracks.reduce((sum, h) => sum + h, 0) + space.sm * (tracks.length - 1);
    const pulse = HEADLINE_PULSE_MIN + HEADLINE_PULSE_RANGE * Math.sin(now * HEADLINE_PULSE_FREQ);

    ctx.globalAlpha *= alpha;
    const p = panel(ui, {
      id: 'level-complete',
      width: 'sm',
      height: 'content',
      contentHeight,
      scrim: false,
      content: (body: Rect) => {
        const [headRow, nameRow, dividerRow, captionRow, buttonRow] = splitV(
          body,
          tracks,
          space.sm,
        );
        const headCx = headRow.x + headRow.w / 2;
        const headCy = headRow.y + headRow.h / 2;
        ctx.save();
        ctx.translate(headCx, headCy);
        ctx.scale(pulse, pulse);
        ctx.translate(-headCx, -headCy);
        glowText(ui, headRow, {
          text: HEADLINE,
          style: headline,
          color: palette.accent.base,
          glow: withAlpha(palette.accent.base, HEADLINE_GLOW_ALPHA),
          glowBlur: space.xl,
        });
        ctx.restore();
        glowText(ui, nameRow, {
          text: this.levelName,
          style: theme.type.title,
          color: palette.category.book,
          glow: withAlpha(palette.category.book, LEVEL_NAME_GLOW_ALPHA),
          glowBlur: space.md,
        });
        drawDivider(ui, dividerRow, withAlpha(palette.accent.base, DIVIDER_ALPHA), space.xxl);
        text(ui, captionRow, { text: CAPTION, role: 'muted', align: 'center' });
        if (buttonAlpha <= 0) return;
        ctx.save();
        ctx.globalAlpha *= buttonAlpha;
        button(ui, buttonRow, {
          id: 'continue',
          label: this.buttonLabel,
          variant: 'primary',
          size: 'lg',
          primary: true,
          onTap: () => this.continueOn(),
        });
        ctx.restore();
      },
    });
    drawRuneCorners(ctx, p.frame, palette.accent.base, now);
  }

  /** This card as a surface. */
  surface(opts: { readonly id?: string } = {}): Surface {
    return {
      id: opts.id ?? 'level-complete',
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: false,
      blocksEscape: true,
      isOpen: () => this.active,
      render: (ui) => this.render(ui),
    };
  }
}
