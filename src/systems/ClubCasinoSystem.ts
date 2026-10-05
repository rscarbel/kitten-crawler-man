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
import { canAffordCoins, partyCoins } from '../core/partyCoins';
import type { AudioManager } from '../audio/AudioManager';
import type { ClubMembership } from '../core/ClubMembership';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { keybindings } from '../core/Keybindings';
import { ACTIVATE_KEYS, type Surface } from '../ui/core/UiRoot';
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
  casinoFit,
  computeCasinoLayout,
  fitRectToScreen,
  fitToScreen,
  handCardBand,
  handSpread,
  type CasinoFit,
  type CasinoLayout,
} from '../ui/casino/casinoLayout';
import {
  CARD_ASPECT,
  drawCardBack,
  drawCardFace,
  drawCardFlip,
  drawSuitGlyph,
  type CardPose,
} from '../ui/casino/PlayingCard';
import {
  drawChip,
  drawChipStack,
  drawEmptyTrayOutline,
  chipStackTopY,
  trayChips,
  CHIP_STACK_STEP as CHIP_STACK_STEP_FRACTION,
} from '../ui/casino/ChipStack';
import { BlackjackRules } from '../ui/screens/dialogs/BlackjackRules';
import { pickDeuceLine, type BanterTrigger } from '../dialog/scripts/deuce';
import { drawDeucePortrait, dealerStateFor, type DealerState } from '../sprites/casinoDealerSprite';
import type { Rect } from '../ui/core/geom';
import {
  casinoTableColors,
  glowText,
  paintSkinnedControl,
  type CasinoTableColors,
  type ControlLook,
} from '../ui/screens/dialogs/minigameChrome';
import { withAlpha } from '../ui/theme/color';
import { skinsFor, type ButtonVariant } from '../ui/theme/skins';
import {
  drawFocusRing,
  drawGlass,
  fillRounded,
  roundRectPath,
  strokeRounded,
  type PaintTarget,
} from '../ui/widgets/paint';
import { measureText, text, type TextOptions } from '../ui/widgets/text';

const FELT_BORDER_WIDTH = 1;
const TURNED_AWAY_BORDER_WIDTH = 2;
/** Deuce's longest line wraps to three lines in the narrow portrait column. */
const BANTER_MAX_LINES = 3;

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

/** Net winnings above which an ordinary win earns a word from Deuce. */
const BIG_WIN_COINS = 50;

const HINT_RETIREMENT_LINE = '"You\'ve got the hang of this — I\'ll stop calling the plays."';

/**
 * The table's cues play at full SFX volume: the music bus already carries
 * headroom for them (see `MUSIC_BUS_HEADROOM`), so the cards and chips can
 * still be heard over the club music and the bar-crowd bed.
 */
const TABLE_SFX_VOLUME = 1;
const CHIP_SFX_VOLUME = 1;

const HALF = 0.5;
const TWO_PI = Math.PI * 2;

/** Everything a player can do at the table. */
export type CasinoAction =
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

/** Who sits at the table, read afresh whenever a control fires. */
export interface CasinoSeat {
  readonly active: () => Player;
  readonly companion: () => Player;
}

/** The fit and screen the table was last drawn at, in UI units. */
interface TableFrame {
  readonly fit: CasinoFit;
  readonly screenW: number;
  readonly screenH: number;
  /** CSS pixels per UI unit. */
  readonly uiScale: number;
}

/** One control the table paints. Its rect is in the panel's design space, before the fit. */
export interface CasinoControl {
  readonly id: string;
  readonly rect: Rect;
  readonly disabled: boolean;
  /** The table's safe default, which an accept key activates when nothing is focused. */
  readonly primary: boolean;
  /**
   * Joins the keyboard ring. The betting row joins it too but marks no primary,
   * so an accept press stakes chips only once the player has walked focus onto
   * a chip on purpose.
   */
  readonly focusable: boolean;
  readonly action: CasinoAction;
}

/** Where and how {@link ClubCasinoSystem.paintTable} draws, and how its controls are hit. */
export interface CasinoPaintFrame {
  readonly target: PaintTarget;
  readonly viewportW: number;
  readonly viewportH: number;
  /** The panel's shrink about the viewport centre; see `casinoFit`. */
  readonly fit: CasinoFit;
  /** Whether labels name their keyboard shortcuts. */
  readonly keyHints: boolean;
  /** Registers a control for this frame and reports how it should look. */
  control(control: CasinoControl): ControlLook;
  /** Opens a keyboard focus group for the controls registered next, or closes it with `null`. */
  focusGroup(id: string | null): void;
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
function visibleChipCapacity(height: number, radius: number, captionHeight: number): number {
  const usable = height - captionHeight - radius;
  return Math.max(1, Math.floor(usable / (radius * CHIP_STACK_STEP_FRACTION)));
}

function rectCentre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w * HALF, y: rect.y + rect.h * HALF };
}

export class ClubCasinoSystem {
  open = false;

  private readonly table: BlackjackTable;
  private readonly rules = new BlackjackRules();

  private animTime = 0;
  private lastFrameStamp: number | null = null;

  private lastFrame: TableFrame | null = null;

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

  /**
   * Fired once, when the panel closes, with the whole session's net winnings
   * and the tray's current screen position — never per hand. The panel stays
   * open under its own dim overlay for many hands in a row, and the in-panel
   * chip-to-tray sweep is already that hand's feedback; a coin landing on the
   * HUD counter behind the overlay every hand would be a second, half-hidden
   * effect nobody can actually watch land. One fly for the whole visit, once
   * the overlay is gone, is the one a player can see.
   */
  onWinnings: ((coins: number, screenX: number, screenY: number) => void) | null = null;

  /** Summed net winnings across every settled hand since the panel opened, flown as one on close. */
  private pendingSessionWinnings = 0;

  constructor(
    private readonly audio: AudioManager | null,
    private readonly membership: ClubMembership,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.table = new BlackjackTable(membership.casinoShoe);
    this.table.onWinnings = (winnings) => {
      if (winnings > 0) this.pendingSessionWinnings += winnings;
    };
  }

  /**
   * The chip tray's current on-screen centre, in canvas CSS pixels rather than
   * the panel's design space or UI units. The fit is whatever the table was
   * last drawn at, which is always at least one frame old by the time a hand
   * can settle.
   */
  private trayScreenPosition(): { x: number; y: number } {
    const frame = this.lastFrame ?? this.unscaledFrame();
    const layout = computeCasinoLayout(frame.screenW, frame.screenH, frame.fit.scale);
    const trayCentre = rectCentre(layout.chipTray);
    const onScreen = fitToScreen(frame.fit, trayCentre.x, trayCentre.y);
    return { x: onScreen.x * frame.uiScale, y: onScreen.y * frame.uiScale };
  }

  /** The canvas taken at one UI unit per CSS pixel, for a table closed before it ever drew. */
  private unscaledFrame(): TableFrame {
    const screenW = viewportWidth();
    const screenH = viewportHeight();
    return { fit: casinoFit(screenW, screenH), screenW, screenH, uiScale: 1 };
  }

  /** Flies the whole session's accumulated winnings as one, then clears the tally. Safe to call on a session with nothing to fly. */
  private flySessionWinnings(): void {
    const winnings = this.pendingSessionWinnings;
    this.pendingSessionWinnings = 0;
    if (winnings <= 0) return;
    const { x, y } = this.trayScreenPosition();
    this.onWinnings?.(winnings, x, y);
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

  dismissRules(): void {
    this.rules.dismiss();
  }

  /**
   * Stack one chip on the felt. The panel's own chip wells route through here,
   * and it is the entry point the preview harness uses to build a bet without a
   * rendered layout to click.
   */
  placeChip(denomination: ChipDenomination, player: Player, companion: Player): void {
    this.table.addChip(denomination, player, companion);
  }

  openTable(player: Player, companion: Player): void {
    this.open = true;
    this.lastFrameStamp = null;
    this.displayedCoins = partyCoins(player, companion);
    // A fresh tally for a fresh sit-down — see `flySessionWinnings`.
    this.pendingSessionWinnings = 0;
    this.table.sitDown(player, companion);
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
    // The one fly for the whole visit — see `flySessionWinnings`. Reached both
    // from the player actually leaving the table and from a scene teardown
    // that force-closes every panel underneath it (`DesperadoClubSystem.closeAll`),
    // so a building exit with the panel still open still tallies correctly;
    // whether that flight is ever seen depends only on whether the scene it
    // was queued in is still around to draw it.
    this.flySessionWinnings();
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

  update(player: Player, companion: Player): void {
    const dtMs = this.tickClock();

    if (!this.open) return;

    this.table.update(dtMs);
    this.consumeEvents(player);
    this.expireAnimations();
    this.tickCoinTicker(player, companion);
    this.maybeOfferHintRetirement();
  }

  /** Milliseconds since the last frame, refusing to jump after a tab-away. */
  private tickClock(): number {
    const now = this.clock();
    const previous = this.lastFrameStamp;
    this.lastFrameStamp = now;
    if (previous === null) return 0;
    const dtMs = Math.min(MAX_FRAME_MS, now - previous);
    this.animTime += dtMs;
    return dtMs;
  }

  private tickCoinTicker(player: Player, companion: Player): void {
    const total = partyCoins(player, companion);
    const gap = total - this.displayedCoins;
    if (Math.abs(gap) <= COIN_TICKER_SNAP) {
      this.displayedCoins = total;
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

  /** Performs a table action, exactly as tapping its control does. */
  act(action: CasinoAction, player: Player, companion: Player): void {
    switch (action.kind) {
      case 'chip':
        this.placeChip(action.denomination, player, companion);
        return;
      case 'remove_chip':
        this.table.removeTopChip(player);
        return;
      case 'clear_bet':
        this.table.clearBet(player);
        return;
      case 'same_bet':
        this.table.repeatLastBet(player, companion);
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
        this.table.doubleDown(player, companion);
        return;
      case 'next_hand':
        this.table.nextHand(player, companion);
        if (this.table.phase === 'turned_away') this.say('turned_away');
        this.outcomeShownAt = null;
        return;
      case 'repeat_hand':
        this.table.nextHand(player, companion);
        if (this.table.phase === 'turned_away') this.say('turned_away');
        else this.table.repeatLastBet(player, companion);
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

  /**
   * The table as a surface: modal and halting. Escape backs out of the rules
   * sheet first, then leaves the table. While no decision row is up to take
   * the accept keys, and the keyboard has not walked focus onto a control, the
   * attack key leaves the table too, as the club's dismiss key does at every
   * other station.
   */
  tableSurface(id: string, seat: CasinoSeat): Surface {
    let decisionRowLive = false;
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.open,
      render: (ui) => {
        const fit = casinoFit(ui.screen.w, ui.screen.h);
        this.lastFrame = { fit, screenW: ui.screen.w, screenH: ui.screen.h, uiScale: ui.uiScale };
        let keyboardOnAControl = false;
        this.paintTable(
          {
            target: ui,
            viewportW: ui.screen.w,
            viewportH: ui.screen.h,
            fit,
            keyHints: ui.density === 'pointer',
            control: (control) => {
              const look = ui.hit(control.id, fitRectToScreen(fit, control.rect), {
                onTap: () => this.act(control.action, seat.active(), seat.companion()),
                disabled: control.disabled,
                primary: control.primary,
                focusable: control.focusable,
              });
              if (look.focused) keyboardOnAControl = true;
              return look;
            },
            focusGroup: () => undefined,
          },
          seat.active(),
          seat.companion(),
        );
        const phase = this.table.phase;
        const decisionRowUp = phase === 'player_turn' || phase === 'settled';
        decisionRowLive = decisionRowUp || keyboardOnAControl;
      },
      close: () => {
        if (this.rules.isOpen) this.rules.dismiss();
        else this.close(seat.active());
      },
      onKey: (key, mods) => {
        if (keybindings.actionFor(key) !== 'attack') return false;
        if (decisionRowLive && ACTIVATE_KEYS.has(key)) return false;
        if (mods.repeat !== true && mods.predatesSurface !== true) this.close(seat.active());
        return true;
      },
    };
  }

  /** The rules sheet as its own surface; mount it after {@link tableSurface} so it stacks above. */
  rulesSurface(id: string): Surface {
    return this.rules.surface(id, {
      enabled: () => this.hintsEnabled,
      toggle: () => this.toggleHints(),
    });
  }

  /**
   * Paints the whole table — scrim, panel, hands, chips, controls and effects —
   * into `frame`, registering every control through `frame.control`. The rules
   * overlay is not part of it.
   */
  paintTable(frame: CasinoPaintFrame, player: Player, companion: Player): void {
    const { ctx } = frame.target;
    ctx.save();
    ctx.fillStyle = skinsFor(frame.target.theme).scrim;
    ctx.fillRect(0, 0, frame.viewportW, frame.viewportH);
    ctx.restore();

    const layout = computeCasinoLayout(frame.viewportW, frame.viewportH, frame.fit.scale);
    const { fit } = frame;
    ctx.save();
    ctx.translate(fit.pivotX, fit.pivotY);
    ctx.scale(fit.scale, fit.scale);
    ctx.translate(-fit.pivotX, -fit.pivotY);

    drawGlass(frame.target, layout.panel, skinsFor(frame.target.theme).panel.card);

    this.renderHeader(frame, layout);
    this.renderDealer(frame, layout);
    this.renderFelt(frame, layout);
    this.renderHands(frame, layout);
    if (this.table.phase === 'turned_away') this.renderTurnedAwayNotice(frame, layout);
    this.renderStatus(frame, layout);
    this.renderChips(frame, layout, player, companion);
    this.renderActions(frame, layout, player, companion);
    this.renderHint(frame, layout);
    this.renderFooter(frame, layout);
    this.renderFlights(frame, layout);
    this.renderOutcomeEffects(frame, layout);
    if (this.shuffleStartedAt !== null) this.renderShuffleFlourish(frame, layout);

    ctx.restore();
  }

  private colors(frame: CasinoPaintFrame): CasinoTableColors {
    return casinoTableColors(frame.target.theme);
  }

  private renderHeader(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const { target } = frame;
    const { type, space } = target.theme;
    const colors = this.colors(frame);
    const header = layout.header;
    const title = layout.mode === 'wide' ? "Deuce's Table — Blackjack" : 'Blackjack';
    const titleRect: Rect = {
      x: header.x,
      y: header.y,
      w: header.w,
      h: type.title.lineHeight,
    };
    text(target, titleRect, {
      text: title,
      style: type.title,
      color: colors.title,
      align: 'center',
    });

    // The suits flank the title as painted pips rather than font glyphs, so
    // they never fall back to a system face's spade.
    const titleWidth = measureText(target, title, { style: type.title });
    const pipY = titleRect.y + titleRect.h * HALF;
    const pipOffset = titleWidth * HALF + space.md;
    const centreX = header.x + header.w * HALF;
    for (const side of [-1, 1]) {
      drawSuitGlyph(
        target.ctx,
        'spades',
        centreX + side * pipOffset,
        pipY,
        type.caption.size,
        colors.title,
      );
    }

    // One readout line rather than a right-aligned corner counter: at the
    // compact width the corner is where the header bust lives. The wager total
    // is dropped in compact — three figures do not fit on one line there, and
    // it is the least load-bearing of them.
    const coins = Math.round(this.displayedCoins);
    const wagered = layout.mode === 'wide' ? `  ·  Wagered ${this.table.coinsWagered}` : '';
    text(
      target,
      {
        x: header.x,
        y: titleRect.y + titleRect.h,
        w: header.w,
        h: type.caption.lineHeight,
      },
      {
        text: `Coins ${coins}${wagered}  ·  Cards ${this.table.cardsRemaining}`,
        style: type.caption,
        color: this.shuffleStartedAt === null ? colors.readout : colors.readoutLive,
        align: 'center',
        tabular: true,
      },
    );
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

  private paintInset(frame: CasinoPaintFrame, rect: Rect, fill: string, border: string): void {
    const { ctx, theme } = frame.target;
    const shape = rect;
    fillRounded(ctx, shape, theme.radius.md, fill);
    strokeRounded(ctx, shape, theme.radius.md, border, FELT_BORDER_WIDTH);
  }

  private renderDealer(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const { ctx } = frame.target;
    const colors = this.colors(frame);
    const state = this.dealerState();
    // Deuce's eyes drift toward whichever hand is live, which is what sells the
    // portrait as watching the table rather than the player.
    const lookY = this.table.phase === 'player_turn' ? 1 : -1;
    const portrait = layout.dealerPortrait;
    if (portrait !== null) {
      this.paintInset(frame, portrait, colors.portrait, colors.portraitBorder);
      drawDeucePortrait(ctx, portrait.x, portrait.y, portrait.w, portrait.h, state, this.animTime, {
        lookY,
      });
    }
    const bust = layout.headerBust;
    if (bust !== null) {
      this.paintInset(frame, bust, colors.portrait, colors.portraitBorder);
      drawDeucePortrait(ctx, bust.x, bust.y, bust.w, bust.h, state, this.animTime, {
        lookY,
        showDeck: false,
      });
    }
    this.renderBanter(frame, layout);
  }

  private renderBanter(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const line = this.banterLine;
    if (line === null) return;
    const age = this.animTime - this.banterStartedAt;
    if (age > BANTER_HOLD_MS + BANTER_FADE_MS) {
      this.banterLine = null;
      return;
    }
    const alpha = age <= BANTER_HOLD_MS ? 1 : 1 - (age - BANTER_HOLD_MS) / BANTER_FADE_MS;
    glowText(frame.target, layout.banner, {
      text: line,
      style: frame.target.theme.type.caption,
      color: this.colors(frame).label,
      align: 'center',
      wrap: true,
      maxLines: BANTER_MAX_LINES,
      alpha,
    });
  }

  /** The felt each hand sits on, plus the painted betting circle. */
  private renderFelt(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const { ctx } = frame.target;
    const colors = this.colors(frame);
    for (const band of [layout.dealerHand, layout.playerHand]) {
      this.paintInset(frame, band, colors.felt, colors.feltLine);
    }
    const spot = layout.betSpot;
    const spotRadius = spot.h * HALF;
    fillRounded(ctx, spot, spotRadius, colors.betSpot);
    strokeRounded(ctx, spot, spotRadius, colors.feltLine, FELT_BORDER_WIDTH);
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

  private renderHands(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    this.renderHand(frame, layout, 'dealer', layout.dealerHand);
    this.renderHand(frame, layout, 'player', layout.playerHand);
  }

  private renderHand(
    frame: CasinoPaintFrame,
    layout: CasinoLayout,
    side: HandSide,
    band: Rect,
  ): void {
    const { target } = frame;
    const { ctx } = target;
    const { type, space } = target.theme;
    // The turn-away notice covers both bands; seat labels showing through it
    // read as artefacts rather than as empty seats.
    if (this.table.phase !== 'turned_away') {
      text(
        target,
        {
          x: band.x + space.sm,
          y: band.y + space.xs,
          w: band.w - space.sm * 2,
          h: type.overline.lineHeight,
        },
        { text: this.handLabel(side), style: type.overline, color: this.colors(frame).label },
      );
    }

    const cards = side === 'player' ? this.table.playerHand : this.table.dealerHand;
    const placements = handSpread(handCardBand(layout, band), layout.cardWidth, cards.length);
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
        highlight: winning ? this.colors(frame).winHighlight : undefined,
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
    rect: CardPose,
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
  private renderTurnedAwayNotice(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const { target } = frame;
    const { ctx, theme } = target;
    const colors = this.colors(frame);
    const top = layout.dealerHand.y;
    const bottom = layout.playerHand.y + layout.playerHand.h;
    const band = { x: layout.dealerHand.x, y: top, w: layout.dealerHand.w, h: bottom - top };

    fillRounded(ctx, band, theme.radius.md, colors.turnedAwayScrim);
    strokeRounded(ctx, band, theme.radius.md, colors.lose, TURNED_AWAY_BORDER_WIDTH);

    const centreY = band.y + band.h * HALF;
    // Flat, bright and unglowing. A glow behind a long string blurs into a bar
    // that reads as text underneath the text, and red on a dark red scrim has
    // too little contrast to carry the line in the first place — the red is
    // doing its job on the border.
    const titleStyle = theme.type.heading;
    text(
      target,
      { x: band.x, y: centreY - titleStyle.lineHeight, w: band.w, h: titleStyle.lineHeight },
      {
        text: 'NOT ENOUGH MONEY',
        style: titleStyle,
        color: colors.turnedAwayTitle,
        align: 'center',
      },
    );
    text(
      target,
      { x: band.x, y: centreY + theme.space.sm, w: band.w, h: theme.type.caption.lineHeight },
      {
        text: `You need at least ${TABLE_MINIMUM} coins to sit down.`,
        style: theme.type.caption,
        color: colors.label,
        align: 'center',
      },
    );
  }

  private renderStatus(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const { target } = frame;
    const { type } = target.theme;
    const colors = this.colors(frame);
    const message = this.statusMessage(colors);
    // The turn-away notice already spells this out across the felt in the
    // player's face; repeating it here just lands a second line on top of it.
    if (message.text === '') return;
    glowText(target, layout.statusRow, {
      text: message.text,
      style: message.emphasised ? type.heading : type.title,
      color: message.color,
      align: 'center',
      glow: message.emphasised ? message.color : undefined,
    });

    const feedback = this.table.feedbackMessage;
    if (feedback !== null) {
      text(target, layout.hintRow, {
        text: feedback,
        style: type.caption,
        color: colors.feedback,
        align: 'center',
        ...hintWrap(layout),
      });
    }
  }

  private statusMessage(colors: CasinoTableColors): {
    text: string;
    color: string;
    emphasised: boolean;
  } {
    switch (this.table.phase) {
      case 'turned_away':
        return { text: '', color: colors.muted, emphasised: false };
      case 'betting':
        return {
          text:
            this.table.betTotal > 0 ? `Bet ${this.table.betTotal}` : 'Stack your chips on the felt',
          color: colors.label,
          emphasised: false,
        };
      case 'dealing':
        return { text: 'Dealing…', color: colors.label, emphasised: false };
      case 'player_turn':
        return {
          text: `Your call — ${this.table.stake} on the felt`,
          color: colors.title,
          emphasised: false,
        };
      case 'dealer_turn':
        return { text: "Deuce's turn", color: colors.label, emphasised: false };
      case 'settled':
        return this.outcomeMessage(colors);
    }
  }

  private outcomeMessage(colors: CasinoTableColors): {
    text: string;
    color: string;
    emphasised: boolean;
  } {
    const outcome = this.table.outcome;
    if (outcome === null) {
      return { text: 'Hand void — bet refunded', color: colors.feedback, emphasised: false };
    }
    const stake = this.table.stake;
    switch (outcome.kind) {
      case 'player_blackjack':
        return {
          text: `BLACKJACK!  +${netForOutcome(outcome, stake)}`,
          color: colors.title,
          emphasised: true,
        };
      case 'player_win':
        return { text: `You win  +${stake}`, color: colors.win, emphasised: true };
      case 'dealer_win':
        return {
          text: isBust(this.table.playerHand) ? `Bust  −${stake}` : `House wins  −${stake}`,
          color: colors.lose,
          emphasised: false,
        };
      case 'push':
        return { text: 'Push — stake returned', color: colors.push, emphasised: false };
    }
  }

  private renderChips(
    frame: CasinoPaintFrame,
    layout: CasinoLayout,
    player: Player,
    companion: Player,
  ): void {
    const { target } = frame;
    const { type } = target.theme;
    const colors = this.colors(frame);
    const tray = layout.chipTray;
    const trayCentre = rectCentre(tray);
    const radius = tray.h * TRAY_CHIP_RADIUS_FRACTION;
    const baseY = tray.y + tray.h - radius;
    // The label owns the top of the rect, so the stack is capped to whatever is
    // left under it — an uncapped stack grows straight through its own caption.
    const chips = trayChips(partyCoins(player, companion)).slice(
      0,
      visibleChipCapacity(tray.h, radius, type.caption.lineHeight),
    );

    if (chips.length === 0) drawEmptyTrayOutline(target, trayCentre.x, baseY, radius);
    else drawChipStack(target, trayCentre.x, baseY, radius, chips);

    text(
      target,
      { x: tray.x, y: tray.y, w: tray.w, h: type.caption.lineHeight },
      {
        text: `Your tray — ${Math.round(this.displayedCoins)}`,
        style: type.caption,
        color: colors.muted,
        align: 'center',
        tabular: true,
      },
    );

    const spot = layout.betSpot;
    const spotCentre = rectCentre(spot);
    // Tapping the stack takes the top chip back off, which is the reverse of
    // tapping a chip well — Clear is the all-at-once shortcut, not the only way.
    if (this.table.phase === 'betting' && this.table.pendingBet.length > 0) {
      const look = frame.control({
        id: 'bet-spot',
        rect: spot,
        disabled: false,
        primary: false,
        focusable: false,
        action: { kind: 'remove_chip' },
      });
      if (look.hovered || look.pressed) {
        fillRounded(target.ctx, spot, spot.h * HALF, colors.betSpotHover);
      }
    }
    const betRadius = spot.h * BET_CHIP_RADIUS_FRACTION;
    const betBaseY = spot.y + spot.h - betRadius;
    const betting = this.table.phase === 'betting';
    const felt = (betting ? this.table.pendingBet : this.stakeChipsOnFelt()).slice(
      0,
      visibleChipCapacity(spot.h, betRadius, type.caption.lineHeight),
    );
    if (felt.length > 0) drawChipStack(target, spotCentre.x, betBaseY, betRadius, felt);

    const spotLabel = betting
      ? `Your bet — ${this.table.betTotal}`
      : felt.length > 0
        ? `Stake — ${this.table.stake}`
        : '';
    if (spotLabel !== '') {
      text(
        target,
        { x: spot.x, y: spot.y, w: spot.w, h: type.caption.lineHeight },
        {
          text: spotLabel,
          style: type.caption,
          color: colors.muted,
          align: 'center',
          tabular: true,
        },
      );
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

  private renderActions(
    frame: CasinoPaintFrame,
    layout: CasinoLayout,
    player: Player,
    companion: Player,
  ): void {
    const row = layout.actionRow;
    switch (this.table.phase) {
      case 'turned_away':
      case 'dealing':
      case 'dealer_turn':
        return;
      case 'betting':
        this.renderBettingActions(frame, layout, row, player, companion);
        return;
      case 'player_turn':
        frame.focusGroup('casino-turn');
        this.renderTurnActions(frame, layout, row, player, companion);
        frame.focusGroup(null);
        return;
      case 'settled':
        frame.focusGroup('casino-settled');
        this.renderSettledActions(frame, layout, row);
        frame.focusGroup(null);
        return;
    }
  }

  /** Split `row` into `count` equal columns with the standard gap between them. */
  private columns(row: Rect, count: number): Array<Rect> {
    const width = (row.w - BUTTON_GAP * (count - 1)) / count;
    const cells: Rect[] = [];
    for (let i = 0; i < count; i++) {
      cells.push({ x: row.x + (width + BUTTON_GAP) * i, y: row.y, w: width, h: row.h });
    }
    return cells;
  }

  /** Two stacked rows in compact mode; one row of everything in wide. */
  private actionCells(layout: CasinoLayout, row: Rect, count: number): Array<Rect> {
    if (layout.mode === 'wide') return this.columns(row, count);
    const perRow = Math.ceil(count / COMPACT_ACTION_ROW_COUNT);
    const rowHeight = layout.buttonHeight;
    const top = this.columns({ ...row, h: rowHeight }, perRow);
    const bottom = this.columns(
      { x: row.x, y: row.y + rowHeight + BUTTON_GAP, w: row.w, h: rowHeight },
      count - perRow,
    );
    return [...top, ...bottom];
  }

  private addButton(
    frame: CasinoPaintFrame,
    button: {
      readonly id: string;
      readonly cell: Rect;
      readonly label: string;
      readonly variant: ButtonVariant;
      readonly action: CasinoAction;
      readonly disabled?: boolean;
      readonly primary?: boolean;
      readonly focusable?: boolean;
    },
  ): void {
    const disabled = button.disabled ?? false;
    const look = frame.control({
      id: button.id,
      rect: button.cell,
      disabled,
      primary: button.primary ?? false,
      focusable: button.focusable ?? true,
      action: button.action,
    });
    const { theme } = frame.target;
    paintSkinnedControl(frame.target, button.cell, {
      label: button.label,
      skin: skinsFor(theme).button[button.variant],
      look,
      disabled,
      radius: theme.radius.md,
      textStyle: theme.type.label,
    });
  }

  private renderBettingActions(
    frame: CasinoPaintFrame,
    layout: CasinoLayout,
    row: Rect,
    player: Player,
    companion: Player,
  ): void {
    const { target } = frame;
    const colors = this.colors(frame);
    const cells = this.actionCells(layout, row, CHIP_DENOMINATIONS.length + BETTING_CONTROL_COUNT);
    const ceiling = this.table.effectiveMaximum(player, companion);

    CHIP_DENOMINATIONS.forEach((denomination, i) => {
      const cell = cells[i];
      const affordable =
        canAffordCoins(player, companion, denomination) &&
        this.table.betTotal + denomination <= ceiling;
      const look = frame.control({
        id: `chip-${denomination}`,
        rect: cell,
        disabled: !affordable,
        primary: false,
        focusable: true,
        action: { kind: 'chip', denomination },
      });
      const well = cell;
      const wellRadius = well.h * HALF;
      fillRounded(target.ctx, well, wellRadius, colors.well);
      if (affordable && (look.hovered || look.pressed)) {
        fillRounded(target.ctx, well, wellRadius, colors.wellHover);
      }
      strokeRounded(target.ctx, well, wellRadius, colors.wellRim, FELT_BORDER_WIDTH);
      if (look.focused) drawFocusRing(target, well, wellRadius);
      const centre = rectCentre(cell);
      const chipRadius = Math.min(
        cell.w * CHIP_WELL_FILL_FRACTION,
        cell.h * HALF - CHIP_BUTTON_INSET,
      );
      const pressDrop = look.pressed && affordable ? skinsFor(target.theme).pressDrop : 0;
      drawChip(target, centre.x, centre.y + pressDrop, chipRadius, denomination, {
        alpha: affordable ? 1 : DISABLED_CHIP_ALPHA,
        showLabel: true,
      });
    });

    const clearCell = cells[CHIP_DENOMINATIONS.length];
    const sameCell = cells[CHIP_DENOMINATIONS.length + 1];
    const dealCell = cells[CHIP_DENOMINATIONS.length + 2];

    this.addButton(frame, {
      id: 'clear',
      cell: clearCell,
      label: 'Clear',
      variant: 'ghost',
      action: { kind: 'clear_bet' },
      disabled: this.table.betTotal === 0,
    });
    this.addButton(frame, {
      id: 'same-bet',
      cell: sameCell,
      label: 'Same Bet',
      variant: 'secondary',
      action: { kind: 'same_bet' },
      disabled: !this.table.canRepeatLastBet,
    });
    this.addButton(frame, {
      id: 'deal',
      cell: dealCell,
      label: 'Deal',
      variant: 'primary',
      action: { kind: 'deal' },
      disabled: this.table.betTotal < TABLE_MINIMUM,
    });
  }

  private renderTurnActions(
    frame: CasinoPaintFrame,
    layout: CasinoLayout,
    row: Rect,
    player: Player,
    companion: Player,
  ): void {
    const cells = this.actionCells(layout, row, TURN_CONTROL_COUNT);
    this.addButton(frame, {
      id: 'hit',
      cell: cells[0],
      label: 'Hit',
      variant: 'success',
      action: { kind: 'hit' },
    });
    this.addButton(frame, {
      id: 'stand',
      cell: cells[1],
      label: 'Stand',
      variant: 'danger',
      action: { kind: 'stand' },
    });
    this.addButton(frame, {
      id: 'double',
      cell: cells[2],
      label: `Double (${this.table.stake})`,
      variant: 'secondary',
      action: { kind: 'double' },
      disabled: !this.table.canDoubleDown(player, companion),
    });
  }

  private renderSettledActions(frame: CasinoPaintFrame, layout: CasinoLayout, row: Rect): void {
    const cells = this.actionCells(layout, row, SETTLED_CONTROL_COUNT);
    // The one safe default at this table: it clears the felt rather than staking anything.
    this.addButton(frame, {
      id: 'next-hand',
      cell: cells[0],
      label: 'Next Hand',
      variant: 'primary',
      action: { kind: 'next_hand' },
      primary: true,
    });
    this.addButton(frame, {
      id: 'repeat-hand',
      cell: cells[1],
      label: 'Same Bet',
      variant: 'secondary',
      action: { kind: 'repeat_hand' },
      disabled: !this.table.canRepeatLastBet,
    });
  }

  private renderHint(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    if (this.table.feedbackMessage !== null) return;
    if (!this.hintsEnabled) return;
    if (this.table.phase !== 'player_turn') return;
    const advice = basicStrategyAdvice(
      this.table.playerHand,
      this.table.dealerHand[0],
      this.table.playerHand.length === 2 && !this.table.doubled,
    );
    if (advice === null) return;
    text(frame.target, layout.hintRow, {
      text: advice.line,
      style: frame.target.theme.type.caption,
      color: this.colors(frame).muted,
      align: 'center',
      ...hintWrap(layout),
    });
  }

  private renderFooter(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    this.addButton(frame, {
      id: 'help',
      cell: layout.helpButton,
      label: 'How to Play',
      variant: 'secondary',
      action: { kind: 'help' },
    });
    this.addButton(frame, {
      id: 'leave',
      cell: layout.leaveButton,
      label: leaveLabel(frame.keyHints, layout.mode),
      variant: 'danger',
      action: { kind: 'leave' },
    });
  }

  // ── Animation layers ─────────────────────────────────────────────────────

  private anchorPoint(layout: CasinoLayout, anchor: ChipAnchor): { x: number; y: number } {
    switch (anchor) {
      case 'tray': {
        const tray = layout.chipTray;
        const radius = tray.h * TRAY_CHIP_RADIUS_FRACTION;
        return { x: tray.x + tray.w * HALF, y: tray.y + tray.h - radius };
      }
      case 'felt': {
        const spot = layout.betSpot;
        const radius = spot.h * BET_CHIP_RADIUS_FRACTION;
        return {
          x: spot.x + spot.w * HALF,
          y: chipStackTopY(spot.y + spot.h - radius, radius, this.table.pendingBet.length),
        };
      }
      case 'rack': {
        // Deuce's own chip rack: the felt strip along the bottom of the portrait
        // in wide mode, and just off the top of the dealer's band in compact.
        // Aiming at the portrait's centre threw losing chips into Deuce's face.
        const portrait = layout.dealerPortrait;
        if (portrait === null) {
          return { x: layout.dealerHand.x + layout.dealerHand.w * HALF, y: layout.panel.y };
        }
        return {
          x: portrait.x + portrait.w * HALF,
          y: portrait.y + portrait.h * DEALER_RACK_PORTRAIT_FRACTION,
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
      x: layout.dealerHand.x + layout.dealerHand.w - layout.cardWidth,
      y: layout.dealerHand.y,
    };
  }

  private renderFlights(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    this.renderCardFlights(frame.target.ctx, layout);
    this.renderChipFlights(frame, layout);
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
      const target = handSpread(handCardBand(layout, band), layout.cardWidth, cards.length)[
        flight.index
      ];

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

  private renderChipFlights(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    for (const flight of this.chipFlights) {
      const progress = clamp01((this.animTime - flight.startedAt) / flight.duration);
      const eased = easeOutCubic(progress);
      const from = this.anchorPoint(layout, flight.from);
      const to = this.anchorPoint(layout, flight.to);
      const radius = layout.chipTray.h * TRAY_CHIP_RADIUS_FRACTION;
      const arc = -Math.sin(progress * Math.PI) * radius * CHIP_ARC_HEIGHT_FRACTION;
      // A landing chip settles with a small bounce rather than sticking flat.
      const landingPhase = Math.max(0, progress - (1 - CHIP_LAND_BOUNCE)) / CHIP_LAND_BOUNCE;
      const bounce = -Math.sin(landingPhase * Math.PI) * radius * CHIP_LAND_BOUNCE;
      drawChip(
        frame.target,
        from.x + (to.x - from.x) * eased,
        from.y + (to.y - from.y) * eased + arc + bounce,
        radius,
        flight.denomination,
        { shadow: true, showLabel: true },
      );
    }
  }

  private renderOutcomeEffects(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const shownAt = this.outcomeShownAt;
    if (shownAt === null) return;
    const { ctx } = frame.target;
    const age = this.animTime - shownAt;

    if (isBust(this.table.playerHand) && age < BUST_VIGNETTE_MS) {
      this.renderBustVignette(frame, layout, age / BUST_VIGNETTE_MS);
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
      ctx.fillStyle = this.colors(frame).coin;
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
    frame: CasinoPaintFrame,
    layout: CasinoLayout,
    progress: number,
  ): void {
    const { ctx, theme } = frame.target;
    const tint = theme.palette.state.danger;
    const panel = layout.panel;
    const centreX = panel.x + panel.w * HALF;
    const centreY = panel.y + panel.h * HALF;
    const radius = Math.hypot(panel.w, panel.h) * HALF;
    const gradient = ctx.createRadialGradient(
      centreX,
      centreY,
      radius * BUST_VIGNETTE_INNER_FRACTION,
      centreX,
      centreY,
      radius,
    );
    gradient.addColorStop(0, withAlpha(tint, 0));
    gradient.addColorStop(1, withAlpha(tint, 1));

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.sin(progress * Math.PI) * VIGNETTE_ALPHA);
    ctx.fillStyle = gradient;
    roundRectPath(ctx, panel, theme.radius.lg);
    ctx.fill();
    ctx.restore();
  }

  /**
   * The riffle: two halves of the deck interleaving over the felt. This is the
   * moment the player learns the deck is real, so it is visible and unmissable
   * rather than a silent counter reset.
   */
  private renderShuffleFlourish(frame: CasinoPaintFrame, layout: CasinoLayout): void {
    const started = this.shuffleStartedAt;
    if (started === null) return;
    const { ctx } = frame.target;
    const colors = this.colors(frame);
    const progress = clamp01((this.animTime - started) / SHUFFLE_FLOURISH_MS);
    const band = layout.dealerHand;
    const centre = rectCentre(band);

    // The riffle plays over the hand that just settled, so the band is covered
    // first — interleaving card backs through a live hand reads as a glitch.
    ctx.save();
    ctx.globalAlpha *= Math.min(1, (1 - progress) * SHUFFLE_SCRIM_FADE);
    this.paintInset(frame, band, colors.feltOpaque, colors.feltLine);
    ctx.restore();

    const cardW = layout.cardWidth * SHUFFLE_CARD_WIDTH_FRACTION;
    const spread = Math.sin(progress * Math.PI) * band.w * SHUFFLE_SPLIT_SPREAD;

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

function hintWrap(layout: CasinoLayout): Pick<TextOptions, 'wrap' | 'maxLines' | 'valign'> {
  return { wrap: layout.hintLines > 1, maxLines: layout.hintLines, valign: 'middle' };
}

/** The landscape footer button is too narrow for both the full name and the key. */
function leaveLabel(keyHints: boolean, mode: CasinoLayout['mode']): string {
  if (!keyHints) return 'Leave Table';
  return mode === 'landscape' ? 'Leave [Esc]' : 'Leave Table [Esc]';
}
