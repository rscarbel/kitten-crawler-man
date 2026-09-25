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
import {
  drawBox,
  drawModal,
  drawOverlay,
  drawScrollbar,
  beginModalFit,
  endModalFit,
  modalFitPoint,
  BOX_PRESETS,
  MODAL_FIT_NONE,
  type ModalFit,
} from './Box';
import {
  beginMenuFocus,
  clearMenuFocus,
  drawButton,
  endMenuFocus,
  setButtonPointerSpace,
  resetButtonPointerSpace,
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

/**
 * The seller's answer to a Buy the panel refused, shown in place of the bark;
 * null leaves the bark as it was. Told which row, because a refusal can mean
 * different things on different rows — too dear on one, nothing better to
 * sell on another.
 */
export type PricedBlockedLine = (option: PricedOption, player: Player) => string | null;

const PANEL_WIDTH = 400;
/** Gap kept between the panel and every screen edge. */
const SCREEN_MARGIN = 8;
/** Below this the text is illegible; the panel overflows the width rather than shrink further. */
const MIN_FIT_SCALE = 0.4;
const WHEEL_SCROLL_SCALE = 0.5;
const SCROLLBAR_INSET = 8;
const SCROLL_BTN_SIZE = 40;
const SCROLL_BTN_GAP = 4;
const SCROLL_BTN_LABEL_SIZE = 14;
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
/**
 * Pitch between wrapped label lines, and the gap kept between the label and
 * the description that follows it (matching the old fixed label-to-desc gap
 * so a single-line label lands exactly where it always has).
 */
const OPTION_NAME_LINE_HEIGHT = 16;
const OPTION_DESC_SIZE = 10;
/**
 * Pitch between wrapped description lines — the size `drawText` picks for this
 * font on its own, stated so the row-height measure and the drawing agree.
 */
const OPTION_DESC_LINE_HEIGHT = 14;
/** Space a grown row keeps under its last description line before the next row's name. */
const ROW_BOTTOM_GAP = 8;
const PRICE_SIZE = 12;
const BYLINE_SIZE = 11;
const BYLINE_GAP = 5;
const BYLINE_LINE_HEIGHT = BYLINE_SIZE + BYLINE_GAP;

const BUY_BTN_WIDTH = 78;
const BUY_BTN_HEIGHT = 40;
const BUY_BTN_Y_LIFT = 8;
const BUY_LABEL_SIZE = 12;
const CLOSE_BTN_WIDTH = 120;
/** Narrower on touch, where the label is bare "Close" and the purse shares the footer. */
const CLOSE_BTN_MOBILE_WIDTH = 88;
const CLOSE_BTN_HEIGHT = 40;
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
 * How far a row's own content reaches above its `rowY` — the Buy button and
 * the quest plate both float above the row's text baseline rather than
 * starting flush with it. Between rows this overhang lands in the gap the
 * previous row already leaves under its description, so it's invisible; the
 * first row has no previous row to borrow that gap from, so the row list
 * carries this much dead space of its own above row zero — keeping the rows
 * clip flush with the viewport's top edge while still giving the first row's
 * button and plate room to float above `rowY` without being sheared off flat.
 */
const ROW_TOP_INSET = Math.max(BUY_BTN_Y_LIFT, QUEST_ROW_PLATE_LIFT);

/**
 * Width the label/description column gets before word-wrap kicks in — the row's
 * content width minus the price and Buy button on the right. Without the cap, a
 * long description runs underneath the button.
 */
function optionTextMaxWidth(contentWidth: number): number {
  return contentWidth - BUY_BTN_WIDTH - PRICE_BTN_GAP * 2;
}

/**
 * How many lines a row's label wraps to within the text column left of the
 * price and Buy button — a long tier name (e.g. "Ratkin Forge Axe") must wrap
 * there rather than run under the button.
 */
function labelLineCount(
  ctx: CanvasRenderingContext2D,
  option: PricedOption,
  contentWidth: number,
): number {
  return measureTextBox(ctx, option.label, {
    size: OPTION_NAME_SIZE,
    bold: true,
    width: optionTextMaxWidth(contentWidth),
    lineHeight: OPTION_NAME_LINE_HEIGHT,
  }).lineCount;
}

/**
 * A row's height: the standard pitch, grown for a label or description that
 * wraps past the lines the pitch has room for, so a long one never runs into
 * the row below.
 */
function rowHeightFor(
  ctx: CanvasRenderingContext2D,
  option: PricedOption,
  contentWidth: number,
): number {
  const descTop = labelLineCount(ctx, option, contentWidth) * OPTION_NAME_LINE_HEIGHT;
  const descLines = measureTextBox(ctx, option.desc, {
    size: OPTION_DESC_SIZE,
    width: optionTextMaxWidth(contentWidth),
    lineHeight: OPTION_DESC_LINE_HEIGHT,
  }).lineCount;
  const descBottom = descTop + descLines * OPTION_DESC_LINE_HEIGHT;
  return Math.max(ROW_HEIGHT, descBottom + ROW_BOTTOM_GAP);
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
  private blockedLine: PricedBlockedLine | null = null;
  /** Frames a Buy stays refused after a sale; 0 for a menu that takes one sale per press. */
  private rebuyGuardFrames = 0;
  private rebuyGuardLeft = 0;
  private feedback = '';
  private feedbackTimer = 0;
  private buyButtons: ButtonResult[] = [];
  private closeButton: ButtonResult | null = null;
  private fit: ModalFit = MODAL_FIT_NONE;
  private scrollY = 0;
  private maxScrollY = 0;
  private rowsTop = 0;
  private rowsBottom = 0;
  private scrollButtons: { up: ButtonResult; down: ButtonResult } | null = null;
  private modalContains: ((px: number, py: number) => boolean) | null = null;

  get isOpen(): boolean {
    return this.menu !== null;
  }

  /**
   * @param onBlocked Called when the player taps a Buy button the panel refuses
   *   — unaffordable or unavailable. A disabled button is otherwise silent, so
   *   callers that want an audible "no" pass one; the rest stay quiet.
   * @param blockedLine What the seller says to that refusal, if anything.
   * @param rebuyGuardFrames For a menu whose row becomes a different, dearer
   *   product the moment it sells (a tool's next tier), how long after a sale
   *   a further Buy is ignored — so a double-click buys once, not twice up the
   *   ladder. Omitted, every press buys.
   */
  open(
    buildMenu: PricedMenuBuilder,
    onPurchase: PricedPurchaseHandler,
    onBlocked?: () => void,
    blockedLine?: PricedBlockedLine,
    rebuyGuardFrames = 0,
  ): void {
    this.rebuyGuardFrames = rebuyGuardFrames;
    this.rebuyGuardLeft = 0;
    this.buildMenu = buildMenu;
    this.menu = buildMenu();
    this.onPurchase = onPurchase;
    this.onBlocked = onBlocked ?? null;
    this.blockedLine = blockedLine ?? null;
    this.feedbackTimer = 0;
    this.scrollY = 0;
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
    this.blockedLine = null;
    this.buyButtons = [];
    this.closeButton = null;
    this.modalContains = null;
    this.scrollButtons = null;
    clearMenuFocus();
  }

  update(): void {
    if (this.feedbackTimer > 0) this.feedbackTimer--;
    if (this.rebuyGuardLeft > 0) this.rebuyGuardLeft--;
  }

  render(ctx: CanvasRenderingContext2D, active: Player): void {
    const menu = this.menu;
    if (menu === null) return;

    drawOverlay(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      alpha: OVERLAY_ALPHA,
    });
    // Only width is fitted; height is handled by scrolling the rows, since a
    // stall's stock can be longer than any phone screen at a legible size.
    const fitScale = Math.max(
      MIN_FIT_SCALE,
      Math.min(1, (viewportWidth() - SCREEN_MARGIN * 2) / PANEL_WIDTH),
    );
    this.fit = { scale: fitScale, pivotX: viewportWidth() / 2, pivotY: viewportHeight() / 2 };
    const maxPanelHeight = (viewportHeight() - SCREEN_MARGIN * 2) / fitScale;
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(fitScale, this.fit.pivotX, this.fit.pivotY);
    const panelWidth = PANEL_WIDTH;
    // Measured before the panel is drawn because the panel's height depends on
    // it: a resident's own bark is a full sentence in their voice, often
    // several lines, and the wrapped remainder has to be paid for in header
    // height or it lands on the first row.
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
    const rowHeights = menu.options.map((option) => rowHeightFor(ctx, option, contentWidth));
    const rowsHeight = rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0);
    // The scrollable content is the rows plus the dead space `ROW_TOP_INSET`
    // reserves above row zero — folded in here so a menu short enough to need
    // no scrolling still grows the panel to show that inset, rather than
    // permanently owing 8px of scroll before the last row is reachable.
    const totalRowsHeight = ROW_TOP_INSET + rowsHeight;
    const height = Math.min(headerHeight + totalRowsHeight + FOOTER_HEIGHT, maxPanelHeight);
    const visibleRowsHeight = height - headerHeight - FOOTER_HEIGHT;
    this.maxScrollY = Math.max(0, totalRowsHeight - visibleRowsHeight);
    this.scrollY = Math.min(this.scrollY, this.maxScrollY);
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
    this.rowsTop = modal.y + headerHeight;
    this.rowsBottom = this.rowsTop + visibleRowsHeight;
    ctx.save();
    ctx.beginPath();
    // Flush with the viewport edge — nothing painted above `rowsTop` is ever
    // shown, scrolled or not. Room for the first row's overhanging button and
    // quest plate comes from `ROW_TOP_INSET` below, not from opening the clip.
    ctx.rect(modal.x, this.rowsTop, modal.width, visibleRowsHeight);
    ctx.clip();
    // Row zero starts `ROW_TOP_INSET` below the viewport edge rather than flush
    // with it, so its button/plate — which float that far above their own
    // `rowY` — land exactly on the clip edge instead of past it.
    let rowY = this.rowsTop + ROW_TOP_INSET - this.scrollY;
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
        rowHeights[i],
      );
      rowY += rowHeights[i];
    }
    ctx.restore();
    drawScrollbar(ctx, {
      x: modal.x + modal.width - SCROLLBAR_INSET,
      trackY: this.rowsTop,
      trackH: visibleRowsHeight,
      contentH: totalRowsHeight,
      scrollY: this.scrollY,
    });

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
    this.scrollButtons = this.renderScrollButtons(ctx, contentLeft, footerCenterY);
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
    endModalFit(ctx);
    resetButtonPointerSpace();
  }

  /** Touch has no wheel and the scene forwards no drags, so the footer carries explicit step buttons. */
  private renderScrollButtons(
    ctx: CanvasRenderingContext2D,
    left: number,
    centerY: number,
  ): { up: ButtonResult; down: ButtonResult } | null {
    if (this.maxScrollY <= 0) return null;
    const common = {
      y: centerY,
      width: SCROLL_BTN_SIZE,
      height: SCROLL_BTN_SIZE,
      alignY: 'middle',
      ...BUTTON_PRESETS.toggle,
      labelSize: SCROLL_BTN_LABEL_SIZE,
    } as const;
    const up = drawButton(ctx, {
      ...common,
      x: left,
      label: '▲',
      disabled: this.scrollY <= 0,
    });
    const down = drawButton(ctx, {
      ...common,
      x: left + SCROLL_BTN_SIZE + SCROLL_BTN_GAP,
      label: '▼',
      disabled: this.scrollY >= this.maxScrollY,
    });
    return { up, down };
  }

  handleWheel(deltaY: number): void {
    if (this.menu !== null) this.scrollBy(deltaY * WHEEL_SCROLL_SCALE);
  }

  private scrollBy(delta: number): void {
    this.scrollY = Math.max(0, Math.min(this.maxScrollY, this.scrollY + delta));
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
    rowHeight: number,
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

    const labelLines = labelLineCount(ctx, option, contentWidth);
    drawText(ctx, option.label, {
      x: left,
      y: rowY,
      size: OPTION_NAME_SIZE,
      bold: true,
      color: isQuestRow ? QUEST_MARKER_GOLD : '#e2e8f0',
      width: optionTextMaxWidth(contentWidth),
      lineHeight: OPTION_NAME_LINE_HEIGHT,
    });
    drawText(ctx, option.desc, {
      x: left,
      y: rowY + labelLines * OPTION_NAME_LINE_HEIGHT,
      size: OPTION_DESC_SIZE,
      color: '#94a3b8',
      width: optionTextMaxWidth(contentWidth),
      lineHeight: OPTION_DESC_LINE_HEIGHT,
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

    const buyTop = rowY - BUY_BTN_Y_LIFT;
    // Reachability is checked against the row's own bounds, not the Buy
    // button's: the button sits lifted above `rowY` to centre on the row, so
    // its rect starts a few pixels above the row — `ROW_TOP_INSET` reserves
    // exactly that much space above row zero so this holds there too, rather
    // than the lifted rect being tested against `rowsTop` and falsely
    // disabling the topmost visible row. A row scrolled out of the band is
    // still drawn (clipped) and must stay inert: `handleClick` ignores a click
    // outside the band, so a focus-ring accept or a registered click sound on
    // a clipped row would otherwise fall through to closing the menu.
    const isReachable = rowY >= this.rowsTop && rowY + rowHeight <= this.rowsBottom;
    this.buyButtons.push(
      drawButton(ctx, {
        x: right,
        y: buyTop,
        width: BUY_BTN_WIDTH,
        height: BUY_BTN_HEIGHT,
        alignX: 'right',
        label: 'Buy',
        labelSize: BUY_LABEL_SIZE,
        disabled: !canAfford || !isAvailable || !isReachable,
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
  handleClick(canvasX: number, canvasY: number, active: Player): boolean {
    const menu = this.menu;
    if (menu === null) return false;
    const { x: mx, y: my } = modalFitPoint(this.fit, canvasX, canvasY);
    const scrollButtons = this.scrollButtons;
    if (scrollButtons?.up.contains(mx, my) === true) {
      this.scrollBy(-ROW_HEIGHT);
      return true;
    }
    if (scrollButtons?.down.contains(mx, my) === true) {
      this.scrollBy(ROW_HEIGHT);
      return true;
    }
    // A row scrolled under the header or footer is clipped from view, so its
    // Buy button must not stay live there.
    const inRowsBand = my >= this.rowsTop && my <= this.rowsBottom;
    for (let i = 0; i < this.buyButtons.length; i++) {
      if (inRowsBand && this.buyButtons[i].contains(mx, my)) {
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

  /**
   * Presses the Buy button of the row keyed `key`, exactly as a click on it
   * would — refused, charged or not by the same rules. For callers with no
   * pointer: headless checks, and anything that buys on the player's behalf.
   * Returns whether such a row was on the menu.
   */
  pressBuy(key: string, active: Player): boolean {
    const option = this.menu?.options.find((candidate) => candidate.key === key);
    if (option === undefined) return false;
    this.tryBuy(option, active);
    return true;
  }

  /** The rows on offer right now, or none while closed. */
  get options(): ReadonlyArray<PricedOption> {
    return this.menu?.options ?? [];
  }

  /** The line the header shows right now: the last purchase's feedback while it lasts, else the bark. */
  get currentLine(): string {
    const menu = this.menu;
    return menu === null ? '' : this.feedbackLine(menu);
  }

  private tryBuy(option: PricedOption, active: Player): void {
    const purchase = this.onPurchase;
    if (purchase === null || this.rebuyGuardLeft > 0) return;
    if (option.unavailable !== undefined || active.coins < option.price) {
      this.onBlocked?.();
      const refusal = this.blockedLine?.(option, active) ?? null;
      if (refusal !== null) this.showFeedback(refusal);
      return;
    }
    // Deduct only on success: a stall handler can refuse a sale it can't deliver
    // (no room in the inventory), and the player must not be charged for goods
    // they never receive.
    const result = purchase(option, active);
    if (result.ok) {
      active.coins -= option.price;
      this.rebuyGuardLeft = this.rebuyGuardFrames;
    }
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
