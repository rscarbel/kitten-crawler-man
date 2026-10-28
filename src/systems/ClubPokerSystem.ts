/**
 * The Cloak & Dagger's Texas Hold'em table — the presentation and input host
 * over {@link PokerTable}, and the one place poker touches the party's purse.
 *
 * Money moves exactly twice: the buy-in (and any rebuy) takes coins out of the
 * purse, and cashing out puts the stack back. Chips at the table are never in
 * the purse, and nothing else here spends or credits a coin.
 *
 * What the table shows lives in `PokerMotion` (the catch-up from the engine's
 * events to what is on screen) and `PokerTableView` (the painting and the
 * controls); this host owns the money, the surfaces and the regulars' reads.
 */

import type { Player } from '../Player';
import { canAffordCoins, partyCoins, spendPartyCoins } from '../core/party/partyCoins';
import { NEVER_LUCKY, type LuckCheck } from '../core/state/GodMode';
import { copyPokerReads, type CasinoState, type PokerReads } from '../core/club/CasinoState';
import { viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import { keybindings } from '../core/input/Keybindings';
import { ACTIVATE_KEYS, type Surface, type Ui, type UiAudio } from '../ui/core/UiRoot';
import { inset, splitV, type Rect } from '../ui/core/geom';
import type { ToastTone } from '../ui/hud/toasts';
import { PokerBanter } from '../ui/casino/pokerBanter';
import { pokerHistorySurface } from '../ui/casino/pokerHistory';
import { REGULAR_SHORT_NAMES } from '../ui/casino/pokerNames';
import { PokerMotion } from '../ui/casino/pokerMotion';
import {
  pokerSeatInfoSurface,
  SEAT_INFO_BIO_HANDS,
  type SeatInfoModel,
} from '../ui/casino/pokerSeatInfo';
import {
  PokerTableView,
  type PokerSeatIdentity,
  type PokerTableControls,
} from '../ui/casino/PokerTableView';
import { ConfirmDialog } from '../ui/screens/dialogs/ConfirmDialog';
import { PokerRules } from '../ui/screens/dialogs/PokerRules';
import { pickDeuceLine, type BanterTrigger } from '../dialog/scripts/deuce';
import {
  POKER_QUIET_LINE,
  pickChatterLine,
  pickRegularLine,
} from '../dialog/scripts/pokerRegulars';
import type { SoundId } from '../audio/sounds';
import { coinPurse, measureCoinPurse } from '../ui/screens/shop/shopParts';
import { skinsFor } from '../ui/theme/skins';
import { card } from '../ui/widgets/card';
import { choiceModalSurface } from '../ui/widgets/choiceModal';
import { panel } from '../ui/widgets/panel';
import { lineHeightOf, text } from '../ui/widgets/text';
import type { PokerAction, PokerActionKind } from './casino/poker/bettingRound';
import { PokerHandHistory, type HandHistoryEntry } from './casino/poker/handHistory';
import type { PokerBanterTrigger, PokerEvent } from './casino/poker/pokerEvents';
import {
  betChipsCue,
  pokerCueSound,
  shuffleSound,
  type PokerCue,
} from './casino/poker/pokerSoundCues';
import { PokerHandReactions, type ReactionVoice } from './casino/poker/pokerReactions';
import {
  BUY_IN_BIG_BLINDS,
  POKER_STAKES,
  POKER_TIER_IDS,
  type PokerTierId,
} from './casino/poker/pokerStakes';
import {
  PLAYER_SEAT,
  POKER_SEAT_COUNT,
  type PokerSeat,
  type PokerTable,
} from './casino/poker/PokerTable';
import { listAt } from './casino/poker/npc/listAt';
import { isTilted } from './casino/poker/npc/mood';
import {
  buildRegularBio,
  rollPokerPersonalities,
  type PokerPersonalities,
} from './casino/poker/npc/personality';
import { createRegularsTable, type PokerRegulars } from './casino/poker/npc/PokerRegulars';
import { fadeReadBetweenVisits } from './casino/poker/npc/playerRead';
import { POKER_REGULARS } from './casino/poker/npc/regulars';
import { REGULAR_IDS, isRegularId, type RegularId } from './casino/poker/npc/regularIds';
import type { CasinoSeat } from './ClubCasinoSystem';

/** Frames longer than this are a tab-away, not a slow frame; the clock refuses to jump. */
const MAX_FRAME_MS = 100;
const HALF = 0.5;

/** The cheapest seat in the room: the casino's game picker gates Hold'em on it. */
export const POKER_MIN_BUY_IN = Math.min(...POKER_TIER_IDS.map((tier) => POKER_STAKES[tier].buyIn));

/** A buy-in card's copy: its terms, then its flavour. */
const TIER_COPY_LINES = 2;
const PLAYER_NAME = 'You';
const EMPTY_SEAT_NAME = 'Empty seat';
const MINUS_SIGN = '−';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** How often Deuce says something over the shuffle when there is nothing else to remark on. */
const DEUCE_SHUFFLE_LINE_CHANCE = 0.15;
/** A pot this many big blinds or bigger earns Deuce's remark as the next hand is shuffled. */
const DEUCE_BIG_POT_BIG_BLINDS = 40;
/** A pot this big, going to a showdown with everyone all in, draws an "ooh" from the rail. */
const RAIL_OOH_BIG_BLINDS = 60;

/** The player's own setting in the browser, read once: the table shortens its motion for it. */
function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** The table's two toggles and the regulars' reads, which live on the casino state between visits. */
export type PokerTableSettings = Pick<
  CasinoState,
  'pokerFast' | 'pokerShowCards' | 'pokerReads' | 'pokerNotes'
>;

function coins(amount: number): string {
  return amount.toLocaleString('en-US');
}

/** "+340", "−60" or "+0": a session's net in the toast's own sign convention. */
function signedCoins(amount: number): string {
  return amount < 0 ? `${MINUS_SIGN}${coins(-amount)}` : `+${coins(amount)}`;
}

function seatName(seat: Readonly<PokerSeat>): string {
  if (seat.isPlayer) return PLAYER_NAME;
  if (seat.occupantId === null) return EMPTY_SEAT_NAME;
  return isRegularId(seat.occupantId) ? POKER_REGULARS[seat.occupantId].name : seat.occupantId;
}

/** What a finished sitting paid back, for the toast and the HUD fly. */
export interface PokerCashOut {
  readonly cashedOut: number;
  readonly net: number;
}

export class ClubPokerSystem {
  private table: PokerTable | null = null;
  /** The regulars playing and churning the current table's NPC seats. */
  private regularsValue: PokerRegulars | null = null;
  private buyInShown = false;
  private readsFadedThisVisit = false;
  /** The rules sheet opens itself once per visit, on the first sit-down, as blackjack's does. */
  private rulesShownThisVisit = false;
  private readonly leaveConfirm: ConfirmDialog;
  private readonly personalities: PokerPersonalities;
  private readonly banter = new PokerBanter();
  /** How many times each cue has sounded, so a cue with several takes rotates through them. */
  private readonly cuePlays = new Map<PokerCue, number>();
  private readonly reactions = new PokerHandReactions((seat) => this.reactionVoiceAt(seat));
  private history: PokerHandHistory;
  private historyShown = false;
  /** The regular whose seat-info card is open, and the seat they were tapped in. */
  private seatInfo: { readonly seat: number; readonly regular: RegularId } | null = null;
  /** Who stood up from each seat last, so their parting line is still credited to them once the chair is empty. */
  private readonly lastVacated: Array<RegularId | null> = Array.from(
    { length: POKER_SEAT_COUNT },
    () => null,
  );
  /**
   * Something Deuce will say as the next hand is shuffled: a remark on the last
   * pot, or his welcome. Said then rather than at once, because the shuffle's
   * own call would cover it straight away.
   */
  private lineOnShuffle: string | null = null;
  private lastDeuceLine: string | null = null;

  private animTime = 0;
  private lastFrameStamp: number | null = null;
  private readonly motion: PokerMotion;
  private readonly view: PokerTableView;
  private readonly rules: PokerRules;
  private readonly reducedMotion = prefersReducedMotion();
  /** The player folded and asked to see the rest of the hand at speed. */
  private skipping = false;

  /** Coins the purse paid into the current sitting: the buy-in plus every rebuy. */
  private sittingBuyIns = 0;
  /** The player's row on screen, in canvas CSS pixels, where the winnings fly from. */
  private playerAnchor: { x: number; y: number } | null = null;

  /**
   * Fired once per sitting, when the player cashes out ahead, with the
   * sitting's net winnings and where the player's stack sat on screen.
   */
  onWinnings: ((coins: number, screenX: number, screenY: number) => void) | null = null;
  /** Read at each deal: while it answers true, the player's hole cards always hold an Ace. */
  isLucky: LuckCheck = NEVER_LUCKY;
  /** Reports a cash-out to the player; the scene posts it as a toast. */
  onNotice: ((message: string, tone: ToastTone) => void) | null = null;

  /**
   * @param lineRandom Picks the words of banter and Deuce's remarks. Kept apart
   *   from `random`, which deals and plays the hands, so what is said never
   *   changes what is dealt.
   */
  constructor(
    private readonly audio: UiAudio | null,
    private readonly worldSeed: number,
    private readonly clock: () => number = () => performance.now(),
    private readonly random: () => number = Math.random,
    private readonly toggles: PokerTableSettings = {
      pokerFast: false,
      pokerShowCards: false,
      pokerReads: {},
      pokerNotes: {},
    },
    private readonly lineRandom: () => number = Math.random,
  ) {
    this.leaveConfirm = new ConfirmDialog(audio);
    this.motion = new PokerMotion((seat) => this.seatLabel(seat));
    this.view = new PokerTableView(this.motion);
    this.view.paintOverTable = (ui, layout) =>
      this.banter.paint(
        ui,
        layout,
        this.motion.time,
        (seat) => this.motion.revealAt[seat] !== null,
      );
    // A table too crowded for a bubble anywhere (a phone at showdown) still
    // lets the line be read, on the dealer's strip, so a chatter tell is never lost.
    this.banter.onUnplaced = (speaker, line) => this.view.say(`${speaker}: ${line}`);
    this.motion.hooks.onBanter = (seat, trigger) => this.regularSays(seat, trigger);
    this.motion.hooks.onChatter = (seat, direction) => this.regularChatters(seat, direction);
    this.personalities = rollPokerPersonalities(worldSeed);
    this.history = new PokerHandHistory((seat) => this.seatLabel(seat));
    this.rules = new PokerRules();
  }

  private seatLabel(seat: number): string {
    const occupant = this.table?.seats[seat];
    return occupant === undefined ? EMPTY_SEAT_NAME : seatName(occupant);
  }

  /** The regulars at the current table: their moods, reads and tells. `null` while not seated. */
  get regulars(): PokerRegulars | null {
    return this.regularsValue;
  }

  /** The table in play, or `null` while the player is not seated. */
  get pokerTable(): PokerTable | null {
    return this.table;
  }

  get tableOpen(): boolean {
    return this.table !== null;
  }

  get buyInOpen(): boolean {
    return this.buyInShown;
  }

  /** Whether any poker screen is up: the buy-in, the table, or anything stacked on it. */
  get anySurfaceOpen(): boolean {
    return (
      this.buyInShown ||
      this.table !== null ||
      this.leaveConfirm.isOpen ||
      this.rules.isOpen ||
      this.historyShown ||
      this.seatInfo !== null
    );
  }

  /** The table's last hands, newest first, as the history panel lists them. */
  get handHistory(): ReadonlyArray<HandHistoryEntry> {
    return this.history.entries;
  }

  /** The speech bubble up now — its seat, words and age — or `null`. */
  get speechBubble(): ReturnType<PokerBanter['showing']> {
    return this.banter.showing(this.motion.time);
  }

  /** Every card and chip in the air has landed: what the table shows has caught up with the hand. */
  get flightsLanded(): boolean {
    return this.motion.flights.length === 0;
  }

  openBuyIn(): void {
    if (this.table !== null) return;
    this.buyInShown = true;
  }

  closeBuyIn(): void {
    this.buyInShown = false;
  }

  /**
   * The regulars' reads of the player as this visit starts them: a read fades
   * once between visits, on the first sit-down, and is carried as it stands
   * from one sitting to the next within a visit.
   */
  private readsForThisVisit(): PokerReads {
    if (!this.readsFadedThisVisit) {
      this.readsFadedThisVisit = true;
      const faded: PokerReads = {};
      for (const id of REGULAR_IDS) {
        const read = this.toggles.pokerReads[id];
        if (read !== undefined) faded[id] = fadeReadBetweenVisits(read);
      }
      this.toggles.pokerReads = faded;
    }
    return this.toggles.pokerReads;
  }

  /** Takes the tier's buy-in from the purse and seats the player. False when the party can't cover it. */
  buyIn(tier: PokerTierId, active: Player, companion: Player): boolean {
    if (this.table !== null) return false;
    const amount = POKER_STAKES[tier].buyIn;
    if (!spendPartyCoins(active, companion, amount, active)) return false;
    this.sittingBuyIns = amount;
    const seated = createRegularsTable({
      tier,
      worldSeed: this.worldSeed,
      random: this.random,
      playerStack: amount,
      reads: this.readsForThisVisit(),
      notes: this.toggles.pokerNotes,
      isLucky: () => this.isLucky(),
    });
    this.table = seated.table;
    this.table.setFast(this.toggles.pokerFast);
    this.table.setShowCards(this.toggles.pokerShowCards);
    this.regularsValue = seated.regulars;
    this.buyInShown = false;
    this.lastFrameStamp = null;
    this.playerAnchor = null;
    this.skipping = false;
    this.motion.reset();
    this.view.closeTray();
    this.banter.clear();
    this.lastVacated.fill(null);
    this.history = new PokerHandHistory((seat) => this.seatLabel(seat));
    this.playCue('buy_in');
    if (this.rulesShownThisVisit) {
      this.lineOnShuffle = `Welcome to the ${POKER_STAKES[tier].name}. Blinds are ${coins(POKER_STAKES[tier].smallBlind)} and ${coins(POKER_STAKES[tier].bigBlind)}.`;
    } else {
      this.rulesShownThisVisit = true;
      this.lineOnShuffle = this.deuceLine('poker_first_sit');
      this.rules.show(true);
    }
    return true;
  }

  /** Back in at the same tier after busting, paid from the purse. */
  rebuy(active: Player, companion: Player): boolean {
    const table = this.table;
    if (table?.phase !== 'player_busted') return false;
    const amount = table.stakes.buyIn;
    if (!canAffordCoins(active, companion, amount)) return false;
    if (!table.rebuy()) return false;
    spendPartyCoins(active, companion, amount, active);
    this.sittingBuyIns += amount;
    this.playCue('rebuy');
    return true;
  }

  /**
   * Every regular has left: cash the stack out exactly as leaving does, then
   * buy into a fresh game at the same tier with a new lineup. False when the
   * purse, with the stack back in it, can't cover the buy-in; the player is
   * then left standing, cashed out.
   */
  newGame(active: Player, companion: Player): boolean {
    const table = this.table;
    if (table?.phase !== 'game_over') return false;
    const tier = table.tier;
    this.leaveTable(active);
    return this.buyIn(tier, active, companion);
  }

  /** Acts for the player; the table refuses anything that is not legal right now. */
  act(action: PokerAction): void {
    this.view.closeTray();
    this.table?.playerAct(action);
  }

  /** Opens the rules sheet over the table, as the footer's Rules button does. */
  openRules(): void {
    this.rules.show();
  }

  /** Puts the rules sheet away, as Done or Skip does. */
  dismissRules(): void {
    this.rules.dismiss();
  }

  /** Opens the hand history over the table, as the footer's History button does. */
  openHistory(): void {
    if (this.table !== null) this.historyShown = true;
  }

  closeHistory(): void {
    this.historyShown = false;
  }

  /** Opens the seat-info card on whoever sits in `seat`; false for the player's own seat or an empty one. */
  openSeatInfo(seat: number): boolean {
    const regular = this.regularsValue?.regularAt(seat) ?? null;
    if (this.table === null || seat === PLAYER_SEAT || regular === null) return false;
    this.seatInfo = { seat, regular };
    return true;
  }

  closeSeatInfo(): void {
    this.seatInfo = null;
  }

  /** What the seat-info card shows: only what the player has watched the regular do. */
  private seatInfoModel(): SeatInfoModel | null {
    const open = this.seatInfo;
    const table = this.table;
    const regulars = this.regularsValue;
    if (open === null || table === null || regulars === null) return null;
    const note = regulars.notes[open.regular] ?? null;
    const read = regulars.reads[open.regular] ?? null;
    const handsTogether = Math.max(note?.handsSeen ?? 0, read?.handsSeen ?? 0);
    const bio =
      handsTogether >= SEAT_INFO_BIO_HANDS
        ? buildRegularBio(this.personalities[open.regular])
        : null;
    const sitting = regulars.regularAt(open.seat) === open.regular;
    return {
      name: POKER_REGULARS[open.regular].name,
      stack: sitting ? table.seats[open.seat].stack : 0,
      handsTogether,
      note,
      bio,
    };
  }

  /** Opens the raise sizing tray as the Raise button does; false when no sized bet or raise is open. */
  openRaiseTray(): boolean {
    return this.table !== null && this.view.openTrayFor(this.table);
  }

  /** Once the player has folded, plays the rest of the hand at speed. */
  skip(): void {
    if (this.table?.skipToNextHand() === true) this.skipping = true;
  }

  private toggleFast(): void {
    this.toggles.pokerFast = !this.toggles.pokerFast;
    this.table?.setFast(this.toggles.pokerFast);
    this.view.say(this.toggles.pokerFast ? 'Fast dealing on.' : 'Fast dealing off.');
  }

  private toggleShowCards(): void {
    this.toggles.pokerShowCards = !this.toggles.pokerShowCards;
    this.table?.setShowCards(this.toggles.pokerShowCards);
    this.view.say(
      this.toggles.pokerShowCards
        ? 'Your losing hands will be shown at showdown.'
        : 'Your losing hands will be mucked at showdown.',
    );
  }

  /**
   * Every way out of the table comes here. Mid-hand it asks first, because
   * leaving folds the hand and leaves the player's chips in the pot.
   */
  requestLeave(player: Player): void {
    const table = this.table;
    if (table === null || this.leaveConfirm.isOpen) return;
    if (!table.isPlayerLive()) {
      this.leaveTable(player);
      return;
    }
    const staked = table.playerContribution;
    const stays =
      staked > 0 ? ` The ${coins(staked)} coins you've put in this pot stay in it.` : '';
    this.leaveConfirm.open({
      title: 'Fold and leave?',
      message: `Leaving now folds your hand.${stays}`,
      yesLabel: 'Fold & Leave',
      noLabel: 'Keep Playing',
      onYes: () => this.leaveTable(player),
      onNo: () => undefined,
    });
  }

  /** Scene teardown: no prompt, the same fold, then the cash-out. */
  forceClose(player: Player): void {
    this.leaveConfirm.close();
    this.rules.dismiss();
    this.buyInShown = false;
    if (this.table !== null) this.leaveTable(player, { quiet: true });
  }

  /**
   * Folds if live, stands up and cashes the stack back into the purse. A
   * teardown leaves `quiet`: the chips are counted with no sound under a
   * scene that is already going away.
   */
  private leaveTable(player: Player, opts: { readonly quiet: boolean } = { quiet: false }): void {
    const table = this.table;
    if (table === null) return;
    this.leaveConfirm.close();
    const remaining = table.forfeitAndLeave();
    table.drainEvents();
    this.motion.settle();
    this.view.closeTray();
    this.rules.dismiss();
    this.historyShown = false;
    this.seatInfo = null;
    this.banter.clear();
    this.history.abandonHand();
    if (!opts.quiet) this.playCue('cash_out');
    const regulars = this.regularsValue;
    if (regulars !== null) {
      this.toggles.pokerReads = copyPokerReads(regulars.reads);
      this.toggles.pokerNotes = copyPokerReads(regulars.notes);
    }
    this.table = null;
    this.regularsValue = null;
    this.cashOut(player, remaining);
  }

  /**
   * The stake comes home as plain coins and only the profit counts as earned,
   * the same split blackjack's payouts use, so run stats never count the
   * player's own buy-in as income.
   */
  private cashOut(player: Player, remaining: number): void {
    const paidIn = this.sittingBuyIns;
    this.sittingBuyIns = 0;
    const stakeReturned = Math.min(remaining, paidIn);
    player.coins += stakeReturned;
    player.earnCoins(remaining - stakeReturned);
    const result: PokerCashOut = { cashedOut: remaining, net: remaining - paidIn };
    // Walking away with nothing has nothing to count out; the bust or the
    // empty table has already said what happened to the chips.
    if (remaining > 0) {
      this.onNotice?.(
        `Cashed out ${coins(result.cashedOut)} (${signedCoins(result.net)})`,
        result.net > 0 ? 'success' : 'neutral',
      );
    }
    if (result.net > 0) {
      const anchor = this.playerAnchor ?? {
        x: viewportWidth() * HALF,
        y: viewportHeight() * HALF,
      };
      this.onWinnings?.(result.net, anchor.x, anchor.y);
    }
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  update(): void {
    const dtMs = this.tickClock();
    const table = this.table;
    if (table === null) return;
    this.motion.setPace({
      fast: this.toggles.pokerFast,
      skipping: this.skipping,
      reducedMotion: this.reducedMotion,
    });
    // The confirm quotes the player's stake in the pot, and the rules sheet,
    // the history and a seat's card are read with the table in view, so the
    // hand holds still under all of them.
    const overlayUp =
      this.leaveConfirm.isOpen || this.rules.isOpen || this.historyShown || this.seatInfo !== null;
    if (!overlayUp) {
      table.update(dtMs);
      let potSwept = false;
      for (const event of table.drainEvents()) {
        const handOver =
          event.kind === 'button_moved' ||
          event.kind === 'shuffled' ||
          event.kind === 'player_busted' ||
          event.kind === 'game_over';
        if (handOver) this.skipping = false;
        if (event.kind === 'seat_vacated' && isRegularId(event.occupantId)) {
          this.lastVacated[event.seat] = event.occupantId;
        }
        this.history.observe(event, table);
        this.reactions.observe(event);
        // A hand the player skipped through plays silently: a cue per card
        // and chip at four times speed is noise, not feedback.
        // Every pot at a showdown is pushed in the same step: one sweep sounds for all of them.
        const repeatSweep = event.kind === 'pot_awarded' && potSwept;
        if (event.kind === 'pot_awarded') potSwept = true;
        if (!this.skipping && !repeatSweep) this.soundFor(event, table);
        this.motion.handle(event, table);
        this.deuceAfter(event, table);
      }
    }
    this.motion.advance(this.animTime);
  }

  // ── Talk ─────────────────────────────────────────────────────────────────

  private deuceLine(trigger: BanterTrigger): string {
    const line = pickDeuceLine(trigger, this.lastDeuceLine);
    this.lastDeuceLine = line;
    return line;
  }

  /**
   * Deuce's remarks ride on the dealer's strip. A remark about a pot waits for
   * the next shuffle, so it never covers the call saying who won it.
   */
  private deuceAfter(event: PokerEvent, table: PokerTable): void {
    if (event.kind === 'shuffled') {
      const pending = this.lineOnShuffle;
      this.lineOnShuffle = null;
      if (pending !== null) this.view.say(pending);
      else if (this.lineRandom() < DEUCE_SHUFFLE_LINE_CHANCE) {
        this.view.say(this.deuceLine('poker_shuffle'));
      }
    } else if (event.kind === 'pot_awarded') {
      if (event.seats.length > 1) this.lineOnShuffle = this.deuceLine('poker_split_pot');
    } else if (event.kind === 'hand_complete') {
      const pot = listAt(this.history.entries, 0)?.pot ?? 0;
      const bigPot = pot >= DEUCE_BIG_POT_BIG_BLINDS * table.stakes.bigBlind;
      if (bigPot && this.lineOnShuffle === null)
        this.lineOnShuffle = this.deuceLine('poker_big_pot');
    } else if (event.kind === 'player_busted') {
      this.lineOnShuffle = null;
      this.view.say(this.deuceLine('poker_player_bust'));
    } else if (event.kind === 'game_over') {
      this.lineOnShuffle = null;
      this.view.say(this.deuceLine('poker_game_over'));
    }
  }

  /** The regular a seat's line belongs to: whoever just stood up, for a parting line. */
  private speakerAt(seat: number, trigger: PokerBanterTrigger): RegularId | null {
    if (trigger === 'leaving') return this.lastVacated[seat] ?? null;
    return this.regularsValue?.regularAt(seat) ?? null;
  }

  private regularSays(seat: number, trigger: PokerBanterTrigger): void {
    const regular = this.speakerAt(seat, trigger);
    if (regular === null) return;
    const voice = this.personalities[regular].profile.banterSet;
    const line = pickRegularLine(regular, voice, trigger, this.banter.lastLine, this.lineRandom);
    const name = POKER_REGULARS[regular].name;
    this.banter.speak(seat, name, line.paragraphs[0], 'banter', this.motion.time);
  }

  /** The chatter tell: a regular who talks more, or goes pointedly quiet, while the hand plays. */
  private regularChatters(seat: number, direction: 'up' | 'down'): void {
    const regular = this.regularsValue?.regularAt(seat) ?? null;
    if (regular === null) return;
    const voice = this.personalities[regular].profile.banterSet;
    const line =
      direction === 'up'
        ? pickChatterLine(regular, voice, this.banter.lastLine, this.lineRandom).paragraphs[0]
        : POKER_QUIET_LINE;
    this.banter.speak(seat, POKER_REGULARS[regular].name, line, 'chatter', this.motion.time);
  }

  // ── Sound ────────────────────────────────────────────────────────────────

  private play(id: SoundId | null): void {
    if (id !== null) this.audio?.play(id);
  }

  private playCue(cue: PokerCue): void {
    const played = this.cuePlays.get(cue) ?? 0;
    this.cuePlays.set(cue, played + 1);
    this.play(pokerCueSound(cue, played));
  }

  private reactionVoiceAt(seat: number): ReactionVoice | null {
    const regular = this.regularsValue?.regularAt(seat) ?? null;
    return regular === null ? null : POKER_REGULARS[regular].look.species;
  }

  /** The one cue each table event raises, if any. */
  private soundFor(event: PokerEvent, table: PokerTable): void {
    const bigBlind = table.stakes.bigBlind;
    switch (event.kind) {
      case 'shuffled':
        this.play(shuffleSound(event.handNumber));
        return;
      case 'button_moved':
        this.playCue('dealer_button');
        return;
      case 'hole_dealt':
        this.playCue('deal_card');
        return;
      case 'street_dealt':
        this.playCue(event.street === 'flop' ? 'board_flop' : 'board_card');
        return;
      case 'action':
        this.playCue(actionCue(event.action, event.amount, bigBlind));
        return;
      case 'player_turn':
        this.playCue('your_turn');
        return;
      case 'runout_started': {
        const pot = table.seats.reduce((sum, seat) => sum + seat.contributed, 0);
        if (pot >= RAIL_OOH_BIG_BLINDS * bigBlind) this.playCue('rail_ooh');
        return;
      }
      case 'pot_awarded':
        this.playCue('pot_sweep');
        return;
      case 'hand_complete': {
        const reaction = this.reactions.reactionTo(event, bigBlind);
        if (reaction !== null) this.playCue(reaction);
        return;
      }
      case 'tell':
        if (event.cue.kind === 'chip_fidget') this.playCue('chip_riffle');
        return;
      case 'banter':
        if (event.trigger === 'tilted') this.playCue('table_slam');
        return;
      case 'blind_posted':
      case 'burn':
      case 'uncalled_returned':
      case 'bets_collected':
      case 'showdown_reveal':
      case 'muck':
      case 'uncontested_show':
      case 'seat_busted':
      case 'seat_rebuy':
      case 'seat_vacated':
      case 'seat_replaced':
      case 'player_busted':
      case 'player_rebuy':
      case 'game_over':
        return;
    }
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

  // ── Surfaces ─────────────────────────────────────────────────────────────

  /** The buy-in: three tier cards, the unaffordable ones saying how much more it takes. */
  buyInSurface(id: string, seat: CasinoSeat): Surface {
    const close = (): void => this.closeBuyIn();
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.buyInShown,
      close,
      render: (ui) => {
        const active = seat.active();
        const companion = seat.companion();
        const purse = partyCoins(active, companion);
        const { space } = ui.theme;
        const headerH = lineHeightOf(ui, 'body');
        const cardH = tierCardHeight(ui);
        // Room is kept under the last card: a phone's sheet has no footer to end on.
        const contentHeight =
          headerH +
          space.md +
          POKER_TIER_IDS.length * cardH +
          (POKER_TIER_IDS.length - 1) * space.sm +
          space.lg;
        panel(ui, {
          id,
          title: "Texas Hold'em",
          subtitle: `Pick a table. Every seat buys in ${BUY_IN_BIG_BLINDS} big blinds deep.`,
          width: 'md',
          height: 'content',
          contentHeight,
          scrollBody: true,
          onClose: close,
          footer:
            ui.size === 'compact'
              ? undefined
              : [
                  {
                    id: 'back',
                    label: 'Not Now',
                    variant: 'secondary',
                    primary: true,
                    onTap: close,
                  },
                ],
          content: (body) => {
            const tracks = [headerH, ...POKER_TIER_IDS.map(() => cardH)];
            const [headerRow, ...cells] = splitV({ ...body, h: contentHeight }, tracks, space.sm);
            const purseW = measureCoinPurse(ui, purse);
            coinPurse(
              ui,
              { ...headerRow, x: headerRow.x + headerRow.w - purseW, w: purseW },
              purse,
            );
            text(ui, inset(headerRow, { r: purseW + space.sm }), {
              text: 'Party coins',
              role: 'muted',
            });
            POKER_TIER_IDS.forEach((tier, index) => {
              const shortBy = POKER_STAKES[tier].buyIn - purse;
              tierCard(ui, cells[index], tier, shortBy, () => {
                this.buyIn(tier, seat.active(), seat.companion());
              });
            });
          },
        });
      },
    };
  }

  /**
   * The table: modal and halting. Escape, the ✕, the Leave button and the
   * attack key all leave through {@link requestLeave}. While the action row is
   * up the accept keys belong to it, so the attack key only leaves when it is
   * not also an accept key.
   */
  tableSurface(id: string, seat: CasinoSeat): Surface {
    let keyboardOnAControl = false;
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.table !== null,
      close: () => this.requestLeave(seat.active()),
      onKey: (key, mods) => {
        const table = this.table;
        if (table !== null && this.view.trayKey(key, table)) return true;
        if (keybindings.actionFor(key) !== 'attack') return false;
        const accept = ACTIVATE_KEYS.has(key);
        const decisionUp = this.table?.awaitingPlayer === true || this.view.trayOpen;
        if (accept && (decisionUp || keyboardOnAControl)) return false;
        // A skip takes its button out of the focus ring, so the press that
        // started it, repeated, would otherwise land here and walk out.
        if (accept && this.skipping) return true;
        if (mods.repeat !== true && mods.predatesSurface !== true) {
          this.requestLeave(seat.active());
        }
        return true;
      },
      render: (ui) => {
        const table = this.table;
        if (table === null) return;
        keyboardOnAControl = this.paintTable(ui, table, seat);
      },
    };
  }

  /** The rules sheet; mount it above {@link tableSurface}. */
  rulesSurface(id: string): Surface {
    return this.rules.surface(id);
  }

  /** The last hands at this table; mount it above {@link tableSurface}. */
  historySurface(id: string): Surface {
    return pokerHistorySurface({
      id,
      isOpen: () => this.historyShown && this.table !== null,
      entries: () => this.history.entries,
      close: () => this.closeHistory(),
    });
  }

  /** A regular's seat-info card; mount it above {@link tableSurface}. */
  seatInfoSurface(id: string): Surface {
    return pokerSeatInfoSurface({
      id,
      model: () => this.seatInfoModel(),
      close: () => this.closeSeatInfo(),
    });
  }

  /** "Fold and leave?": mount it above {@link tableSurface}. Keep Playing is the default. */
  leaveConfirmSurface(id: string): Surface {
    return this.leaveConfirm.surface(id);
  }

  /** Out of chips: rebuy at the same tier, or leave. Leave is the default, so a stray key never spends. */
  bustSurface(id: string, seat: CasinoSeat): Surface {
    const leave = (): void => this.leaveTable(seat.active());
    return choiceModalSurface({
      id,
      isOpen: () => this.table?.phase === 'player_busted' && !this.leaveConfirm.isOpen,
      haltsWorld: true,
      locksKeyboard: true,
      escape: { kind: 'close', onEscape: leave },
      content: () => {
        const tier = this.table?.stakes ?? POKER_STAKES.penny;
        const purse = partyCoins(seat.active(), seat.companion());
        const shortBy = tier.buyIn - purse;
        return {
          id: 'bust',
          title: 'Out of chips',
          icon: 'coin',
          tone: 'danger',
          body: `Deuce sweeps your last chips away. Buy back in at the ${tier.name} for ${coins(tier.buyIn)}?`,
          width: 'sm',
          buttons: [
            {
              id: 'rebuy',
              label: `Rebuy (${coins(tier.buyIn)})`,
              disabled: shortBy > 0 ? `Need ${coins(shortBy)} more` : false,
              onTap: () => {
                this.rebuy(seat.active(), seat.companion());
              },
            },
            { id: 'leave', label: 'Leave Table', onTap: leave },
          ],
          defaultButton: 1,
        };
      },
    });
  }

  /**
   * The last regular has gone: start a new game at the same tier, or leave.
   * Leave is the default, so a stray key never spends.
   */
  gameOverSurface(id: string, seat: CasinoSeat): Surface {
    const leave = (): void => this.leaveTable(seat.active());
    return choiceModalSurface({
      id,
      isOpen: () => this.table?.phase === 'game_over' && !this.leaveConfirm.isOpen,
      haltsWorld: true,
      locksKeyboard: true,
      escape: { kind: 'close', onEscape: leave },
      content: () => {
        const tier = this.table?.stakes ?? POKER_STAKES.penny;
        const stack = this.table?.playerStack ?? 0;
        const purse = partyCoins(seat.active(), seat.companion()) + stack;
        const shortBy = tier.buyIn - purse;
        return {
          id: 'game-over',
          title: 'Game over',
          icon: 'coin',
          body: gameOverBody(tier.name, stack, tier.buyIn),
          width: 'sm',
          buttons: [
            {
              id: 'new-game',
              label: `New game (${coins(tier.buyIn)})`,
              disabled: shortBy > 0 ? `Need ${coins(shortBy)} more` : false,
              onTap: () => {
                this.newGame(seat.active(), seat.companion());
              },
            },
            { id: 'leave', label: 'Leave', onTap: leave },
          ],
          defaultButton: 1,
        };
      },
    });
  }

  // ── Painting ─────────────────────────────────────────────────────────────

  /** Who sits in `seat` as the plate shows them; `occupantId` may be a regular who has just left. */
  private seatIdentity(seat: number, occupantId: string | null, active: Player): PokerSeatIdentity {
    if (seat === PLAYER_SEAT && occupantId !== null) {
      return {
        name: PLAYER_NAME,
        avatar: { kind: 'crawler', crawler: crawlerOf(active) },
        tilted: false,
      };
    }
    if (occupantId === null)
      return { name: EMPTY_SEAT_NAME, avatar: { kind: 'empty' }, tilted: false };
    if (!isRegularId(occupantId))
      return { name: occupantId, avatar: { kind: 'empty' }, tilted: false };
    const regular = POKER_REGULARS[occupantId];
    const sitting = this.regularsValue?.regularAt(seat) === occupantId;
    const mood = sitting ? (this.regularsValue?.moodAt(seat) ?? null) : null;
    return {
      name: regular.name,
      shortName: REGULAR_SHORT_NAMES[occupantId],
      avatar: { kind: 'regular', key: occupantId, look: regular.look },
      tilted: mood !== null && isTilted(mood),
    };
  }

  private tableControls(seat: CasinoSeat): PokerTableControls {
    return {
      act: (action) => this.act(action),
      skip: () => this.skip(),
      skipping: this.skipping,
      leave: () => this.requestLeave(seat.active()),
      rules: () => this.openRules(),
      history: () => this.openHistory(),
      fast: this.toggles.pokerFast,
      toggleFast: () => this.toggleFast(),
      showCards: this.toggles.pokerShowCards,
      toggleShowCards: () => this.toggleShowCards(),
      seatTapped: (seat) => {
        this.openSeatInfo(seat);
      },
    };
  }

  /** Paints the table; true when keyboard focus sits on one of its controls. */
  private paintTable(ui: Ui, table: PokerTable, seat: CasinoSeat): boolean {
    const active = seat.active();
    const result = this.view.paint(
      ui,
      table,
      (index, occupantId) => this.seatIdentity(index, occupantId, active),
      this.tableControls(seat),
    );
    this.playerAnchor = result.playerAnchor;
    return result.keyboardOnAControl;
  }
}

/** The Game over prompt's line: with no chips left there is nothing to cash out, only leaving. */
export function gameOverBody(tierName: string, stack: number, buyIn: number): string {
  const choice =
    stack > 0 ? `Cash out your ${coins(stack)}, or start a new game` : 'Leave, or start a new game';
  return `Every regular has left the ${tierName}. ${choice} for ${coins(buyIn)} with a fresh table.`;
}

function actionCue(kind: PokerActionKind, amount: number, bigBlind: number): PokerCue {
  switch (kind) {
    case 'fold':
      return 'fold';
    case 'check':
      return 'check';
    case 'all_in':
      return 'all_in';
    case 'call':
    case 'bet':
    case 'raise':
      return betChipsCue(amount, bigBlind);
  }
}

function crawlerOf(player: Player): 'human' | 'cat' {
  return 'crawlerKind' in player && player.crawlerKind === 'cat' ? 'cat' : 'human';
}

function tierCardHeight(ui: Ui): number {
  const skin = skinsFor(ui.theme).panel.raised;
  const copy = lineHeightOf(ui, 'secondary') * TIER_COPY_LINES + lineHeightOf(ui, 'caption');
  return skin.padding * 2 + lineHeightOf(ui, 'title') + ui.theme.space.sm + copy;
}

function tierCard(ui: Ui, rect: Rect, tier: PokerTierId, shortBy: number, onTap: () => void): void {
  const stakes = POKER_STAKES[tier];
  const { palette } = ui.theme;
  const short = shortBy > 0 ? `Need ${coins(shortBy)} more` : null;
  card(ui, rect, {
    id: `tier-${tier}`,
    title: stakes.name,
    accent: palette.accent.base,
    disabled: short ?? false,
    onTap,
    content: (body) => {
      const secondaryH = lineHeightOf(ui, 'secondary');
      const [terms, flavour, status] = splitV(body, [secondaryH, secondaryH, 'fill'], 0);
      text(ui, terms, {
        text: `Buy-in ${coins(stakes.buyIn)} · Blinds ${coins(stakes.smallBlind)}/${coins(stakes.bigBlind)}`,
        role: 'secondary',
        tabular: true,
      });
      text(ui, flavour, { text: stakes.flavour, role: 'muted' });
      if (short !== null) text(ui, status, { text: short, role: 'danger' });
    },
  });
}
