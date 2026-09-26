/**
 * The one on-screen sign that game progress was written — a panel with a
 * floppy-disk icon and status text, shown over whatever scene triggered a
 * save. Distinct from `HotbarToast`: that one is a small outlined line for
 * mid-fight notices; this fires rarely, has to be unmissable, and needs a
 * backdrop opaque enough to read over any tile, wall or boss arena.
 *
 * `trigger()` restarts the animation rather than queuing a second run, so a
 * checkpoint and a safe-room save landing on the same frame still show one
 * banner, not two stacked.
 */

import { drawBox, BOX_PRESETS } from './Box';
import { drawText, TEXT_PRESETS } from './TextBox';
import { viewportWidth } from '../core/Viewport';
import { hotbarStripRect } from './InventoryPanel';

type Phase = 'idle' | 'saving' | 'saved';

/** "Saving..." holds for a beat before flipping to the confirmed state. */
const SAVING_PHASE_TICKS = 24;
/** "Game Saved" holds long enough to register at a glance, then fades. */
const SAVED_HOLD_TICKS = 84;
const FADE_IN_TICKS = 8;
const FADE_OUT_TICKS = 18;

const PANEL_WIDTH = 260;
const PANEL_HEIGHT = 64;
const PANEL_PADDING = 14;
/**
 * Gap between the banner's bottom edge and the hotbar strip's top edge —
 * the same anchor `HotbarToast` stacks its lines above and centres on, so the
 * two land in the same column. Sized to clear `HotbarToast` even at its
 * fullest: three stacked 17px rows, its own 13px font and its own 10px gap
 * above the strip reach 57px above the strip top, so this banner starts
 * comfortably above that reach rather than merging with it.
 */
const GAP_ABOVE_HOTBAR = 66;

const ICON_SIZE = 34;
const ICON_GAP = 14;
const STATUS_TEXT_SIZE = 18;
/** Half `STATUS_TEXT_SIZE` — centers the single status line on the icon's own middle. */
const STATUS_TEXT_VERTICAL_OFFSET = STATUS_TEXT_SIZE / 2;

const DISK_BODY_COLOR = '#e2e8f0';
const DISK_SHUTTER_COLOR = '#94a3b8';
const DISK_LABEL_COLOR = '#0f172a';
const CHECK_BADGE_COLOR = '#22c55e';
const CHECK_MARK_COLOR = '#052e16';

/** Every measurement below is a fraction of the icon's `size`, so the icon scales as one unit. */
const NOTCH_FRACTION = 0.28;
const SHUTTER_X_FRACTION = 0.22;
const SHUTTER_Y_FRACTION = 0.08;
const SHUTTER_WIDTH_FRACTION = 0.5;
const SHUTTER_HEIGHT_FRACTION = 0.32;
const PROTECT_NOTCH_X_FRACTION = 0.58;
const PROTECT_NOTCH_Y_FRACTION = 0.12;
const PROTECT_NOTCH_WIDTH_FRACTION = 0.08;
const HALF = 0.5;
const PROTECT_NOTCH_HEIGHT_FRACTION = SHUTTER_HEIGHT_FRACTION * HALF;
const LABEL_X_FRACTION = 0.1;
const LABEL_Y_FRACTION = 0.46;
const LABEL_WIDTH_FRACTION = 0.8;
const LABEL_HEIGHT_FRACTION = 0.44;

const CHECK_BADGE_RADIUS_FRACTION = 0.32;
const CHECK_BADGE_X_FRACTION = 0.86;
const CHECK_BADGE_Y_FRACTION = 0.86;
const CHECK_BADGE_RING_WIDTH_FRACTION = 0.05;
const CHECK_MARK_WIDTH_FRACTION = 0.09;
/** The checkmark's three points, each a fraction of the badge's own radius. */
const CHECK_MARK_LEFT_X_FRACTION = 0.45;
const CHECK_MARK_LOW_X_FRACTION = 0.1;
const CHECK_MARK_LOW_Y_FRACTION = 0.4;
const CHECK_MARK_RIGHT_X_FRACTION = 0.5;
const CHECK_MARK_RIGHT_Y_FRACTION = 0.4;

const FULL_TURN_RADIANS = Math.PI * 2;

function drawFloppyIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  withCheck: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);

  const notch = size * NOTCH_FRACTION;
  ctx.beginPath();
  ctx.moveTo(0, notch);
  ctx.lineTo(notch, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size, size);
  ctx.lineTo(0, size);
  ctx.closePath();
  ctx.fillStyle = DISK_BODY_COLOR;
  ctx.fill();

  // The shutter: the metal slider on a floppy's face, the detail that reads
  // as "disk" rather than "rounded square" at icon size.
  const shutterW = size * SHUTTER_WIDTH_FRACTION;
  const shutterH = size * SHUTTER_HEIGHT_FRACTION;
  ctx.fillStyle = DISK_SHUTTER_COLOR;
  ctx.fillRect(size * SHUTTER_X_FRACTION, size * SHUTTER_Y_FRACTION, shutterW, shutterH);

  // The write-protect notch on the shutter.
  ctx.fillStyle = DISK_BODY_COLOR;
  ctx.fillRect(
    size * PROTECT_NOTCH_X_FRACTION,
    size * PROTECT_NOTCH_Y_FRACTION,
    size * PROTECT_NOTCH_WIDTH_FRACTION,
    size * PROTECT_NOTCH_HEIGHT_FRACTION,
  );

  // The label — the lower two-thirds of the face.
  const labelY = size * LABEL_Y_FRACTION;
  ctx.fillStyle = DISK_LABEL_COLOR;
  ctx.fillRect(
    size * LABEL_X_FRACTION,
    labelY,
    size * LABEL_WIDTH_FRACTION,
    size * LABEL_HEIGHT_FRACTION,
  );

  if (withCheck) {
    const badgeR = size * CHECK_BADGE_RADIUS_FRACTION;
    const badgeX = size * CHECK_BADGE_X_FRACTION;
    const badgeY = size * CHECK_BADGE_Y_FRACTION;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, FULL_TURN_RADIANS);
    ctx.fillStyle = CHECK_BADGE_COLOR;
    ctx.fill();
    ctx.strokeStyle = DISK_BODY_COLOR;
    ctx.lineWidth = size * CHECK_BADGE_RING_WIDTH_FRACTION;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(badgeX - badgeR * CHECK_MARK_LEFT_X_FRACTION, badgeY);
    ctx.lineTo(
      badgeX - badgeR * CHECK_MARK_LOW_X_FRACTION,
      badgeY + badgeR * CHECK_MARK_LOW_Y_FRACTION,
    );
    ctx.lineTo(
      badgeX + badgeR * CHECK_MARK_RIGHT_X_FRACTION,
      badgeY - badgeR * CHECK_MARK_RIGHT_Y_FRACTION,
    );
    ctx.strokeStyle = CHECK_MARK_COLOR;
    ctx.lineWidth = size * CHECK_MARK_WIDTH_FRACTION;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  ctx.restore();
}

export class SaveIndicator {
  private phase: Phase = 'idle';
  private ticksInPhase = 0;

  /** Starts (or restarts) the "Saving... → Game Saved" sequence. */
  trigger(): void {
    this.phase = 'saving';
    this.ticksInPhase = 0;
  }

  update(): void {
    if (this.phase === 'idle') return;
    this.ticksInPhase++;
    if (this.phase === 'saving' && this.ticksInPhase >= SAVING_PHASE_TICKS) {
      this.phase = 'saved';
      this.ticksInPhase = 0;
    } else if (this.phase === 'saved' && this.ticksInPhase >= SAVED_HOLD_TICKS) {
      this.phase = 'idle';
      this.ticksInPhase = 0;
    }
  }

  private currentAlpha(): number {
    if (this.phase === 'saving') {
      return Math.min(1, this.ticksInPhase / FADE_IN_TICKS);
    }
    if (this.phase === 'saved') {
      const ticksLeft = SAVED_HOLD_TICKS - this.ticksInPhase;
      if (ticksLeft <= FADE_OUT_TICKS) return Math.max(0, ticksLeft / FADE_OUT_TICKS);
      return 1;
    }
    return 0;
  }

  /**
   * Anchored centred above the hotbar, the same reference point `HotbarToast`
   * uses, rather than the top of the screen — reads as tied to where the
   * player is already looking to check their tools instead of a separate
   * corner of the HUD, and works the same way on desktop and mobile since
   * `hotbarStripRect` already accounts for the bar shrinking on a narrow
   * canvas.
   */
  render(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'idle') return;
    const alpha = this.currentAlpha();
    if (alpha <= 0) return;

    const hotbarTop = hotbarStripRect().y;
    const box = drawBox(ctx, {
      x: viewportWidth() / 2,
      y: hotbarTop - GAP_ABOVE_HOTBAR,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      alignX: 'center',
      alignY: 'bottom',
      padding: PANEL_PADDING,
      alpha,
      ...BOX_PRESETS.saveIndicator,
    });

    const iconX = box.inner.x;
    const iconY = box.inner.y + box.inner.height / 2 - ICON_SIZE / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawFloppyIcon(ctx, iconX, iconY, ICON_SIZE, this.phase === 'saved');
    ctx.restore();

    const textX = iconX + ICON_SIZE + ICON_GAP;
    const textWidth = box.inner.width - ICON_SIZE - ICON_GAP;
    if (this.phase === 'saving') {
      drawText(ctx, 'Saving...', {
        x: textX,
        y: box.inner.y + box.inner.height / 2 - STATUS_TEXT_VERTICAL_OFFSET,
        width: textWidth,
        alpha,
        ...TEXT_PRESETS.heading,
        size: STATUS_TEXT_SIZE,
      });
    } else {
      drawText(ctx, 'Game Saved', {
        x: textX,
        y: box.inner.y + box.inner.height / 2 - STATUS_TEXT_VERTICAL_OFFSET,
        width: textWidth,
        alpha,
        ...TEXT_PRESETS.success,
        size: STATUS_TEXT_SIZE,
        bold: true,
      });
    }
  }

  /** Drop the banner instantly — used on scene teardown. */
  clear(): void {
    this.phase = 'idle';
    this.ticksInPhase = 0;
  }
}
