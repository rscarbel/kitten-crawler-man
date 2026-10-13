/**
 * The regulars at a Texas Hold'em table: one object that is both the table's
 * `PokerSeatBrain` (every NPC decision, muck and show) and its
 * `PokerSeatManager` (busts, rebuys and hit-and-runs). One object is one
 * game: a chair a regular leaves stays empty until the player starts a new
 * game, which builds a fresh one.
 *
 * It keeps each seated regular's session mood, each regular's read of the
 * player, who has left and rebought this game, and a tally of every tell that
 * fired. It learns what happened by observing the table's events as they are
 * emitted, and answers some of them with banter and tells for the host to show.
 *
 * Decisions, churn and tells draw from one injected random source:
 * `Math.random` in play, a seeded stream in verify and report scripts. Who
 * each regular is comes from the world seed and never from that source.
 */

import type { LuckCheck } from '../../../../core/GodMode';
import type { Card } from '../../Deck';
import { passiveAction, type PokerActionKind } from '../bettingRound';
import {
  HOLE_CARD_COUNT,
  PLAYER_SEAT,
  POKER_SEAT_COUNT,
  PokerTable,
  type PokerBrainEvent,
  type PokerDecisionContext,
  type PokerSeatBrain,
  type PokerSeatManager,
  type ShowdownContext,
} from '../PokerTable';
import type { PokerBanterTrigger, PokerEvent, ShownCardIndices } from '../pokerEvents';
import { POKER_STAKES, stackForBigBlinds, type PokerTierId } from '../pokerStakes';
import { chance, range, type Rng } from '../../../../sprites/person/rng';
import { readBoardTexture, readDraws } from './boardRead';
import { QUIET_TABLE, paceBanter, type BanterPaceState } from './banterPacing';
import { handStrengthNow } from './combos';
import { TYPICAL_TENDENCIES, decide, type NpcDecision } from './decide';
import { knownHandsEquity } from './equity';
import {
  CALM_MOOD,
  CARD_DEAD_HANDS,
  BAD_BEAT_EQUITY,
  effectiveProfile,
  isTilted,
  moodAfterHand,
  type Mood,
  type TiltTarget,
} from './mood';
import {
  EMPTY_PLAYER_READ,
  observeHand,
  observedPfr,
  observedVpip,
  type HandObservation,
  type PlayerRead,
} from './playerRead';
import { preflopStrength } from './preflop';
import {
  rollPokerPersonalities,
  selectTable,
  type PokerPersonalities,
  type PokerPersonality,
} from './personality';
import { listAt } from './listAt';
import { lineOf, type PerceivedTendencies } from './ranges';
import { REGULAR_IDS, type RegularId } from './regulars';
import {
  conditionRate,
  tellConditionPrior,
  emptyTellTally,
  evaluateTells,
  tallyTellFiring,
  type TellChance,
  type TellFiring,
  type TellHandState,
  type TellTally,
} from './tells';

/** Two board cards of one suit leave a player holding two more drawing at a flush. */
const FLUSH_DRAW_BOARD_SUITED = 2;

export type PlayerReads = Partial<Record<RegularId, PlayerRead>>;

/** One regular's decision as it happened, for reports. */
export interface RegularDecisionRecord {
  readonly seat: number;
  readonly regularId: RegularId;
  readonly street: PokerDecisionContext['street'];
  readonly decision: NpcDecision;
}

export interface PokerRegularsOptions {
  readonly tier: PokerTierId;
  readonly personalities: PokerPersonalities;
  /** The regulars sitting in seats 1–5, in seat order. */
  readonly seated: ReadonlyArray<RegularId>;
  /** What each regular remembers about the player; copied, never aliased. */
  readonly reads?: PlayerReads;
  /** What the player has seen of each regular's play; copied, never aliased. */
  readonly notes?: PlayerReads;
  /** In-hand randomness: decisions, churn, tells and banter. Defaults to `Math.random`. */
  readonly random?: Rng;
  /** False hands every banter candidate to the host unpaced. */
  readonly paceBanter?: boolean;
  readonly equityIterations?: number;
  readonly onDecision?: (record: RegularDecisionRecord) => void;
}

interface SeatState {
  readonly regularId: RegularId;
  mood: Mood;
  sessionNetChips: number;
  lastNetBigBlinds: number;
}

interface ConditionCounts {
  readonly chances: number[];
  readonly held: number[];
}

interface HandTrack {
  holeCardsDealt: number;
  readonly revealed: Set<number>;
  uncontestedShow: { readonly seat: number; readonly cards: number } | null;
  mainWinners: ReadonlyArray<number>;
  uncontested: boolean;
}

function freshTrack(): HandTrack {
  return {
    holeCardsDealt: 0,
    revealed: new Set(),
    uncontestedShow: null,
    mainWinners: [],
    uncontested: false,
  };
}

export function isRegularId(id: string | null): id is RegularId {
  return REGULAR_IDS.some((regularId) => regularId === id);
}

/** Regulars know each other's games roughly: their read of another regular is half truth, half table average. */
const REGULAR_FAMILIARITY = 0.5;
/** A winner whose hand rates below this against a random hand was betting with little: a bluff. */
const BLUFF_STRENGTH_BELOW = 0.35;
/** A seat must win at least this many big blinds for a hit-and-run to tempt them. */
const HIT_AND_RUN_WIN_BIG_BLINDS = 20;
const BIG_POT_WIN_BIG_BLINDS = 20;
/** Passes for the equity a loser had when their money went in; settled once per hand. */
const BAD_BEAT_EQUITY_ITERATIONS = 200;
/** Of the times a non-bluffing uncontested winner shows anything, it is one card. */
const VALUE_FLASH_SHARE = 0.25;
const STRONG_DRAW_OUTS = 8;
/** Only a seat the table never told us about lands here; it checks or calls without fuss. */
const UNSEATED_THINK_MS = 700;
const FLOP_CARDS = 3;
const FULL_BOARD = 5;
const BOARD_LENGTH_BY_STREET = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;
/**
 * A regular's first bust of a game always buys back in; every bust after
 * that is a coin flip between reloading and leaving the game.
 */
export const REPEAT_REBUY_CHANCE = 0.5;
const BOTH_CARDS: ShownCardIndices = [0, 1];

export class PokerRegulars implements PokerSeatBrain, PokerSeatManager {
  readonly tier: PokerTierId;
  private readonly personalities: PokerPersonalities;
  private readonly random: Rng;
  private readonly paced: boolean;
  private readonly equityIterations: number | undefined;
  private readonly onDecision: ((record: RegularDecisionRecord) => void) | null;
  private readonly seatStates: Array<SeatState | null>;
  private readonly readsByRegular = new Map<RegularId, PlayerRead>();
  /** The player's side of the same watching: how each regular has played in front of them. */
  private readonly notesByRegular = new Map<RegularId, PlayerRead>();
  /** Regulars who stood up this game; nobody takes their chair until a new game. */
  private readonly left = new Set<RegularId>();
  /** How many times each regular has busted this game. */
  private readonly bustsThisGame = new Map<RegularId, number>();
  /** How many times each regular has bought back in this game. */
  private readonly rebuysThisGameByRegular = new Map<RegularId, number>();
  private readonly tallies = new Map<RegularId, TellTally>();
  /** Per regular, per tell: how many chances it had and how often its condition held. */
  private readonly conditionCounts = new Map<RegularId, ConditionCounts>();
  private track: HandTrack = freshTrack();
  private banterPace: BanterPaceState = QUIET_TABLE;
  private handNumber = 0;

  constructor(options: PokerRegularsOptions) {
    this.tier = options.tier;
    this.personalities = options.personalities;
    this.random = options.random ?? Math.random;
    this.paced = options.paceBanter ?? true;
    this.equityIterations = options.equityIterations;
    this.onDecision = options.onDecision ?? null;
    for (const id of REGULAR_IDS) {
      const read = options.reads?.[id];
      if (read !== undefined) this.readsByRegular.set(id, { ...read });
      const note = options.notes?.[id];
      if (note !== undefined) this.notesByRegular.set(id, { ...note });
    }
    this.seatStates = Array.from({ length: POKER_SEAT_COUNT }, (_, seat) => {
      const regularId = seat === PLAYER_SEAT ? undefined : options.seated[seat - 1];
      return regularId === undefined ? null : this.freshSeat(regularId);
    });
  }

  // ── Reading the regulars ──────────────────────────────────────────────────

  /** Every regular's read of the player, copied for saving with the run. */
  get reads(): PlayerReads {
    const result: PlayerReads = {};
    for (const [id, read] of this.readsByRegular) result[id] = { ...read };
    return result;
  }

  /**
   * What the player has watched each regular do, copied for saving with the
   * run. Built only from what happened in front of the player — actions and
   * cards turned face up — so it can never leak a regular's hidden profile.
   */
  get notes(): PlayerReads {
    const result: PlayerReads = {};
    for (const [id, note] of this.notesByRegular) result[id] = { ...note };
    return result;
  }

  /** Regulars who stood up this game, busted out or walked away. */
  get leftThisGame(): ReadonlySet<RegularId> {
    return new Set(this.left);
  }

  /** How many times `regularId` has bought back in this game. */
  rebuysThisGame(regularId: RegularId): number {
    return this.rebuysThisGameByRegular.get(regularId) ?? 0;
  }

  regularAt(seat: number): RegularId | null {
    return this.seatStates[seat]?.regularId ?? null;
  }

  moodAt(seat: number): Mood | null {
    return this.seatStates[seat]?.mood ?? null;
  }

  personalityOf(regularId: RegularId): PokerPersonality {
    return this.personalities[regularId];
  }

  /** How often each of a regular's tells fired, and how often truthfully. */
  tellTally(regularId: RegularId): TellTally {
    return this.tallies.get(regularId) ?? emptyTellTally();
  }

  /**
   * A sit-down stack, drawn from the regular's buy-in habit but never more than
   * the table's buy-in: a short-stacker sits short, nobody sits deep.
   */
  buyInFor(regularId: RegularId): number {
    const band = this.personalities[regularId].profile.buyInBigBlinds;
    const habit = stackForBigBlinds(this.tier, range(this.random, band.min, band.max));
    return Math.min(habit, this.rebuyStack);
  }

  /** Every rebuy is exactly the table's buy-in. */
  get rebuyStack(): number {
    return POKER_STAKES[this.tier].buyIn;
  }

  private freshSeat(regularId: RegularId): SeatState {
    return { regularId, mood: CALM_MOOD, sessionNetChips: 0, lastNetBigBlinds: 0 };
  }

  private seatedRegular(seat: number): { state: SeatState; personality: PokerPersonality } | null {
    const state = this.seatStates[seat] ?? null;
    return state === null ? null : { state, personality: this.personalities[state.regularId] };
  }

  // ── PokerSeatBrain ────────────────────────────────────────────────────────

  decide(context: PokerDecisionContext): NpcDecision {
    const seated = this.seatedRegular(context.seat);
    if (seated === null) {
      return {
        action: passiveAction(context.legal),
        thinkMs: UNSEATED_THINK_MS,
        cues: [],
        tellFirings: [],
        tellChances: [],
        intent: 'check',
        perceivedStrength: 0,
        handStrength: 0,
      };
    }
    const { state, personality } = seated;
    const bigBlind = context.stakes.bigBlind;
    const me = context.seats[context.seat];
    const profile = effectiveProfile(personality.profile, state.mood, {
      archetype: personality.archetype,
      stackBigBlinds: (me.stack + me.contributed) / bigBlind,
      tier: this.tier,
      sessionNetBigBlinds: state.sessionNetChips / bigBlind,
      facingTarget: this.facingTarget(context, state.mood.target),
    });
    const read = this.readsByRegular.get(state.regularId) ?? EMPTY_PLAYER_READ;
    const decision = decide(context, profile, state.mood, read, this.random, {
      archetype: personality.archetype,
      tells: personality.tells,
      opponents: context.seats.map((seat) => this.tendenciesOf(seat.seat, seat.isPlayer, read)),
      equityIterations: this.equityIterations,
      tellConditionRates: this.conditionRates(state.regularId),
    });
    this.tally(state.regularId, decision.tellFirings);
    this.recordChances(state.regularId, decision.tellChances);
    this.onDecision?.({
      seat: context.seat,
      regularId: state.regularId,
      street: context.street,
      decision,
    });
    return decision;
  }

  private facingTarget(context: PokerDecisionContext, target: TiltTarget | null): boolean {
    if (target === null) return false;
    const seat = listAt(context.seats, target.seat);
    if (seat === undefined || !seat.inHand || seat.folded) return false;
    return target.occupant === 'player' ? seat.isPlayer : seat.occupantId === target.occupant;
  }

  private tendenciesOf(seat: number, isPlayer: boolean, read: PlayerRead): PerceivedTendencies {
    if (isPlayer) return { vpip: observedVpip(read), pfr: observedPfr(read) };
    const other = this.seatStates[seat];
    if (other === null) return TYPICAL_TENDENCIES;
    const profile = this.personalities[other.regularId].profile;
    const blend = (truth: number, typical: number): number =>
      REGULAR_FAMILIARITY * truth + (1 - REGULAR_FAMILIARITY) * typical;
    return {
      vpip: blend(profile.vpip, TYPICAL_TENDENCIES.vpip),
      pfr: blend(profile.pfr, TYPICAL_TENDENCIES.pfr),
    };
  }

  /** Each of a regular's tells' condition rates, as their own hands have shown them so far. */
  private conditionRates(regularId: RegularId): number[] {
    const counts = this.conditionCounts.get(regularId);
    return this.personalities[regularId].tells.map((tell, index) =>
      conditionRate(
        counts?.held[index] ?? 0,
        counts?.chances[index] ?? 0,
        tellConditionPrior(tell),
      ),
    );
  }

  /** How many chances each of a regular's tells had, and how often its condition held, by tell index. */
  tellConditionCounts(
    regularId: RegularId,
  ): ReadonlyArray<{ readonly chances: number; readonly held: number }> {
    const counts = this.conditionCounts.get(regularId);
    return this.personalities[regularId].tells.map((_, index) => ({
      chances: counts?.chances[index] ?? 0,
      held: counts?.held[index] ?? 0,
    }));
  }

  private recordChances(regularId: RegularId, chances: ReadonlyArray<TellChance>): void {
    const size = this.personalities[regularId].tells.length;
    const counts = this.conditionCounts.get(regularId) ?? {
      chances: new Array<number>(size).fill(0),
      held: new Array<number>(size).fill(0),
    };
    for (const entry of chances) {
      counts.chances[entry.tellIndex]++;
      if (entry.held) counts.held[entry.tellIndex]++;
    }
    this.conditionCounts.set(regularId, counts);
  }

  private tally(regularId: RegularId, firings: ReadonlyArray<TellFiring>): void {
    let tally = this.tellTally(regularId);
    for (const firing of firings) tally = tallyTellFiring(tally, firing);
    this.tallies.set(regularId, tally);
  }

  showsLosingHand(context: ShowdownContext): boolean {
    const seated = this.seatedRegular(context.seat);
    return seated !== null && chance(this.random, seated.personality.profile.showsLosers);
  }

  uncontestedShow(context: ShowdownContext): ShownCardIndices {
    const seated = this.seatedRegular(context.seat);
    if (seated === null) return [];
    const profile = seated.personality.profile;
    if (handWasBluff(context.holeCards, context.board, context.history, context.seat)) {
      return chance(this.random, profile.showsBluffs) ? BOTH_CARDS : [];
    }
    if (!chance(this.random, profile.showsBluffs * VALUE_FLASH_SHARE)) return [];
    return chance(this.random, 1 / 2) ? [0] : [1];
  }

  // ── Observing the table ───────────────────────────────────────────────────

  observe(event: PokerEvent, table: PokerTable): ReadonlyArray<PokerBrainEvent> {
    switch (event.kind) {
      case 'shuffled':
        this.handNumber = event.handNumber;
        this.track = freshTrack();
        return event.handNumber === 1 ? this.offerEach('sit_down') : [];
      case 'hole_dealt':
        this.track.holeCardsDealt++;
        return this.track.holeCardsDealt === table.seatsDealt * HOLE_CARD_COUNT
          ? this.waitingTells(table, false)
          : [];
      case 'street_dealt':
        return this.waitingTells(table, event.street === 'flop');
      case 'action':
        return this.onAction(event.seat, event.action, table);
      case 'showdown_reveal':
        this.track.revealed.add(event.seat);
        return [];
      case 'uncontested_show':
        this.track.uncontestedShow = { seat: event.seat, cards: event.shown.length };
        return [];
      case 'pot_awarded':
        if (event.potIndex === 0) this.track.mainWinners = event.seats;
        this.track.uncontested = event.uncontested;
        return [];
      case 'hand_complete':
        return this.settleHand(table, event.netBySeat);
      case 'seat_rebuy':
        return this.offer(event.seat, 'rebuy');
      case 'seat_vacated':
        return this.offer(event.seat, 'leaving');
      case 'seat_replaced':
        return this.offer(event.seat, 'sit_down');
      case 'button_moved':
      case 'blind_posted':
      case 'burn':
      case 'player_turn':
      case 'uncalled_returned':
      case 'bets_collected':
      case 'runout_started':
      case 'muck':
      case 'seat_busted':
      case 'player_busted':
      case 'player_rebuy':
      case 'game_over':
      case 'banter':
      case 'tell':
        return [];
    }
  }

  private offer(seat: number, trigger: PokerBanterTrigger): PokerBrainEvent[] {
    const seated = this.seatedRegular(seat);
    if (seated === null) return [];
    if (!this.paced) return [{ kind: 'banter', seat, trigger }];
    const paced = paceBanter(
      this.banterPace,
      {
        trigger,
        handNumber: this.handNumber,
        chattiness: seated.personality.profile.chattiness,
      },
      this.random(),
    );
    this.banterPace = paced.state;
    return paced.speak ? [{ kind: 'banter', seat, trigger }] : [];
  }

  private offerEach(trigger: PokerBanterTrigger): PokerBrainEvent[] {
    const lines: PokerBrainEvent[] = [];
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) lines.push(...this.offer(seat, trigger));
    return lines;
  }

  private onAction(seat: number, kind: PokerActionKind, table: PokerTable): PokerBrainEvent[] {
    if (seat === PLAYER_SEAT) return [];
    if (kind === 'all_in') return this.offer(seat, 'all_in');
    if (kind !== 'fold') return [];
    const last = listAt(table.history, -1);
    const facedRaise = table.history.some(
      (record) => record.street === last?.street && record.aggressive && record.seat !== seat,
    );
    return facedRaise ? this.offer(seat, 'fold_to_raise') : [];
  }

  /** Fidgets, chatter and rechecks for every live regular as a street (or the deal) lands. */
  private waitingTells(table: PokerTable, flop: boolean): PokerBrainEvent[] {
    const board = table.board;
    const texture = board.length >= FLOP_CARDS ? readBoardTexture(board) : null;
    const tells: PokerBrainEvent[] = [];
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      const seated = this.seatedRegular(seat);
      const tableSeat = table.seats[seat];
      if (seated === null || !tableSeat.inHand || tableSeat.folded) continue;
      const hole = tableSeat.holeCards;
      const first = listAt(hole, 0);
      const second = listAt(hole, 1);
      if (first === undefined || second === undefined) continue;
      const flushSuit =
        texture !== null && texture.dominantSuitCount >= FLUSH_DRAW_BOARD_SUITED
          ? texture.dominantSuit
          : null;
      const state: TellHandState = {
        madeStrength:
          board.length === 0 ? preflopStrength(first, second) : handStrengthNow(hole, board),
        hasDraw: readDraws(hole, board).outs >= STRONG_DRAW_OUTS,
        drawsPossible: board.length >= FLOP_CARDS && board.length < FULL_BOARD,
        bluffing: false,
        flopFlushPossible: flushSuit !== null,
        holeCardsOfFlushSuit: hole.filter((card) => card.suit === flushSuit).length,
      };
      const regularId = seated.state.regularId;
      const tellsOfSeat = seated.personality.tells;
      const rates = this.conditionRates(regularId);
      const waiting = evaluateTells(tellsOfSeat, 'waiting', state, this.random, rates);
      const recheck = flop
        ? evaluateTells(tellsOfSeat, 'flop_dealt', state, this.random, rates)
        : { firings: [], chances: [] };
      const firings = [...waiting.firings, ...recheck.firings];
      this.recordChances(regularId, [...waiting.chances, ...recheck.chances]);
      this.tally(regularId, firings);
      for (const firing of firings) tells.push({ kind: 'tell', seat, cue: firing.cue });
    }
    return tells;
  }

  // ── Settling a hand: moods, reads, banter ────────────────────────────────

  private settleHand(table: PokerTable, netBySeat: ReadonlyArray<number>): PokerBrainEvent[] {
    const bigBlind = table.stakes.bigBlind;
    const board = table.board;
    const history = table.history;
    const winner = listAt(this.track.mainWinners, 0) ?? null;
    const shownBluff =
      this.track.uncontested &&
      winner !== null &&
      this.track.uncontestedShow?.seat === winner &&
      this.track.uncontestedShow.cards === BOTH_CARDS.length &&
      handWasBluff(table.seats[winner].holeCards, board, history, winner);
    const lines: PokerBrainEvent[] = [];

    if (shownBluff) lines.push(...this.offer(winner, 'bluff_shown'));

    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      const seated = this.seatedRegular(seat);
      const tableSeat = table.seats[seat];
      if (seated === null || !tableSeat.inHand) continue;
      const { state, personality } = seated;
      const net = netBySeat[seat] ?? 0;
      const line = lineOf(history, seat);
      const wonPot = this.track.mainWinners.includes(seat) || net > 0;
      const lostAtShowdown = !this.track.uncontested && !tableSeat.folded && !wonPot;
      const beatenBy =
        winner !== null && winner !== seat ? this.tiltTargetFor(winner, table) : null;
      const outcome = {
        netBigBlinds: net / bigBlind,
        wonPot,
        voluntarilyPlayed: line.preflopRaises > 0 || line.preflopCalled,
        lostWithEquity: lostAtShowdown ? this.equityWhenMoneyWentIn(table, seat) : null,
        shownBluff: shownBluff && tableSeat.folded,
        beatenBy,
      };
      const wasTilted = isTilted(state.mood);
      state.mood = moodAfterHand(state.mood, outcome, personality.profile);
      state.sessionNetChips += net;
      state.lastNetBigBlinds = net / bigBlind;

      if (outcome.lostWithEquity !== null && outcome.lostWithEquity >= BAD_BEAT_EQUITY) {
        lines.push(...this.offer(seat, 'bad_beat'));
      }
      if (outcome.shownBluff) lines.push(...this.offer(seat, 'got_bluffed'));
      if (!wasTilted && isTilted(state.mood)) lines.push(...this.offer(seat, 'tilted'));
      if (state.mood.cardDead === CARD_DEAD_HANDS) lines.push(...this.offer(seat, 'card_dead'));
      if (net >= BIG_POT_WIN_BIG_BLINDS * bigBlind) lines.push(...this.offer(seat, 'big_pot_win'));
      const beatThePlayer =
        wonPot && (netBySeat[PLAYER_SEAT] ?? 0) < 0 && !table.seats[PLAYER_SEAT].folded;
      if (beatThePlayer && chance(this.random, personality.profile.needle)) {
        lines.push(...this.offer(seat, 'needle_player'));
      }
    }

    this.observePlayer(table);
    this.noteRegulars(table);
    return lines;
  }

  private tiltTargetFor(seat: number, table: PokerTable): TiltTarget | null {
    if (seat === PLAYER_SEAT) return { seat, occupant: 'player' };
    const occupant = table.seats[seat].occupantId;
    return isRegularId(occupant) ? { seat, occupant } : null;
  }

  /** The seat's equity against every hand still live, on the board as it stood when its last chips went in. */
  private equityWhenMoneyWentIn(table: PokerTable, seat: number): number {
    const lastChips = [...table.history]
      .reverse()
      .find((record) => record.seat === seat && record.chipsAdded > 0);
    const boardLength = BOARD_LENGTH_BY_STREET[lastChips?.street ?? 'preflop'];
    const live = table.seats.filter((other) => other.inHand && !other.folded);
    const index = live.findIndex((other) => other.index === seat);
    if (index < 0) return 0;
    const equities = knownHandsEquity(
      live.map((other) => other.holeCards),
      table.board.slice(0, boardLength),
      this.random,
      BAD_BEAT_EQUITY_ITERATIONS,
    );
    return equities[index] ?? 0;
  }

  /** One seat's hand as anyone at the table saw it: its actions, and its cards only if they were turned up. */
  private observationOf(table: PokerTable, seat: number): HandObservation {
    const tableSeat = table.seats[seat];
    const history = table.history;
    const mine = history.filter((record) => record.seat === seat);
    const line = lineOf(history, seat);
    const foldedPreflop = mine.some(
      (record) => record.kind === 'fold' && record.street === 'preflop',
    );
    const shownUncontested =
      this.track.uncontestedShow?.seat === seat &&
      this.track.uncontestedShow.cards === BOTH_CARDS.length;
    const showedCards = this.track.revealed.has(seat) || shownUncontested;
    return {
      voluntarilyPutMoneyIn: line.preflopRaises > 0 || line.preflopCalled,
      raisedPreflop: line.preflopRaises > 0,
      aggressiveActions: mine.filter((record) => record.aggressive).length,
      calls: mine.filter((record) => !record.aggressive && record.chipsAdded > 0).length,
      sawFlop: table.board.length >= FLOP_CARDS && !foldedPreflop,
      wentToShowdown: !this.track.uncontested && !tableSeat.folded,
      showedCards,
      showedBluff: showedCards && handWasBluff(tableSeat.holeCards, table.board, history, seat),
    };
  }

  /** Every seated regular watches the player's hand and updates their read. */
  private observePlayer(table: PokerTable): void {
    const player = table.seats[PLAYER_SEAT];
    if (!player.inHand || player.occupantId === null) return;
    const observation = this.observationOf(table, PLAYER_SEAT);
    for (const state of this.seatStates) {
      if (state === null) continue;
      const before = this.readsByRegular.get(state.regularId) ?? EMPTY_PLAYER_READ;
      this.readsByRegular.set(state.regularId, observeHand(before, observation));
    }
  }

  /** The player watches every regular dealt into the hand with them. */
  private noteRegulars(table: PokerTable): void {
    if (table.seats[PLAYER_SEAT].occupantId === null) return;
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      const state = this.seatStates[seat] ?? null;
      if (state === null || !table.seats[seat].inHand) continue;
      const before = this.notesByRegular.get(state.regularId) ?? EMPTY_PLAYER_READ;
      this.notesByRegular.set(
        state.regularId,
        observeHand(before, this.observationOf(table, seat)),
      );
    }
  }

  // ── PokerSeatManager ──────────────────────────────────────────────────────

  /**
   * Busts, rebuys and walk-outs. Nobody new ever sits down mid-game: a chair
   * a regular leaves stays empty until the player starts a new game, so the
   * table only shrinks.
   */
  betweenHands(table: PokerTable): void {
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      if (seat === PLAYER_SEAT) continue;
      const tableSeat = table.seats[seat];
      const seated = this.seatedRegular(seat);
      if (seated === null) continue;
      const { state, personality } = seated;
      if (tableSeat.occupantId === null) {
        this.seatStates[seat] = null;
        this.left.add(state.regularId);
        continue;
      }
      if (tableSeat.stack <= 0) {
        const busts = this.bustsThisGame.get(state.regularId) ?? 0;
        this.bustsThisGame.set(state.regularId, busts + 1);
        const rebuys = busts === 0 || chance(this.random, REPEAT_REBUY_CHANCE);
        if (rebuys) {
          table.rebuySeat(seat, this.rebuyStack);
          this.rebuysThisGameByRegular.set(
            state.regularId,
            this.rebuysThisGame(state.regularId) + 1,
          );
        } else this.leave(table, seat, state.regularId);
        continue;
      }
      const bigWin = state.lastNetBigBlinds >= HIT_AND_RUN_WIN_BIG_BLINDS;
      state.lastNetBigBlinds = 0;
      if (bigWin && chance(this.random, personality.profile.hitAndRun)) {
        this.leave(table, seat, state.regularId);
      }
    }
  }

  private leave(table: PokerTable, seat: number, regularId: RegularId): void {
    table.vacateSeat(seat);
    this.left.add(regularId);
    this.seatStates[seat] = null;
  }
}

/** The seat was the last to bet or raise and its hand rates as weak: it was bluffing. */
function handWasBluff(
  hole: ReadonlyArray<Card>,
  board: ReadonlyArray<Card>,
  history: PokerDecisionContext['history'],
  seat: number,
): boolean {
  const aggressive = history.filter((record) => record.aggressive);
  if (listAt(aggressive, -1)?.seat !== seat) return false;
  const first = listAt(hole, 0);
  const second = listAt(hole, 1);
  if (first === undefined || second === undefined) return false;
  const strength =
    board.length === 0 ? preflopStrength(first, second) : handStrengthNow(hole, board);
  return strength < BLUFF_STRENGTH_BELOW;
}

export interface RegularsTableOptions {
  readonly tier: PokerTierId;
  /** The run's world seed: decides who every regular is. */
  readonly worldSeed: number;
  readonly reads?: PlayerReads;
  readonly notes?: PlayerReads;
  /** In-hand randomness for the regulars and table selection. Defaults to `Math.random`. */
  readonly random?: Rng;
  /** Shuffles and the starting button. Defaults to `random`. */
  readonly tableRandom?: () => number;
  readonly playerStack?: number;
  readonly fast?: boolean;
  readonly paceBanter?: boolean;
  readonly equityIterations?: number;
  readonly onDecision?: (record: RegularDecisionRecord) => void;
  /** Reuse an already rolled roster instead of rolling `worldSeed` again. */
  readonly personalities?: PokerPersonalities;
  readonly isLucky?: LuckCheck;
}

/**
 * A table at `tier` with five regulars chosen for its flavour, every seat
 * played and churned by one `PokerRegulars`.
 */
export function createRegularsTable(options: RegularsTableOptions): {
  readonly table: PokerTable;
  readonly regulars: PokerRegulars;
} {
  const random = options.random ?? Math.random;
  const personalities = options.personalities ?? rollPokerPersonalities(options.worldSeed);
  // Every game is a fresh night at the table: whoever left the last one may sit again.
  const seated = selectTable(personalities, options.tier, random);
  const regulars = new PokerRegulars({
    tier: options.tier,
    personalities,
    seated,
    reads: options.reads,
    notes: options.notes,
    random,
    paceBanter: options.paceBanter,
    equityIterations: options.equityIterations,
    onDecision: options.onDecision,
  });
  const table = new PokerTable({
    tier: options.tier,
    brain: regulars,
    seatManager: regulars,
    npcs: seated.map((occupantId) => ({ occupantId, stack: regulars.buyInFor(occupantId) })),
    random: options.tableRandom ?? random,
    playerStack: options.playerStack,
    fast: options.fast,
    isLucky: options.isLucky,
  });
  return { table, regulars };
}
