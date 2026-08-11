/**
 * QuestDialog — shared paged modal dialog for quest systems. Owns pagination,
 * the advance button, and rendering; callers supply pages and a completion
 * callback. Extracted from CircusQuestSystem so every questline renders
 * dialog the same way.
 */

import { pointInRect } from '../utils';
import type { AudioManager } from '../audio/AudioManager';
import { drawText, measureTextBox } from './TextBox';
import {
  beginMenuFocus,
  drawButton,
  endMenuFocus,
  playButtonSound,
  BUTTON_PRESETS,
} from './Button';
import { drawBox, drawModal, BOX_PRESETS } from './Box';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawItemIcon } from './InventoryPanel';
import { ITEM_DEF, type ItemId } from '../core/ItemDefs';

/**
 * What a page is offering, previewed on the page that asks the player to agree
 * to the work.
 *
 * A quest that states its reward only on completion asks the player to take an
 * errand on faith. The strip is deliberately plain-language — what the thing
 * *does*, not what it is called — because "Wayfinder's Anchor" tells a
 * first-time player nothing about whether the walk is worth it.
 */
export interface DialogReward {
  /** Drawn with the same icon the inventory uses — never a second drawing. */
  itemId: ItemId;
  displayName: string;
  /** One or two lines, in plain language, of what the item actually does. */
  lines: ReadonlyArray<string>;
  xp: number;
}

/** One page of quest dialog: a speaker/heading, body lines, and a button label. */
export interface DialogPage {
  title: string;
  lines: ReadonlyArray<string>;
  /** Label for the advance button on this page. */
  button: string;
  /**
   * Label for a second button that closes the dialog *without* completing it.
   *
   * Omit — as every page but an offer's last one does — and the page renders
   * with the single centred button it always had. Esc has always done this, but
   * a modal whose only refusal is a key nobody is told about is not a choice the
   * player knows they have.
   */
  declineButton?: string;
  /**
   * Reward preview strip, drawn between the body and the buttons. Set it on the
   * page that asks for a commitment — usually an offer's last page, beside
   * {@link DialogPage.declineButton}.
   */
  reward?: DialogReward;
}

const DIALOG_WIDTH = 460;
const DIALOG_CANVAS_PADDING = 40;
const DIALOG_BASE_HEIGHT = 72;
const DIALOG_BUTTON_AREA_HEIGHT = 52;
const DIALOG_LINE_SPACING = 17;
const DIALOG_PAD_X = 18;
const DIALOG_TITLE_Y_OFFSET = 14;
const DIALOG_TITLE_SIZE = 14;
const DIALOG_LINE_START_Y = 40;
const DIALOG_LINE_SIZE = 12;
const DIALOG_BTN_W = 150;
const DIALOG_BTN_H = 30;
const DIALOG_BTN_Y_FROM_BOTTOM = 42;
/** Gap between the accept and decline buttons when a page offers both. */
const DIALOG_BTN_GAP = 12;
const DIALOG_BTN_LABEL_SIZE = 12;
const DIALOG_PAGE_COUNTER_SIZE = 10;
/**
 * Gap kept between the panel's foot and the bottom of the viewport.
 *
 * Enough to clear the mobile hotbar's row of buttons, which is the tallest
 * furniture anything sits on down there.
 */
const DIALOG_BOTTOM_MARGIN = 96;

// Reward strip. Its height is measured, not assumed, so a two-line description
// pushes the buttons down instead of printing over them.
const REWARD_STRIP_TOP_GAP = 12;
const REWARD_STRIP_PAD = 9;
const REWARD_ICON_SIZE = 36;
const REWARD_ICON_TEXT_GAP = 10;
const REWARD_HEADING_SIZE = 9;
const REWARD_HEADING_HEIGHT = 13;
const REWARD_NAME_SIZE = 12;
const REWARD_NAME_HEIGHT = 16;
const REWARD_LINE_SIZE = 10;
const REWARD_LINE_SPACING = 13;
const REWARD_XP_SIZE = 10;
const REWARD_XP_HEIGHT = 14;
const REWARD_HEADING_COLOR = 'rgba(148,163,184,0.9)';
const REWARD_NAME_COLOR = '#facc15';
const REWARD_LINE_COLOR = '#cbd5e1';
const REWARD_XP_COLOR = '#4ade80';
const REWARD_HEADING_TEXT = 'REWARD';

/**
 * How far below centre the panel sits.
 *
 * A quest dialog is a conversation, and the people having it are standing on
 * screen — the camera holds the active crawler dead centre, which is exactly
 * where a centred modal lands. Every closing scene in the game was therefore
 * played out behind its own dialogue. Anchoring the box near the foot of the
 * viewport leaves the party, and whoever they are talking to, in clear view.
 *
 * Clamped so a panel too tall for the viewport is never pushed *up* past centre
 * instead: on a short screen the buttons are the part that has to stay reachable,
 * and they are at the bottom.
 */
function lowerThirdOffset(boxHeight: number): number {
  const centredY = viewportHeight() / 2 - boxHeight / 2;
  const loweredY = viewportHeight() - DIALOG_BOTTOM_MARGIN - boxHeight;
  return Math.max(0, loweredY - centredY);
}

export class QuestDialog {
  private pages: ReadonlyArray<DialogPage> = [];
  private pageIndex = 0;
  private onComplete: (() => void) | null = null;
  private buttonRect: { x: number; y: number; w: number; h: number } | null = null;
  private declineRect: { x: number; y: number; w: number; h: number } | null = null;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.pages.length > 0;
  }

  /** Opens the dialog on its first page. `onComplete` fires when the last page is advanced. */
  open(pages: ReadonlyArray<DialogPage>, onComplete: () => void): void {
    if (pages.length === 0) {
      onComplete();
      return;
    }
    this.pages = pages;
    this.pageIndex = 0;
    this.onComplete = onComplete;
    this.audio?.play('typing_click');
  }

  /** Esc: closes without firing `onComplete`. Returns true if a dialog was open. */
  dismiss(): boolean {
    if (!this.isOpen) return false;
    this.close();
    return true;
  }

  /**
   * Closes on the current page's decline button, if it has one. Returns true
   * when there was something to decline — callers use that to tell a refusal
   * apart from a click that landed on nothing.
   */
  decline(): boolean {
    if (!this.isOpen) return false;
    if (this.pages[this.pageIndex].declineButton === undefined) return false;
    playButtonSound(this.audio);
    this.close();
    return true;
  }

  private close(): void {
    this.pages = [];
    this.pageIndex = 0;
    this.onComplete = null;
    this.buttonRect = null;
    this.declineRect = null;
  }

  /**
   * Advances past the current page as if its button were clicked — pagination
   * and completion logic shared by mouse clicks and keyboard/tap "interact"
   * callers that have no pointer coordinates to hit-test against.
   * Returns true if a dialog was open to advance.
   */
  advance(): boolean {
    if (!this.isOpen) return false;
    playButtonSound(this.audio);
    if (this.pageIndex < this.pages.length - 1) {
      this.pageIndex++;
      this.audio?.play('typing_click');
    } else {
      const done = this.onComplete;
      this.close();
      done?.();
    }
    return true;
  }

  /** Returns true when the click was consumed — dialogs are modal while open. */
  handleClick(mx: number, my: number): boolean {
    if (!this.isOpen) return false;
    if (this.declineRect && pointInRect(mx, my, this.declineRect)) {
      this.decline();
      return true;
    }
    if (this.buttonRect && pointInRect(mx, my, this.buttonRect)) {
      this.advance();
    }
    return true;
  }

  /** Width available to the strip's text column, once the icon has taken its share. */
  private rewardTextWidth(stripWidth: number): number {
    return stripWidth - REWARD_STRIP_PAD * 2 - REWARD_ICON_SIZE - REWARD_ICON_TEXT_GAP;
  }

  /**
   * Measured rather than fixed: the description wraps, and the strip has to grow
   * with it or the buttons below end up drawn over the last line.
   */
  private rewardStripHeight(
    ctx: CanvasRenderingContext2D,
    reward: DialogReward,
    stripWidth: number,
  ): number {
    const { lineCount } = measureTextBox(ctx, reward.lines.join('\n'), {
      width: this.rewardTextWidth(stripWidth),
      size: REWARD_LINE_SIZE,
      lineHeight: REWARD_LINE_SPACING,
    });
    const textHeight =
      REWARD_HEADING_HEIGHT +
      REWARD_NAME_HEIGHT +
      lineCount * REWARD_LINE_SPACING +
      (reward.xp > 0 ? REWARD_XP_HEIGHT : 0);
    return REWARD_STRIP_PAD * 2 + Math.max(REWARD_ICON_SIZE, textHeight);
  }

  /** The reward preview: the item's own icon, its name, what it does, and the XP. */
  private drawRewardStrip(
    ctx: CanvasRenderingContext2D,
    reward: DialogReward,
    x: number,
    y: number,
    stripWidth: number,
  ): void {
    const height = this.rewardStripHeight(ctx, reward, stripWidth);
    drawBox(ctx, { x, y, width: stripWidth, height, ...BOX_PRESETS.panel });

    const innerX = x + REWARD_STRIP_PAD;
    const innerY = y + REWARD_STRIP_PAD;
    // The inventory's own icon, so the thing the player is shown here is exactly
    // the thing they will later hunt for on the hotbar.
    drawItemIcon(
      ctx,
      { ...ITEM_DEF[reward.itemId], quantity: 1 },
      innerX,
      innerY,
      REWARD_ICON_SIZE,
    );

    const textX = innerX + REWARD_ICON_SIZE + REWARD_ICON_TEXT_GAP;
    const textWidth = this.rewardTextWidth(stripWidth);

    drawText(ctx, REWARD_HEADING_TEXT, {
      x: textX,
      y: innerY,
      size: REWARD_HEADING_SIZE,
      bold: true,
      color: REWARD_HEADING_COLOR,
    });
    drawText(ctx, reward.displayName, {
      x: textX,
      y: innerY + REWARD_HEADING_HEIGHT,
      size: REWARD_NAME_SIZE,
      bold: true,
      color: REWARD_NAME_COLOR,
    });
    const linesY = innerY + REWARD_HEADING_HEIGHT + REWARD_NAME_HEIGHT;
    drawText(ctx, reward.lines.join('\n'), {
      x: textX,
      y: linesY,
      width: textWidth,
      lineHeight: REWARD_LINE_SPACING,
      size: REWARD_LINE_SIZE,
      color: REWARD_LINE_COLOR,
    });
    const { lineCount } = measureTextBox(ctx, reward.lines.join('\n'), {
      width: textWidth,
      size: REWARD_LINE_SIZE,
      lineHeight: REWARD_LINE_SPACING,
    });
    // Omitted rather than printed as zero: a reward that is only an item still
    // wants the strip, and "+0 XP" under it reads as a bug rather than as none.
    if (reward.xp > 0) {
      drawText(ctx, `+${reward.xp} XP`, {
        x: textX,
        y: linesY + lineCount * REWARD_LINE_SPACING,
        size: REWARD_XP_SIZE,
        bold: true,
        color: REWARD_XP_COLOR,
      });
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isOpen) return;
    const page = this.pages[this.pageIndex];
    const dw = Math.min(DIALOG_WIDTH, viewportWidth() - DIALOG_CANVAS_PADDING);

    // Wrap the body to the box's inner width and size the box from the resulting
    // line count so long lines stay inside the panel instead of running past it.
    const contentWidth = dw - DIALOG_PAD_X * 2;
    const body = page.lines.join('\n');
    const { lineCount } = measureTextBox(ctx, body, {
      width: contentWidth,
      size: DIALOG_LINE_SIZE,
      lineHeight: DIALOG_LINE_SPACING,
    });
    const reward = page.reward;
    const rewardHeight =
      reward === undefined
        ? 0
        : REWARD_STRIP_TOP_GAP + this.rewardStripHeight(ctx, reward, contentWidth);
    const dh =
      DIALOG_BASE_HEIGHT +
      lineCount * DIALOG_LINE_SPACING +
      rewardHeight +
      DIALOG_BUTTON_AREA_HEIGHT;

    const box = drawModal(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      width: dw,
      height: dh,
      offsetY: lowerThirdOffset(dh),
      ...BOX_PRESETS.modal,
    });

    drawText(ctx, page.title, {
      x: box.x + DIALOG_PAD_X,
      y: box.y + DIALOG_TITLE_Y_OFFSET,
      size: DIALOG_TITLE_SIZE,
      bold: true,
      color: '#8ae0d0',
    });

    drawText(ctx, body, {
      x: box.x + DIALOG_PAD_X,
      y: box.y + DIALOG_LINE_START_Y,
      width: contentWidth,
      lineHeight: DIALOG_LINE_SPACING,
      size: DIALOG_LINE_SIZE,
      color: '#e2e8f0',
    });

    if (this.pages.length > 1) {
      drawText(ctx, `${this.pageIndex + 1} / ${this.pages.length}`, {
        x: box.x + dw - DIALOG_PAD_X,
        y: box.y + DIALOG_TITLE_Y_OFFSET,
        size: DIALOG_PAGE_COUNTER_SIZE,
        color: 'rgba(200,200,200,0.6)',
        align: 'right',
      });
    }

    if (reward !== undefined) {
      this.drawRewardStrip(
        ctx,
        reward,
        box.x + DIALOG_PAD_X,
        box.y + DIALOG_LINE_START_Y + lineCount * DIALOG_LINE_SPACING + REWARD_STRIP_TOP_GAP,
        contentWidth,
      );
    }

    const btnY = box.y + dh - DIALOG_BTN_Y_FROM_BOTTOM;
    const decline = page.declineButton;

    beginMenuFocus('quest-dialog');
    if (decline === undefined) {
      const btnX = box.x + dw / 2 - DIALOG_BTN_W / 2;
      drawButton(ctx, {
        x: btnX,
        y: btnY,
        width: DIALOG_BTN_W,
        height: DIALOG_BTN_H,
        label: page.button,
        ...BUTTON_PRESETS.primary,
        labelSize: DIALOG_BTN_LABEL_SIZE,
        primaryAction: true,
      });
      endMenuFocus();
      this.buttonRect = { x: btnX, y: btnY, w: DIALOG_BTN_W, h: DIALOG_BTN_H };
      this.declineRect = null;
      return;
    }

    // Decline on the left, accept on the right: the committing button is the one
    // under the thumb on mobile, and the pair reads in the order the player is
    // being asked to weigh them.
    const pairWidth = DIALOG_BTN_W * 2 + DIALOG_BTN_GAP;
    const declineX = box.x + dw / 2 - pairWidth / 2;
    const acceptX = declineX + DIALOG_BTN_W + DIALOG_BTN_GAP;
    drawButton(ctx, {
      x: declineX,
      y: btnY,
      width: DIALOG_BTN_W,
      height: DIALOG_BTN_H,
      label: decline,
      ...BUTTON_PRESETS.toggle,
      labelSize: DIALOG_BTN_LABEL_SIZE,
    });
    drawButton(ctx, {
      x: acceptX,
      y: btnY,
      width: DIALOG_BTN_W,
      height: DIALOG_BTN_H,
      label: page.button,
      ...BUTTON_PRESETS.primary,
      labelSize: DIALOG_BTN_LABEL_SIZE,
      primaryAction: true,
    });
    endMenuFocus();
    this.declineRect = { x: declineX, y: btnY, w: DIALOG_BTN_W, h: DIALOG_BTN_H };
    this.buttonRect = { x: acceptX, y: btnY, w: DIALOG_BTN_W, h: DIALOG_BTN_H };
  }
}
