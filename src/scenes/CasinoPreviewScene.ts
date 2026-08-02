/**
 * Localhost-only harness for reviewing the blackjack table, reached via
 * `?casino` in `devBootScene`. Ships no behaviour to players.
 *
 * Four tabs:
 *  - **Cards** — all 52 faces plus the back at three sizes, which is the only
 *    way to judge whether a rank index collides with a pip at the smallest size
 *    the panel produces.
 *  - **Panel** — the live table letterboxed into a chosen viewport, so a desktop
 *    reviewer sees the phone layout accurately instead of approximately.
 *  - **Dealer** — Deuce's portrait and world figure in every animation state.
 *  - **Deck** — a live shoe readout plus the simulation that asserts the
 *    no-repeat and money-conservation invariants and prints a line per check.
 */

import { Scene } from '../core/Scene';
import { setViewportSize, viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { drawButton, BUTTON_PRESETS, setButtonMouseState, type ButtonResult } from '../ui/Button';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { TILE_SIZE } from '../core/constants';
import { createClubMembership, type ClubMembership } from '../core/ClubMembership';
import { ClubCasinoSystem } from '../systems/ClubCasinoSystem';
import {
  Deck,
  RANKS,
  SUITS,
  cardId,
  DECK_SIZE,
  RESHUFFLE_THRESHOLD,
  type Card,
} from '../systems/casino/Deck';
import { handValue, isNaturalBlackjack, payoutFor } from '../systems/casino/blackjackRules';
import {
  BlackjackTable,
  CHIP_DENOMINATIONS,
  TABLE_MINIMUM,
} from '../systems/casino/BlackjackTable';
import { CARD_ASPECT, drawCardBack, drawCardFace } from '../ui/casino/PlayingCard';
import {
  drawCasinoDealer,
  drawDeucePortrait,
  type DealerState,
} from '../sprites/casinoDealerSprite';

const BG_COLOR = '#151d18';
const PANEL_COLOR = '#1e2a22';
const LABEL_COLOR = '#e2e8f0';
const SUBLABEL_COLOR = '#93a2c0';
const PASS_COLOR = '#6ee87a';
const FAIL_COLOR = '#e87a7a';

const MARGIN = 24;
const TITLE_SIZE = 18;
const LABEL_SIZE = 12;
const SMALL_LABEL_SIZE = 10;
const TAB_HEIGHT = 30;
const TAB_WIDTH = 96;
const TAB_GAP = 6;
const TAB_ROW_Y = 40;
const TAB_ROW_GAP = 16;
const CONTENT_TOP = TAB_ROW_Y + TAB_HEIGHT + TAB_ROW_GAP;

const TABS = ['Cards', 'Panel', 'Dealer', 'Deck'] as const;
type PreviewTab = (typeof TABS)[number];

// Cards tab.
const CARD_SIZE_LARGE = 68;
const CARD_SIZE_MEDIUM = 44;
const CARD_SIZE_SMALL = 28;
const CARD_SIZES: ReadonlyArray<number> = [CARD_SIZE_LARGE, CARD_SIZE_MEDIUM, CARD_SIZE_SMALL];
const CARD_GRID_GAP = 6;
const CARD_ROW_GAP = 22;
const SIZE_SECTION_GAP = 18;

// Panel tab — the review matrix.
interface PreviewViewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORT_MATRIX: ReadonlyArray<PreviewViewport> = [
  { label: '360×640', width: 360, height: 640 },
  { label: '390×844', width: 390, height: 844 },
  { label: '844×390', width: 844, height: 390 },
  { label: '768×1024', width: 768, height: 1024 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1920×1080', width: 1920, height: 1080 },
];

const VIEWPORT_BTN_WIDTH = 82;
const VIEWPORT_BTN_HEIGHT = 26;
const VIEWPORT_BTN_GAP = 6;
const PREVIEW_STARTING_COINS = 400;

// Dealer tab.
const DEALER_STATES: ReadonlyArray<DealerState> = [
  'idle',
  'dealing',
  'flipping',
  'waiting_on_player',
  'concede',
  'smug',
  'impressed',
  'bust',
];
const PORTRAIT_CELL_W = 130;
const PORTRAIT_CELL_H = 170;
const PORTRAIT_COLUMNS = 4;
const PORTRAIT_INSET = 8;
/** Room left under a portrait cell for its caption, in multiples of the inset. */
const PORTRAIT_CAPTION_INSETS = 3;
const WORLD_FIGURE_TILE = 96;
const WORLD_FIGURE_GAP = 40;

// Deck tab.
const SIMULATED_ROUNDS = 10000;
/** Stack-then-clear repetitions used to prove reversible bets never count as wagers. */
const CLEAR_CYCLES = 50;
/** One 60fps frame, so the simulation drives the model's beats the way the panel does. */
const SIM_FRAME_MS = 16;
/** Generous ceiling on frames per simulated round — a real round settles in far fewer. */
const SIM_MAX_FRAMES_PER_ROUND = 400;
/** Every Nth simulated round doubles down, and every Mth takes a hit first. */
const DOUBLE_EVERY = 7;
const HIT_EVERY = 3;
/** Deals to try before giving up on reaching a live player turn. */
const MID_HAND_DEAL_ATTEMPTS = 40;
/** Closes applied back to back when checking that a refund cannot repeat. */
const CLOSE_REPEATS = 3;
/** The fewest cards any round consumes: two to each side. */
const SIM_CARDS_PER_ROUND_MIN = 4;
const SIM_CARDS_PER_ROUND_MAX = 11;
const LINE_HEIGHT = 18;
const READOUT_BTN_WIDTH = 200;
const READOUT_BTN_HEIGHT = 30;

/** The expected totals for the ace-promotion check, spelled out rather than inline. */
const SOFT_TWENTY_ONE = 21;
const HARD_TWELVE = 12;

interface InvariantResult {
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
}

/** A freshly shuffled deck holds all 52 (rank, suit) pairs exactly once. */
function checkFreshDeckComplete(): InvariantResult {
  const deck = Deck.fresh();
  const seen = new Set<string>();
  for (let i = 0; i < DECK_SIZE; i++) {
    const card = deck.draw();
    if (card === null) break;
    seen.add(cardId(card));
  }
  const expected = SUITS.length * RANKS.length;
  return {
    label: 'Fresh deck holds all 52 cards exactly once',
    passed: seen.size === expected,
    detail: `${seen.size}/${expected} distinct`,
  };
}

/** Drawing all 52 yields 52 distinct cards; the 53rd draw is null. */
function checkExhaustion(): InvariantResult {
  const deck = Deck.fresh();
  for (let i = 0; i < DECK_SIZE; i++) deck.draw();
  const overdraw = deck.draw();
  return {
    label: 'The 53rd draw returns null rather than reshuffling',
    passed: overdraw === null && deck.remaining === 0,
    detail: overdraw === null ? 'null as expected' : 'a card resurfaced',
  };
}

/**
 * The rule the feature exists for: across a long run of rounds with reshuffles,
 * no card identity appears twice between two consecutive shuffles. Tested
 * directly rather than inferred from the code shape.
 */
function checkNoRepeatsBetweenShuffles(): InvariantResult {
  const deck = Deck.fresh();
  let seen = new Set<string>();
  let duplicates = 0;
  let shuffles = 0;

  for (let round = 0; round < SIMULATED_ROUNDS; round++) {
    const cardsThisRound =
      SIM_CARDS_PER_ROUND_MIN +
      Math.floor(Math.random() * (SIM_CARDS_PER_ROUND_MAX - SIM_CARDS_PER_ROUND_MIN));
    for (let i = 0; i < cardsThisRound; i++) {
      const card = deck.draw();
      if (card === null) {
        duplicates++;
        break;
      }
      const id = cardId(card);
      if (seen.has(id)) duplicates++;
      seen.add(id);
    }
    if (deck.needsReshuffle) {
      deck.shuffle();
      seen = new Set<string>();
      shuffles++;
    }
  }

  return {
    label: `No card repeats between shuffles (${SIMULATED_ROUNDS} rounds)`,
    passed: duplicates === 0,
    detail: `${shuffles} reshuffles, ${duplicates} repeats`,
  };
}

/**
 * Reshuffle flags at exactly the threshold, not somewhere near it.
 *
 * That the threshold also leaves room for a whole round is a static fact —
 * `RESHUFFLE_THRESHOLD` is above the most cards one hand can take before
 * busting — so there is nothing to measure there, only the flag point itself.
 */
function checkReshuffleThreshold(): InvariantResult {
  const deck = Deck.fresh();
  let drawsBeforeFlag = 0;
  while (!deck.needsReshuffle) {
    deck.draw();
    drawsBeforeFlag++;
  }
  const expectedDraws = DECK_SIZE - RESHUFFLE_THRESHOLD;
  return {
    label: `Reshuffle flags at exactly ${RESHUFFLE_THRESHOLD} cards left`,
    passed: drawsBeforeFlag === expectedDraws && deck.remaining === RESHUFFLE_THRESHOLD,
    detail: `flagged after ${drawsBeforeFlag} draws (expected ${expectedDraws}), ${deck.remaining} left`,
  };
}

/** Ace promotion: A+A+9 is a soft 21; A+A+A+9 is a hard 12; A+K is a natural. */
function checkAceHandling(): InvariantResult {
  const ace: Card = { rank: 'A', suit: 'spades' };
  const otherAce: Card = { rank: 'A', suit: 'hearts' };
  const thirdAce: Card = { rank: 'A', suit: 'clubs' };
  const nine: Card = { rank: '9', suit: 'diamonds' };
  const king: Card = { rank: 'K', suit: 'hearts' };

  const two = handValue([ace, otherAce, nine]);
  const three = handValue([ace, otherAce, thirdAce, nine]);
  const natural = isNaturalBlackjack([ace, king]);
  const passed =
    two.total === SOFT_TWENTY_ONE &&
    two.soft &&
    three.total === HARD_TWELVE &&
    !three.soft &&
    natural;
  return {
    label: 'Ace promotion: A+A+9 soft 21, A+A+A+9 hard 12, A+K natural',
    passed,
    detail: `${two.total}${two.soft ? ' soft' : ''} / ${three.total}${three.soft ? ' soft' : ''} / ${natural ? 'natural' : 'not natural'}`,
  };
}

/**
 * Coins never drift: after every round the balance equals what went out as stake
 * and what came back as payout. Deliberately plays hits, busts and double-downs
 * as well as plain stands — a stand-only run never touches the second debit that
 * doubling makes, which is where a drift would actually hide.
 */
function checkMoneyConservation(): InvariantResult {
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  const table = new BlackjackTable(null);
  let drift = 0;
  let rounds = 0;
  let doubles = 0;
  let hits = 0;
  let mispaid = 0;

  for (let round = 0; round < SIMULATED_ROUNDS; round++) {
    // Topped up every round so a losing streak can never starve the run down to
    // the handful of rounds a fixed bankroll would allow.
    player.coins = PREVIEW_STARTING_COINS;
    table.sitDown(player);
    const before = player.coins;
    table.addChip(CHIP_DENOMINATIONS[round % CHIP_DENOMINATIONS.length], player);
    let staked = table.betTotal;
    table.deal();

    for (let frame = 0; frame < SIM_MAX_FRAMES_PER_ROUND && table.phase !== 'settled'; frame++) {
      table.update(SIM_FRAME_MS);
      if (table.phase !== 'player_turn') continue;
      if (round % DOUBLE_EVERY === 0 && table.canDoubleDown(player)) {
        staked += table.stake;
        table.doubleDown(player);
        doubles++;
      } else if (round % HIT_EVERY === 0) {
        table.hit();
        hits++;
      } else {
        table.stand();
      }
    }
    if (table.phase !== 'settled') break;

    const outcome = table.outcome;
    const payout = table.collectPayout(player);
    if (player.coins !== before - staked + payout) drift++;
    // Ledger self-consistency alone would pass a hand that paid the wrong
    // amount, so the payout is also checked against what the outcome owes.
    if (outcome === null || payout !== payoutFor(outcome, staked)) mispaid++;
    rounds++;
    table.nextHand(player);
  }

  return {
    label: `Coins reconcile and pay correctly (${rounds} rounds, ${doubles} doubles, ${hits} hits)`,
    passed: drift === 0 && mispaid === 0 && rounds === SIMULATED_ROUNDS,
    detail: `${drift} drifting rounds, ${mispaid} mispaid`,
  };
}

/** Stacking chips then leaving returns the player to exactly their starting coins. */
function checkBetRefund(): InvariantResult {
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  player.coins = PREVIEW_STARTING_COINS;
  const table = new BlackjackTable(null);
  table.sitDown(player);
  for (const denomination of CHIP_DENOMINATIONS) table.addChip(denomination, player);
  const midBet = player.coins;
  table.leaveTable(player);
  return {
    label: 'Stacking chips then leaving refunds to the exact starting coins',
    passed: player.coins === PREVIEW_STARTING_COINS && midBet < PREVIEW_STARTING_COINS,
    detail: `${midBet} mid-bet → ${player.coins} after leaving`,
  };
}

/** Reversible bets are not wagers: stacking and clearing must never count. */
function checkClearedBetsAreNotWagered(): InvariantResult {
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  player.coins = PREVIEW_STARTING_COINS;
  const table = new BlackjackTable(null);
  table.sitDown(player);
  for (let cycle = 0; cycle < CLEAR_CYCLES; cycle++) {
    for (const denomination of CHIP_DENOMINATIONS) table.addChip(denomination, player);
    table.clearBet(player);
  }
  return {
    label: `${CLEAR_CYCLES} stack-then-clear cycles leave the wager total at zero`,
    passed: table.coinsWagered === 0 && player.coins === PREVIEW_STARTING_COINS,
    detail: `wagered ${table.coinsWagered}, coins ${player.coins}`,
  };
}

/**
 * Every exit the game has — the Leave Table button, the Esc chain and the
 * interior scene tearing down — lands on `ClubCasinoSystem.close`, so what has
 * to hold is that closing refunds the felt and repeating it cannot refund twice.
 */
function checkEveryExitRefunds(): InvariantResult {
  const failures: string[] = [];

  const closeCounts: ReadonlyArray<number> = [1, CLOSE_REPEATS];
  for (const closes of closeCounts) {
    const player = new HumanPlayer(0, 0, TILE_SIZE);
    player.coins = PREVIEW_STARTING_COINS;
    const casino = new ClubCasinoSystem(null, createClubMembership());
    casino.openTable(player);
    casino.dismissRules();
    casino.placeChip(CHIP_DENOMINATIONS[CHIP_DENOMINATIONS.length - 1], player);
    if (player.coins >= PREVIEW_STARTING_COINS) {
      failures.push(`${closes}× close: the chip never left the tray`);
    }
    for (let i = 0; i < closes; i++) casino.close(player);
    if (player.coins !== PREVIEW_STARTING_COINS) {
      failures.push(`${closes}× close: ${player.coins} coins, expected ${PREVIEW_STARTING_COINS}`);
    }
  }

  return {
    label: 'Closing the table refunds a pending bet exactly once, however many times it is closed',
    passed: failures.length === 0,
    detail:
      failures.length === 0 ? 'single and repeated closes both reconcile' : failures.join('; '),
  };
}

/**
 * Leaving mid-hand plays the hand out rather than stranding the stake. The table
 * does not survive leaving the club, so a locked stake left behind is a stake
 * destroyed.
 */
function checkMidHandExitResolves(): InvariantResult {
  const player = new HumanPlayer(0, 0, TILE_SIZE);

  // A player natural, or the dealer's peek, settles the round before it ever
  // reaches `player_turn` — about one deal in ten. Those rounds exercise none of
  // the fast-forward, so the check re-deals until it gets a live hand instead of
  // passing on a hand that resolved itself. Each attempt gets its own table: a
  // skipped round leaves a payout owing that the next `sitDown` would credit
  // after the bankroll had already been reset.
  for (let attempt = 0; attempt < MID_HAND_DEAL_ATTEMPTS; attempt++) {
    const table = new BlackjackTable(null);
    player.coins = PREVIEW_STARTING_COINS;
    table.sitDown(player);
    table.addChip(CHIP_DENOMINATIONS[CHIP_DENOMINATIONS.length - 1], player);
    const stake = table.betTotal;
    table.deal();
    // Pump until the table stops moving on its own. Guarding on `dealing` alone
    // stops the moment a natural or the dealer's peek jumps to `dealer_turn`,
    // leaving the round unfinished and every later attempt a no-op.
    for (
      let frame = 0;
      frame < SIM_MAX_FRAMES_PER_ROUND &&
      table.phase !== 'player_turn' &&
      table.phase !== 'settled';
      frame++
    ) {
      table.update(SIM_FRAME_MS);
    }
    if (table.phase !== 'player_turn') continue;

    const midHandCoins = player.coins;
    table.leaveTable(player);
    // `outcome` is set only by `settle`, so it reports that the round finished
    // without re-reading `phase`, which the guard above has already narrowed.
    const outcome = table.outcome;
    const settled = outcome !== null;
    const owed = outcome === null ? 0 : payoutFor(outcome, stake);
    return {
      label: 'Leaving mid-hand plays the hand out instead of destroying the stake',
      passed:
        settled &&
        midHandCoins === PREVIEW_STARTING_COINS - stake &&
        player.coins === midHandCoins + owed,
      detail: settled
        ? `settled ${outcome.kind}, paid ${player.coins - midHandCoins} of ${stake}`
        : 'left unsettled',
    };
  }

  return {
    label: 'Leaving mid-hand plays the hand out instead of destroying the stake',
    passed: false,
    detail: `no hand reached player_turn in ${MID_HAND_DEAL_ATTEMPTS} deals`,
  };
}

function runInvariants(): ReadonlyArray<InvariantResult> {
  return [
    checkFreshDeckComplete(),
    checkExhaustion(),
    checkNoRepeatsBetweenShuffles(),
    checkReshuffleThreshold(),
    checkAceHandling(),
    checkMoneyConservation(),
    checkBetRefund(),
    checkEveryExitRefunds(),
    checkMidHandExitResolves(),
    checkClearedBetsAreNotWagered(),
  ];
}

export class CasinoPreviewScene extends Scene {
  private frames = 0;
  private tab: PreviewTab = 'Cards';
  private viewportIndex = 0;
  private results: ReadonlyArray<InvariantResult> | null = null;

  private mouseX = 0;
  private mouseY = 0;

  private tabButtons: Array<{ result: ButtonResult; tab: PreviewTab }> = [];
  private viewportButtons: Array<{ result: ButtonResult; index: number }> = [];
  private runButton: ButtonResult | null = null;

  private readonly membership: ClubMembership = createClubMembership();
  private readonly player = new HumanPlayer(0, 0, TILE_SIZE);
  private readonly casino = new ClubCasinoSystem(null, this.membership);

  constructor() {
    super();
    this.player.coins = PREVIEW_STARTING_COINS;
    this.casino.openTable(this.player);
    this.casino.dismissRules();
  }

  handleMouseMove(mx: number, my: number): void {
    this.mouseX = mx;
    this.mouseY = my;
  }

  handleClick(mx: number, my: number): void {
    for (const tab of this.tabButtons) {
      if (tab.result.contains(mx, my)) {
        this.tab = tab.tab;
        return;
      }
    }
    if (this.tab === 'Panel') {
      for (const button of this.viewportButtons) {
        if (button.result.contains(mx, my)) {
          this.viewportIndex = button.index;
          return;
        }
      }
      const inset = this.panelInset();
      this.casino.handleClick(mx - inset.x, my - inset.y, this.player);
      return;
    }
    if (this.tab === 'Deck' && this.runButton?.contains(mx, my) === true) {
      this.results = runInvariants();
    }
  }

  update(): void {
    this.frames += 1;
    if (this.tab !== 'Panel') return;
    if (!this.casino.open) this.casino.openTable(this.player);
    if (this.player.coins < TABLE_MINIMUM) this.player.coins = PREVIEW_STARTING_COINS;
    this.casino.update(this.player);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    setButtonMouseState(this.mouseX, this.mouseY);

    drawText(ctx, 'Blackjack — Desperado Club review harness', {
      x: MARGIN,
      y: 14,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });

    this.renderTabs(ctx);

    switch (this.tab) {
      case 'Cards':
        this.renderCardsTab(ctx, width);
        return;
      case 'Panel':
        this.renderPanelTab(ctx, width, height);
        return;
      case 'Dealer':
        this.renderDealerTab(ctx);
        return;
      case 'Deck':
        this.renderDeckTab(ctx);
        return;
    }
  }

  private renderTabs(ctx: CanvasRenderingContext2D): void {
    this.tabButtons = [];
    TABS.forEach((tab, i) => {
      const result = drawButton(ctx, {
        x: MARGIN + i * (TAB_WIDTH + TAB_GAP),
        y: TAB_ROW_Y,
        width: TAB_WIDTH,
        height: TAB_HEIGHT,
        label: tab,
        ...(tab === this.tab ? BUTTON_PRESETS.gold : BUTTON_PRESETS.primary),
      });
      this.tabButtons.push({ result, tab });
    });
  }

  private renderCardsTab(ctx: CanvasRenderingContext2D, width: number): void {
    let y = CONTENT_TOP;
    for (const size of CARD_SIZES) {
      drawText(ctx, `${size}px wide`, {
        x: MARGIN,
        y,
        size: LABEL_SIZE,
        bold: true,
        color: LABEL_COLOR,
      });
      y += LINE_HEIGHT;

      const perRow = Math.max(1, Math.floor((width - MARGIN * 2) / (size + CARD_GRID_GAP)));
      let column = 0;
      let rowTop = y;
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          const x = MARGIN + column * (size + CARD_GRID_GAP);
          drawCardFace(ctx, { rank, suit }, { x, y: rowTop, width: size });
          column++;
          if (column >= perRow) {
            column = 0;
            rowTop += size * CARD_ASPECT + CARD_GRID_GAP;
          }
        }
      }
      // The back sits at the end of the run, so it is compared against faces at
      // the same size rather than in isolation.
      drawCardBack(ctx, {
        x: MARGIN + column * (size + CARD_GRID_GAP),
        y: rowTop,
        width: size,
      });
      y = rowTop + size * CARD_ASPECT + CARD_ROW_GAP + SIZE_SECTION_GAP;
    }
  }

  /** Top-left of the letterboxed viewport, so clicks can be mapped into it. */
  private panelInset(): { x: number; y: number } {
    return { x: MARGIN, y: CONTENT_TOP + VIEWPORT_BTN_HEIGHT + CARD_ROW_GAP };
  }

  private renderPanelTab(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.viewportButtons = [];
    VIEWPORT_MATRIX.forEach((viewport, i) => {
      const result = drawButton(ctx, {
        x: MARGIN + i * (VIEWPORT_BTN_WIDTH + VIEWPORT_BTN_GAP),
        y: CONTENT_TOP,
        width: VIEWPORT_BTN_WIDTH,
        height: VIEWPORT_BTN_HEIGHT,
        label: viewport.label,
        labelSize: SMALL_LABEL_SIZE,
        ...(i === this.viewportIndex ? BUTTON_PRESETS.gold : BUTTON_PRESETS.primary),
      });
      this.viewportButtons.push({ result, index: i });
    });

    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const inset = this.panelInset();

    ctx.fillStyle = PANEL_COLOR;
    ctx.fillRect(inset.x, inset.y, viewport.width, viewport.height);

    // The panel reads the viewport globals, so the simulated size is installed
    // for the duration of its render and restored immediately afterwards.
    ctx.save();
    ctx.translate(inset.x, inset.y);
    ctx.beginPath();
    ctx.rect(0, 0, viewport.width, viewport.height);
    ctx.clip();
    setViewportSize(viewport.width, viewport.height);
    setButtonMouseState(this.mouseX - inset.x, this.mouseY - inset.y);
    this.casino.renderPanel(ctx, this.player);
    setViewportSize(width, height);
    ctx.restore();
    setButtonMouseState(this.mouseX, this.mouseY);

    drawText(ctx, `${viewport.label} — click inside to play the table`, {
      x: inset.x,
      y: inset.y + viewport.height + CARD_GRID_GAP,
      size: SMALL_LABEL_SIZE,
      color: SUBLABEL_COLOR,
    });
  }

  private renderDealerTab(ctx: CanvasRenderingContext2D): void {
    DEALER_STATES.forEach((state, i) => {
      const column = i % PORTRAIT_COLUMNS;
      const row = Math.floor(i / PORTRAIT_COLUMNS);
      const x = MARGIN + column * PORTRAIT_CELL_W;
      const y = CONTENT_TOP + row * PORTRAIT_CELL_H;
      ctx.fillStyle = PANEL_COLOR;
      ctx.fillRect(
        x,
        y,
        PORTRAIT_CELL_W - PORTRAIT_INSET,
        PORTRAIT_CELL_H - PORTRAIT_INSET * PORTRAIT_CAPTION_INSETS,
      );
      drawDeucePortrait(
        ctx,
        x,
        y,
        PORTRAIT_CELL_W - PORTRAIT_INSET,
        PORTRAIT_CELL_H - PORTRAIT_INSET * PORTRAIT_CAPTION_INSETS,
        state,
        this.frames,
        { lookY: 1 },
      );
      drawText(ctx, state, {
        x: x + (PORTRAIT_CELL_W - PORTRAIT_INSET) / 2,
        y: y + PORTRAIT_CELL_H - PORTRAIT_INSET * 2,
        size: SMALL_LABEL_SIZE,
        color: SUBLABEL_COLOR,
        align: 'center',
      });
    });

    const worldRow =
      CONTENT_TOP + Math.ceil(DEALER_STATES.length / PORTRAIT_COLUMNS) * PORTRAIT_CELL_H;
    drawText(ctx, 'World figure — resting / dealing', {
      x: MARGIN,
      y: worldRow,
      size: LABEL_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });
    [false, true].forEach((dealing, i) => {
      drawCasinoDealer(
        ctx,
        MARGIN + i * (WORLD_FIGURE_TILE + WORLD_FIGURE_GAP),
        worldRow + LINE_HEIGHT,
        WORLD_FIGURE_TILE,
        this.frames,
        dealing,
      );
    });
  }

  private renderDeckTab(ctx: CanvasRenderingContext2D): void {
    this.runButton = drawButton(ctx, {
      x: MARGIN,
      y: CONTENT_TOP,
      width: READOUT_BTN_WIDTH,
      height: READOUT_BTN_HEIGHT,
      label: 'Run invariant checks',
      ...BUTTON_PRESETS.gold,
    });

    let y = CONTENT_TOP + READOUT_BTN_HEIGHT + CARD_ROW_GAP;
    const results = this.results;
    if (results === null) {
      drawText(ctx, 'Not run yet — the long checks simulate 10,000 rounds and take a moment.', {
        x: MARGIN,
        y,
        size: LABEL_SIZE,
        color: SUBLABEL_COLOR,
      });
      return;
    }

    for (const result of results) {
      drawText(ctx, `${result.passed ? 'PASS' : 'FAIL'}  ${result.label}  —  ${result.detail}`, {
        x: MARGIN,
        y,
        size: LABEL_SIZE,
        color: result.passed ? PASS_COLOR : FAIL_COLOR,
      });
      y += LINE_HEIGHT;
    }
  }
}
