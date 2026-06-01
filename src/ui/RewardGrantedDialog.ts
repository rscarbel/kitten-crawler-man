import type { GrantedReward } from '../core/GrantedReward';
import type { AudioManager } from '../audio/AudioManager';
import { wrapTextLines, drawPowerUpIcon } from './canvasUtils';
import { drawText } from './TextBox';
import { drawOverlay, drawBox } from './Box';
import { drawButton, BUTTON_PRESETS } from './Button';

// Dialog box dimensions
const DIALOG_MAX_WIDTH = 320;
const DIALOG_PADDING_HORIZONTAL = 32;
const DIALOG_MIN_HEIGHT = 280;
const DIALOG_BASE_HEIGHT = 230;
const DIALOG_DESC_LINE_HEIGHT = 15;

// Dialog layout positions
const DIALOG_TITLE_Y_OFFSET = 17;
const DIALOG_ICON_Y = 48;
const DIALOG_NAME_Y_OFFSET = 28;
const DIALOG_NAME_SIZE = 14;
const DIALOG_NAME_Y_ADJUST = 13;
const DIALOG_DESC_Y_OFFSET = 16;
const DIALOG_DESC_X_INSET = 20;
const DIALOG_DESC_WIDTH_MARGIN = 40;
const DIALOG_DESC_SIZE = 11;
const DIALOG_DESC_Y_ADJUST = 11;

// Icon
const ICON_SIZE = 56;

// OK button
const OK_BUTTON_WIDTH = 100;
const OK_BUTTON_HEIGHT = 34;
const OK_BUTTON_Y_OFFSET = 50;

// Animation timing
const POWER_UP_FRAMES = 60;

type Phase = 'idle' | 'power_up' | 'done';

/**
 * Pausing overlay shown when the player is granted an ability or special unlock
 * (e.g. Mongo the velociraptor companion) after dismissing an award screen.
 *
 * Multiple rewards are queued and shown one after the other.
 *
 * DungeonScene should:
 *   1. Call enqueue(reward) when a rewardGranted bus event fires.
 *   2. Skip updateGameplay() while isShowing is true.
 *   3. Call update() and render() every frame regardless of pause state.
 *   4. Call handleClick(mx, my) in its click handler (returns true when consumed).
 */
export class RewardGrantedDialog {
  private queue: GrantedReward[] = [];
  private current: GrantedReward | null = null;
  private phase: Phase = 'idle';
  private frame = 0;
  private iconPulse = 0;
  private okBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private cachedDescLines: string[] | null = null;

  audio: AudioManager | null = null;

  /** Returns true while an announcement animation is visible (game should pause). */
  get isShowing(): boolean {
    return this.phase !== 'idle';
  }

  /** Push a new reward onto the queue. */
  enqueue(reward: GrantedReward): void {
    this.queue.push(reward);
    if (this.phase === 'idle') this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) {
      this.phase = 'idle';
      this.current = null;
      return;
    }
    this.current = next;
    this.phase = 'power_up';
    this.frame = 0;
    this.iconPulse = 0;
    this.cachedDescLines = null;
    this.audio?.play('ability_level_up');
  }

  update(): void {
    if (this.phase === 'idle') return;
    this.frame++;

    if (this.phase === 'power_up') {
      this.iconPulse = this.frame / POWER_UP_FRAMES;
      if (this.frame >= POWER_UP_FRAMES) {
        this.phase = 'done';
      }
    }
  }

  handleClick(mx: number, my: number): boolean {
    if (this.phase !== 'done') return this.isShowing;
    const { x, y, w, h } = this.okBtnRect;
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
      this.advance();
      return true;
    }
    return true;
  }

  handleSpaceBar(): boolean {
    if (!this.isShowing) return false;
    if (this.phase === 'done') this.advance();
    return true;
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.isShowing || !this.current) return;
    const current = this.current;

    const cw = canvas.width;
    const ch = canvas.height;

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: 0.72 });

    const boxW = Math.min(DIALOG_MAX_WIDTH, cw - DIALOG_PADDING_HORIZONTAL);
    if (this.cachedDescLines === null) {
      ctx.font = `${DIALOG_DESC_SIZE}px monospace`;
      this.cachedDescLines = wrapTextLines(
        ctx,
        current.description,
        boxW - DIALOG_DESC_WIDTH_MARGIN,
      );
    }
    const descLines = this.cachedDescLines;
    const boxH = Math.min(
      Math.max(DIALOG_MIN_HEIGHT, DIALOG_BASE_HEIGHT + descLines.length * DIALOG_DESC_LINE_HEIGHT),
      ch - DIALOG_PADDING_HORIZONTAL,
    );
    const bx = cw / 2 - boxW / 2;
    const by = ch / 2 - boxH / 2;

    drawBox(ctx, {
      x: bx,
      y: by,
      width: boxW,
      height: boxH,
      fill: '#0f172a',
      border: '#a855f7',
      borderWidth: 2.5,
    });

    // Title
    drawText(ctx, 'New Ability!', {
      x: bx + boxW / 2,
      y: by + DIALOG_TITLE_Y_OFFSET,
      size: 16,
      bold: true,
      color: '#e9d5ff',
      align: 'center',
    });

    // Icon with power-up animation
    const iconX = bx + boxW / 2 - ICON_SIZE / 2;
    const iconY = by + DIALOG_ICON_Y;
    drawPowerUpIcon(ctx, iconX, iconY, ICON_SIZE, this.iconPulse, this.phase === 'power_up', () => {
      current.renderIcon(ctx, iconX, iconY, ICON_SIZE);
    });

    // Reward name
    const nameY = iconY + ICON_SIZE + DIALOG_NAME_Y_OFFSET;
    drawText(ctx, current.name, {
      x: bx + boxW / 2,
      y: nameY - DIALOG_NAME_Y_ADJUST,
      size: DIALOG_NAME_SIZE,
      bold: true,
      color: '#e9d5ff',
      align: 'center',
    });

    // Description and OK button (shown after power-up completes)
    if (this.phase === 'done') {
      const descY = nameY + DIALOG_DESC_Y_OFFSET;
      drawText(ctx, current.description, {
        x: bx + DIALOG_DESC_X_INSET,
        y: descY - DIALOG_DESC_Y_ADJUST,
        size: DIALOG_DESC_SIZE,
        color: '#c4b5fd',
        align: 'center',
        width: boxW - DIALOG_DESC_WIDTH_MARGIN,
        lineHeight: DIALOG_DESC_LINE_HEIGHT,
      });

      const btnW = OK_BUTTON_WIDTH;
      const btnH = OK_BUTTON_HEIGHT;
      const btnX = bx + boxW / 2 - btnW / 2;
      const btnY = by + boxH - OK_BUTTON_Y_OFFSET;
      this.okBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };

      drawButton(ctx, {
        x: btnX,
        y: btnY,
        width: btnW,
        height: btnH,
        label: 'OK',
        ...BUTTON_PRESETS.purple,
        labelColor: '#ede9fe',
      });
    }
  }
}
