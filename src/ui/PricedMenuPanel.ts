/**
 * A modal menu of priced things offered by whoever you're standing in front of:
 * the tavern's drinks, the temple's blessing, the tattooist's ink, a market
 * stall's stock. Each row is a label, a short description, a price and a Buy
 * button — disabled when the player can't afford it or the row is unavailable
 * (already spent, sold out).
 *
 * The panel owns the coins; the caller's `onPurchase` owns the effect, whether
 * that's a service performed on the spot or an item pushed into the inventory. A
 * handler that can fail (a full inventory) returns `ok: false` and the panel
 * leaves the player's purse alone — the money moves only when the goods do.
 *
 * Built on the shared `Button`/`Box`/`TextBox` utilities so hover, press, and
 * touch all work: every button is a hit-tested rect, a tap outside the modal
 * closes it, and the close hint adapts to the platform. The owning scene drives
 * open/close, routes Space/Esc/click here through its input-priority chain, and
 * calls `setButtonMouseState` each frame so hover/press state flows in.
 */

import { platform } from '../core/Platform';
import { drawBox, drawModal, drawOverlay, BOX_PRESETS } from './Box';
import {
  beginMenuFocus,
  clearMenuFocus,
  drawButton,
  endMenuFocus,
  BUTTON_PRESETS,
  type ButtonResult,
} from './Button';
import { QUEST_MARKER_GOLD } from '../sprites/questNPCSprite';
import { drawText, measureTextBox } from './TextBox';
import type { Player } from '../Player';
import { viewportWidth, viewportHeight } from '../core/Viewport';

export interface PricedOption {
  /** Stable identifier for the row, so a handler can act on a rebuilt menu. */
  key: string;
  label: string;
  price: number;
  desc: string;
  /** When set, the row is disabled and shows this instead of a price (e.g. "Already inked", "Sold out"). */
  unavailable?: string;
  /**
   * Marks the row as a questline's errand rather than ordinary stock. It is
   * drawn in the quest gold the rest of the game uses for quest business, and
   * while it is affordable it becomes the row a bare accept press buys — a
   * player sent to a stall for one specific thing can open the menu and take it
   * without navigating past the everyday goods.
   */
  isQuestItem?: boolean;
}

export interface PricedMenu {
  title: string;
  /** The NPC's opening line, shown until a purchase replaces it with feedback. */
  bark: string;
  /**
   * Who is selling, attributed under the bark on a line of its own. Omit where
   * the room itself is the seller and a name would just repeat the title (the
   * tavern, the temple, the parlour) — the header shrinks back when absent.
   */
  byline?: string;
  options: ReadonlyArray<PricedOption>;
}

/** What a handler did: whether the purchase went through, and the line to echo. */
export interface PricedPurchaseResult {
  ok: boolean;
  line: string;
}

/**
 * Performs the purchase. Runs *before* the coins are taken, so a handler that
 * can't deliver (a full inventory) can reject with `ok: false` and leave the
 * player uncharged.
 */
export type PricedPurchaseHandler = (option: PricedOption, player: Player) => PricedPurchaseResult;

/** Builds the current menu. Re-run after every purchase so availability stays honest. */
export type PricedMenuBuilder = () => PricedMenu;

const PANEL_MAX_WIDTH = 400;
/** Gap kept between the panel and the screen edges on phones narrower than the ideal width. */
const PANEL_SIDE_MARGIN = 10;
const PANEL_PADDING = 18;
const TITLE_SIZE = 17;
const BARK_SIZE = 11;
/**
 * Pitch between wrapped bark lines. Stated rather than left to `drawText`'s
 * default so the header's height math and the drawn text can never disagree.
 */
const BARK_LINE_HEIGHT = 16;
/** Height of a header whose bark is a single line. */
const HEADER_HEIGHT = 58;
const ROW_HEIGHT = 52;
const FOOTER_HEIGHT = 52;
const OPTION_NAME_SIZE = 13;
const OPTION_DESC_SIZE = 10;
const OPTION_DESC_GAP = 16;
const PRICE_SIZE = 12;
const BYLINE_SIZE = 11;
const BYLINE_GAP = 5;
const BYLINE_LINE_HEIGHT = BYLINE_SIZE + BYLINE_GAP;

const BUY_BTN_WIDTH = 78;
const BUY_BTN_HEIGHT = 30;
const BUY_BTN_Y_LIFT = 2;
const BUY_LABEL_SIZE = 12;
const CLOSE_BTN_WIDTH = 120;
/** Narrower on touch, where the label is bare "Close" and the purse shares the footer. */
const CLOSE_BTN_MOBILE_WIDTH = 88;
const CLOSE_BTN_HEIGHT = 30;
const CLOSE_LABEL_SIZE = 11;
const CLOSE_LABEL_MOBILE = 'Close';
const CLOSE_LABEL_DESKTOP = 'Close  [Space / Esc]';
/** Advertised while a quest row owns Space, so the footer never promises a key it no longer has. */
const CLOSE_LABEL_ESC_ONLY = 'Close  [Esc]';
const BARK_GAP = 6;
const PRICE_BTN_GAP = 12;
const ROW_TEXT_TOP_PAD = 2;

const FEEDBACK_FRAMES = 110;
const FEEDBACK_FADE_FRAMES = 25;
const PANEL_RADIUS = 8;
const OVERLAY_ALPHA = 0.55;

// Quest-row treatment: a gold-bordered plate behind the row, the label in the
// same gold, and a small tag under the price. The plate is inset from the row
// pitch so consecutive quest rows never share an edge.
const QUEST_ROW_PLATE_LIFT = 8;
const QUEST_ROW_PLATE_HEIGHT = 40;
const QUEST_ROW_PLATE_SIDE_PAD = 6;
const QUEST_ROW_PLATE_RADIUS = 5;
const QUEST_ROW_PLATE_FILL = 'rgba(251,191,36,0.10)';
const QUEST_ROW_PLATE_BORDER_WIDTH = 1.5;
const QUEST_TAG_TEXT = 'QUEST';
const QUEST_TAG_SIZE = 9;
const QUEST_TAG_TOP_GAP = 18;

/**
 * Width the label/description column gets before word-wrap kicks in — the row's
 * content width minus the price and Buy button on the right. Without the cap, a
 * long description runs underneath the button.
 */
function optionTextMaxWidth(contentWidth: number): number {
  return contentWidth - BUY_BTN_WIDTH - PRICE_BTN_GAP * 2;
}

function closeLabel(questRowIsPrimary: boolean): string {
  if (platform.isMobile) return CLOSE_LABEL_MOBILE;
  return questRowIsPrimary ? CLOSE_LABEL_ESC_ONLY : CLOSE_LABEL_DESKTOP;
}

export class PricedMenuPanel {
  private menu: PricedMenu | null = null;
  private buildMenu: PricedMenuBuilder | null = null;
  private onPurchase: PricedPurchaseHandler | null = null;
  private onBlocked: (() => void) | null = null;
  private feedback = '';
  private feedbackTimer = 0;
  private buyButtons: ButtonResult[] = [];
  private closeButton: ButtonResult | null = null;
  private modalContains: ((px: number, py: number) => boolean) | null = null;

  get isOpen(): boolean {
    return this.menu !== null;
  }

  /**
   * @param onBlocked Called when the player taps a Buy button the panel refuses
   *   — unaffordable or unavailable. A disabled button is otherwise silent, so
   *   callers that want an audible "no" pass one; the rest stay quiet.
   */
  open(
    buildMenu: PricedMenuBuilder,
    onPurchase: PricedPurchaseHandler,
    onBlocked?: () => void,
  ): void {
    this.buildMenu = buildMenu;
    this.menu = buildMenu();
    this.onPurchase = onPurchase;
    this.onBlocked = onBlocked ?? null;
    this.feedbackTimer = 0;
    // Every priced menu shares one focus context, so a selection the player left
    // behind in the tavern would otherwise still be live when a stall opens —
    // and the first accept press would buy whatever row that stale index landed
    // on rather than this menu's default.
    clearMenuFocus();
  }

  close(): void {
    this.menu = null;
    this.buildMenu = null;
    this.onPurchase = null;
    this.onBlocked = null;
    this.buyButtons = [];
    this.closeButton = null;
    this.modalContains = null;
    clearMenuFocus();
  }

  update(): void {
    if (this.feedbackTimer > 0) this.feedbackTimer--;
  }

  render(ctx: CanvasRenderingContext2D, active: Player): void {
    const menu = this.menu;
    if (menu === null) return;

    drawOverlay(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      alpha: OVERLAY_ALPHA,
    });
    const panelWidth = Math.min(PANEL_MAX_WIDTH, viewportWidth() - PANEL_SIDE_MARGIN * 2);
    // Measured before the panel is drawn because the panel's height depends on
    // it: a resident's own bark is a full sentence in their voice, far longer
    // than the one line the header used to assume, and the wrapped remainder
    // has to be paid for in header height or it lands on the first row.
    const contentWidth = panelWidth - PANEL_PADDING * 2;
    const barkLineCount = measureTextBox(ctx, this.feedbackLine(menu), {
      size: BARK_SIZE,
      width: contentWidth,
      lineHeight: BARK_LINE_HEIGHT,
    }).lineCount;
    const extraBarkHeight = (barkLineCount - 1) * BARK_LINE_HEIGHT;
    // A byline claims its own line under the bark, so the header grows for it
    // rather than the name being squeezed alongside the centred title, where a
    // long name and a long title would silently overlap.
    const headerHeight =
      HEADER_HEIGHT + extraBarkHeight + (menu.byline === undefined ? 0 : BYLINE_LINE_HEIGHT);
    const height = headerHeight + menu.options.length * ROW_HEIGHT + FOOTER_HEIGHT;
    const modal = drawModal(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      width: panelWidth,
      height,
      radius: PANEL_RADIUS,
      shadow: true,
      ...BOX_PRESETS.modal,
    });
    this.modalContains = (px, py) => modal.contains(px, py);

    // Everything inside lays out against the *drawn* width, never PANEL_MAX_WIDTH:
    // on a phone narrower than the ideal width the panel shrinks, and measuring
    // from the constant pushes the prices and Buy buttons past the screen edge.
    const contentLeft = modal.x + PANEL_PADDING;
    const contentRight = modal.x + modal.width - PANEL_PADDING;
    const centerX = modal.x + modal.width / 2;
    const barkY = modal.y + PANEL_PADDING + TITLE_SIZE + BARK_GAP;

    drawText(ctx, menu.title, {
      x: centerX,
      y: modal.y + PANEL_PADDING,
      size: TITLE_SIZE,
      bold: true,
      color: '#f0d870',
      align: 'center',
      outline: true,
    });
    // `x` is the box's left edge whenever `width` is set — `drawText` centres
    // within the box, so passing `centerX` here would shift it half a panel right.
    drawText(ctx, this.feedbackLine(menu), {
      x: contentLeft,
      y: barkY,
      size: BARK_SIZE,
      color: this.feedbackColor(),
      align: 'center',
      width: contentWidth,
      lineHeight: BARK_LINE_HEIGHT,
    });
    if (menu.byline !== undefined) {
      drawText(ctx, `— ${menu.byline}`, {
        x: contentLeft,
        y: barkY + BARK_SIZE + extraBarkHeight + BYLINE_GAP,
        size: BYLINE_SIZE,
        color: '#8f7f5a',
        align: 'center',
        width: contentWidth,
      });
    }

    // A buyable quest row takes the primary from Close: the errand the player
    // was sent here for is what an accept press should answer. It is also shown
    // focused from the first frame, so the key the panel is about to obey is
    // visible before anything is pressed.
    const questRowIndex = menu.options.findIndex((option) => this.isQuestDefault(option, active));
    const questRowIsPrimary = questRowIndex !== -1;

    this.buyButtons = [];
    // Literal, not a named constant: `verify-menus.ts` statically greps every
    // `beginMenuFocus('...')` call to confirm each scene's declared
    // `focusContext: 'priced-menu'` overlay claim actually has an opener.
    beginMenuFocus('priced-menu', questRowIsPrimary);
    let rowY = modal.y + headerHeight;
    for (let i = 0; i < menu.options.length; i++) {
      this.renderRow(
        ctx,
        menu.options[i],
        active,
        contentLeft,
        rowY,
        contentRight,
        contentWidth,
        i === questRowIndex,
      );
      rowY += ROW_HEIGHT;
    }

    const footerCenterY = modal.y + height - FOOTER_HEIGHT / 2;
    this.closeButton = drawButton(ctx, {
      x: centerX,
      y: footerCenterY,
      width: platform.isMobile ? CLOSE_BTN_MOBILE_WIDTH : CLOSE_BTN_WIDTH,
      height: CLOSE_BTN_HEIGHT,
      alignX: 'center',
      alignY: 'middle',
      label: closeLabel(questRowIsPrimary),
      labelSize: CLOSE_LABEL_SIZE,
      ...BUTTON_PRESETS.primary,
      primaryAction: !questRowIsPrimary,
    });
    endMenuFocus();
    // The purse shares the footer rather than the header: a centred title on a
    // narrow phone panel grows into the top-right corner and hides it.
    drawText(ctx, `Coins: ${active.coins}`, {
      x: contentRight,
      y: footerCenterY - PRICE_SIZE / 2,
      size: PRICE_SIZE,
      bold: true,
      color: '#d4c070',
      align: 'right',
    });
  }

  private renderRow(
    ctx: CanvasRenderingContext2D,
    option: PricedOption,
    active: Player,
    left: number,
    rowY: number,
    right: number,
    contentWidth: number,
    isPrimaryBuy: boolean,
  ): void {
    const isQuestRow = option.isQuestItem === true;
    if (isQuestRow) {
      drawBox(ctx, {
        x: left - QUEST_ROW_PLATE_SIDE_PAD,
        y: rowY - QUEST_ROW_PLATE_LIFT,
        width: contentWidth + QUEST_ROW_PLATE_SIDE_PAD * 2,
        height: QUEST_ROW_PLATE_HEIGHT,
        radius: QUEST_ROW_PLATE_RADIUS,
        fill: QUEST_ROW_PLATE_FILL,
        border: QUEST_MARKER_GOLD,
        borderWidth: QUEST_ROW_PLATE_BORDER_WIDTH,
      });
    }

    drawText(ctx, option.label, {
      x: left,
      y: rowY,
      size: OPTION_NAME_SIZE,
      bold: true,
      color: isQuestRow ? QUEST_MARKER_GOLD : '#e2e8f0',
    });
    drawText(ctx, option.desc, {
      x: left,
      y: rowY + OPTION_DESC_GAP,
      size: OPTION_DESC_SIZE,
      color: '#94a3b8',
      width: optionTextMaxWidth(contentWidth),
    });

    const canAfford = active.coins >= option.price;
    const blockedReason = option.unavailable;
    const isAvailable = blockedReason === undefined;
    drawText(ctx, blockedReason ?? `${option.price}c`, {
      x: right - BUY_BTN_WIDTH - PRICE_BTN_GAP,
      y: rowY + ROW_TEXT_TOP_PAD,
      size: PRICE_SIZE,
      bold: true,
      color: isAvailable && canAfford ? '#facc15' : '#7f1d1d',
      align: 'right',
    });

    if (isQuestRow) {
      drawText(ctx, QUEST_TAG_TEXT, {
        x: right - BUY_BTN_WIDTH - PRICE_BTN_GAP,
        y: rowY + QUEST_TAG_TOP_GAP,
        size: QUEST_TAG_SIZE,
        bold: true,
        color: QUEST_MARKER_GOLD,
        align: 'right',
      });
    }

    this.buyButtons.push(
      drawButton(ctx, {
        x: right,
        y: rowY - BUY_BTN_Y_LIFT,
        width: BUY_BTN_WIDTH,
        height: BUY_BTN_HEIGHT,
        alignX: 'right',
        label: 'Buy',
        labelSize: BUY_LABEL_SIZE,
        disabled: !canAfford || !isAvailable,
        ...BUTTON_PRESETS.success,
        primaryAction: isPrimaryBuy,
      }),
    );
  }

  /**
   * Whether this row is the one a bare accept press should buy. A quest row the
   * player cannot act on — sold out, or beyond their purse — never takes the
   * primary, so Close keeps it and Space still does the harmless thing.
   */
  private isQuestDefault(option: PricedOption, active: Player): boolean {
    return (
      option.isQuestItem === true &&
      option.unavailable === undefined &&
      active.coins >= option.price
    );
  }

  /**
   * Routes a click/tap. Buys the option under a Buy button, closes on the Close
   * button or a tap outside the modal, and swallows (without closing) taps that
   * land elsewhere inside the modal — so a stray tap near a Buy button doesn't
   * dismiss a menu the player is mid-order in. Returns whether consumed (always
   * true while open, so the tap can't fall through to move/attack).
   */
  handleClick(mx: number, my: number, active: Player): boolean {
    const menu = this.menu;
    if (menu === null) return false;
    for (let i = 0; i < this.buyButtons.length; i++) {
      if (this.buyButtons[i].contains(mx, my)) {
        this.tryBuy(menu.options[i], active);
        return true;
      }
    }
    if (this.closeButton?.contains(mx, my) === true) {
      this.close();
      return true;
    }
    if (this.modalContains?.(mx, my) === true) return true;
    this.close();
    return true;
  }

  private tryBuy(option: PricedOption, active: Player): void {
    const purchase = this.onPurchase;
    if (purchase === null) return;
    if (option.unavailable !== undefined || active.coins < option.price) {
      this.onBlocked?.();
      return;
    }
    // Deduct only on success: a stall handler can refuse a sale it can't deliver
    // (no room in the inventory), and the player must not be charged for goods
    // they never receive.
    const result = purchase(option, active);
    if (result.ok) active.coins -= option.price;
    // A purchase can change what's still on offer — the last tattoo, the last
    // wound worth healing, the last unit in stock — so the rows are rebuilt
    // before the next frame draws.
    this.menu = this.buildMenu?.() ?? this.menu;
    this.showFeedback(result.line);
  }

  private showFeedback(msg: string): void {
    this.feedback = msg;
    this.feedbackTimer = FEEDBACK_FRAMES;
  }

  private feedbackLine(menu: PricedMenu): string {
    return this.feedbackTimer > 0 ? this.feedback : menu.bark;
  }

  private feedbackColor(): string {
    if (this.feedbackTimer <= 0) return '#b9a06a';
    const fade = Math.min(1, this.feedbackTimer / FEEDBACK_FADE_FRAMES);
    return `rgba(210, 190, 110, ${fade})`;
  }
}
