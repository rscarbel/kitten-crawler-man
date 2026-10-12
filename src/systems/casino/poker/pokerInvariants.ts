/**
 * The Hold'em engine's invariant checks as pure functions over seeded random
 * streams, shared by the `verify:poker` gate and the `?poker` preview's Sim
 * tab so both judge the engine by the same rules.
 *
 * Every check returns a {@link PokerCheck} instead of printing, so the gate can
 * count failures and the preview can draw a line per result.
 */

import { DECK_SIZE, cardId, type Card, type Deck, type Rank, type Suit } from '../Deck';
import type { LegalActions, PokerAction } from './bettingRound';
import { evaluateBest, handRank, type HandCategory } from './handEvaluator';
import type { PokerEvent } from './pokerEvents';
import { POKER_STAKES, type PokerTierId } from './pokerStakes';
import { buildPots } from './pots';
import {
  NPC_SEAT_COUNT,
  HEADS_UP_SEATS,
  PLAYER_SEAT,
  POKER_SEAT_COUNT,
  PokerTable,
  type NpcSeating,
  type PokerSeatBrain,
} from './PokerTable';
import { chance, pick, rangeInt, type Rng } from '../../../sprites/person/rng';

/** One verdict: what was checked, with its measured numbers, and whether it held. */
export interface PokerCheck {
  readonly passed: boolean;
  readonly description: string;
}

/** One table clock step while a sim plays a hand out. */
export const SIM_FRAME_MS = 50;
/** Ceiling on clock steps per hand before a sim stream counts as stalled. */
export const MAX_FRAMES_PER_HAND = 4000;
/** Table errors quoted in a failing line; the rest are counted, not listed. */
export const ERRORS_SHOWN = 3;

export function sum(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0);
}

// ── Cards ──────────────────────────────────────────────────────────────────

const SUIT_BY_LETTER: Record<string, Suit> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};
const RANK_BY_TEXT: Record<string, Rank> = {
  A: 'A',
  K: 'K',
  Q: 'Q',
  J: 'J',
  '10': '10',
  '9': '9',
  '8': '8',
  '7': '7',
  '6': '6',
  '5': '5',
  '4': '4',
  '3': '3',
  '2': '2',
};

/** Cards written as space-separated text: rank then suit letter, e.g. `"As 10h 2c"`. */
export function parseCards(text: string): Card[] {
  return text.split(' ').map((token) => {
    const rank = RANK_BY_TEXT[token.slice(0, -1)];
    const suit = SUIT_BY_LETTER[token.slice(-1)];
    if (typeof rank !== 'string' || typeof suit !== 'string')
      throw new Error(`bad card "${token}"`);
    return { rank, suit };
  });
}

// ── Hand evaluator ─────────────────────────────────────────────────────────

export interface EvaluatorCase {
  readonly cards: string;
  readonly category: HandCategory;
  readonly label: string;
}

export const EVALUATOR_CASES: ReadonlyArray<EvaluatorCase> = [
  { cards: 'As Ks Qs Js 10s 2d 3c', category: 'straight_flush', label: 'Royal Flush' },
  { cards: '9h 8h 7h 6h 5h Ah Kh', category: 'straight_flush', label: 'Straight Flush, Nine high' },
  { cards: '5d 4d 3d 2d Ad Kc Qc', category: 'straight_flush', label: 'Straight Flush, Five high' },
  { cards: 'Kc Kd Kh Ks 7d 7c 2s', category: 'four_of_a_kind', label: 'Four of a Kind, Kings' },
  {
    cards: 'Qc Qd Qh 9s 9d 9c 2s',
    category: 'full_house',
    label: 'Full House, Queens full of Nines',
  },
  {
    cards: 'Jc Jd Jh 4s 4d 8c 8s',
    category: 'full_house',
    label: 'Full House, Jacks full of Eights',
  },
  { cards: 'Ah Jh 9h 6h 3h 2h Kd', category: 'flush', label: 'Flush, Ace high' },
  { cards: 'As Ks Qs Js 9s', category: 'flush', label: 'Flush, Ace high' },
  { cards: 'Ac 2d 3h 4s 5c 9d Kh', category: 'straight', label: 'Straight, Five high' },
  { cards: '10c Jd Qh Ks Ac 2d 3h', category: 'straight', label: 'Straight, Ace high' },
  { cards: '4c 5d 6h 7s 8c 9d 9h', category: 'straight', label: 'Straight, Nine high' },
  { cards: '7c 7d 7h Ks 2c 4d 9h', category: 'three_of_a_kind', label: 'Three of a Kind, Sevens' },
  { cards: 'Kc Kd 7h 7s 3c 3d Ah', category: 'two_pair', label: 'Two Pair, Kings and Sevens' },
  { cards: 'Kc Kd 4h 7s 9c Jd 2h', category: 'pair', label: 'Pair of Kings' },
  { cards: 'Ac Qd 9h 7s 4c 3d 2h', category: 'high_card', label: 'Ace high' },
  { cards: 'Kh Kd', category: 'pair', label: 'Pair of Kings' },
];

/** `[stronger, weaker, why]`; the first must strictly beat the second. */
export const STRICT_COMPARISONS: ReadonlyArray<readonly [string, string, string]> = [
  ['2c 3d 4h 5s 6c', 'Ac 2d 3h 4s 5c', 'a six-high straight beats the wheel'],
  ['Kc Kd 7h 7s Ac', 'Kh Ks 7d 7c Qc', 'two pair falls to the kicker'],
  [
    'Kc Kd 7h 7s 5c 5d 6h',
    'Kh Ks 7d 7c 5h 5s 2h',
    'with three pairs the kicker can beat the third pair',
  ],
  ['Kc Kd Kh Ks Ad', 'Kc Kd Kh Ks Qd', 'quads fall to the kicker'],
  ['2h 5h 7h 9h Jh', '10c Jd Qh Ks Ac', 'a flush beats a straight'],
  ['2c 2d 3h 3s 3c', 'Ah Kh Qh Jh 9h', 'a full house beats a flush'],
  ['Ac Ad Kc 9d 3h', 'Ah As Qc Jd 10h', 'a pair falls to its first kicker'],
  ['Qc Qd Qh 2s 2d', 'Jc Jd Jh As Ad', 'a full house is ranked by its trips first'],
  ['Ah Kh 9h 6h 3h', 'As Ks 9s 6s 2s', 'flushes compare all five cards'],
  ['2c 3c 4c 5c 6c', 'Ac Ad Ah As Kd', 'a straight flush beats four of a kind'],
];

/** `[first, second, why]`; the two must score exactly the same. */
export const EXACT_TIES: ReadonlyArray<readonly [string, string, string]> = [
  [
    'Ac Kc Qc Jc 10c 2d 3h',
    'Ac Kc Qc Jc 10c 4s 5d',
    'when the board plays, both hands tie exactly',
  ],
  ['Ah Kd Qs Jc 9h 3c 2d', 'As Kh Qd Jh 9c 4d 2s', 'identical best fives from different suits tie'],
];

/** Every fixed hand gets its category and label. */
export function knownHandChecks(): PokerCheck[] {
  return EVALUATOR_CASES.map((testCase) => {
    const hand = evaluateBest(parseCards(testCase.cards));
    return {
      passed: hand.category === testCase.category && hand.label === testCase.label,
      description: `${testCase.cards} → ${testCase.label} (got ${hand.category}, "${hand.label}")`,
    };
  });
}

/** Strict orderings, then exact ties. */
export function comparisonChecks(): PokerCheck[] {
  const strict = STRICT_COMPARISONS.map(([stronger, weaker, description]) => ({
    passed: handRank(parseCards(stronger)) > handRank(parseCards(weaker)),
    description,
  }));
  const ties = EXACT_TIES.map(([first, second, description]) => ({
    passed: handRank(parseCards(first)) === handRank(parseCards(second)),
    description,
  }));
  return [...strict, ...ties];
}

// ── Table sims ─────────────────────────────────────────────────────────────

/** The quickest a sim brain ever thinks. */
export const MIN_THINK_MS = 50;
const MAX_THINK_MS = 1500;
const FOLD_WEIGHT = 0.15;
const AGGRESSION_WEIGHT = 0.25;
const SHOVE_WEIGHT = 0.04;
const SHOW_LOSER_CHANCE = 0.3;
const FAST_TOGGLE_CHANCE = 0.1;
const SHOW_CARDS_CHANCE = 0.5;
const SKIP_CHANCE = 0.5;
const ILLEGAL_PROBE_CHANCE = 0.2;
/** How often the sim player tries to rebuy while a hand is still being played. */
const REBUY_PROBE_CHANCE = 0.05;
const UNCONTESTED_SHOWS = [[], [0], [1], [0, 1]] as const;

export function randomLegalAction(legal: LegalActions, rng: Rng): PokerAction {
  const roll = rng();
  if (legal.allIn !== null && roll < SHOVE_WEIGHT) return { kind: 'all_in' };
  if (legal.canFold && roll < SHOVE_WEIGHT + FOLD_WEIGHT) return { kind: 'fold' };
  if (roll < SHOVE_WEIGHT + FOLD_WEIGHT + AGGRESSION_WEIGHT) {
    if (legal.bet !== null)
      return { kind: 'bet', amount: rangeInt(rng, legal.bet.min, legal.bet.max) };
    if (legal.raise !== null)
      return { kind: 'raise', amount: rangeInt(rng, legal.raise.min, legal.raise.max) };
  }
  if (legal.canCheck) return { kind: 'check' };
  if (legal.call !== null) return { kind: 'call' };
  if (legal.allIn !== null) return { kind: 'all_in' };
  return { kind: 'fold' };
}

/** A brain that plays any legal action at random, so the sims reach every corner of the rules. */
export function randomBrain(rng: Rng): PokerSeatBrain {
  return {
    decide: (context) => ({
      action: randomLegalAction(context.legal, rng),
      thinkMs: rangeInt(rng, MIN_THINK_MS, MAX_THINK_MS),
    }),
    showsLosingHand: () => chance(rng, SHOW_LOSER_CHANCE),
    uncontestedShow: () => pick(rng, UNCONTESTED_SHOWS),
  };
}

/** Five anonymous NPCs, each bought in at the tier's buy-in. */
export function npcsFor(tier: PokerTierId): NpcSeating[] {
  return Array.from({ length: NPC_SEAT_COUNT }, (_, i) => ({
    occupantId: `regular_${i + 1}`,
    stack: POKER_STAKES[tier].buyIn,
  }));
}

export interface SimTally {
  hands: number;
  chipLeaks: number;
  duplicateCards: number;
  buttonFaults: number;
  blindFaults: number;
  deckFaults: number;
  shortHanded: number;
  awardFaults: number;
  /** Chips that appeared or vanished between one hand's end and the next one's start. */
  crossHandLeaks: number;
  potWinnerFaults: number;
  potWinnersChecked: number;
  rebuyGuardFaults: number;
  /** NPC rebuys that were not exactly the table's buy-in. */
  rebuyAmountFaults: number;
  headsUpHands: number;
  shortHandedHands: number;
  gameOvers: number;
  /** Games that ended with a regular still in a chair. */
  gameOverFaults: number;
  refusedLegal: number;
  acceptedIllegal: number;
  showToggleFaults: number;
  showToggleOnSeen: number;
  showToggleOffSeen: number;
  showdowns: number;
  uncontested: number;
  runouts: number;
  sidePots: number;
  splitPots: number;
  npcRebuys: number;
  playerBusts: number;
  errors: string[];
}

export function newTally(): SimTally {
  return {
    hands: 0,
    chipLeaks: 0,
    duplicateCards: 0,
    buttonFaults: 0,
    blindFaults: 0,
    deckFaults: 0,
    shortHanded: 0,
    awardFaults: 0,
    crossHandLeaks: 0,
    potWinnerFaults: 0,
    potWinnersChecked: 0,
    rebuyGuardFaults: 0,
    rebuyAmountFaults: 0,
    headsUpHands: 0,
    shortHandedHands: 0,
    gameOvers: 0,
    gameOverFaults: 0,
    refusedLegal: 0,
    acceptedIllegal: 0,
    showToggleFaults: 0,
    showToggleOnSeen: 0,
    showToggleOffSeen: 0,
    showdowns: 0,
    uncontested: 0,
    runouts: 0,
    sidePots: 0,
    splitPots: 0,
    npcRebuys: 0,
    playerBusts: 0,
    errors: [],
  };
}

type HandComplete = Extract<PokerEvent, { kind: 'hand_complete' }>;

/** The first seat clockwise after `from` that is dealt in. */
function nextDealtSeat(from: number, dealt: ReadonlyArray<boolean>): number {
  for (let offset = 1; offset <= POKER_SEAT_COUNT; offset++) {
    const seat = (from + offset) % POKER_SEAT_COUNT;
    if (dealt[seat]) return seat;
  }
  return from;
}

interface ObservedAward {
  readonly potIndex: number;
  readonly seats: ReadonlyArray<number>;
}

/**
 * Per-hand bookkeeping the event stream is checked against. Stack baselines come
 * from the event payloads rather than the table, so they are right however many
 * beats one clock step happened to run.
 */
class HandWatcher {
  private chipsAtShuffle = 0;
  private stacksAtShuffle: ReadonlyArray<number> = [];
  private dealt: ReadonlyArray<boolean> = [];
  /** Chips at the table when the last hand finished, before any churn. */
  private chipsAfterLastHand: number | null = null;
  /** Chips that joined (rebuys, arrivals) or left (departures) since the last hand finished. */
  private chipsChurned = 0;
  private lastButton: number | null = null;
  private lastDeck: Deck | null = null;
  private button = -1;
  private buttonMoves = 0;
  private smallBlinds = 0;
  private bigBlinds = 0;
  private awarded = 0;
  private awards: ObservedAward[] = [];
  private runout = false;
  private showdownOrder: number[] = [];
  private mucked = new Set<number>();
  private winners = new Set<number>();
  private showCardsThisHand = false;

  constructor(
    private readonly table: PokerTable,
    private readonly tally: SimTally,
  ) {}

  observe(event: PokerEvent): void {
    const table = this.table;
    const tally = this.tally;
    switch (event.kind) {
      case 'button_moved':
        // Checked when the shuffle says which seats are dealt in: the button
        // passes over an empty chair.
        this.button = event.seat;
        this.buttonMoves++;
        return;
      case 'shuffled': {
        const deck = table.currentDeck;
        if (deck === null || deck === this.lastDeck || event.cardsRemaining !== DECK_SIZE)
          tally.deckFaults++;
        this.lastDeck = deck;
        this.chipsAtShuffle = sum(event.stacks);
        this.stacksAtShuffle = event.stacks;
        const expectedChips =
          this.chipsAfterLastHand === null ? null : this.chipsAfterLastHand + this.chipsChurned;
        if (expectedChips !== null && expectedChips !== this.chipsAtShuffle) tally.crossHandLeaks++;
        this.chipsChurned = 0;
        this.dealt = event.dealt;
        const expectedButton =
          this.lastButton === null ? this.button : nextDealtSeat(this.lastButton, event.dealt);
        if (!event.dealt[this.button] || this.button !== expectedButton) tally.buttonFaults++;
        this.lastButton = this.button;
        const seatedWithChips = table.seats.map(
          (seat, index) => seat.occupantId !== null && (event.stacks[index] ?? 0) > 0,
        );
        const dealtCount = event.dealt.filter(Boolean).length;
        const dealtEveryoneSeated = seatedWithChips.every(
          (ready, index) => ready === event.dealt[index],
        );
        if (!dealtEveryoneSeated || !event.dealt[PLAYER_SEAT] || dealtCount < HEADS_UP_SEATS) {
          tally.shortHanded++;
        }
        if (dealtCount === HEADS_UP_SEATS) tally.headsUpHands++;
        else if (dealtCount < POKER_SEAT_COUNT) tally.shortHandedHands++;
        this.showCardsThisHand = table.showCards;
        return;
      }
      case 'blind_posted': {
        const stakes = table.stakes;
        const size = event.blind === 'small' ? stakes.smallBlind : stakes.bigBlind;
        // Heads-up the button posts the small blind; otherwise the blinds are
        // the next two seats dealt in after it.
        const headsUp = this.dealt.filter(Boolean).length === HEADS_UP_SEATS;
        const smallSeat = headsUp ? this.button : nextDealtSeat(this.button, this.dealt);
        const expectedSeat =
          event.blind === 'small' ? smallSeat : nextDealtSeat(smallSeat, this.dealt);
        const expected = Math.min(size, this.stacksAtShuffle[event.seat] ?? 0);
        if (event.seat !== expectedSeat || event.amount !== expected) tally.blindFaults++;
        if (event.blind === 'small') this.smallBlinds++;
        else this.bigBlinds++;
        return;
      }
      case 'runout_started':
        this.runout = true;
        tally.runouts++;
        return;
      case 'showdown_reveal':
        if (!this.runout) this.showdownOrder.push(event.seat);
        return;
      case 'muck':
        this.showdownOrder.push(event.seat);
        this.mucked.add(event.seat);
        return;
      case 'pot_awarded':
        this.awarded += sum(event.amounts);
        for (const seat of event.seats) this.winners.add(seat);
        if (!event.uncontested) this.awards.push({ potIndex: event.potIndex, seats: event.seats });
        if (event.potIndex > 0) tally.sidePots++;
        if (event.seats.length > 1) tally.splitPots++;
        if (event.uncontested) tally.uncontested++;
        else tally.showdowns++;
        return;
      case 'seat_rebuy':
        tally.npcRebuys++;
        if (event.amount !== table.stakes.buyIn) tally.rebuyAmountFaults++;
        this.chipsChurned += event.amount;
        return;
      case 'seat_replaced':
        this.chipsChurned += event.stack;
        return;
      case 'seat_vacated':
        this.chipsChurned -= event.stack;
        return;
      case 'player_rebuy':
        this.chipsChurned += event.amount;
        return;
      case 'player_busted':
        tally.playerBusts++;
        return;
      case 'hand_complete':
        this.completeHand(event);
        return;
      case 'hole_dealt':
      case 'burn':
      case 'street_dealt':
      case 'action':
      case 'player_turn':
      case 'uncalled_returned':
      case 'bets_collected':
      case 'uncontested_show':
      case 'seat_busted':
      case 'banter':
      case 'tell':
        return;
      case 'game_over':
        tally.gameOvers++;
        if (table.seats.some((seat) => !seat.isPlayer && seat.occupantId !== null))
          tally.gameOverFaults++;
        return;
    }
  }

  /** Reads only the event, so it holds however many beats ran before the drain. */
  private completeHand(hand: HandComplete): void {
    const tally = this.tally;
    tally.hands++;
    const chipsNow = sum(hand.stacks);
    if (chipsNow !== this.chipsAtShuffle || sum(hand.netBySeat) !== 0) tally.chipLeaks++;
    this.chipsAfterLastHand = chipsNow;
    if (this.awarded !== sum(hand.contributions)) tally.awardFaults++;
    if (this.buttonMoves !== 1) tally.buttonFaults++;
    if (this.smallBlinds !== 1 || this.bigBlinds !== 1) tally.blindFaults++;
    this.checkPotWinners(hand);

    const dealt = [...hand.holeCards.flat(), ...hand.board, ...hand.burned];
    if (new Set(dealt.map(cardId)).size !== dealt.length) tally.duplicateCards++;

    const playerShowdownSlot = this.showdownOrder.indexOf(PLAYER_SEAT);
    const playerLostAfterOpener = playerShowdownSlot > 0 && !this.winners.has(PLAYER_SEAT);
    if (!this.runout && playerLostAfterOpener) {
      const mucked = this.mucked.has(PLAYER_SEAT);
      if (mucked === this.showCardsThisHand) tally.showToggleFaults++;
      if (this.showCardsThisHand) tally.showToggleOnSeen++;
      else tally.showToggleOffSeen++;
    }

    this.buttonMoves = 0;
    this.smallBlinds = 0;
    this.bigBlinds = 0;
    this.awarded = 0;
    this.awards = [];
    this.runout = false;
    this.showdownOrder = [];
    this.mucked.clear();
    this.winners.clear();
  }

  /** Every contested pot went to exactly the best hands among the seats eligible for it. */
  private checkPotWinners(hand: HandComplete): void {
    const pots = buildPots(
      hand.contributions,
      hand.live.map((live) => !live),
    );
    for (const award of this.awards) {
      this.tally.potWinnersChecked++;
      if (award.potIndex < 0 || award.potIndex >= pots.length) {
        this.tally.potWinnerFaults++;
        continue;
      }
      const pot = pots[award.potIndex];
      const ranks = new Map(
        pot.eligibleSeats.map((seat) => [
          seat,
          handRank([...(hand.holeCards[seat] ?? []), ...hand.board]),
        ]),
      );
      const best = Math.max(...ranks.values());
      const expected = pot.eligibleSeats.filter((seat) => ranks.get(seat) === best);
      const matches =
        expected.length === award.seats.length &&
        expected.every((seat) => award.seats.includes(seat));
      if (!matches) this.tally.potWinnerFaults++;
    }
  }
}

function playerTurn(table: PokerTable, rng: Rng, tally: SimTally): void {
  const legal = table.playerLegalActions();
  if (legal === null) return;
  if (chance(rng, ILLEGAL_PROBE_CHANCE)) {
    const probe: PokerAction =
      legal.raise !== null
        ? { kind: 'raise', amount: legal.raise.min - 1 }
        : legal.canCheck
          ? { kind: 'fold' }
          : { kind: 'check' };
    if (table.playerAct(probe) === null) tally.acceptedIllegal++;
  }
  const refusal = table.playerAct(randomLegalAction(legal, rng));
  if (refusal !== null) tally.refusedLegal++;
}

/**
 * Plays `hands` hands with a random player, checking every hand's invariants as
 * it goes. Stops early, without counting a stall, when the game ends because
 * every regular has left; the caller decides whether to start another.
 */
export function playStream(
  label: string,
  table: PokerTable,
  playerRng: Rng,
  tally: SimTally,
  hands: number,
  onEvent: (event: PokerEvent) => void = () => undefined,
): void {
  const watcher = new HandWatcher(table, tally);
  const startHands = tally.hands;
  const maxFrames = hands * MAX_FRAMES_PER_HAND;
  try {
    for (let frame = 0; frame < maxFrames && tally.hands - startHands < hands; frame++) {
      if (table.phase === 'game_over') break;
      if (table.phase === 'between_hands') {
        table.setShowCards(chance(playerRng, SHOW_CARDS_CHANCE));
        if (chance(playerRng, FAST_TOGGLE_CHANCE)) table.setFast(!table.fast);
      }
      if (table.awaitingPlayer) playerTurn(table, playerRng, tally);
      if (table.phase === 'player_busted') table.rebuy();
      if (table.handInProgress && chance(playerRng, REBUY_PROBE_CHANCE)) {
        const stackBefore = table.playerStack;
        if (table.rebuy() || table.playerStack !== stackBefore) tally.rebuyGuardFaults++;
      }
      if (table.handInProgress && !table.isPlayerLive() && chance(playerRng, SKIP_CHANCE))
        table.skipToNextHand();
      table.update(SIM_FRAME_MS);
      for (const event of table.drainEvents()) {
        watcher.observe(event);
        onEvent(event);
      }
    }
  } catch (error) {
    tally.errors.push(`${label}: ${String(error)}`);
  }
  if (tally.hands - startHands < hands && table.phase !== 'game_over') {
    tally.errors.push(`${label}: stalled after ${tally.hands - startHands} hands`);
  }
  if (table.illegalNpcActions > 0)
    tally.errors.push(`${label}: ${table.illegalNpcActions} illegal NPC actions`);
}

/** The three independent streams one random-brain sim table draws from. */
export interface SimStreams {
  readonly brain: Rng;
  readonly table: Rng;
  readonly player: Rng;
}

/** One table of random brains at `tier`, played for `hands` hands into `tally`. */
export function runSimStream(
  label: string,
  tier: PokerTierId,
  streams: SimStreams,
  tally: SimTally,
  hands: number,
): void {
  const table = new PokerTable({
    tier,
    brain: randomBrain(streams.brain),
    npcs: npcsFor(tier),
    random: streams.table,
  });
  playStream(label, table, streams.player, tally, hands);
}

/** The player's side of the sims: legal actions accepted, illegal ones refused, and the Show cards toggle obeyed. */
export function playerActionChecks(tally: SimTally): PokerCheck[] {
  return [
    {
      passed: tally.refusedLegal === 0,
      description: `every legal player action is accepted (${tally.refusedLegal} refused)`,
    },
    {
      passed: tally.acceptedIllegal === 0,
      description: `illegal player actions are refused (${tally.acceptedIllegal} accepted)`,
    },
    {
      passed:
        tally.showToggleFaults === 0 && tally.showToggleOnSeen > 0 && tally.showToggleOffSeen > 0,
      description: `a losing player hand mucks unless Show cards is on (${tally.showToggleOnSeen} on / ${tally.showToggleOffSeen} off, ${tally.showToggleFaults} faults)`,
    },
  ];
}

/** The per-hand invariants over a finished set of sim streams that should have played `expectedHands`. */
export function simTallyChecks(tally: SimTally, expectedHands: number): PokerCheck[] {
  const errorsQuoted =
    tally.errors.length > 0 ? `: ${tally.errors.slice(0, ERRORS_SHOWN).join('; ')}` : '';
  return [
    { passed: tally.errors.length === 0, description: `no table errors or stalls${errorsQuoted}` },
    { passed: tally.hands === expectedHands, description: `${tally.hands} hands completed` },
    {
      passed: tally.chipLeaks === 0,
      description: `chips at the table are conserved every hand (${tally.chipLeaks} leaks)`,
    },
    {
      passed: tally.awardFaults === 0,
      description: `every chip put in is awarded (${tally.awardFaults} faults)`,
    },
    {
      passed: tally.crossHandLeaks === 0,
      description: `chips between hands reconcile with rebuys, arrivals and departures (${tally.crossHandLeaks} leaks)`,
    },
    {
      passed: tally.potWinnerFaults === 0 && tally.potWinnersChecked > 0,
      description: `every contested pot goes to its best eligible hand (${tally.potWinnersChecked} pots re-evaluated, ${tally.potWinnerFaults} wrong)`,
    },
    {
      passed: tally.rebuyAmountFaults === 0,
      description: `every NPC rebuy is exactly the table's buy-in (${tally.rebuyAmountFaults} off)`,
    },
    {
      passed: tally.gameOverFaults === 0,
      description: `a game only ends once no regular is left in a chair (${tally.gameOverFaults} early)`,
    },
    {
      passed: tally.rebuyGuardFaults === 0,
      description: `a rebuy is refused while a hand is being played (${tally.rebuyGuardFaults} accepted)`,
    },
    {
      passed: tally.duplicateCards === 0,
      description: `no card appears twice across hole cards, board and burns (${tally.duplicateCards})`,
    },
    {
      passed: tally.deckFaults === 0,
      description: `a fresh deck with its cursor at 0 every hand (${tally.deckFaults} faults)`,
    },
    {
      passed: tally.buttonFaults === 0,
      description: `the button moves exactly once a hand, to the next seat dealt in (${tally.buttonFaults})`,
    },
    {
      passed: tally.blindFaults === 0,
      description: `every hand posts one small and one big blind at tier amounts, the next seats dealt in after the button, the button itself heads-up (${tally.blindFaults})`,
    },
    {
      passed: tally.shortHanded === 0,
      description: `every seated player with chips is dealt in, the player always, two seats at least (${tally.shortHanded} faults)`,
    },
    ...playerActionChecks(tally),
    {
      passed:
        tally.showdowns > 0 &&
        tally.uncontested > 0 &&
        tally.runouts > 0 &&
        tally.sidePots > 0 &&
        tally.splitPots > 0,
      description: `the sims reach showdowns (${tally.showdowns}), uncontested pots (${tally.uncontested}), all-in run-outs (${tally.runouts}), side pots (${tally.sidePots}) and split pots (${tally.splitPots})`,
    },
    {
      passed: tally.npcRebuys > 0 && tally.playerBusts > 0,
      description: `busted NPCs rebuy (${tally.npcRebuys}) and the player busts and rebuys (${tally.playerBusts})`,
    },
  ];
}
