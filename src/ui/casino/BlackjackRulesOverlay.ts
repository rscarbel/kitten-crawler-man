/**
 * The blackjack rules explainer: a paged overlay opened by the panel's "How to
 * Play" button and shown automatically the first time a player sits down in a
 * club visit.
 *
 * Borrows `QuestDialog`'s conventions — paged title + lines, a `typing_click` on
 * every page turn, `advance` / `dismiss` / `handleClick` — and adds an
 * illustration band per page, because the rules that matter (a soft 17, a bust,
 * the hole-card flip) are far clearer shown than described. On a short viewport
 * the band collapses and the text takes the space.
 */

import { drawModal, drawOverlay, BOX_PRESETS } from '../Box';
import {
  beginMenuFocus,
  drawButton,
  endMenuFocus,
  BUTTON_PRESETS,
  type ButtonResult,
} from '../Button';
import { drawText } from '../TextBox';
import { platform } from '../../core/Platform';
import { viewportWidth, viewportHeight } from '../../core/Viewport';
import type { AudioManager } from '../../audio/AudioManager';
import type { Card } from '../../systems/casino/Deck';
import { CARD_ASPECT, drawCardBack, drawCardFace } from './PlayingCard';
import { drawChipStack } from './ChipStack';
import { MIN_TOUCH_TARGET_PX, WIDE_LAYOUT_MIN_WIDTH } from './casinoLayout';
import {
  CHIP_DENOMINATIONS,
  TABLE_MAXIMUM,
  TABLE_MINIMUM,
} from '../../systems/casino/BlackjackTable';
import { RESHUFFLE_THRESHOLD } from '../../systems/casino/Deck';

const PANEL_WIDTH_WIDE = 620;
const PANEL_WIDTH_COMPACT = 360;
const PANEL_HEIGHT_WIDE = 460;
const PANEL_HEIGHT_COMPACT = 520;
const PANEL_SIDE_MARGIN = 24;
const PANEL_PADDING = 18;
const OVERLAY_ALPHA = 0.78;

const TITLE_SIZE = 17;
const BODY_SIZE = 12;
const BODY_LINE_HEIGHT = 19;
const TITLE_GAP = 28;

/** Below this panel height the illustration band collapses and the text takes the space. */
const ILLUSTRATION_MIN_PANEL_HEIGHT = 380;
const ILLUSTRATION_HEIGHT_FRACTION = 0.34;
const ILLUSTRATION_CARD_WIDTH_FRACTION = 0.6;
const ILLUSTRATION_GAP = 12;
const ILLUSTRATION_CAPTION_SIZE = 10;

const FOOTER_BTN_WIDTH = 110;
const FOOTER_BTN_GAP = 10;
const FOOTER_LABEL_SIZE = 11;
/** Back, Next and Close. */
const FOOTER_BUTTON_COUNT = 3;
const DOT_RADIUS = 3;
const DOT_SPACING = 12;
const DOT_ROW_GAP = 16;

const TOGGLE_BTN_WIDTH = 220;
const TOGGLE_ROW_GAP = 8;

const ACCENT = '#f0d870';
const BODY_COLOR = '#e2d9c0';
const CAPTION_COLOR = '#9a8c68';
const CHECKBOX_TICKED = '[X]';
const CHECKBOX_EMPTY = '[ ]';
const HALF = 0.5;
const TWO_PI = Math.PI * 2;

type IllustrationKind =
  | 'beating_hand'
  | 'ace_and_king'
  | 'bust'
  | 'soft_seventeen'
  | 'hole_flip'
  | 'natural'
  | 'double_down'
  | 'chip_stack'
  | 'shuffle';

interface RulesPage {
  readonly title: string;
  readonly body: string;
  readonly illustration: IllustrationKind;
}

const CARD_SPADE_TEN: Card = { rank: '10', suit: 'spades' };
const CARD_HEART_KING: Card = { rank: 'K', suit: 'hearts' };
const CARD_CLUB_NINE: Card = { rank: '9', suit: 'clubs' };
const CARD_DIAMOND_TEN: Card = { rank: '10', suit: 'diamonds' };
const CARD_SPADE_ACE: Card = { rank: 'A', suit: 'spades' };
const CARD_HEART_SIX: Card = { rank: '6', suit: 'hearts' };
const CARD_CLUB_EIGHT: Card = { rank: '8', suit: 'clubs' };
const CARD_DIAMOND_SEVEN: Card = { rank: '7', suit: 'diamonds' };
const CARD_SPADE_FIVE: Card = { rank: '5', suit: 'spades' };

const PAGES: ReadonlyArray<RulesPage> = [
  {
    title: 'The Goal',
    body: "Beat the dealer's hand without going over 21. Closest to 21 wins — go past it and you lose straight away, whatever the dealer does after.",
    illustration: 'beating_hand',
  },
  {
    title: 'Card Values',
    body: 'Number cards are worth their number. Jack, Queen and King are all worth 10. An ace is worth 1 or 11 — whichever helps your hand more, decided for you automatically.',
    illustration: 'ace_and_king',
  },
  {
    title: 'Your Turn',
    body: 'Hit takes another card. Stand keeps the hand you have. Go over 21 and the hand busts — it loses immediately, and the dealer does not even have to play.',
    illustration: 'bust',
  },
  {
    title: 'Soft Hands',
    body: 'A hand with an ace counted as 11 is "soft". An ace and a six is a soft 17: take a card and the worst that happens is the ace drops to 1. You cannot bust a soft hand in one card.',
    illustration: 'soft_seventeen',
  },
  {
    title: "The Dealer's Turn",
    body: 'Once you stand, the dealer turns the face-down card over and must draw until reaching 17 — then must stop. No choices, no judgement. Deuce has to follow the same rule every hand.',
    illustration: 'hole_flip',
  },
  {
    title: 'Blackjack',
    body: 'An ace plus any ten-value card on your first two cards is a natural blackjack. It pays three to two instead of even money — the best result at the table.',
    illustration: 'natural',
  },
  {
    title: 'Double Down',
    body: 'Double your bet in exchange for exactly one more card, then the hand is over. Best on a hard 9, 10 or 11, where a ten-value card lands you near 21.',
    illustration: 'double_down',
  },
  {
    title: 'Chips and Coins',
    body: `Your chips are your gold. Tap chips from the tray to build a bet (minimum ${TABLE_MINIMUM}, maximum ${TABLE_MAXIMUM}), tap them back to take it down, and anything not yet bet comes home as coins when you leave. "Same Bet" repeats the last hand.`,
    illustration: 'chip_stack',
  },
  {
    title: 'The Deck',
    body: `One 52-card deck. A card that has been dealt cannot come back until the deck reshuffles, which happens once ${RESHUFFLE_THRESHOLD} or fewer cards remain — and the deck remembers you between visits. Watch the counter.`,
    illustration: 'shuffle',
  },
];

interface IllustrationSpec {
  /** Cards drawn face up, left to right. */
  readonly faceUp: ReadonlyArray<Card>;
  /** How many trailing slots are drawn as backs instead of faces. */
  readonly faceDownCount: number;
  readonly caption: string;
}

const ILLUSTRATIONS: Record<IllustrationKind, IllustrationSpec> = {
  beating_hand: {
    faceUp: [CARD_SPADE_TEN, CARD_HEART_KING],
    faceDownCount: 0,
    caption: 'Twenty beats the dealer’s nineteen.',
  },
  ace_and_king: {
    faceUp: [CARD_SPADE_ACE, CARD_HEART_KING],
    faceDownCount: 0,
    caption: 'Ace counted as 11 — twenty-one.',
  },
  bust: {
    faceUp: [CARD_DIAMOND_TEN, CARD_CLUB_EIGHT, CARD_SPADE_FIVE],
    faceDownCount: 0,
    caption: 'Twenty-three. Bust.',
  },
  soft_seventeen: {
    faceUp: [CARD_SPADE_ACE, CARD_HEART_SIX],
    faceDownCount: 0,
    caption: 'Soft 17 — the ace can still drop to 1.',
  },
  hole_flip: {
    faceUp: [CARD_CLUB_NINE],
    faceDownCount: 1,
    caption: 'The hole card turns, then the dealer draws to 17.',
  },
  natural: {
    faceUp: [CARD_SPADE_ACE, CARD_DIAMOND_TEN],
    faceDownCount: 0,
    caption: 'A natural. Pays three to two.',
  },
  double_down: {
    faceUp: [CARD_DIAMOND_SEVEN, CARD_CLUB_NINE],
    faceDownCount: 1,
    caption: 'Sixteen doubled — one more card, then stand.',
  },
  chip_stack: { faceUp: [], faceDownCount: 0, caption: 'Fifty on the felt.' },
  shuffle: { faceUp: [], faceDownCount: 3, caption: 'Fifty-two again, all of it live.' },
};

/** A fifty on the felt, built from the same denominations the table deals in. */
const CHIP_ILLUSTRATION_STACK: ReadonlyArray<number> = [
  CHIP_DENOMINATIONS[2],
  CHIP_DENOMINATIONS[1],
  CHIP_DENOMINATIONS[0],
  CHIP_DENOMINATIONS[0],
];
const CHIP_ILLUSTRATION_RADIUS_FRACTION = 0.22;
/** Where the stack's base sits inside the illustration band. */
const CHIP_ILLUSTRATION_BASE_FRACTION = 0.8;
const SHUFFLE_FAN_ROTATION = 0.16;
/** Illustration cards sit side by side with a hair of separation, not overlapped. */
const ILLUSTRATION_CARD_STEP = 1.12;

export class BlackjackRulesOverlay {
  private open = false;
  private page = 0;
  private backButton: ButtonResult | null = null;
  private nextButton: ButtonResult | null = null;
  private closeButton: ButtonResult | null = null;
  private hintsToggleButton: ButtonResult | null = null;
  private autoShown = false;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * @param autoShown True when the table opened this itself on the player's first
   *   sit-down. That run gets a Skip button — a tutorial nobody asked for needs a
   *   way out that does not read as "Close and lose your place".
   */
  show(autoShown = false): void {
    this.open = true;
    this.page = 0;
    this.autoShown = autoShown;
  }

  dismiss(): void {
    this.open = false;
    this.backButton = null;
    this.nextButton = null;
    this.closeButton = null;
    this.hintsToggleButton = null;
  }

  /** The Next button: forward a page, and close off the last one. */
  advance(): void {
    if (!this.open) return;
    if (this.page >= PAGES.length - 1) {
      this.dismiss();
      return;
    }
    this.page++;
    this.audio?.play('typing_click');
  }

  private back(): void {
    if (this.page === 0) return;
    this.page--;
    this.audio?.play('typing_click');
  }

  /**
   * Routes a tap. Returns whether the overlay consumed it — always true while
   * open, so a tap cannot fall through to the table behind.
   */
  handleClick(mx: number, my: number, onToggleHints: () => void): boolean {
    if (!this.open) return false;
    if (this.hintsToggleButton?.contains(mx, my) === true) {
      onToggleHints();
      return true;
    }
    if (this.backButton?.contains(mx, my) === true) {
      this.back();
      return true;
    }
    if (this.nextButton?.contains(mx, my) === true) {
      this.advance();
      return true;
    }
    if (this.closeButton?.contains(mx, my) === true) {
      this.dismiss();
      return true;
    }
    return true;
  }

  render(ctx: CanvasRenderingContext2D, hintsEnabled: boolean): void {
    if (!this.open) return;
    const vw = viewportWidth();
    const vh = viewportHeight();
    const wide = vw >= WIDE_LAYOUT_MIN_WIDTH;
    const panelW = Math.min(wide ? PANEL_WIDTH_WIDE : PANEL_WIDTH_COMPACT, vw - PANEL_SIDE_MARGIN);
    const panelH = Math.min(
      wide ? PANEL_HEIGHT_WIDE : PANEL_HEIGHT_COMPACT,
      vh - PANEL_SIDE_MARGIN,
    );

    drawOverlay(ctx, { canvasWidth: vw, canvasHeight: vh, alpha: OVERLAY_ALPHA });
    const modal = drawModal(ctx, {
      canvasWidth: vw,
      canvasHeight: vh,
      width: panelW,
      height: panelH,
      radius: 8,
      shadow: true,
      ...BOX_PRESETS.modal,
      border: '#c8a840',
    });

    const page = PAGES[this.page];
    const centreX = modal.x + modal.width * HALF;
    const contentX = modal.x + PANEL_PADDING;
    const contentW = modal.width - PANEL_PADDING * 2;

    drawText(ctx, page.title, {
      x: centreX,
      y: modal.y + PANEL_PADDING,
      size: TITLE_SIZE,
      bold: true,
      color: ACCENT,
      align: 'center',
    });

    const footerTop = modal.y + panelH - PANEL_PADDING - MIN_TOUCH_TARGET_PX;
    const dotsY = footerTop - DOT_ROW_GAP;
    // The hints checkbox sits on every page rather than only the last one: a
    // setting the player has to read eight pages to find may as well not exist.
    const toggleTop = dotsY - TOGGLE_ROW_GAP - MIN_TOUCH_TARGET_PX;

    const bodyTop = modal.y + PANEL_PADDING + TITLE_GAP;
    const bandHeight =
      panelH >= ILLUSTRATION_MIN_PANEL_HEIGHT ? panelH * ILLUSTRATION_HEIGHT_FRACTION : 0;
    const bandTop = toggleTop - ILLUSTRATION_GAP - bandHeight;

    drawText(ctx, page.body, {
      x: contentX,
      y: bodyTop,
      width: contentW,
      size: BODY_SIZE,
      lineHeight: BODY_LINE_HEIGHT,
      color: BODY_COLOR,
      align: 'center',
    });

    if (bandHeight > 0) {
      drawIllustration(ctx, page.illustration, contentX, bandTop, contentW, bandHeight);
    }

    this.hintsToggleButton = drawButton(ctx, {
      x: centreX,
      y: toggleTop,
      width: Math.min(TOGGLE_BTN_WIDTH, contentW),
      height: MIN_TOUCH_TARGET_PX,
      alignX: 'center',
      label: `${hintsEnabled ? CHECKBOX_TICKED : CHECKBOX_EMPTY}  Show strategy hints`,
      labelSize: FOOTER_LABEL_SIZE,
      ...(hintsEnabled ? BUTTON_PRESETS.success : BUTTON_PRESETS.primary),
    });

    drawPageDots(ctx, centreX, dotsY, this.page);
    this.renderFooter(ctx, centreX, footerTop, contentW);
  }

  /** The way out: "Skip" while this is the unasked-for tutorial, "Close" otherwise. */
  private skipLabel(): string {
    if (this.autoShown) return platform.isMobile ? 'Skip' : 'Skip [Esc]';
    return platform.isMobile ? 'Close' : 'Close [Esc]';
  }

  private renderFooter(
    ctx: CanvasRenderingContext2D,
    centreX: number,
    footerTop: number,
    available: number,
  ): void {
    // Three fixed-width buttons overflow the compact panel, so the row is
    // measured against the content width rather than assumed to fit.
    const buttonWidth = Math.min(
      FOOTER_BTN_WIDTH,
      (available - FOOTER_BTN_GAP * (FOOTER_BUTTON_COUNT - 1)) / FOOTER_BUTTON_COUNT,
    );
    const rowWidth = buttonWidth * FOOTER_BUTTON_COUNT + FOOTER_BTN_GAP * (FOOTER_BUTTON_COUNT - 1);
    let x = centreX - rowWidth * HALF;

    beginMenuFocus('blackjack-rules');
    this.backButton = drawButton(ctx, {
      x,
      y: footerTop,
      width: buttonWidth,
      height: MIN_TOUCH_TARGET_PX,
      label: '‹ Back',
      labelSize: FOOTER_LABEL_SIZE,
      disabled: this.page === 0,
      ...BUTTON_PRESETS.primary,
    });
    x += buttonWidth + FOOTER_BTN_GAP;

    this.nextButton = drawButton(ctx, {
      x,
      y: footerTop,
      width: buttonWidth,
      height: MIN_TOUCH_TARGET_PX,
      label: this.page >= PAGES.length - 1 ? 'Done' : 'Next ›',
      labelSize: FOOTER_LABEL_SIZE,
      ...BUTTON_PRESETS.gold,
    });
    x += buttonWidth + FOOTER_BTN_GAP;

    this.closeButton = drawButton(ctx, {
      x,
      y: footerTop,
      width: buttonWidth,
      height: MIN_TOUCH_TARGET_PX,
      label: this.skipLabel(),
      labelSize: FOOTER_LABEL_SIZE,
      ...BUTTON_PRESETS.primary,
      primaryAction: true,
    });
    endMenuFocus();
  }
}

function drawPageDots(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  y: number,
  current: number,
): void {
  const rowWidth = (PAGES.length - 1) * DOT_SPACING;
  ctx.save();
  for (let i = 0; i < PAGES.length; i++) {
    ctx.fillStyle = i === current ? ACCENT : 'rgba(200,168,64,0.28)';
    ctx.beginPath();
    ctx.arc(centreX - rowWidth * HALF + i * DOT_SPACING, y, DOT_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * One illustration band: a small hand of real card renders plus a caption, so
 * the rule on the page is shown with the same art the table uses.
 */
function drawIllustration(
  ctx: CanvasRenderingContext2D,
  kind: IllustrationKind,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const spec = ILLUSTRATIONS[kind];
  const captionY = y + height - ILLUSTRATION_CAPTION_SIZE * 2;
  // The fanned cards on the shuffle page rotate past their own box, so the art
  // gives up a gap rather than letting a corner sit on the caption.
  const artHeight = captionY - y - ILLUSTRATION_GAP;

  if (kind === 'chip_stack') {
    const radius = artHeight * CHIP_ILLUSTRATION_RADIUS_FRACTION;
    drawChipStack(
      ctx,
      x + width * HALF,
      y + artHeight * CHIP_ILLUSTRATION_BASE_FRACTION,
      radius,
      CHIP_ILLUSTRATION_STACK,
    );
  } else {
    drawIllustrationHand(ctx, spec, kind, x, y, width, artHeight);
  }

  drawText(ctx, spec.caption, {
    x: x + width * HALF,
    y: captionY,
    size: ILLUSTRATION_CAPTION_SIZE,
    color: CAPTION_COLOR,
    align: 'center',
  });
}

function drawIllustrationHand(
  ctx: CanvasRenderingContext2D,
  spec: IllustrationSpec,
  kind: IllustrationKind,
  x: number,
  y: number,
  width: number,
  artHeight: number,
): void {
  const slots = spec.faceUp.length + spec.faceDownCount;
  if (slots === 0) return;
  const byHeight = artHeight / CARD_ASPECT;
  const byWidth = (width * ILLUSTRATION_CARD_WIDTH_FRACTION) / slots;
  const cardW = Math.max(1, Math.min(byHeight, byWidth));
  const step = cardW * ILLUSTRATION_CARD_STEP;
  const left = x + (width - (step * (slots - 1) + cardW)) * HALF;
  const top = y + (artHeight - cardW * CARD_ASPECT) * HALF;

  spec.faceUp.forEach((card, i) => {
    drawCardFace(ctx, card, { x: left + step * i, y: top, width: cardW });
  });
  for (let i = 0; i < spec.faceDownCount; i++) {
    const slot = spec.faceUp.length + i;
    // The shuffle page fans its backs, so the page reads as cards in motion.
    const rotation = kind === 'shuffle' ? (i - 1) * SHUFFLE_FAN_ROTATION : 0;
    drawCardBack(ctx, { x: left + step * slot, y: top, width: cardW, rotation });
  }
}
