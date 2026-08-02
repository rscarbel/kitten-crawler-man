/**
 * The Desperado Club's blackjack table — the presentation and input host over
 * {@link BlackjackTable}.
 *
 * No game logic lives here: every button forwards to a table action, and every
 * animation is driven off the model's phase and the events it emits. That split
 * is what lets the money and deck invariants be exercised without a canvas.
 *
 * The shoe outlives the club scene, so it is hydrated from `ClubMembership` on
 * construction and written back after every round — walking out cannot reroll a
 * bad deck.
 */

import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { ClubMembership } from '../core/ClubMembership';
import { drawText } from '../ui/TextBox';
import {
  drawModal,
  drawOverlay,
  drawBox,
  BOX_PRESETS,
  fitModal,
  beginModalFit,
  endModalFit,
  modalFitPoint,
  MODAL_FIT_NONE,
  type ModalFit,
} from '../ui/Box';
import {
  drawButton,
  BUTTON_PRESETS,
  setButtonPointerSpace,
  resetButtonPointerSpace,
  type ButtonOptions,
  type ButtonResult,
} from '../ui/Button';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { platform } from '../core/Platform';
import {
  BlackjackTable,
  CHIP_DENOMINATIONS,
  HINTS_AUTO_FADE_HANDS,
  LONG_SESSION_HANDS,
  TABLE_MINIMUM,
  type ChipDenomination,
  type TableEvent,
} from './casino/BlackjackTable';
import { handValue, isBust, netForOutcome } from './casino/blackjackRules';
import { basicStrategyAdvice } from './casino/basicStrategy';
import type { Card } from './casino/Deck';
import {
  casinoDesignHeight,
  casinoLayoutMode,
  computeCasinoLayout,
  handSpread,
  type CasinoLayout,
  type Rect,
} from '../ui/casino/casinoLayout';
import { CARD_ASPECT, drawCardBack, drawCardFace, drawCardFlip } from '../ui/casino/PlayingCard';
import {
  drawChip,
  drawChipStack,
  drawEmptyTrayOutline,
  chipStackTopY,
  trayChips,
  CHIP_STACK_STEP as CHIP_STACK_STEP_FRACTION,
} from '../ui/casino/ChipStack';
import { BlackjackRulesOverlay } from '../ui/casino/BlackjackRulesOverlay';
import { pickDeuceLine, type BanterTrigger } from '../ui/casino/deuceLines';
import { drawDeucePortrait, dealerStateFor, type DealerState } from '../sprites/casinoDealerSprite';

const OVERLAY_ALPHA = 0.7;
const PANEL_RADIUS = 10;
const PORTRAIT_RADIUS = 8;
const PANEL_BORDER = '#c8a840';
const PANEL_FILL = '#0d1a14';

const TITLE_SIZE = 16;
const READOUT_SIZE = 11;
const STATUS_SIZE = 14;
/** How much a win or a blackjack grows the outcome line over a neutral one. */
const STATUS_EMPHASIS_BUMP = 2;
const HINT_SIZE = 10;
const BANTER_SIZE = 11;
const BUTTON_LABEL_SIZE = 12;
const FOOTER_LABEL_SIZE = 11;
const HAND_LABEL_SIZE = 10;

const ACCENT = '#f0d870';
const SECONDARY_TEXT = '#cbbf98';
const MUTED_TEXT = '#8a7648';
const WIN_COLOR = '#6ee87a';
const LOSE_COLOR = '#e87a7a';
const PUSH_COLOR = '#c8c8a0';
const FEEDBACK_COLOR = '#f0b040';
const TURNED_AWAY_SCRIM = 'rgba(34,8,10,0.96)';
const TURNED_AWAY_TITLE_COLOR = '#ffe4e0';
const TURNED_AWAY_TITLE_SIZE = 22;
const FELT_GREEN = 'rgba(18,58,44,0.55)';
const BET_SPOT_FILL = 'rgba(10,36,27,0.6)';
const PORTRAIT_FILL = 'rgba(8,24,18,0.7)';
const PORTRAIT_BORDER = 'rgba(200,168,64,0.25)';
const FELT_LINE = 'rgba(200,168,64,0.35)';
/** The felt at full opacity, for the scrim the shuffle flourish plays on. */
const FELT_GREEN_OPAQUE = '#123a2c';

const BUTTON_GAP = 8;
/** Clear, Same Bet and Deal accompany the chip wells in the betting row. */
const BETTING_CONTROL_COUNT = 3;
/** Hit, Stand and Double. */
const TURN_CONTROL_COUNT = 3;
/** Next Hand and Same Bet. */
const SETTLED_CONTROL_COUNT = 2;
/** Compact mode splits an action row across this many rows of buttons. */
const COMPACT_ACTION_ROW_COUNT = 2;

// ── Animation timings, all in milliseconds off the panel's own clock ────────

const CARD_FLIGHT_MS = 260;
const FLIP_DURATION_MS = 340;
/** The point in a flip where the face becomes visible — the card is edge-on here. */
const FLIP_REVEAL_POINT = 0.5;
/** How long a chip takes to arc between the tray and the felt. */
const CHIP_FLIGHT_MS = 240;
const PAYOUT_SWEEP_MS = 620;
const SHUFFLE_FLOURISH_MS = 1000;
const BANTER_HOLD_MS = 4200;
const BANTER_FADE_MS = 600;
/** Frames longer than this are a tab-away, not a slow frame; the clock refuses to jump. */
const MAX_FRAME_MS = 100;

const CARD_FLIGHT_LIFT = 1.12;
const CARD_FLIGHT_OVERSHOOT = 0.08;
const CHIP_ARC_HEIGHT_FRACTION = 0.55;
const CHIP_LAND_BOUNCE = 0.12;

const COIN_TICKER_RATE = 0.14;
const COIN_TICKER_SNAP = 1;

const BUST_SHAKE_MS = 420;
const BUST_SHAKE_FREQUENCY = 26;
const BUST_SHAKE_AMPLITUDE = 3;
const BUST_DIM = 0.45;
const VIGNETTE_ALPHA = 0.55;
const BUST_VIGNETTE = 'rgba(160,30,30,1)';
/** The same tint at zero alpha — the gradient's inner stop. */
const BUST_VIGNETTE_CLEAR = 'rgba(160,30,30,0)';
/** Losing is frequent, so the bust tint is a flash rather than a hold. */
const BUST_VIGNETTE_MS = 700;
/** Inside this fraction of the panel's radius the vignette is fully transparent. */
const BUST_VIGNETTE_INNER_FRACTION = 0.45;

const COIN_PARTICLE_COUNT = 14;
const COIN_PARTICLE_MS = 900;
const COIN_PARTICLE_SPREAD = 90;
const COIN_PARTICLE_RISE = 70;
const COIN_PARTICLE_GRAVITY = 130;
const COIN_PARTICLE_RADIUS = 3;
const MS_PER_SECOND = 1000;

const SHUFFLE_CARD_COUNT = 8;
const SHUFFLE_CARD_WIDTH_FRACTION = 0.55;
const SHUFFLE_SPLIT_SPREAD = 0.42;
/** How fast the riffle's scrim lets the felt back through as the flourish ends. */
const SHUFFLE_SCRIM_FADE = 3;
/** Radians of tilt per pixel of riffle spread — small, so the halves lean rather than tumble. */
const SHUFFLE_TILT_PER_PX = 0.0008;

const TRAY_CHIP_RADIUS_FRACTION = 0.3;
const BET_CHIP_RADIUS_FRACTION = 0.3;
const CHIP_BUTTON_INSET = 4;
/** How much of a chip well's width the chip itself spans, so it fills the pill. */
const CHIP_WELL_FILL_FRACTION = 0.36;
/** Where the felt strip under Deuce's forearms sits inside the portrait. */
const DEALER_RACK_PORTRAIT_FRACTION = 0.86;
/** How far a disabled chip fades, so it still reads as a chip rather than vanishing. */
const DISABLED_CHIP_ALPHA = 0.4;

const WIN_HIGHLIGHT = 'rgba(240,216,112,0.8)';

/** Net winnings above which an ordinary win earns a word from Deuce. */
const BIG_WIN_COINS = 50;

const HINT_RETIREMENT_LINE = '"You\'ve got the hang of this — I\'ll stop calling the plays."';

/**
 * The table's cues play at full SFX volume. They used to duck for the club music
 * and the bar-crowd bed, which left them inaudible — the music bus carries that
 * headroom now (see `MUSIC_BUS_HEADROOM`), so the cards and chips can be heard.
 */
const TABLE_SFX_VOLUME = 1;
const CHIP_SFX_VOLUME = 1;

const HALF = 0.5;
const TWO_PI = Math.PI * 2;

type PanelAction =
  | { kind: 'chip'; denomination: ChipDenomination }
  | { kind: 'remove_chip' }
  | { kind: 'clear_bet' }
  | { kind: 'same_bet' }
  | { kind: 'deal' }
  | { kind: 'hit' }
  | { kind: 'stand' }
  | { kind: 'double' }
  | { kind: 'next_hand' }
  | { kind: 'repeat_hand' }
  | { kind: 'help' }
  | { kind: 'leave' };

/** The styling half of a `drawButton` call — everything but geometry and label. */
type CasinoButtonPreset = Partial<Omit<ButtonOptions, 'x' | 'y' | 'width' | 'height' | 'label'>>;

interface PanelButton {
  readonly result: ButtonResult;
  readonly action: PanelAction;
}

type HandSide = 'player' | 'dealer';

interface CardFlight {
  readonly side: HandSide;
  readonly index: number;
  readonly startedAt: number;
}

type ChipAnchor = 'tray' | 'felt' | 'rack';

interface ChipFlight {
  readonly denomination: number;
  readonly from: ChipAnchor;
  readonly to: ChipAnchor;
  readonly startedAt: number;
  readonly duration: number;
}

interface CoinParticle {
  readonly angle: number;
  readonly speed: number;
  readonly startedAt: number;
}

function easeOutCubic(t: number): number {
  const inverted = 1 - t;
  return 1 - inverted * inverted * inverted;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * How many chips fit in a stack of `height` px without running through the
 * caption above it.
 */
function visibleChipCapacity(height: number, radius: number): number {
  const usable = height - HAND_LABEL_SIZE - radius;
  return Math.max(1, Math.floor(usable / (radius * CHIP_STACK_STEP_FRACTION)));
}

function rectCentre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width * HALF, y: rect.y + rect.height * HALF };
}

export class ClubCasinoSystem {
  open = false;

  private readonly table: BlackjackTable;
  private readonly rules: BlackjackRulesOverlay;

  private animTime = 0;
  private lastFrameStamp: number | null = null;

  private fit: ModalFit = MODAL_FIT_NONE;
  private buttons: PanelButton[] = [];

  private readonly cardFlights: CardFlight[] = [];
  private readonly chipFlights: ChipFlight[] = [];
  private readonly coinParticles: CoinParticle[] = [];

  private flipStartedAt: number | null = null;
  private outcomeShownAt: number | null = null;
  private shuffleStartedAt: number | null = null;

  private banterLine: string | null = null;
  private banterStartedAt = 0;
  private lastBanterLine: string | null = null;
  private longSessionBanterFired = false;
  private hintsOfferMade = false;

  private displayedCoins = 0;
  /** Shown once per club visit, and again on demand from the panel's button. */
  private hasSeenRules = false;

  constructor(
    private readonly audio: AudioManager | null,
    private readonly membership: ClubMembership,
  ) {
    this.table = new BlackjackTable(membership.casinoShoe);
    this.rules = new BlackjackRulesOverlay(audio);
  }

  /** Total coins staked since entering the club — the free-security perk hook. */
  get coinsWageredThisVisit(): number {
    return this.table.coinsWagered;
  }

  get jackpotPending(): boolean {
    return this.table.jackpotPending;
  }

  set jackpotPending(value: boolean) {
    this.table.jackpotPending = value;
  }

  get rulesOpen(): boolean {
    return this.rules.isOpen;
  }

  dismissRules(): void {
    this.rules.dismiss();
  }

  /**
   * Stack one chip on the felt. The panel's own chip wells route through here,
   * and it is the entry point the preview harness uses to build a bet without a
   * rendered layout to click.
   */
  placeChip(denomination: ChipDenomination, player: Player): void {
    this.table.addChip(denomination, player);
  }

  openTable(player: Player): void {
    this.open = true;
    this.lastFrameStamp = null;
    this.displayedCoins = player.coins;
    this.table.sitDown(player);
    // Sitting down settles any leftover from the last session; those events
    // belong to a hand the player is no longer looking at.
    this.table.drainEvents();
    this.say(this.table.phase === 'turned_away' ? 'turned_away' : 'first_sit');
    if (!this.hasSeenRules) {
      this.hasSeenRules = true;
      this.rules.show(true);
    }
  }

  /**
   * Leaving the table. Refunds anything on the felt, because the felt is the one
   * place a coin could be stranded, and settles the shoe back onto the
   * membership so the next visit resumes this deck.
   */
  close(player: Player): void {
    // The chips sliding back to the tray are audible even though the panel is
    // already gone, so the refund is not silent. A parting line from Deuce would
    // not be: nothing renders the banter strip once `open` is false.
    if (this.open && this.table.pendingBet.length > 0) {
      this.audio?.play('casino_chips_stack', { volume: CHIP_SFX_VOLUME });
    }
    this.table.leaveTable(player);
    this.persistShoe();
    // Playing the hand out queues deal, flip and settle events. Nothing drains
    // them once the panel is shut, so without this they would fire on the next
    // visit — a stinger, a coin burst and a chip sweep over an empty felt.
    this.table.drainEvents();
    this.rules.dismiss();
    this.open = false;
  }

  private persistShoe(): void {
    this.membership.casinoShoe = this.table.shoeState();
  }

  /** Whether the live advice line is showing, resolving the not-yet-answered default. */
  private get hintsEnabled(): boolean {
    return this.membership.casinoHintsEnabled ?? this.table.handsPlayed < HINTS_AUTO_FADE_HANDS;
  }

  private toggleHints(): void {
    this.membership.casinoHintsEnabled = !this.hintsEnabled;
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  update(player: Player): void {
    const dtMs = this.tickClock();

    if (!this.open) return;

    this.table.update(dtMs);
    this.consumeEvents(player);
    this.expireAnimations();
    this.tickCoinTicker(player);
    this.maybeOfferHintRetirement();
  }

  /** Milliseconds since the last frame, refusing to jump after a tab-away. */
  private tickClock(): number {
    const now = performance.now();
    const previous = this.lastFrameStamp;
    this.lastFrameStamp = now;
    if (previous === null) return 0;
    const dtMs = Math.min(MAX_FRAME_MS, now - previous);
    this.animTime += dtMs;
    return dtMs;
  }

  private tickCoinTicker(player: Player): void {
    const gap = player.coins - this.displayedCoins;
    if (Math.abs(gap) <= COIN_TICKER_SNAP) {
      this.displayedCoins = player.coins;
      return;
    }
    this.displayedCoins += gap * COIN_TICKER_RATE;
  }

  private expireAnimations(): void {
    const dropExpired = (list: Array<{ startedAt: number }>, duration: number): void => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (this.animTime - list[i].startedAt >= duration) list.splice(i, 1);
      }
    };
    dropExpired(this.cardFlights, CARD_FLIGHT_MS);
    dropExpired(this.chipFlights, PAYOUT_SWEEP_MS);
    dropExpired(this.coinParticles, COIN_PARTICLE_MS);
    if (this.flipStartedAt !== null && this.animTime - this.flipStartedAt >= FLIP_DURATION_MS) {
      this.flipStartedAt = null;
    }
    if (
      this.shuffleStartedAt !== null &&
      this.animTime - this.shuffleStartedAt >= SHUFFLE_FLOURISH_MS
    ) {
      this.shuffleStartedAt = null;
    }
  }

  /** After a long enough run, Deuce offers to stop calling the plays — once. */
  private maybeOfferHintRetirement(): void {
    if (this.hintsOfferMade) return;
    if (this.membership.casinoHintsEnabled !== null) return;
    if (this.table.handsPlayed < HINTS_AUTO_FADE_HANDS) return;
    this.hintsOfferMade = true;
    this.showBanter(HINT_RETIREMENT_LINE);
  }

  private consumeEvents(player: Player): void {
    for (const event of this.table.drainEvents()) this.handleEvent(event, player);
  }

  private handleEvent(event: TableEvent, player: Player): void {
    switch (event.kind) {
      case 'chip_added':
        this.chipFlights.push({
          denomination: event.denomination,
          from: 'tray',
          to: 'felt',
          startedAt: this.animTime,
          duration: CHIP_FLIGHT_MS,
        });
        this.audio?.play(this.chipCueFor(event.denomination), { volume: CHIP_SFX_VOLUME });
        return;
      case 'chip_removed':
        this.chipFlights.push({
          denomination: event.denomination,
          from: 'felt',
          to: 'tray',
          startedAt: this.animTime,
          duration: CHIP_FLIGHT_MS,
        });
        this.audio?.play('casino_chips_stack', { volume: CHIP_SFX_VOLUME });
        return;
      case 'bet_cleared':
        if (event.refunded > 0) {
          this.audio?.play('casino_chips_stack', { volume: CHIP_SFX_VOLUME });
        }
        return;
      case 'opening_deal_started':
        // One cue under all four cards: firing the single-card sound four times
        // over the stagger phases against itself and reads as a stutter.
        this.audio?.play('casino_deal_four_cards', { volume: TABLE_SFX_VOLUME });
        return;
      case 'card_dealt':
        this.cardFlights.push({ side: event.to, index: event.index, startedAt: this.animTime });
        if (this.table.phase !== 'dealing') {
          this.audio?.play('casino_deal_card', { volume: TABLE_SFX_VOLUME });
        }
        return;
      case 'hole_revealed':
        this.flipStartedAt = this.animTime;
        this.audio?.play('casino_blackjack_check', { volume: TABLE_SFX_VOLUME });
        return;
      case 'settled':
        this.onSettled(event.outcome.kind, event.payout, event.stake, player);
        return;
      case 'reshuffled':
        this.shuffleStartedAt = this.animTime;
        this.audio?.playRandom(['casino_shuffle_1', 'casino_shuffle_2'], {
          volume: TABLE_SFX_VOLUME,
        });
        this.say('reshuffle');
        return;
    }
  }

  private chipCueFor(denomination: number): 'casino_chips_bet_small' | 'casino_chips_bet_big' {
    const atMaximum = this.table.betTotal >= this.table.tableMaximum;
    const heavy = denomination >= CHIP_DENOMINATIONS[CHIP_DENOMINATIONS.length - 1];
    return heavy || atMaximum ? 'casino_chips_bet_big' : 'casino_chips_bet_small';
  }

  private onSettled(
    kind: 'player_blackjack' | 'player_win' | 'dealer_win' | 'push',
    payout: number,
    stake: number,
    player: Player,
  ): void {
    this.outcomeShownAt = this.animTime;
    // The ledger settles the instant the hand does and the ticker counts up to
    // it, so a payout can never be lost to an interrupted animation.
    this.table.collectPayout(player);
    this.persistShoe();

    const won = kind === 'player_win' || kind === 'player_blackjack';
    // Winnings come home to the tray; a loss slides away to Deuce's rack.
    this.chipFlights.push({
      denomination: stake,
      from: 'felt',
      to: kind === 'dealer_win' ? 'rack' : 'tray',
      startedAt: this.animTime,
      duration: PAYOUT_SWEEP_MS,
    });

    if (won) {
      this.audio?.play(
        kind === 'player_blackjack' ? 'achievement_awarded' : 'treasure_chest_reward',
        { volume: TABLE_SFX_VOLUME },
      );
      this.audio?.play('coin_pouch', { volume: CHIP_SFX_VOLUME });
      this.audio?.play('casino_chips_stack', { volume: CHIP_SFX_VOLUME });
      this.spawnCoinBurst();
    } else if (kind === 'push') {
      this.audio?.play('casino_chips_stack', { volume: CHIP_SFX_VOLUME });
    } else {
      this.audio?.play('powering_off', { volume: TABLE_SFX_VOLUME });
    }

    this.sayOutcomeLine(kind, payout - stake);
  }

  /**
   * Deuce's line for the result. A plain house win gets none: Deuce does not
   * gloat, so a losing streak stays a story instead of turning into an insult.
   */
  private sayOutcomeLine(
    kind: 'player_blackjack' | 'player_win' | 'dealer_win' | 'push',
    net: number,
  ): void {
    if (!this.longSessionBanterFired && this.table.handsPlayed >= LONG_SESSION_HANDS) {
      this.longSessionBanterFired = true;
      this.say('long_session');
      return;
    }
    if (isBust(this.table.dealerHand)) {
      this.say('dealer_bust');
      return;
    }
    switch (kind) {
      case 'player_blackjack':
        this.say('player_blackjack');
        return;
      case 'player_win':
        if (net >= BIG_WIN_COINS) this.say('big_win');
        return;
      case 'push':
        this.say('push');
        return;
      case 'dealer_win':
        if (isBust(this.table.playerHand)) this.say('player_bust');
        return;
    }
  }

  private spawnCoinBurst(): void {
    for (let i = 0; i < COIN_PARTICLE_COUNT; i++) {
      this.coinParticles.push({
        angle: (i / COIN_PARTICLE_COUNT) * TWO_PI,
        speed: COIN_PARTICLE_SPREAD * (HALF + Math.random() * HALF),
        startedAt: this.animTime,
      });
    }
  }

  /** Deuce says a line, never repeating the previous one back to back. */
  private say(trigger: BanterTrigger): void {
    this.showBanter(pickDeuceLine(trigger, this.lastBanterLine));
  }

  private showBanter(line: string): void {
    this.lastBanterLine = line;
    this.banterLine = line;
    this.banterStartedAt = this.animTime;
  }

  // ── Input ────────────────────────────────────────────────────────────────

  handleClick(mx: number, my: number, player: Player): void {
    if (this.rules.isOpen) {
      this.rules.handleClick(mx, my, () => this.toggleHints());
      return;
    }
    const point = modalFitPoint(this.fit, mx, my);
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const button = this.buttons[i];
      if (!button.result.contains(point.x, point.y)) continue;
      this.runAction(button.action, player);
      return;
    }
  }

  private runAction(action: PanelAction, player: Player): void {
    switch (action.kind) {
      case 'chip':
        this.placeChip(action.denomination, player);
        return;
      case 'remove_chip':
        this.table.removeTopChip(player);
        return;
      case 'clear_bet':
        this.table.clearBet(player);
        return;
      case 'same_bet':
        this.table.repeatLastBet(player);
        return;
      case 'deal':
        this.table.deal();
        return;
      case 'hit':
        this.table.hit();
        return;
      case 'stand':
        this.table.stand();
        return;
      case 'double':
        this.table.doubleDown(player);
        return;
      case 'next_hand':
        this.table.nextHand(player);
        if (this.table.phase === 'turned_away') this.say('turned_away');
        this.outcomeShownAt = null;
        return;
      case 'repeat_hand':
        this.table.nextHand(player);
        if (this.table.phase === 'turned_away') this.say('turned_away');
        else this.table.repeatLastBet(player);
        this.outcomeShownAt = null;
        return;
      case 'help':
        this.rules.show();
        return;
      case 'leave':
        this.close(player);
        return;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  renderPanel(ctx: CanvasRenderingContext2D, player: Player): void {
    if (!this.open) return;
    this.buttons = [];

    const vw = viewportWidth();
    const vh = viewportHeight();
    drawOverlay(ctx, { canvasWidth: vw, canvasHeight: vh, alpha: OVERLAY_ALPHA });

    // The fit is measured before the layout because the layout derives its touch
    // targets *from* it — a 44px screen target is 44 / scale design pixels.
    const mode = casinoLayoutMode(vw);
    this.fit = fitModal(casinoDesignHeight(mode));
    const layout = computeCasinoLayout(vw, vh, this.fit.scale);

    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    drawModal(ctx, {
      canvasWidth: vw,
      canvasHeight: vh,
      width: layout.panel.width,
      height: layout.panel.height,
      radius: PANEL_RADIUS,
      shadow: true,
      ...BOX_PRESETS.modal,
      fill: PANEL_FILL,
      border: PANEL_BORDER,
    });

    this.renderHeader(ctx, layout);
    this.renderDealer(ctx, layout);
    this.renderFelt(ctx, layout);
    this.renderHands(ctx, layout);
    if (this.table.phase === 'turned_away') this.renderTurnedAwayNotice(ctx, layout);
    this.renderStatus(ctx, layout);
    this.renderChips(ctx, layout, player);
    this.renderActions(ctx, layout, player);
    this.renderHint(ctx, layout);
    this.renderFooter(ctx, layout);
    this.renderFlights(ctx, layout);
    this.renderOutcomeEffects(ctx, layout);
    if (this.shuffleStartedAt !== null) this.renderShuffleFlourish(ctx, layout);

    endModalFit(ctx);
    resetButtonPointerSpace();

    this.rules.render(ctx, this.hintsEnabled);
  }

  private renderHeader(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const header = layout.header;
    const title = layout.mode === 'wide' ? "♠  Deuce's Table — Blackjack  ♠" : '♠  Blackjack  ♠';
    drawText(ctx, title, {
      x: header.x,
      y: header.y,
      width: header.width,
      size: TITLE_SIZE,
      bold: true,
      color: ACCENT,
      align: 'center',
    });

    // One readout line rather than a right-aligned corner counter: at the
    // compact width the corner is where the header bust lives. The wager total
    // is dropped in compact — three figures do not fit on one line there, and
    // it is the least load-bearing of them.
    const coins = Math.round(this.displayedCoins);
    const wagered = layout.mode === 'wide' ? `  ·  Wagered ${this.table.coinsWagered}` : '';
    drawText(ctx, `Coins ${coins}${wagered}  ·  Cards ${this.table.cardsRemaining}`, {
      x: header.x,
      y: header.y + TITLE_SIZE + BUTTON_GAP * HALF,
      width: header.width,
      size: READOUT_SIZE,
      color: this.shuffleStartedAt === null ? SECONDARY_TEXT : ACCENT,
      align: 'center',
    });
  }

  private dealerState(): DealerState {
    const outcome = this.table.outcome;
    return dealerStateFor(
      this.table.phase,
      outcome === null ? null : outcome.kind,
      this.table.holeCardRevealed && isBust(this.table.dealerHand),
      this.table.holeCardRevealed,
    );
  }

  private renderDealer(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const state = this.dealerState();
    // Deuce's eyes drift toward whichever hand is live, which is what sells the
    // portrait as watching the table rather than the player.
    const lookY = this.table.phase === 'player_turn' ? 1 : -1;
    const portrait = layout.dealerPortrait;
    if (portrait !== null) {
      drawBox(ctx, {
        x: portrait.x,
        y: portrait.y,
        width: portrait.width,
        height: portrait.height,
        fill: PORTRAIT_FILL,
        border: PORTRAIT_BORDER,
        radius: PORTRAIT_RADIUS,
      });
      drawDeucePortrait(
        ctx,
        portrait.x,
        portrait.y,
        portrait.width,
        portrait.height,
        state,
        this.animTime,
        { lookY },
      );
    }
    const bust = layout.headerBust;
    if (bust !== null) {
      drawBox(ctx, {
        x: bust.x,
        y: bust.y,
        width: bust.width,
        height: bust.height,
        fill: PORTRAIT_FILL,
        border: PORTRAIT_BORDER,
        radius: PORTRAIT_RADIUS,
      });
      drawDeucePortrait(ctx, bust.x, bust.y, bust.width, bust.height, state, this.animTime, {
        lookY,
        showDeck: false,
      });
    }
    this.renderBanter(ctx, layout);
  }

  private renderBanter(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const line = this.banterLine;
    if (line === null) return;
    const age = this.animTime - this.banterStartedAt;
    if (age > BANTER_HOLD_MS + BANTER_FADE_MS) {
      this.banterLine = null;
      return;
    }
    const alpha = age <= BANTER_HOLD_MS ? 1 : 1 - (age - BANTER_HOLD_MS) / BANTER_FADE_MS;
    drawText(ctx, line, {
      x: layout.banner.x,
      y: layout.banner.y,
      width: layout.banner.width,
      size: BANTER_SIZE,
      color: SECONDARY_TEXT,
      align: 'center',
      alpha,
    });
  }

  /** The felt each hand sits on, plus the painted betting circle. */
  private renderFelt(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    for (const band of [layout.dealerHand, layout.playerHand]) {
      drawBox(ctx, {
        x: band.x,
        y: band.y,
        width: band.width,
        height: band.height,
        fill: FELT_GREEN,
        border: FELT_LINE,
        radius: PANEL_RADIUS,
      });
    }
    const spot = layout.betSpot;
    drawBox(ctx, {
      x: spot.x,
      y: spot.y,
      width: spot.width,
      height: spot.height,
      fill: BET_SPOT_FILL,
      border: FELT_LINE,
      radius: spot.height * HALF,
    });
  }

  /**
   * True until the hole card has visually turned. The model reveals the card a
   * whole flip before the player can see it, and printing the full total in that
   * window gives the hand away ahead of its own animation.
   */
  private get holeCardStillHidden(): boolean {
    if (!this.table.holeCardRevealed) return true;
    const started = this.flipStartedAt;
    if (started === null) return false;
    return this.animTime - started < FLIP_DURATION_MS * FLIP_REVEAL_POINT;
  }

  private handLabel(side: HandSide): string {
    if (side === 'dealer') {
      if (this.table.dealerHand.length === 0) return 'Deuce';
      if (this.holeCardStillHidden) {
        const upCard = this.table.dealerHand[0];
        return `Deuce shows ${handValue([upCard]).total}`;
      }
      const value = handValue(this.table.dealerHand);
      return `Deuce ${value.total}${value.soft ? ' (soft)' : ''}`;
    }
    if (this.table.playerHand.length === 0) return 'You';
    const value = handValue(this.table.playerHand);
    return `You ${value.total}${value.soft ? ' (soft)' : ''}`;
  }

  private renderHands(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    this.renderHand(ctx, layout, 'dealer', layout.dealerHand);
    this.renderHand(ctx, layout, 'player', layout.playerHand);
  }

  private renderHand(
    ctx: CanvasRenderingContext2D,
    layout: CasinoLayout,
    side: HandSide,
    band: Rect,
  ): void {
    // The turn-away notice covers both bands; seat labels showing through it
    // read as artefacts rather than as empty seats.
    if (this.table.phase !== 'turned_away') {
      drawText(ctx, this.handLabel(side), {
        x: band.x + BUTTON_GAP,
        y: band.y + BUTTON_GAP * HALF,
        size: HAND_LABEL_SIZE,
        color: SECONDARY_TEXT,
      });
    }

    const cards = side === 'player' ? this.table.playerHand : this.table.dealerHand;
    const placements = handSpread(band, layout.cardWidth, cards.length);
    const busted = isBust(cards);
    const winning = this.isWinningHand(side);
    const shake = this.bustShakeOffset(side);

    cards.forEach((card, index) => {
      if (this.isInFlight(side, index)) return;
      const placement = placements[index];
      const rect = {
        x: placement.x + shake,
        y: placement.y,
        width: layout.cardWidth,
        rotation: placement.rotation,
      };
      const opts = {
        highlight: winning ? WIN_HIGHLIGHT : undefined,
        dim: busted ? BUST_DIM : undefined,
      };
      if (this.isHoleCard(side, index)) {
        this.renderHoleCard(ctx, card, rect, opts);
        return;
      }
      drawCardFace(ctx, card, rect, opts);
    });
  }

  private renderHoleCard(
    ctx: CanvasRenderingContext2D,
    card: Card,
    rect: { x: number; y: number; width: number; rotation: number },
    opts: { highlight?: string; dim?: number },
  ): void {
    if (!this.table.holeCardRevealed) {
      drawCardBack(ctx, rect, opts);
      return;
    }
    const started = this.flipStartedAt;
    if (started === null) {
      drawCardFace(ctx, card, rect, opts);
      return;
    }
    drawCardFlip(ctx, card, rect, clamp01((this.animTime - started) / FLIP_DURATION_MS), opts);
  }

  /** The dealer's second card is the hole card until it turns. */
  private isHoleCard(side: HandSide, index: number): boolean {
    return side === 'dealer' && index === 1;
  }

  private isWinningHand(side: HandSide): boolean {
    const outcome = this.table.outcome;
    if (outcome === null) return false;
    const playerWon = outcome.kind === 'player_win' || outcome.kind === 'player_blackjack';
    return side === 'player' ? playerWon : outcome.kind === 'dealer_win';
  }

  private bustShakeOffset(side: HandSide): number {
    const shownAt = this.outcomeShownAt;
    if (shownAt === null) return 0;
    const cards = side === 'player' ? this.table.playerHand : this.table.dealerHand;
    if (!isBust(cards)) return 0;
    const age = this.animTime - shownAt;
    if (age > BUST_SHAKE_MS) return 0;
    const decay = 1 - age / BUST_SHAKE_MS;
    return Math.sin((age / BUST_SHAKE_MS) * BUST_SHAKE_FREQUENCY) * BUST_SHAKE_AMPLITUDE * decay;
  }

  private isInFlight(side: HandSide, index: number): boolean {
    return this.cardFlights.some((flight) => flight.side === side && flight.index === index);
  }

  /**
   * The turn-away notice, across the empty felt. The status line and Deuce's
   * warm line both say it, but a player who cannot bet needs to know *why* the
   * controls are gone at a glance, before reading anything.
   */
  private renderTurnedAwayNotice(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const top = layout.dealerHand.y;
    const bottom = layout.playerHand.y + layout.playerHand.height;
    const band = {
      x: layout.dealerHand.x,
      y: top,
      width: layout.dealerHand.width,
      height: bottom - top,
    };

    drawBox(ctx, {
      x: band.x,
      y: band.y,
      width: band.width,
      height: band.height,
      fill: TURNED_AWAY_SCRIM,
      border: LOSE_COLOR,
      borderWidth: 2,
      radius: PANEL_RADIUS,
    });

    const centreY = band.y + band.height * HALF;
    // Flat, bright and unglowing. A glow behind a long string blurs into a bar
    // that reads as text underneath the text, and red on a dark red scrim has
    // too little contrast to carry the line in the first place — the red is
    // doing its job on the border.
    drawText(ctx, 'NOT ENOUGH MONEY', {
      x: band.x,
      y: centreY - TURNED_AWAY_TITLE_SIZE,
      width: band.width,
      size: TURNED_AWAY_TITLE_SIZE,
      bold: true,
      color: TURNED_AWAY_TITLE_COLOR,
      align: 'center',
    });
    drawText(ctx, `You need at least ${TABLE_MINIMUM} coins to sit down.`, {
      x: band.x,
      y: centreY + BUTTON_GAP,
      width: band.width,
      size: READOUT_SIZE,
      color: SECONDARY_TEXT,
      align: 'center',
    });
  }

  private renderStatus(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const row = layout.statusRow;
    const centreX = row.x + row.width * HALF;
    const message = this.statusMessage();
    // The turn-away notice already spells this out across the felt in the
    // player's face; repeating it here just lands a second line on top of it.
    if (message.text === '') return;
    drawText(ctx, message.text, {
      x: centreX,
      y: row.y,
      size: message.emphasised ? STATUS_SIZE + STATUS_EMPHASIS_BUMP : STATUS_SIZE,
      bold: true,
      color: message.color,
      align: 'center',
      glow: message.emphasised ? message.color : false,
    });

    const feedback = this.table.feedbackMessage;
    if (feedback !== null) {
      drawText(ctx, feedback, {
        x: layout.hintRow.x,
        y: layout.hintRow.y,
        width: layout.hintRow.width,
        size: HINT_SIZE,
        color: FEEDBACK_COLOR,
        align: 'center',
      });
    }
  }

  private statusMessage(): { text: string; color: string; emphasised: boolean } {
    switch (this.table.phase) {
      case 'turned_away':
        return { text: '', color: MUTED_TEXT, emphasised: false };
      case 'betting':
        return {
          text:
            this.table.betTotal > 0 ? `Bet ${this.table.betTotal}` : 'Stack your chips on the felt',
          color: SECONDARY_TEXT,
          emphasised: false,
        };
      case 'dealing':
        return { text: 'Dealing…', color: SECONDARY_TEXT, emphasised: false };
      case 'player_turn':
        return {
          text: `Your call — ${this.table.stake} on the felt`,
          color: ACCENT,
          emphasised: false,
        };
      case 'dealer_turn':
        return { text: "Deuce's turn", color: SECONDARY_TEXT, emphasised: false };
      case 'settled':
        return this.outcomeMessage();
    }
  }

  private outcomeMessage(): { text: string; color: string; emphasised: boolean } {
    const outcome = this.table.outcome;
    if (outcome === null) {
      return { text: 'Hand void — bet refunded', color: FEEDBACK_COLOR, emphasised: false };
    }
    const stake = this.table.stake;
    switch (outcome.kind) {
      case 'player_blackjack':
        return {
          text: `BLACKJACK!  +${netForOutcome(outcome, stake)}`,
          color: ACCENT,
          emphasised: true,
        };
      case 'player_win':
        return { text: `You win  +${stake}`, color: WIN_COLOR, emphasised: true };
      case 'dealer_win':
        return {
          text: isBust(this.table.playerHand) ? `Bust  −${stake}` : `House wins  −${stake}`,
          color: LOSE_COLOR,
          emphasised: false,
        };
      case 'push':
        return { text: 'Push — stake returned', color: PUSH_COLOR, emphasised: false };
    }
  }

  private renderChips(ctx: CanvasRenderingContext2D, layout: CasinoLayout, player: Player): void {
    const tray = layout.chipTray;
    const trayCentre = rectCentre(tray);
    const radius = tray.height * TRAY_CHIP_RADIUS_FRACTION;
    const baseY = tray.y + tray.height - radius;
    // The label owns the top of the rect, so the stack is capped to whatever is
    // left under it — an uncapped stack grows straight through its own caption.
    const chips = trayChips(player.coins).slice(0, visibleChipCapacity(tray.height, radius));

    if (chips.length === 0) drawEmptyTrayOutline(ctx, trayCentre.x, baseY, radius);
    else drawChipStack(ctx, trayCentre.x, baseY, radius, chips);

    drawText(ctx, `Your tray — ${Math.round(this.displayedCoins)}`, {
      x: trayCentre.x,
      y: tray.y,
      size: HAND_LABEL_SIZE,
      color: MUTED_TEXT,
      align: 'center',
    });

    const spot = layout.betSpot;
    const spotCentre = rectCentre(spot);
    // Tapping the stack takes the top chip back off, which is the reverse of
    // tapping a chip well — Clear is the all-at-once shortcut, not the only way.
    if (this.table.phase === 'betting' && this.table.pendingBet.length > 0) {
      this.addButton(ctx, spot, '', BUTTON_PRESETS.casinoBetSpot, { kind: 'remove_chip' });
    }
    const betRadius = spot.height * BET_CHIP_RADIUS_FRACTION;
    const betBaseY = spot.y + spot.height - betRadius;
    const betting = this.table.phase === 'betting';
    const felt = (betting ? this.table.pendingBet : this.stakeChipsOnFelt()).slice(
      0,
      visibleChipCapacity(spot.height, betRadius),
    );
    if (felt.length > 0) drawChipStack(ctx, spotCentre.x, betBaseY, betRadius, felt);

    const spotLabel = betting
      ? `Your bet — ${this.table.betTotal}`
      : felt.length > 0
        ? `Stake — ${this.table.stake}`
        : '';
    if (spotLabel !== '') {
      drawText(ctx, spotLabel, {
        x: spotCentre.x,
        y: spot.y,
        size: HAND_LABEL_SIZE,
        color: MUTED_TEXT,
        align: 'center',
      });
    }
  }

  /**
   * The stake still sitting on the felt. The moment the hand settles the payout
   * sweep picks the stack up, so the static stack goes with it — drawing both
   * leaves a ghost stake behind after its own chips have flown home.
   */
  private stakeChipsOnFelt(): ReadonlyArray<number> {
    if (this.table.phase === 'settled') return [];
    return trayChips(this.table.stake);
  }

  private renderActions(ctx: CanvasRenderingContext2D, layout: CasinoLayout, player: Player): void {
    const row = layout.actionRow;
    switch (this.table.phase) {
      case 'turned_away':
      case 'dealing':
      case 'dealer_turn':
        return;
      case 'betting':
        this.renderBettingActions(ctx, layout, row, player);
        return;
      case 'player_turn':
        this.renderTurnActions(ctx, layout, row, player);
        return;
      case 'settled':
        this.renderSettledActions(ctx, layout, row);
        return;
    }
  }

  /** Split `row` into `count` equal columns with the standard gap between them. */
  private columns(row: Rect, count: number): Array<Rect> {
    const width = (row.width - BUTTON_GAP * (count - 1)) / count;
    const cells: Rect[] = [];
    for (let i = 0; i < count; i++) {
      cells.push({ x: row.x + (width + BUTTON_GAP) * i, y: row.y, width, height: row.height });
    }
    return cells;
  }

  /** Two stacked rows in compact mode; one row of everything in wide. */
  private actionCells(layout: CasinoLayout, row: Rect, count: number): Array<Rect> {
    if (layout.mode === 'wide') return this.columns(row, count);
    const perRow = Math.ceil(count / COMPACT_ACTION_ROW_COUNT);
    const rowHeight = layout.buttonHeight;
    const top = this.columns({ ...row, height: rowHeight }, perRow);
    const bottom = this.columns(
      { x: row.x, y: row.y + rowHeight + BUTTON_GAP, width: row.width, height: rowHeight },
      count - perRow,
    );
    return [...top, ...bottom];
  }

  private addButton(
    ctx: CanvasRenderingContext2D,
    cell: Rect,
    label: string,
    preset: CasinoButtonPreset,
    action: PanelAction,
    disabled = false,
  ): void {
    const result = drawButton(ctx, {
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
      label,
      labelSize: BUTTON_LABEL_SIZE,
      disabled,
      ...preset,
    });
    if (!disabled) this.buttons.push({ result, action });
  }

  private renderBettingActions(
    ctx: CanvasRenderingContext2D,
    layout: CasinoLayout,
    row: Rect,
    player: Player,
  ): void {
    const cells = this.actionCells(layout, row, CHIP_DENOMINATIONS.length + BETTING_CONTROL_COUNT);
    const ceiling = this.table.effectiveMaximum(player);

    CHIP_DENOMINATIONS.forEach((denomination, i) => {
      const cell = cells[i];
      const affordable =
        player.coins >= denomination && this.table.betTotal + denomination <= ceiling;
      this.addButton(
        ctx,
        cell,
        '',
        BUTTON_PRESETS.casinoChip,
        { kind: 'chip', denomination },
        !affordable,
      );
      const centre = rectCentre(cell);
      const chipRadius = Math.min(
        cell.width * CHIP_WELL_FILL_FRACTION,
        cell.height * HALF - CHIP_BUTTON_INSET,
      );
      drawChip(ctx, centre.x, centre.y, chipRadius, denomination, {
        alpha: affordable ? 1 : DISABLED_CHIP_ALPHA,
        showLabel: true,
      });
    });

    const clearCell = cells[CHIP_DENOMINATIONS.length];
    const sameCell = cells[CHIP_DENOMINATIONS.length + 1];
    const dealCell = cells[CHIP_DENOMINATIONS.length + 2];

    this.addButton(
      ctx,
      clearCell,
      'Clear',
      BUTTON_PRESETS.primary,
      { kind: 'clear_bet' },
      this.table.betTotal === 0,
    );
    this.addButton(
      ctx,
      sameCell,
      'Same Bet',
      BUTTON_PRESETS.blue,
      { kind: 'same_bet' },
      !this.table.canRepeatLastBet,
    );
    this.addButton(
      ctx,
      dealCell,
      'Deal',
      BUTTON_PRESETS.gold,
      { kind: 'deal' },
      this.table.betTotal < TABLE_MINIMUM,
    );
  }

  private renderTurnActions(
    ctx: CanvasRenderingContext2D,
    layout: CasinoLayout,
    row: Rect,
    player: Player,
  ): void {
    const cells = this.actionCells(layout, row, TURN_CONTROL_COUNT);
    this.addButton(ctx, cells[0], 'Hit', BUTTON_PRESETS.success, { kind: 'hit' });
    this.addButton(ctx, cells[1], 'Stand', BUTTON_PRESETS.danger, { kind: 'stand' });
    this.addButton(
      ctx,
      cells[2],
      `Double (${this.table.stake})`,
      BUTTON_PRESETS.gold,
      { kind: 'double' },
      !this.table.canDoubleDown(player),
    );
  }

  private renderSettledActions(
    ctx: CanvasRenderingContext2D,
    layout: CasinoLayout,
    row: Rect,
  ): void {
    const cells = this.actionCells(layout, row, SETTLED_CONTROL_COUNT);
    this.addButton(ctx, cells[0], 'Next Hand', BUTTON_PRESETS.gold, { kind: 'next_hand' });
    this.addButton(
      ctx,
      cells[1],
      'Same Bet',
      BUTTON_PRESETS.blue,
      { kind: 'repeat_hand' },
      !this.table.canRepeatLastBet,
    );
  }

  private renderHint(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    if (this.table.feedbackMessage !== null) return;
    if (!this.hintsEnabled) return;
    if (this.table.phase !== 'player_turn') return;
    const advice = basicStrategyAdvice(
      this.table.playerHand,
      this.table.dealerHand[0],
      this.table.playerHand.length === 2 && !this.table.doubled,
    );
    if (advice === null) return;
    drawText(ctx, advice.line, {
      x: layout.hintRow.x,
      y: layout.hintRow.y,
      width: layout.hintRow.width,
      size: HINT_SIZE,
      color: MUTED_TEXT,
      align: 'center',
    });
  }

  private renderFooter(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const help = layout.helpButton;
    this.addButton(
      ctx,
      help,
      '?  How to Play',
      { ...BUTTON_PRESETS.primary, labelSize: FOOTER_LABEL_SIZE },
      { kind: 'help' },
    );
    const leave = layout.leaveButton;
    this.addButton(
      ctx,
      leave,
      platform.isMobile ? 'Leave Table' : 'Leave Table  [Esc]',
      { ...BUTTON_PRESETS.danger, labelSize: FOOTER_LABEL_SIZE },
      { kind: 'leave' },
    );
  }

  // ── Animation layers ─────────────────────────────────────────────────────

  private anchorPoint(layout: CasinoLayout, anchor: ChipAnchor): { x: number; y: number } {
    switch (anchor) {
      case 'tray': {
        const tray = layout.chipTray;
        const radius = tray.height * TRAY_CHIP_RADIUS_FRACTION;
        return { x: tray.x + tray.width * HALF, y: tray.y + tray.height - radius };
      }
      case 'felt': {
        const spot = layout.betSpot;
        const radius = spot.height * BET_CHIP_RADIUS_FRACTION;
        return {
          x: spot.x + spot.width * HALF,
          y: chipStackTopY(spot.y + spot.height - radius, radius, this.table.pendingBet.length),
        };
      }
      case 'rack': {
        // Deuce's own chip rack: the felt strip along the bottom of the portrait
        // in wide mode, and just off the top of the dealer's band in compact.
        // Aiming at the portrait's centre threw losing chips into Deuce's face.
        const portrait = layout.dealerPortrait;
        if (portrait === null) {
          return { x: layout.dealerHand.x + layout.dealerHand.width * HALF, y: layout.panel.y };
        }
        return {
          x: portrait.x + portrait.width * HALF,
          y: portrait.y + portrait.height * DEALER_RACK_PORTRAIT_FRACTION,
        };
      }
    }
  }

  /**
   * Where the shoe sits: inside the dealer band's top-right corner, inset by a
   * card width so a card in flight starts on the felt rather than half off the
   * edge of the panel.
   */
  private shoePoint(layout: CasinoLayout): { x: number; y: number } {
    return {
      x: layout.dealerHand.x + layout.dealerHand.width - layout.cardWidth,
      y: layout.dealerHand.y,
    };
  }

  private renderFlights(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    this.renderCardFlights(ctx, layout);
    this.renderChipFlights(ctx, layout);
  }

  private renderCardFlights(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const origin = this.shoePoint(layout);
    for (const flight of this.cardFlights) {
      const cards = flight.side === 'player' ? this.table.playerHand : this.table.dealerHand;
      // A flight is spawned from the event that pushed the card, and expires on
      // a timer, so its index is always inside the hand it belongs to.
      if (flight.index >= cards.length) continue;
      const card = cards[flight.index];
      const band = flight.side === 'player' ? layout.playerHand : layout.dealerHand;
      const target = handSpread(band, layout.cardWidth, cards.length)[flight.index];

      const progress = clamp01((this.animTime - flight.startedAt) / CARD_FLIGHT_MS);
      const eased = easeOutCubic(progress);
      // A small overshoot past the slot, settling back — a card thrown onto felt
      // does not stop dead.
      const settle = 1 + Math.sin(progress * Math.PI) * CARD_FLIGHT_OVERSHOOT;
      const scale = 1 + (CARD_FLIGHT_LIFT - 1) * Math.sin(progress * Math.PI);
      const x = origin.x + (target.x - origin.x) * eased;
      const y = origin.y + (target.y - origin.y) * eased * settle;

      const faceDown = this.isHoleCard(flight.side, flight.index) && !this.table.holeCardRevealed;
      const rect = {
        x,
        y,
        width: layout.cardWidth * scale,
        rotation: target.rotation * eased,
      };
      if (faceDown) drawCardBack(ctx, rect, { liftShadow: true });
      else drawCardFace(ctx, card, rect, { liftShadow: true });
    }
  }

  private renderChipFlights(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    for (const flight of this.chipFlights) {
      const progress = clamp01((this.animTime - flight.startedAt) / flight.duration);
      const eased = easeOutCubic(progress);
      const from = this.anchorPoint(layout, flight.from);
      const to = this.anchorPoint(layout, flight.to);
      const radius = layout.chipTray.height * TRAY_CHIP_RADIUS_FRACTION;
      const arc = -Math.sin(progress * Math.PI) * radius * CHIP_ARC_HEIGHT_FRACTION;
      // A landing chip settles with a small bounce rather than sticking flat.
      const landingPhase = Math.max(0, progress - (1 - CHIP_LAND_BOUNCE)) / CHIP_LAND_BOUNCE;
      const bounce = -Math.sin(landingPhase * Math.PI) * radius * CHIP_LAND_BOUNCE;
      drawChip(
        ctx,
        from.x + (to.x - from.x) * eased,
        from.y + (to.y - from.y) * eased + arc + bounce,
        radius,
        flight.denomination,
        { shadow: true, showLabel: true },
      );
    }
  }

  private renderOutcomeEffects(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const shownAt = this.outcomeShownAt;
    if (shownAt === null) return;
    const age = this.animTime - shownAt;

    if (isBust(this.table.playerHand) && age < BUST_VIGNETTE_MS) {
      this.renderBustVignette(ctx, layout, age / BUST_VIGNETTE_MS);
    }

    const centre = rectCentre(layout.playerHand);
    for (const particle of this.coinParticles) {
      const elapsed = (this.animTime - particle.startedAt) / COIN_PARTICLE_MS;
      if (elapsed >= 1) continue;
      const seconds = elapsed * (COIN_PARTICLE_MS / MS_PER_SECOND);
      const x = centre.x + Math.cos(particle.angle) * particle.speed * elapsed;
      const y =
        centre.y -
        COIN_PARTICLE_RISE * elapsed +
        COIN_PARTICLE_GRAVITY * seconds * seconds * HALF -
        Math.sin(particle.angle) * particle.speed * elapsed * HALF;
      ctx.save();
      ctx.globalAlpha = 1 - elapsed;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(x, y, COIN_PARTICLE_RADIUS, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * A red pulse around the panel's edges on a bust. A flat wash over the whole
   * panel greys out the cards and the buttons the player is about to read, so
   * the tint is kept to the border where it registers without obscuring
   * anything — and it is over quickly, because losing is frequent.
   */
  private renderBustVignette(
    ctx: CanvasRenderingContext2D,
    layout: CasinoLayout,
    progress: number,
  ): void {
    const panel = layout.panel;
    const centreX = panel.x + panel.width * HALF;
    const centreY = panel.y + panel.height * HALF;
    const radius = Math.hypot(panel.width, panel.height) * HALF;
    const gradient = ctx.createRadialGradient(
      centreX,
      centreY,
      radius * BUST_VIGNETTE_INNER_FRACTION,
      centreX,
      centreY,
      radius,
    );
    gradient.addColorStop(0, BUST_VIGNETTE_CLEAR);
    gradient.addColorStop(1, BUST_VIGNETTE);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.sin(progress * Math.PI) * VIGNETTE_ALPHA);
    ctx.fillStyle = gradient;
    ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
    ctx.restore();
  }

  /**
   * The riffle: two halves of the deck interleaving over the felt. This is the
   * moment the player learns the deck is real, so it is visible and unmissable
   * rather than a silent counter reset.
   */
  private renderShuffleFlourish(ctx: CanvasRenderingContext2D, layout: CasinoLayout): void {
    const started = this.shuffleStartedAt;
    if (started === null) return;
    const progress = clamp01((this.animTime - started) / SHUFFLE_FLOURISH_MS);
    const band = layout.dealerHand;
    const centre = rectCentre(band);

    // The riffle plays over the hand that just settled, so the band is covered
    // first — interleaving card backs through a live hand reads as a glitch.
    drawBox(ctx, {
      x: band.x,
      y: band.y,
      width: band.width,
      height: band.height,
      fill: FELT_GREEN_OPAQUE,
      border: FELT_LINE,
      radius: PANEL_RADIUS,
      alpha: Math.min(1, (1 - progress) * SHUFFLE_SCRIM_FADE),
    });

    const cardW = layout.cardWidth * SHUFFLE_CARD_WIDTH_FRACTION;
    const spread = Math.sin(progress * Math.PI) * band.width * SHUFFLE_SPLIT_SPREAD;

    for (let i = 0; i < SHUFFLE_CARD_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i / 2) / (SHUFFLE_CARD_COUNT / 2);
      drawCardBack(
        ctx,
        {
          x: centre.x - cardW * HALF + side * spread * (1 - rank),
          y: centre.y - cardW * CARD_ASPECT * HALF + rank * cardW * CARD_FLIGHT_OVERSHOOT,
          width: cardW,
          rotation: side * spread * SHUFFLE_TILT_PER_PX,
        },
        { alpha: 1 - progress * HALF, liftShadow: true },
      );
    }
  }
}
