/**
 * The blackjack rules sheet's pages and their illustrations: a small hand of
 * the table's own card renders, or its chip stack, over a caption.
 */

import { worldText } from '../../world/worldText';
import type { Card } from '../../../systems/casino/Deck';
import { CARD_ASPECT, drawCardBack, drawCardFace } from '../../casino/PlayingCard';
import { drawChipStack } from '../../casino/ChipStack';
import { chromeTarget } from '../../screens/dialogs/canvasChrome';
import {
  CHIP_DENOMINATIONS,
  TABLE_MAXIMUM,
  TABLE_MINIMUM,
} from '../../../systems/casino/BlackjackTable';
import { RESHUFFLE_THRESHOLD } from '../../../systems/casino/Deck';

const ILLUSTRATION_CARD_WIDTH_FRACTION = 0.6;
const ILLUSTRATION_GAP = 12;
const ILLUSTRATION_CAPTION_SIZE = 10;
const CAPTION_COLOR = '#9a8c68';
const HALF = 0.5;

export type BlackjackIllustrationKind =
  | 'beating_hand'
  | 'ace_and_king'
  | 'bust'
  | 'soft_seventeen'
  | 'hole_flip'
  | 'natural'
  | 'double_down'
  | 'chip_stack'
  | 'shuffle';

export interface BlackjackRulesPage {
  readonly title: string;
  readonly body: string;
  readonly illustration: BlackjackIllustrationKind;
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

export const BLACKJACK_RULES_PAGES: ReadonlyArray<BlackjackRulesPage> = [
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

const ILLUSTRATIONS: Record<BlackjackIllustrationKind, IllustrationSpec> = {
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

/**
 * One illustration band: a small hand of real card renders plus a caption, so
 * the rule on the page is shown with the same art the table uses.
 */
export function drawBlackjackIllustration(
  ctx: CanvasRenderingContext2D,
  kind: BlackjackIllustrationKind,
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
      chromeTarget(ctx),
      x + width * HALF,
      y + artHeight * CHIP_ILLUSTRATION_BASE_FRACTION,
      radius,
      CHIP_ILLUSTRATION_STACK,
    );
  } else {
    drawIllustrationHand(ctx, spec, kind, x, y, width, artHeight);
  }

  worldText(ctx, spec.caption, {
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
  kind: BlackjackIllustrationKind,
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
