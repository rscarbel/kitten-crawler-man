#!/usr/bin/env tsx
/**
 * Headless gate on the Texas Hold'em rules engine (`src/systems/casino/poker/`):
 * hand ranking, side pots and the odd chip, betting legality, the table's
 * per-hand invariants over thousands of seeded hands, the leave-mid-hand
 * forfeit, the fresh deck per hand and the six-handed guard.
 *
 * Every random source is a seeded `mulberry32` stream, and the table sims run
 * across many streams so one extra draw anywhere cannot reshuffle the verdict.
 * No check is a timing, so a busy machine can't fail it.
 *
 * Run: npm run verify:poker
 */

import { DECK_SIZE, Deck, cardId, createShoe, type Card } from '../src/systems/casino/Deck';
import {
  BettingRound,
  IllegalPokerAction,
  isLegal,
  passiveAction,
  type BettingSeat,
  type LegalActions,
  type PokerAction,
} from '../src/systems/casino/poker/bettingRound';
import { HAND_SIZE, evaluateBest, handRank } from '../src/systems/casino/poker/handEvaluator';
import type {
  PokerBanterTrigger,
  PokerEvent,
  ShownCardIndices,
} from '../src/systems/casino/poker/pokerEvents';
import {
  BUY_IN_BIG_BLINDS,
  POKER_STAKES,
  POKER_TIER_IDS,
  chipDenominations,
  type PokerTierId,
} from '../src/systems/casino/poker/pokerStakes';
import {
  NPC_SEAT_COUNT,
  PASSIVE_BRAIN,
  PLAYER_SEAT,
  HEADS_UP_SEATS,
  POKER_SEAT_COUNT,
  PokerTable,
  type PokerSeatBrain,
  type PokerSeatManager,
} from '../src/systems/casino/poker/PokerTable';
import { awardPots, buildPots } from '../src/systems/casino/poker/pots';
import {
  GROAN_LOSS_BIG_BLINDS,
  PokerHandReactions,
  isShownWinningBluff,
  type ReactionVoice,
} from '../src/systems/casino/poker/pokerReactions';
import { createCanvas } from 'canvas';
import { registerUiFontForNode } from './nodeUiFont';
import { computePokerLayout, PLAYER_CARD_MIN_WIDTH } from '../src/ui/casino/pokerLayout';
import {
  HAND_NAME_MAX_LINES,
  HAND_NAME_PAD,
  handNameLines,
  handNameShortLine,
} from '../src/ui/casino/pokerHandNames';
import { REGULAR_SHORT_NAMES } from '../src/ui/casino/pokerNames';
import { LABEL_NAME_MIN_PLATE_H } from '../src/ui/casino/pokerSeat';
import { CARD_ASPECT } from '../src/ui/casino/PlayingCard';
import { clampedUiScale, NO_INSETS } from '../src/ui/core/viewport';
import { fontFor, resolveTheme, type TypeStyle } from '../src/ui/theme/tokens';
import {
  PokerRegulars,
  createRegularsTable,
  isRegularId,
} from '../src/systems/casino/poker/npc/PokerRegulars';
import {
  decide,
  legalize,
  seatPosition,
  type SeatPosition,
} from '../src/systems/casino/poker/npc/decide';
import {
  BIG_LOSS_BIG_BLINDS,
  CALM_MOOD,
  effectiveProfile,
  moodAfterHand,
} from '../src/systems/casino/poker/npc/mood';
import { EMPTY_PLAYER_READ, type PlayerRead } from '../src/systems/casino/poker/npc/playerRead';
import { parseClubMembershipCheckpoint } from '../src/core/save/PersistedWorldState';
import { JACKPOT_FLOOR } from '../src/systems/casino/slots/slotBets';
import type { ClubMembershipCheckpoint } from '../src/core/club/ClubMembership';
import {
  LOOSE_VPIP_AT,
  TIGHT_VPIP_AT,
  rollPokerPersonalities,
  selectTable,
  type PokerPersonalities,
} from '../src/systems/casino/poker/npc/personality';
import { ARCHETYPES, type Archetype } from '../src/systems/casino/poker/npc/profiles';
import type { PokerTell } from '../src/systems/casino/poker/npc/tells';
import {
  POKER_REGULARS,
  REGULAR_IDS,
  type RegularId,
} from '../src/systems/casino/poker/npc/regulars';
import type { PokerDecisionContext } from '../src/systems/casino/poker/PokerTable';
import {
  ERRORS_SHOWN,
  MAX_FRAMES_PER_HAND,
  MIN_THINK_MS,
  SIM_FRAME_MS as FRAME_MS,
  comparisonChecks,
  knownHandChecks,
  newTally,
  npcsFor,
  playStream,
  playerActionChecks,
  runSimStream,
  simTallyChecks,
  sum,
  type PokerCheck,
} from '../src/systems/casino/poker/pokerInvariants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { TILE_SIZE } from '../src/core/constants';
import { partyCoins } from '../src/core/party/partyCoins';
import { ClubPokerSystem } from '../src/systems/ClubPokerSystem';
import { POKER_DEV_SEED } from '../src/systems/casino/poker/npc/personality';
import { paceBanter } from '../src/systems/casino/poker/npc/banterPacing';
import { mulberry32, pick, rangeInt, subSeed, type Rng } from '../src/sprites/person/rng';

let failures = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ok   ${description}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${description}`);
}

function report(result: PokerCheck): void {
  check(result.passed, result.description);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const BASE_SEED = 0x5eed_c0de;
const SIM_STREAMS = 12;
const HANDS_PER_STREAM = 400;
const FORFEIT_STREAMS = 6;
const EVALUATOR_STREAMS = 3;
const RANDOM_HANDS_PER_STREAM = 3000;
const SEVEN_CARDS = 7;
/** The NPC seat the churn checks stand up and refill. */
const CHURN_SEAT = 3;
const CHURN_HAND = 2;

function stream(salt: number): Rng {
  return mulberry32(subSeed(BASE_SEED, salt));
}

// Salts keep every family of streams independent of the others.
const EVALUATOR_SALT = 100;
const SIM_SALT = 1000;
const SIM_BRAIN_SALT = 2000;
const SIM_PLAYER_SALT = 3000;
const FORFEIT_SALT = 4000;
const GUARD_SALT = 5000;
const SPEED_SALT = 6000;
/** Decimal places for the milliseconds and shares quoted in check lines. */
const REPORT_DECIMALS = 2;
/** Any fixed seed: the check is that two shuffles from it agree. */
const DECK_ORDER_SEED = 42;

// ── Cards ──────────────────────────────────────────────────────────────────

function fullDeck(): Card[] {
  const deck = Deck.fresh(stream(0));
  const cards: Card[] = [];
  for (let card = deck.draw(); card !== null; card = deck.draw()) cards.push(card);
  return cards;
}

function dealRandom(rng: Rng, count: number): Card[] {
  const cards = fullDeck();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards.slice(0, count);
}

function fiveCardSubsets(cards: ReadonlyArray<Card>): Card[][] {
  const subsets: Card[][] = [];
  const recurse = (start: number, chosen: Card[]): void => {
    if (chosen.length === HAND_SIZE) {
      subsets.push([...chosen]);
      return;
    }
    for (let i = start; i < cards.length; i++) recurse(i + 1, [...chosen, cards[i]]);
  };
  recurse(0, []);
  return subsets;
}

// ── 1. Stakes and deck ─────────────────────────────────────────────────────

function checkStakesAndDeck(): void {
  section('Stakes table and seeded deck');
  for (const tier of POKER_TIER_IDS) {
    const stakes = POKER_STAKES[tier];
    check(
      stakes.buyIn === stakes.bigBlind * BUY_IN_BIG_BLINDS,
      `${tier}: buy-in is ${BUY_IN_BIG_BLINDS} big blinds`,
    );
    check(stakes.smallBlind * 2 === stakes.bigBlind, `${tier}: small blind is half the big blind`);
    check(
      chipDenominations(tier).every((value) => value % stakes.chipUnit === 0) &&
        stakes.bigBlind % stakes.chipUnit === 0,
      `${tier}: chips and blinds are whole multiples of the smallest chip`,
    );
  }
  const seed = DECK_ORDER_SEED;
  const a = createShoe(mulberry32(seed));
  const b = createShoe(mulberry32(seed));
  check(
    a.cards.map(cardId).join() === b.cards.map(cardId).join(),
    'the same seed shuffles the same deck order',
  );
  check(
    new Set(a.cards.map(cardId)).size === DECK_SIZE,
    'a seeded deck still holds 52 distinct cards',
  );
  const unseeded = Deck.fresh();
  check(unseeded.remaining === DECK_SIZE, 'the unseeded default still builds a full deck');
}

// ── 2. Hand evaluator ──────────────────────────────────────────────────────

function checkEvaluator(): void {
  section('Hand evaluator: known hands');
  for (const result of knownHandChecks()) report(result);

  section('Hand evaluator: comparisons');
  for (const result of comparisonChecks()) report(result);

  section('Hand evaluator: agrees with brute force over every five-card subset');
  let mismatches = 0;
  let badBestFive = 0;
  let total = 0;
  for (let s = 0; s < EVALUATOR_STREAMS; s++) {
    const rng = stream(EVALUATOR_SALT + s);
    for (let i = 0; i < RANDOM_HANDS_PER_STREAM; i++) {
      const cards = dealRandom(rng, SEVEN_CARDS);
      const fast = handRank(cards);
      const brute = Math.max(...fiveCardSubsets(cards).map((subset) => handRank(subset)));
      if (fast !== brute) mismatches++;
      const best = evaluateBest(cards);
      const ids = new Set(best.best5.map(cardId));
      const fromInput = best.best5.every((card) => cards.some((c) => cardId(c) === cardId(card)));
      if (ids.size !== HAND_SIZE || !fromInput || handRank(best.best5) !== best.rankValue)
        badBestFive++;
      total++;
    }
  }
  check(
    mismatches === 0,
    `${total} random seven-card hands: best-of-seven equals the best five-card subset (${mismatches} mismatches)`,
  );
  check(
    badBestFive === 0,
    `${total} random hands: best5 is five distinct input cards scoring the hand's value (${badBestFive} bad)`,
  );
}

// ── 3. Pots ────────────────────────────────────────────────────────────────

function same(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * A side-pot fixture. Amounts are written as space-separated text so each case
 * reads as one table row; `ranks` uses S / M / W for a strong, medium or weak
 * showdown hand and `-` for a seat with no claim.
 */
interface PotCase {
  readonly name: string;
  readonly contributions: string;
  readonly ranks: string;
  /** Seats that folded, space-separated; empty when none did. */
  readonly folded: string;
  readonly button: number;
  readonly pots: string;
  readonly perSeat: string;
  /** The table's smallest chip, which a split is made in; 1 when omitted. */
  readonly chipUnit?: number;
}

const SHOWDOWN_STRENGTH: Record<string, number | null> = { S: 900, M: 500, W: 100, '-': null };

const POT_CASES: ReadonlyArray<PotCase> = [
  {
    name: '2-way: the short stack wins the 80 main pot, the 60 side pot returns to the big stack',
    contributions: '100 40',
    ranks: 'W S',
    folded: '',
    button: 0,
    pots: '80 60',
    perSeat: '60 80',
  },
  {
    name: '3-way: pots of 150 / 100 / 100, each to the best hand eligible for it',
    contributions: '50 100 200',
    ranks: 'S W M',
    folded: '',
    button: 0,
    pots: '150 100 100',
    perSeat: '150 0 200',
  },
  {
    name: '4-way with a folded seat: pots of 150 / 180 / 140 keep its chips, the tied top pot splits',
    contributions: '30 80 150 150 60',
    ranks: 'S M W W -',
    folded: '4',
    button: 0,
    pots: '150 180 140',
    perSeat: '150 180 70 70 0',
  },
  {
    name: 'odd chip: button on seat 0 gives it to seat 1, first winner clockwise',
    contributions: '1 1 1',
    ranks: 'S S -',
    folded: '2',
    button: 0,
    pots: '3',
    perSeat: '1 2 0',
  },
  {
    name: 'odd chip: button on seat 1 gives it to seat 0, first winner clockwise of seat 2',
    contributions: '1 1 1',
    ranks: 'S S -',
    folded: '2',
    button: 1,
    pots: '3',
    perSeat: '2 1 0',
  },
  {
    name: 'three-way tie on 8: the two leftover coins go to the first two winners clockwise',
    contributions: '2 2 2 2',
    ranks: 'S S S -',
    folded: '3',
    button: 2,
    pots: '8',
    perSeat: '3 3 2 0',
  },
  {
    name: 'Card Room split of 50: shares are whole 10-chips, the odd chip goes to seat 1 first clockwise',
    contributions: '25 25',
    ranks: 'S S',
    folded: '',
    button: 0,
    pots: '50',
    perSeat: '20 30',
    chipUnit: POKER_STAKES.card_room.chipUnit,
  },
  {
    name: 'Card Room split of 65: the 5 coins smaller than a chip still go to the first winner clockwise',
    contributions: '30 30 5',
    ranks: 'S S -',
    folded: '2',
    button: 0,
    pots: '65',
    perSeat: '30 35 0',
    chipUnit: POKER_STAKES.card_room.chipUnit,
  },
  {
    name: 'High Rollers three-way split of 800: two odd 100-chips go to seats 2 and 0, first clockwise of the button',
    contributions: '200 200 200 200',
    ranks: 'S S S -',
    folded: '3',
    button: 1,
    pots: '800',
    perSeat: '300 200 300 0',
    chipUnit: POKER_STAKES.high_rollers.chipUnit,
  },
];

function numbers(text: string): number[] {
  return text === '' ? [] : text.split(' ').map(Number);
}

function checkPots(): void {
  section('Side pots and awards');
  for (const potCase of POT_CASES) {
    const contributions = numbers(potCase.contributions);
    const foldedSeats = numbers(potCase.folded);
    const folded = contributions.map((_, seat) => foldedSeats.includes(seat));
    const ranks = potCase.ranks.split(' ').map((letter) => SHOWDOWN_STRENGTH[letter] ?? null);
    const pots = buildPots(contributions, folded);
    const result = awardPots(pots, ranks, potCase.button, potCase.chipUnit);
    const foldedEligible = pots.some((pot) => pot.eligibleSeats.some((seat) => folded[seat]));
    check(
      same(
        pots.map((pot) => pot.amount),
        numbers(potCase.pots),
      ) &&
        same(result.perSeat, numbers(potCase.perSeat)) &&
        sum(result.perSeat) === sum(contributions) &&
        !foldedEligible,
      potCase.name,
    );
  }
}

// ── 4. Betting legality ────────────────────────────────────────────────────

function seats(stacks: ReadonlyArray<number>): BettingSeat[] {
  return stacks.map((stack) => ({
    stack,
    streetBet: 0,
    contributed: 0,
    folded: false,
    allIn: false,
  }));
}

function threw(action: () => void): boolean {
  try {
    action();
    return false;
  } catch (error) {
    return error instanceof IllegalPokerAction;
  }
}

const BIG_BLIND = 20;
const SMALL_BLIND = BIG_BLIND / 2;
const DEEP = 1000;
const OPEN_BET = 50;
const RAISE_TO = 150;
const BET = 100;
/** A stack whose all-in over `BET` is less than a full raise. */
const SHORT_SHOVE_STACK = 130;
/** A stack whose all-in over `BET` is at least a full raise. */
const FULL_SHOVE_STACK = 250;
const FOLDING_BET = 60;
const UNDER_THE_GUN = 3;

function checkBetting(): void {
  section('Betting legality');
  const unopened = { bigBlind: BIG_BLIND, openingBet: 0, firstToAct: 0 };
  {
    const round = new BettingRound(seats([DEEP, DEEP, DEEP]), unopened);
    const opening = round.legalActions(0);
    check(
      opening.bet?.min === BIG_BLIND && opening.canCheck && !opening.canFold,
      'an unopened street: check, or bet at least one big blind',
    );
    check(
      threw(() => round.apply(0, { kind: 'bet', amount: BIG_BLIND - 1 })),
      'a bet under the big blind is refused',
    );
    round.apply(0, { kind: 'bet', amount: OPEN_BET });
    const minRaise = OPEN_BET * 2;
    check(
      round.legalActions(1).raise?.min === minRaise,
      `min-raise after a ${OPEN_BET} bet is to ${minRaise}`,
    );
    check(
      threw(() => round.apply(1, { kind: 'raise', amount: minRaise - 1 })),
      `a raise to ${minRaise - 1} is refused`,
    );
    round.apply(1, { kind: 'raise', amount: RAISE_TO });
    const reRaise = RAISE_TO + (RAISE_TO - OPEN_BET);
    check(
      round.legalActions(2).raise?.min === reRaise,
      `after a raise to ${RAISE_TO} the next raise is to at least ${reRaise}`,
    );
    check(
      threw(() => round.apply(0, { kind: 'call' })),
      'acting out of turn is refused',
    );
  }
  {
    const round = new BettingRound(seats([DEEP, DEEP, SHORT_SHOVE_STACK]), unopened);
    round.apply(0, { kind: 'bet', amount: BET });
    round.apply(1, { kind: 'call' });
    const shove = round.apply(2, { kind: 'all_in' });
    const opener = round.legalActions(0);
    check(
      shove.kind === 'all_in' && round.price === SHORT_SHOVE_STACK,
      `a short all-in raises the price to ${SHORT_SHOVE_STACK}`,
    );
    check(
      opener.raise === null && opener.allIn === null && opener.call === SHORT_SHOVE_STACK - BET,
      'a short all-in does not reopen betting: the opener may only call the difference or fold',
    );
    round.apply(0, { kind: 'call' });
    check(round.legalActions(1).raise === null, 'nor may the caller re-raise');
  }
  {
    const round = new BettingRound(seats([DEEP, SHORT_SHOVE_STACK, DEEP]), unopened);
    round.apply(0, { kind: 'bet', amount: BET });
    round.apply(1, { kind: 'all_in' });
    check(
      round.legalActions(2).raise?.min === SHORT_SHOVE_STACK + BET,
      'a seat yet to act keeps its raise after a short all-in, priced off the last full bet',
    );
  }
  {
    const round = new BettingRound(seats([DEEP, DEEP, FULL_SHOVE_STACK]), unopened);
    round.apply(0, { kind: 'bet', amount: BET });
    round.apply(1, { kind: 'call' });
    round.apply(2, { kind: 'all_in' });
    check(
      round.legalActions(0).raise?.min === FULL_SHOVE_STACK + (FULL_SHOVE_STACK - BET),
      'a full-raise all-in reopens betting for the opener',
    );
  }
  {
    const table = seats([DEEP, DEEP, DEEP, DEEP]);
    const smallBlindSeat = 1;
    const bigBlindSeat = 2;
    for (const [seat, blind] of [
      [smallBlindSeat, SMALL_BLIND],
      [bigBlindSeat, BIG_BLIND],
    ] as const) {
      table[seat].stack -= blind;
      table[seat].streetBet = blind;
      table[seat].contributed = blind;
    }
    const round = new BettingRound(table, {
      bigBlind: BIG_BLIND,
      openingBet: BIG_BLIND,
      firstToAct: UNDER_THE_GUN,
    });
    round.apply(UNDER_THE_GUN, { kind: 'call' });
    round.apply(0, { kind: 'call' });
    round.apply(smallBlindSeat, { kind: 'call' });
    const option = round.nextToAct() === bigBlindSeat ? round.legalActions(bigBlindSeat) : null;
    check(
      option !== null && option.canCheck && option.raise?.min === BIG_BLIND * 2,
      'BB option: limped to the big blind, it may check or raise to 2 BB',
    );
    round.apply(bigBlindSeat, { kind: 'check' });
    check(round.isComplete, 'the BB checking its option closes the round');
  }
  {
    const round = new BettingRound(seats([DEEP, DEEP, DEEP]), unopened);
    round.apply(0, { kind: 'bet', amount: FOLDING_BET });
    round.apply(1, { kind: 'fold' });
    round.apply(2, { kind: 'fold' });
    check(
      round.isComplete && round.nextToAct() === null,
      'the round ends when everyone folds to the bettor',
    );
  }
  {
    // The big blind posts all-in for less than a small blind, then everyone
    // folds round to the small blind, which has already covered it.
    const SHORT_BLIND_STACK = SMALL_BLIND - 2;
    const table = seats([DEEP, DEEP, SHORT_BLIND_STACK, DEEP]);
    const smallBlindSeat = 1;
    const bigBlindSeat = 2;
    table[smallBlindSeat].stack -= SMALL_BLIND;
    table[smallBlindSeat].streetBet = SMALL_BLIND;
    table[smallBlindSeat].contributed = SMALL_BLIND;
    table[bigBlindSeat].streetBet = SHORT_BLIND_STACK;
    table[bigBlindSeat].contributed = SHORT_BLIND_STACK;
    table[bigBlindSeat].stack = 0;
    table[bigBlindSeat].allIn = true;
    const round = new BettingRound(table, {
      bigBlind: BIG_BLIND,
      openingBet: BIG_BLIND,
      firstToAct: UNDER_THE_GUN,
    });
    round.apply(UNDER_THE_GUN, { kind: 'fold' });
    round.apply(0, { kind: 'fold' });
    check(
      round.isComplete && round.nextToAct() === null,
      'a short all-in big blind already covered by the last seat with chips closes the round with no decision',
    );
  }
}

// ── 5. Table sims ──────────────────────────────────────────────────────────

function checkSims(): void {
  section(`Table sims: ${SIM_STREAMS} seeded streams × ${HANDS_PER_STREAM} hands, all tiers`);
  const tally = newTally();
  for (let s = 0; s < SIM_STREAMS; s++) {
    const tier = POKER_TIER_IDS[s % POKER_TIER_IDS.length];
    runSimStream(
      `${tier} stream ${s}`,
      tier,
      {
        brain: stream(SIM_BRAIN_SALT + s),
        table: stream(SIM_SALT + s),
        player: stream(SIM_PLAYER_SALT + s),
      },
      tally,
      HANDS_PER_STREAM,
    );
  }
  for (const result of simTallyChecks(tally, SIM_STREAMS * HANDS_PER_STREAM)) report(result);
}

// ── 6. Leaving mid-hand ────────────────────────────────────────────────────

function step(table: PokerTable): void {
  table.update(FRAME_MS);
  table.drainEvents();
}

/** Plays (the player check/calling) until `ready` holds; false when it never did. */
function playUntil(table: PokerTable, ready: () => boolean): boolean {
  const maxFrames = MAX_FRAMES_PER_HAND * POKER_SEAT_COUNT;
  for (let frame = 0; frame < maxFrames; frame++) {
    if (ready()) return true;
    const legal = table.playerLegalActions();
    if (legal !== null) table.playerAct(legal.canCheck ? { kind: 'check' } : { kind: 'call' });
    step(table);
  }
  return ready();
}

interface ForfeitOutcome {
  readonly description: string;
  readonly reached: boolean;
  readonly stackBefore: number;
  readonly contribution: number;
  readonly npcChipsBefore: number;
  readonly returned: number;
  readonly npcStacksAfter: number;
  readonly eventsAfter: number;
  readonly phaseAfter: string;
  /** The table's running wager tally grew by exactly this hand's contribution. */
  readonly committedMatches: boolean;
}

function forfeit(description: string, table: PokerTable, reached: boolean): ForfeitOutcome {
  const player = table.seats[PLAYER_SEAT];
  const stackBefore = player.stack;
  const contribution = table.playerContribution;
  const committedBeforeHand = table.playerCoinsCommitted - contribution;
  // Contributions outlive the award for display, so they only count while a pot is still out.
  const potOut = table.handInProgress && table.phase !== 'awarding';
  const npcChipsBefore = sum(
    table.seats
      .filter((seat) => !seat.isPlayer)
      .map((seat) => seat.stack + (potOut ? seat.contributed : 0)),
  );
  const returned = table.forfeitAndLeave();
  return {
    description,
    reached,
    stackBefore,
    contribution,
    npcChipsBefore,
    returned,
    npcStacksAfter: sum(table.seats.filter((seat) => !seat.isPlayer).map((seat) => seat.stack)),
    eventsAfter: table.drainEvents().length,
    phaseAfter: table.phase,
    committedMatches: table.playerCoinsCommitted === committedBeforeHand + contribution,
  };
}

/** Folds whenever folding is allowed, so a player's unmatched bet is never called. */
const FOLDING_BRAIN: PokerSeatBrain = {
  ...PASSIVE_BRAIN,
  decide: (context) => ({
    action: context.legal.canFold ? { kind: 'fold' } : passiveAction(context.legal),
    thinkMs: MIN_THINK_MS,
  }),
};

/** The size of the unmatched raise the player leaves behind, in big blinds. */
const UNCALLED_RAISE_BIG_BLINDS = 25;

function freshTable(streamIndex: number, brain: PokerSeatBrain = PASSIVE_BRAIN): PokerTable {
  return new PokerTable({
    tier: 'card_room',
    brain,
    npcs: npcsFor('card_room'),
    random: stream(FORFEIT_SALT + streamIndex),
  });
}

function forfeitScenarios(streamIndex: number): ForfeitOutcome[] {
  const outcomes: ForfeitOutcome[] = [];

  {
    const table = freshTable(streamIndex);
    const betPreflop = playUntil(table, () => table.awaitingPlayer && table.board.length === 0);
    const legal = table.playerLegalActions();
    if (legal?.raise) table.playerAct({ kind: 'raise', amount: legal.raise.min });
    const reached =
      betPreflop && playUntil(table, () => table.awaitingPlayer && table.board.length > 0);
    outcomes.push(
      forfeit('live after raising, on the flop', table, reached && table.playerContribution > 0),
    );
  }
  {
    const table = freshTable(streamIndex);
    const reached = playUntil(table, () => table.awaitingPlayer);
    table.playerAct({ kind: 'all_in' });
    outcomes.push(
      forfeit('all-in', table, reached && table.isPlayerLive() && table.playerStack === 0),
    );
  }
  for (const blind of ['small', 'big'] as const) {
    const table = freshTable(streamIndex);
    const blindSeat = (): number => (blind === 'small' ? table.smallBlindSeat : table.bigBlindSeat);
    const reached = playUntil(
      table,
      () => table.phase === 'posting_blinds' && blindSeat() === PLAYER_SEAT,
    );
    outcomes.push(
      forfeit(
        `in the ${blind} blind, before acting`,
        table,
        reached && table.playerContribution > 0,
      ),
    );
  }
  for (const shove of [false, true]) {
    const table = freshTable(streamIndex, FOLDING_BRAIN);
    const reached = playUntil(table, () => table.awaitingPlayer && table.board.length === 0);
    const legal = table.playerLegalActions();
    const raiseTo = legal?.raise
      ? Math.min(
          legal.raise.max,
          Math.max(legal.raise.min, table.stakes.bigBlind * UNCALLED_RAISE_BIG_BLINDS),
        )
      : null;
    const acted = shove
      ? table.playerAct({ kind: 'all_in' })
      : raiseTo === null
        ? 'no raise available'
        : table.playerAct({ kind: 'raise', amount: raiseTo });
    outcomes.push(
      forfeit(
        `${shove ? 'shoved' : 'raised'} and left before the folding NPCs answered`,
        table,
        reached && acted === null && table.isPlayerLive(),
      ),
    );
  }
  {
    const table = freshTable(streamIndex);
    const reached = playUntil(
      table,
      () => table.handNumber >= 1 && table.phase === 'between_hands',
    );
    outcomes.push(forfeit('between hands', table, reached && table.playerContribution === 0));
  }
  return outcomes;
}

function checkForfeit(): void {
  section(`Leaving mid-hand: forfeit math across ${FORFEIT_STREAMS} streams`);
  const byDescription = new Map<string, ForfeitOutcome[]>();
  for (let s = 0; s < FORFEIT_STREAMS; s++) {
    for (const outcome of forfeitScenarios(s)) {
      byDescription.set(outcome.description, [
        ...(byDescription.get(outcome.description) ?? []),
        outcome,
      ]);
    }
  }
  for (const [description, outcomes] of byDescription) {
    const reached = outcomes.every((o) => o.reached);
    const returnsStack = outcomes.every((o) => o.returned === o.stackBefore);
    const potStays = outcomes.every((o) => o.npcStacksAfter === o.npcChipsBefore + o.contribution);
    const closed = outcomes.every((o) => o.eventsAfter === 0 && o.phaseAfter === 'left');
    const committed = outcomes.every((o) => o.committedMatches);
    check(reached, `${description}: scenario reached on every stream`);
    check(returnsStack, `${description}: the purse gets exactly the remaining stack`);
    check(
      potStays,
      `${description}: the player's contribution stays in the pot and goes to the table`,
    );
    check(closed, `${description}: the hand resolves instantly with no events left to drain`);
    check(committed, `${description}: the wager tally counts exactly the chips left in the pot`);
  }
}

// ── 7. Guards and pacing ───────────────────────────────────────────────────

/**
 * Heads-up, the button posts the small blind and acts first before the flop;
 * the big blind acts first after it. Played with the button on both seats.
 */
function checkHeadsUp(): void {
  const headsUpOnly: PokerSeatManager = {
    betweenHands: (table) => {
      for (const seat of table.seats) {
        if (!seat.isPlayer && seat.index !== HEADS_UP_OPPONENT) table.vacateSeat(seat.index);
      }
    },
  };
  let labelFaults = 0;
  let labelsChecked = 0;
  const labelling: PokerSeatBrain = {
    ...PASSIVE_BRAIN,
    decide: (context) => {
      const dealt = context.seats.filter((seat) => seat.inHand).length;
      const expected = context.seat === context.buttonSeat ? 'button' : 'big_blind';
      labelsChecked++;
      if (seatPosition(context.positionFromButton, dealt) !== expected) labelFaults++;
      return PASSIVE_BRAIN.decide(context);
    },
  };
  const table = new PokerTable({
    tier: 'card_room',
    brain: labelling,
    npcs: npcsFor('card_room'),
    random: stream(GUARD_SALT + HEADS_UP_SALT_OFFSET),
    seatManager: headsUpOnly,
  });
  let hands = 0;
  let blindFaults = 0;
  let preflopFaults = 0;
  let postflopFaults = 0;
  let postflopChecked = 0;
  const buttonsSeen = new Set<number>();
  let firstActorThisStreet: number | null = null;
  let street: 'preflop' | 'post' = 'preflop';
  const noteActor = (seat: number): void => {
    if (firstActorThisStreet !== null) return;
    firstActorThisStreet = seat;
    if (street === 'preflop' && seat !== table.buttonSeat) preflopFaults++;
    if (street === 'post') {
      postflopChecked++;
      if (seat !== table.bigBlindSeat) postflopFaults++;
    }
  };
  for (
    let frame = 0;
    frame < MAX_FRAMES_PER_HAND * HEADS_UP_HANDS && hands < HEADS_UP_HANDS;
    frame++
  ) {
    const legal = table.playerLegalActions();
    if (legal !== null) {
      noteActor(PLAYER_SEAT);
      table.playerAct(passiveAction(legal));
    }
    if (table.phase === 'player_busted') table.rebuy();
    table.update(FRAME_MS);
    for (const event of table.drainEvents()) {
      if (event.kind === 'shuffled') {
        street = 'preflop';
        firstActorThisStreet = null;
        buttonsSeen.add(table.buttonSeat);
      }
      if (event.kind === 'blind_posted') {
        const expected =
          event.blind === 'small' ? table.buttonSeat : headsUpOther(table.buttonSeat);
        if (event.seat !== expected) blindFaults++;
      }
      if (event.kind === 'street_dealt') {
        street = 'post';
        firstActorThisStreet = null;
      }
      if (event.kind === 'action') noteActor(event.seat);
      if (event.kind === 'hand_complete') hands++;
    }
  }
  check(
    hands === HEADS_UP_HANDS &&
      buttonsSeen.size === HEADS_UP_SEATS &&
      table.seatsDealt === HEADS_UP_SEATS,
    `${hands} heads-up hands dealt with the button on both seats`,
  );
  check(blindFaults === 0, `heads-up the button posts the small blind (${blindFaults} faults)`);
  check(
    labelsChecked > 0 && labelFaults === 0,
    `heads-up a regular reads its own seat as the button or the big blind (${labelsChecked} decisions, ${labelFaults} misnamed)`,
  );
  check(
    preflopFaults === 0,
    `heads-up the button acts first before the flop (${preflopFaults} faults)`,
  );
  check(
    postflopChecked > 0 && postflopFaults === 0,
    `heads-up the big blind acts first after the flop (${postflopChecked} streets, ${postflopFaults} faults)`,
  );
}

/** Every position's name, clockwise from the button, at each table size a game can shrink to. */
const SEAT_NAMES_BY_TABLE_SIZE: ReadonlyArray<readonly [number, ReadonlyArray<SeatPosition>]> = [
  [HEADS_UP_SEATS, ['button', 'big_blind']],
  [HEADS_UP_SEATS + 1, ['button', 'small_blind', 'big_blind']],
  [HEADS_UP_SEATS + 2, ['button', 'small_blind', 'big_blind', 'cutoff']],
  [POKER_SEAT_COUNT - 1, ['button', 'small_blind', 'big_blind', 'middle', 'cutoff']],
  [POKER_SEAT_COUNT, ['button', 'small_blind', 'big_blind', 'under_the_gun', 'middle', 'cutoff']],
];

/** The seat a heads-up test keeps; everyone else stands up before the first hand. */
const HEADS_UP_OPPONENT = 3;
const HEADS_UP_HANDS = 12;
const HEADS_UP_SALT_OFFSET = 3;
const BUST_OUT_SALT_OFFSET = 4;
function headsUpOther(button: number): number {
  return button === PLAYER_SEAT ? HEADS_UP_OPPONENT : PLAYER_SEAT;
}

function checkGuards(): void {
  section('Short-handed tables, heads-up order and the end of a game');
  const vacateOnly: PokerSeatManager = {
    betweenHands: (table) => {
      if (table.handNumber >= CHURN_HAND) table.vacateSeat(CHURN_SEAT);
    },
  };
  const shortTable = new PokerTable({
    tier: 'penny',
    brain: PASSIVE_BRAIN,
    npcs: npcsFor('penny'),
    random: stream(GUARD_SALT),
    seatManager: vacateOnly,
  });
  let shortError = '';
  let shortReached = false;
  try {
    shortReached = playUntil(
      shortTable,
      () => shortTable.handNumber > CHURN_HAND && shortTable.phase === 'preflop',
    );
  } catch (error) {
    shortError = String(error);
  }
  check(
    shortError === '' &&
      shortReached &&
      shortTable.seatsDealt === POKER_SEAT_COUNT - 1 &&
      !shortTable.seats[CHURN_SEAT].inHand,
    `a table with an empty chair deals on to the seats left${shortError ? ` (${shortError})` : ''}`,
  );

  const vacateEveryone: PokerSeatManager = {
    betweenHands: (table) => {
      if (table.handNumber < CHURN_HAND) return;
      for (const seat of table.seats) if (!seat.isPlayer) table.vacateSeat(seat.index);
    },
  };
  const emptiedTable = new PokerTable({
    tier: 'penny',
    brain: PASSIVE_BRAIN,
    npcs: npcsFor('penny'),
    random: stream(GUARD_SALT + 2),
    seatManager: vacateEveryone,
  });
  const endEvents: PokerEvent[] = [];
  for (
    let frame = 0;
    frame < MAX_FRAMES_PER_HAND * CHURN_HAND && emptiedTable.phase !== 'game_over';
    frame++
  ) {
    const legal = emptiedTable.playerLegalActions();
    if (legal !== null) emptiedTable.playerAct(passiveAction(legal));
    emptiedTable.update(FRAME_MS);
    endEvents.push(...emptiedTable.drainEvents().filter((event) => event.kind === 'game_over'));
  }
  const stackAtEnd = emptiedTable.playerStack;
  check(
    emptiedTable.phase === 'game_over' && endEvents.length === 1,
    'the game ends, once, when the last regular leaves the table',
  );
  check(
    emptiedTable.forfeitAndLeave() === stackAtEnd,
    'leaving a finished game cashes out the whole stack',
  );

  // Everyone walks out on the hand that busts the player: the table must say
  // so before asking for a rebuy, so the player never pays into an empty table.
  const walkOutOnBust: PokerSeatManager = {
    betweenHands: (table) => {
      if (table.seats[PLAYER_SEAT].stack > 0) return;
      for (const seat of table.seats) if (!seat.isPlayer) table.vacateSeat(seat.index);
    },
  };
  const bustTable = new PokerTable({
    tier: 'penny',
    brain: PASSIVE_BRAIN,
    npcs: npcsFor('penny'),
    random: stream(GUARD_SALT + BUST_OUT_SALT_OFFSET),
    seatManager: walkOutOnBust,
  });
  let bustEnded = false;
  for (
    let frame = 0;
    frame < MAX_FRAMES_PER_HAND * CHURN_HAND * CHURN_HAND && !bustEnded;
    frame++
  ) {
    const legal = bustTable.playerLegalActions();
    if (legal !== null)
      bustTable.playerAct(legal.allIn !== null ? { kind: 'all_in' } : passiveAction(legal));
    bustTable.update(FRAME_MS);
    bustEnded = bustTable.phase === 'player_busted' || bustTable.phase === 'game_over';
  }
  check(
    bustTable.phase === 'game_over' && bustTable.playerStack === 0 && !bustTable.rebuy(),
    `a bust that empties the table ends the game instead of offering a rebuy (${bustTable.phase})`,
  );

  section('Heads-up order');
  checkHeadsUp();

  section('Seat churn');

  const NEWCOMER = 'newcomer';
  const replacing: PokerSeatManager = {
    betweenHands: (table) => {
      if (table.handNumber !== CHURN_HAND) return;
      table.vacateSeat(CHURN_SEAT);
      table.seatOccupant(CHURN_SEAT, NEWCOMER, table.stakes.buyIn);
    },
  };
  const fullTable = new PokerTable({
    tier: 'penny',
    brain: PASSIVE_BRAIN,
    npcs: npcsFor('penny'),
    random: stream(GUARD_SALT + 1),
    seatManager: replacing,
  });
  const replacedEvents: PokerEvent[] = [];
  let replacementError = '';
  try {
    for (
      let frame = 0;
      frame < MAX_FRAMES_PER_HAND * POKER_SEAT_COUNT && fullTable.handNumber <= CHURN_HAND;
      frame++
    ) {
      const legal = fullTable.playerLegalActions();
      if (legal !== null)
        fullTable.playerAct(legal.canCheck ? { kind: 'check' } : { kind: 'call' });
      fullTable.update(FRAME_MS);
      replacedEvents.push(
        ...fullTable.drainEvents().filter((event) => event.kind === 'seat_replaced'),
      );
    }
  } catch (error) {
    replacementError = String(error);
  }
  check(
    replacementError === '' &&
      replacedEvents.length === 1 &&
      fullTable.seats[CHURN_SEAT].occupantId === NEWCOMER,
    `a vacated seat refilled between hands deals on, with one seat_replaced event${replacementError ? ` (${replacementError})` : ''}`,
  );
  check(!fullTable.vacateSeat(PLAYER_SEAT), 'seat churn never touches the player seat');

  section('Fast and skip pacing');
  const msUntil = (table: PokerTable, done: (event: PokerEvent) => boolean): number => {
    for (let frame = 0; frame < MAX_FRAMES_PER_HAND; frame++) {
      table.update(FRAME_MS);
      if (table.drainEvents().some(done)) return (frame + 1) * FRAME_MS;
    }
    return Number.POSITIVE_INFINITY;
  };
  const pacedTable = (fast: boolean): PokerTable =>
    new PokerTable({
      tier: 'penny',
      brain: PASSIVE_BRAIN,
      npcs: npcsFor('penny'),
      random: stream(SPEED_SALT),
      fast,
    });
  const firstTurn = (event: PokerEvent): boolean => event.kind === 'player_turn';
  const normalToTurn = msUntil(pacedTable(false), firstTurn);
  const fastToTurn = msUntil(pacedTable(true), firstTurn);
  check(
    Number.isFinite(normalToTurn) && fastToTurn < normalToTurn,
    `Fast reaches the player's turn sooner (${fastToTurn} vs ${normalToTurn} ms)`,
  );

  /** Milliseconds to finish the hand after folding, or `null` when the fold never landed. */
  const foldThenTime = (skip: boolean): number | null => {
    const table = pacedTable(false);
    const reached = playUntil(table, () => table.playerLegalActions()?.canFold === true);
    const folded = reached && table.playerAct({ kind: 'fold' }) === null;
    const skipped = !skip || table.skipToNextHand();
    if (!folded || !skipped) return null;
    return msUntil(table, (event) => event.kind === 'hand_complete');
  };
  const normalRest = foldThenTime(false);
  const skippedRest = foldThenTime(true);
  check(
    normalRest !== null &&
      skippedRest !== null &&
      Number.isFinite(normalRest) &&
      skippedRest < normalRest / 2,
    `Skip to next hand finishes the folded hand faster (${skippedRest} vs ${normalRest} ms)`,
  );

  const liveTable = pacedTable(false);
  const liveReached = playUntil(liveTable, () => liveTable.awaitingPlayer);
  check(
    liveReached && liveTable.awaitingPlayer && !liveTable.skipToNextHand(),
    'Skip is refused while the player is still live',
  );
  const nanThinker: PokerSeatBrain = {
    ...PASSIVE_BRAIN,
    decide: (context) => ({ action: passiveAction(context.legal), thinkMs: Number.NaN }),
  };
  const nanTable = new PokerTable({
    tier: 'penny',
    brain: nanThinker,
    npcs: npcsFor('penny'),
    random: stream(SPEED_SALT + 1),
  });
  check(
    playUntil(nanTable, () => nanTable.handNumber > 1),
    'a brain answering with a NaN think time does not freeze the table',
  );
  const stackBeforeRebuy = liveTable.playerStack;
  check(
    liveReached && !liveTable.rebuy() && liveTable.playerStack === stackBeforeRebuy,
    'a rebuy is refused mid-hand and leaves the stack alone',
  );
}

// ── 8. The regulars: real brains and seat churn ────────────────────────────

const REGULAR_STREAMS = 12;
const REGULAR_HANDS_PER_STREAM = 120;
/** Ceiling on games one stream plays to reach its hands. */
const REGULAR_GAMES_PER_STREAM = 50;
const REGULARS_SALT = 7000;
const REGULARS_TABLE_SALT = 7500;
const REGULARS_PLAYER_SALT = 8000;
const REGULARS_WORLD_SEED_SALT = 8500;

/** What happened to a regular's chips after one of their busts, by which bust of the game it was. */
interface BustTally {
  firstRebought: number;
  firstLeft: number;
  laterRebought: number;
  laterLeft: number;
}

/**
 * Watches one game of regulars: who busts and what they do next, and that a
 * chair, once left, stays empty until the game ends.
 */
class GameWatcher {
  private readonly bustsByRegular = new Map<string, number>();
  private readonly pendingBust = new Map<number, number>();
  private readonly emptied = new Set<number>();
  seatingFaults = 0;
  refills = 0;
  walkOuts = 0;

  constructor(
    private readonly table: PokerTable,
    private readonly regulars: PokerRegulars,
    private readonly busts: BustTally,
  ) {}

  observe(event: PokerEvent): void {
    const table = this.table;
    switch (event.kind) {
      case 'shuffled': {
        const seated = table.seats.filter((seat) => !seat.isPlayer && seat.occupantId !== null);
        const ids = seated.map((seat) => seat.occupantId);
        const brainAgrees = table.seats.every(
          (seat) => seat.isPlayer || this.regulars.regularAt(seat.index) === seat.occupantId,
        );
        const distinct = new Set(ids).size === ids.length;
        const allRegulars = ids.every((id) => isRegularId(id));
        if (
          seated.length < 1 ||
          seated.length > NPC_SEAT_COUNT ||
          !distinct ||
          !allRegulars ||
          !brainAgrees
        )
          this.seatingFaults++;
        if ([...this.emptied].some((seat) => table.seats[seat].occupantId !== null)) this.refills++;
        return;
      }
      case 'seat_busted': {
        const nth = (this.bustsByRegular.get(event.occupantId) ?? 0) + 1;
        this.bustsByRegular.set(event.occupantId, nth);
        this.pendingBust.set(event.seat, nth);
        return;
      }
      case 'seat_rebuy': {
        const nth = this.pendingBust.get(event.seat);
        this.pendingBust.delete(event.seat);
        if (nth === 1) this.busts.firstRebought++;
        else if (nth !== undefined) this.busts.laterRebought++;
        return;
      }
      case 'seat_vacated': {
        const nth = this.pendingBust.get(event.seat);
        this.pendingBust.delete(event.seat);
        if (nth === 1) this.busts.firstLeft++;
        else if (nth !== undefined) this.busts.laterLeft++;
        else this.walkOuts++;
        this.emptied.add(event.seat);
        return;
      }
      case 'seat_replaced':
        this.refills++;
        return;
      case 'button_moved':
      case 'blind_posted':
      case 'hole_dealt':
      case 'burn':
      case 'street_dealt':
      case 'action':
      case 'player_turn':
      case 'uncalled_returned':
      case 'bets_collected':
      case 'runout_started':
      case 'showdown_reveal':
      case 'muck':
      case 'uncontested_show':
      case 'pot_awarded':
      case 'hand_complete':
      case 'player_busted':
      case 'player_rebuy':
      case 'game_over':
      case 'banter':
      case 'tell':
        return;
    }
  }
}

function checkRegularsSims(): void {
  section(
    `Regulars at the table: ${REGULAR_STREAMS} seeded streams × ${REGULAR_HANDS_PER_STREAM} hands, real brains and churn`,
  );
  const tally = newTally();
  const busts: BustTally = { firstRebought: 0, firstLeft: 0, laterRebought: 0, laterLeft: 0 };
  let seatingFaults = 0;
  let refills = 0;
  let walkOuts = 0;
  let foreignTells = 0;
  let banter = 0;
  let tells = 0;
  let readsSeen = 0;
  let games = 0;
  let leaversBackNextGame = 0;
  let rebuyCountsCarried = 0;
  for (let s = 0; s < REGULAR_STREAMS; s++) {
    const tier = POKER_TIER_IDS[s % POKER_TIER_IDS.length];
    const worldSeed = subSeed(BASE_SEED, REGULARS_WORLD_SEED_SALT + s);
    const personalities = rollPokerPersonalities(worldSeed);
    const random = stream(REGULARS_SALT + s);
    const tableRandom = stream(REGULARS_TABLE_SALT + s);
    const playerRandom = stream(REGULARS_PLAYER_SALT + s);
    const handsAtStart = tally.hands;
    let leftLastGame: ReadonlySet<RegularId> = new Set();
    for (
      let game = 0;
      game < REGULAR_GAMES_PER_STREAM && tally.hands - handsAtStart < REGULAR_HANDS_PER_STREAM;
      game++
    ) {
      games++;
      const { table, regulars } = createRegularsTable({
        tier,
        worldSeed,
        personalities,
        random,
        tableRandom,
      });
      const seatedAgain = table.seats.some(
        (seat) => isRegularId(seat.occupantId) && leftLastGame.has(seat.occupantId),
      );
      if (seatedAgain) leaversBackNextGame++;
      if (REGULAR_IDS.some((id) => regulars.rebuysThisGame(id) !== 0)) rebuyCountsCarried++;
      const watcher = new GameWatcher(table, regulars, busts);
      const onEvent = (event: PokerEvent): void => {
        watcher.observe(event);
        if (event.kind === 'banter') banter++;
        if (event.kind === 'tell') {
          tells++;
          if (regulars.regularAt(event.seat) === null) foreignTells++;
        }
      };
      playStream(
        `regulars ${tier} stream ${s} game ${game}`,
        table,
        playerRandom,
        tally,
        REGULAR_HANDS_PER_STREAM - (tally.hands - handsAtStart),
        onEvent,
      );
      seatingFaults += watcher.seatingFaults;
      refills += watcher.refills;
      walkOuts += watcher.walkOuts;
      readsSeen += Object.values(regulars.reads).filter((read) => read.handsSeen > 0).length;
      leftLastGame = regulars.leftThisGame;
    }
  }
  check(
    tally.errors.length === 0,
    `no table errors, stalls or illegal NPC actions${tally.errors.length > 0 ? `: ${tally.errors.slice(0, ERRORS_SHOWN).join('; ')}` : ''}`,
  );
  check(
    tally.hands === REGULAR_STREAMS * REGULAR_HANDS_PER_STREAM,
    `${tally.hands} hands completed over ${games} games`,
  );
  check(
    tally.chipLeaks === 0 && tally.awardFaults === 0 && tally.crossHandLeaks === 0,
    `chips are conserved and fully awarded every hand, and reconcile between hands as the table shrinks (${tally.chipLeaks} leaks, ${tally.awardFaults} award faults, ${tally.crossHandLeaks} between hands)`,
  );
  check(
    tally.duplicateCards === 0 && tally.deckFaults === 0 && tally.potWinnerFaults === 0,
    `no repeated cards, a fresh deck every hand and every pot to its best hand (${tally.duplicateCards}, ${tally.deckFaults}, ${tally.potWinnerFaults})`,
  );
  check(
    tally.buttonFaults === 0 && tally.blindFaults === 0 && tally.shortHanded === 0,
    `button, blinds and deals hold as seats empty (${tally.buttonFaults}, ${tally.blindFaults}, ${tally.shortHanded})`,
  );
  check(
    tally.shortHandedHands > 0 && tally.headsUpHands > 0,
    `the table plays short-handed (${tally.shortHandedHands} hands) and heads-up (${tally.headsUpHands} hands)`,
  );
  for (const result of playerActionChecks(tally)) report(result);
  check(
    seatingFaults === 0,
    `one to ${NPC_SEAT_COUNT} distinct regulars sit when every hand starts, and the brain agrees who they are (${seatingFaults} faults)`,
  );
  check(
    tally.rebuyAmountFaults === 0 && tally.npcRebuys > 0,
    `every regular's rebuy is exactly the table's buy-in (${tally.npcRebuys} rebuys, ${tally.rebuyAmountFaults} off)`,
  );
  check(
    busts.firstLeft === 0 && busts.firstRebought > 0,
    `a regular's first bust of a game always buys back in (${busts.firstRebought} rebought, ${busts.firstLeft} left)`,
  );
  check(
    busts.laterRebought > 0 && busts.laterLeft > 0,
    `a later bust sometimes rebuys (${busts.laterRebought}) and sometimes leaves (${busts.laterLeft})`,
  );
  check(
    refills === 0 && walkOuts + busts.laterLeft > 0,
    `no chair a regular leaves is refilled within a game, whether they busted out or walked out (${busts.laterLeft + walkOuts} departures, ${refills} refilled)`,
  );
  check(
    leaversBackNextGame > 0 && rebuyCountsCarried === 0,
    `a new game starts every regular with no rebuys (${rebuyCountsCarried} carried over), and a regular who left the last game can sit in it (${leaversBackNextGame} games)`,
  );
  check(
    tally.gameOvers > 0 && tally.gameOverFaults === 0,
    `games end when the last regular leaves (${tally.gameOvers} ended, ${tally.gameOverFaults} with a regular still seated)`,
  );
  check(
    banter > 0 && tells > 0 && foreignTells === 0,
    `regulars banter (${banter}) and show tells (${tells}), only from their own seats (${foreignTells} stray)`,
  );
  check(readsSeen > 0, `regulars build reads of the player (${readsSeen} non-empty reads)`);
}

// ── 9. Seeded personalities ────────────────────────────────────────────────

const PERSONALITY_SEEDS = 300;
const PERSONALITY_SEED_SALT = 9000;
const SELECTION_SALT = 9500;
/** "Several" archetypes per regular across the sweep. */
const MIN_ARCHETYPES_PER_REGULAR = 4;
const MIN_TELL_SETS_PER_REGULAR = 3;
const MAX_PER_ARCHETYPE = 2;
const PENNY_SOFT_REQUIRED = 2;
const SOFT_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>([
  'recreational',
  'calling_station',
  'old_timer',
]);
const STRONG_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(['tag_reg', 'lag']);

function tableRuleBreaks(
  personalities: PokerPersonalities,
  tier: PokerTierId,
  table: ReadonlyArray<RegularId>,
): string | null {
  if (table.length !== NPC_SEAT_COUNT || new Set(table).size !== NPC_SEAT_COUNT)
    return `seats ${table.length}`;
  const seated = table.map((id) => personalities[id]);
  const counts = new Map<Archetype, number>();
  for (const seat of seated) counts.set(seat.archetype, (counts.get(seat.archetype) ?? 0) + 1);
  if ([...counts.values()].some((count) => count > MAX_PER_ARCHETYPE))
    return 'three of an archetype';
  if (!seated.some((seat) => seat.profile.vpip >= LOOSE_VPIP_AT)) return 'no loose player';
  if (!seated.some((seat) => seat.profile.vpip <= TIGHT_VPIP_AT)) return 'no tight player';
  if (tier === 'high_rollers' && !seated.some((seat) => STRONG_ARCHETYPES.has(seat.archetype)))
    return 'no strong regular at the high rollers';
  if (
    tier === 'penny' &&
    seated.filter((seat) => SOFT_ARCHETYPES.has(seat.archetype)).length < PENNY_SOFT_REQUIRED
  )
    return 'too few soft players at the penny table';
  return null;
}

function tellSignature(personalities: PokerPersonalities, id: RegularId): string {
  return JSON.stringify(personalities[id].tells.map((tell) => [tell.signal, tell.polarity]));
}

function checkPersonalities(): void {
  section(`Seeded personalities: ${PERSONALITY_SEEDS} world seeds`);
  const sample = subSeed(BASE_SEED, PERSONALITY_SEED_SALT);
  check(
    JSON.stringify(rollPokerPersonalities(sample)) ===
      JSON.stringify(rollPokerPersonalities(sample)),
    'the same seed rolls deep-equal personalities twice',
  );

  const realRandom = Math.random;
  let touchedMathRandom = false;
  Math.random = () => {
    touchedMathRandom = true;
    throw new Error('the personality roll called Math.random');
  };
  try {
    rollPokerPersonalities(sample);
  } catch {
    touchedMathRandom = true;
  } finally {
    Math.random = realRandom;
  }
  check(!touchedMathRandom, 'the roll never calls Math.random');

  const archetypesOf = new Map<RegularId, Set<Archetype>>();
  const tellSetsOf = new Map<RegularId, Set<string>>();
  let seedsMissingArchetypes = 0;
  const ruleBreaks: string[] = [];
  const selectionRng = stream(SELECTION_SALT);
  for (let i = 0; i < PERSONALITY_SEEDS; i++) {
    const seed = subSeed(BASE_SEED, PERSONALITY_SEED_SALT + 1 + i);
    const personalities = rollPokerPersonalities(seed);
    const present = new Set(REGULAR_IDS.map((id) => personalities[id].archetype));
    if (ARCHETYPES.some((archetype) => !present.has(archetype))) seedsMissingArchetypes++;
    for (const id of REGULAR_IDS) {
      const archetypes = archetypesOf.get(id) ?? new Set<Archetype>();
      archetypes.add(personalities[id].archetype);
      archetypesOf.set(id, archetypes);
      const tellSets = tellSetsOf.get(id) ?? new Set<string>();
      tellSets.add(tellSignature(personalities, id));
      tellSetsOf.set(id, tellSets);
    }
    for (const tier of POKER_TIER_IDS) {
      const broken = tableRuleBreaks(
        personalities,
        tier,
        selectTable(personalities, tier, selectionRng),
      );
      if (broken !== null) ruleBreaks.push(`seed ${seed} ${tier}: ${broken}`);
    }
  }
  const fewestArchetypes = Math.min(...REGULAR_IDS.map((id) => archetypesOf.get(id)?.size ?? 0));
  const fewestTellSets = Math.min(...REGULAR_IDS.map((id) => tellSetsOf.get(id)?.size ?? 0));
  check(
    fewestArchetypes >= MIN_ARCHETYPES_PER_REGULAR,
    `every regular plays several archetypes across seeds (fewest ${fewestArchetypes})`,
  );
  check(
    fewestTellSets >= MIN_TELL_SETS_PER_REGULAR,
    `every regular gets different tells across seeds (fewest ${fewestTellSets} distinct sets)`,
  );
  check(
    seedsMissingArchetypes === 0,
    `every seed has all ten archetypes (${seedsMissingArchetypes} short)`,
  );
  check(
    ruleBreaks.length === 0,
    `every seed seats a table that meets every tier's rules${ruleBreaks.length > 0 ? `: ${ruleBreaks.slice(0, ERRORS_SHOWN).join('; ')}` : ''}`,
  );
}

// ── 10. Decide: purity and legality ────────────────────────────────────────

const DECIDE_SALT = 10000;
/** Keeps the legalize probes' stream apart from the decide streams before it. */
const LEGALIZE_SALT_OFFSET = 3;
const DECIDE_CONTEXTS = 40;
/** Multiway: an equity run against three or more ranges, the hardest spot to decide. */
const MULTIWAY_OPPONENTS = 3;
const LEGALIZE_PROBES = 4000;
const BET_TELL_SALT_OFFSET = 50000;
const BET_TELL_SEEDS = 25;
const BET_TELL_RELIABILITY = 0.9;

interface CapturedSpot {
  readonly context: PokerDecisionContext;
  readonly regularId: RegularId;
}

/** Real multiway postflop spots, captured from a seeded table as regulars meet them. */
function captureMultiwaySpots(): {
  spots: CapturedSpot[];
  regulars: PokerRegulars;
  personalities: PokerPersonalities;
} {
  const spots: CapturedSpot[] = [];
  const personalities = rollPokerPersonalities(subSeed(BASE_SEED, DECIDE_SALT));
  const random = stream(DECIDE_SALT);
  const seated = selectTable(personalities, 'card_room', random);
  const regulars = new PokerRegulars({ tier: 'card_room', personalities, seated, random });
  const capturing: PokerSeatBrain = {
    decide: (context) => {
      const regularId = regulars.regularAt(context.seat);
      if (
        regularId !== null &&
        context.street !== 'preflop' &&
        context.liveOpponents >= MULTIWAY_OPPONENTS &&
        spots.length < DECIDE_CONTEXTS
      ) {
        spots.push({ context, regularId });
      }
      return regulars.decide(context);
    },
    showsLosingHand: (context) => regulars.showsLosingHand(context),
    uncontestedShow: (context) => regulars.uncontestedShow(context),
    observe: (event, table) => regulars.observe(event, table),
  };
  const table = new PokerTable({
    tier: 'card_room',
    brain: capturing,
    // No seat manager: busted regulars simply reload, so the table stays
    // full and keeps offering multiway pots to capture.
    npcs: seated.map((occupantId) => ({ occupantId, stack: regulars.buyInFor(occupantId) })),
    random: stream(DECIDE_SALT + 1),
  });
  for (
    let frame = 0;
    frame < MAX_FRAMES_PER_HAND * HANDS_PER_STREAM && spots.length < DECIDE_CONTEXTS;
    frame++
  ) {
    const legal = table.playerLegalActions();
    // The player calls everything so pots stay multiway.
    if (legal !== null) table.playerAct(passiveAction(legal));
    if (table.phase === 'player_busted') table.rebuy();
    table.update(FRAME_MS);
    table.drainEvents();
  }
  return { spots, regulars, personalities };
}

function checkDecide(): void {
  section('Seat names by table size');
  for (const [size, expected] of SEAT_NAMES_BY_TABLE_SIZE) {
    const named = expected.map((_, position) => seatPosition(position, size));
    check(
      named.every((name, position) => name === expected[position]),
      `${size} dealt in: ${named.join(', ')}`,
    );
  }

  section('Decide: purity, legality and timing');
  const { spots, personalities } = captureMultiwaySpots();
  check(spots.length === DECIDE_CONTEXTS, `captured ${spots.length} multiway postflop spots`);

  const decideFresh = (spot: CapturedSpot, seed: number): ReturnType<typeof decide> => {
    const personality = personalities[spot.regularId];
    const profile = effectiveProfile(personality.profile, CALM_MOOD, {
      archetype: personality.archetype,
      stackBigBlinds: spot.context.seats[spot.context.seat].stack / spot.context.stakes.bigBlind,
      tier: spot.context.tier,
      sessionNetBigBlinds: 0,
      facingTarget: false,
    });
    return decide(spot.context, profile, CALM_MOOD, EMPTY_PLAYER_READ, mulberry32(seed), {
      archetype: personality.archetype,
      tells: personality.tells,
      opponents: [],
    });
  };
  let impure = 0;
  let illegal = 0;
  spots.forEach((spot, index) => {
    const first = decideFresh(spot, DECIDE_SALT + index);
    const second = decideFresh(spot, DECIDE_SALT + index);
    if (JSON.stringify(first) !== JSON.stringify(second)) impure++;
    if (!isLegal(first.action, spot.context.legal)) illegal++;
  });
  check(impure === 0, `the same inputs and seed give the same decision (${impure} differ)`);
  check(illegal === 0, `every decision is legal at the moment it is made (${illegal} illegal)`);

  // A "bets big" tell must never shrink the bet it rides on: with the same
  // decision stream, the told raise is at least the untold one.
  const BIG_BET_TELL: PokerTell = {
    signal: { kind: 'bet_size', size: 'big' },
    polarity: 'strength',
    reliability: BET_TELL_RELIABILITY,
  };
  let toldRaises = 0;
  let shrunk = 0;
  const raiseSize = (action: PokerAction, legal: LegalActions): number => {
    if (action.kind === 'bet' || action.kind === 'raise') return action.amount;
    if (action.kind === 'all_in') return legal.allIn ?? 0;
    return 0;
  };
  for (const sizing of ['standard', 'erratic'] as const) {
    spots.forEach((spot, index) => {
      const personality = personalities[spot.regularId];
      const profile = {
        ...effectiveProfile(personality.profile, CALM_MOOD, {
          archetype: personality.archetype,
          stackBigBlinds:
            spot.context.seats[spot.context.seat].stack / spot.context.stakes.bigBlind,
          tier: spot.context.tier,
          sessionNetBigBlinds: 0,
          facingTarget: false,
        }),
        sizing,
      };
      for (let seedOffset = 0; seedOffset < BET_TELL_SEEDS; seedOffset++) {
        const seed = DECIDE_SALT + BET_TELL_SALT_OFFSET + index * BET_TELL_SEEDS + seedOffset;
        const withTells = (tells: ReadonlyArray<PokerTell>): ReturnType<typeof decide> =>
          decide(spot.context, profile, CALM_MOOD, EMPTY_PLAYER_READ, mulberry32(seed), {
            archetype: personality.archetype,
            tells,
            opponents: [],
          });
        const told = withTells([BIG_BET_TELL]);
        if (!told.cues.some((cue) => cue.kind === 'bet_size')) continue;
        const untold = withTells([]);
        toldRaises++;
        if (
          raiseSize(told.action, spot.context.legal) < raiseSize(untold.action, spot.context.legal)
        )
          shrunk++;
      }
    });
  }
  check(
    toldRaises > 0 && shrunk === 0,
    `a firing "bets big" tell never makes the bet smaller (${toldRaises} told raises, ${shrunk} smaller)`,
  );

  const legalizeRng = stream(DECIDE_SALT + LEGALIZE_SALT_OFFSET);
  let unlawful = 0;
  for (let probe = 0; probe < LEGALIZE_PROBES; probe++) {
    const spot = pick(legalizeRng, spots);
    const wild: PokerAction = pick(legalizeRng, [
      { kind: 'fold' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'all_in' },
      { kind: 'bet', amount: rangeInt(legalizeRng, -DEEP, DEEP * DEEP) },
      { kind: 'raise', amount: rangeInt(legalizeRng, -DEEP, DEEP * DEEP) },
    ]);
    if (!isLegal(legalize(wild, spot.context.legal), spot.context.legal)) unlawful++;
  }
  check(
    unlawful === 0,
    `legalize turns any wish into a legal action (${unlawful} of ${LEGALIZE_PROBES} not)`,
  );
}

// ── 11. Long sessions: who sits after the reserve runs out, and honest tells ──

const LONG_STREAMS = 3;
const LONG_HANDS_PER_STREAM = 1500;
const LONG_SALT = 11000;
/** Equity is not what these sims measure, so a cheap estimate keeps 4,500 hands quick. */
const LONG_EQUITY_ITERATIONS = 60;
/** A tell group needs this many firings before its truthful share is more than noise. */
const TELL_MIN_FIRINGS = 150;
/** How far a group's truthful share may sit from its tells' reliability. */
const TELL_TRUTH_TOLERANCE = 0.1;
const MIN_TELL_GROUPS_MEASURED = 3;

interface TellGroup {
  fired: number;
  truthful: number;
  expectedTruthful: number;
}

/** Adds every regular's tell firings to its kind × polarity group, with what its reliability promised. */
function addTellGroups(groups: Map<string, TellGroup>, regulars: PokerRegulars): void {
  for (const id of REGULAR_IDS) {
    const tally = regulars.tellTally(id);
    for (const tell of regulars.personalityOf(id).tells) {
      const key = `${tell.signal.kind} on ${tell.polarity}`;
      const group = groups.get(key) ?? { fired: 0, truthful: 0, expectedTruthful: 0 };
      const counts = tally[tell.signal.kind];
      group.fired += counts.fired;
      group.truthful += counts.truthful;
      group.expectedTruthful += counts.fired * tell.reliability;
      groups.set(key, group);
    }
  }
}

function checkTellCalibration(groups: ReadonlyMap<string, TellGroup>, when: string): void {
  const measured = [...groups.entries()].filter(([, group]) => group.fired >= TELL_MIN_FIRINGS);
  const off = measured
    .map(([key, group]) => ({
      key,
      share: group.truthful / group.fired,
      expected: group.expectedTruthful / group.fired,
    }))
    .filter((entry) => Math.abs(entry.share - entry.expected) > TELL_TRUTH_TOLERANCE);
  check(
    measured.length >= MIN_TELL_GROUPS_MEASURED && off.length === 0,
    `${when}, a fired tell is truthful about as often as its reliability says (${measured.length} groups measured${off.length > 0 ? `; off: ${off.map((entry) => `${entry.key} ${entry.share.toFixed(REPORT_DECIMALS)} vs ${entry.expected.toFixed(REPORT_DECIMALS)}`).join(', ')}` : ''})`,
  );
}

/**
 * A visit's worth of play per table, each with fresh condition counts, so the
 * tells must be honest from the first hands on, while the prior still
 * carries most of the weight. Aggregated across many seeds and tables so one
 * unlucky table cannot flip the verdict.
 */
const VISIT_STREAMS = 40;
const VISIT_HANDS = 60;
const VISIT_SALT = 12000;
/** Tells are rare enough per visit that only the common groups reach the firing floor. */
const MIN_VISIT_TELL_GROUPS = 6;

function checkVisitTellCalibration(): void {
  section(`Tells over single visits: ${VISIT_STREAMS} tables × ${VISIT_HANDS} hands`);
  const groups = new Map<string, TellGroup>();
  for (let s = 0; s < VISIT_STREAMS; s++) {
    const { table, regulars } = createRegularsTable({
      tier: POKER_TIER_IDS[s % POKER_TIER_IDS.length],
      worldSeed: subSeed(BASE_SEED, VISIT_SALT + s),
      random: stream(VISIT_SALT + s),
      equityIterations: LONG_EQUITY_ITERATIONS,
    });
    for (
      let frame = 0;
      frame < VISIT_HANDS * MAX_FRAMES_PER_HAND &&
      table.handNumber <= VISIT_HANDS &&
      table.phase !== 'game_over';
      frame++
    ) {
      foldingPlayer(table);
      if (table.phase === 'player_busted') table.rebuy();
      table.update(FRAME_MS);
      table.drainEvents();
    }
    addTellGroups(groups, regulars);
  }
  const measured = [...groups.values()].filter((group) => group.fired >= TELL_MIN_FIRINGS).length;
  check(
    measured >= MIN_VISIT_TELL_GROUPS,
    `${measured} tell groups fire often enough within visits to judge`,
  );
  checkTellCalibration(groups, 'within single visits');
}

/** A player who never plays a hand, so the regulars play every pot among themselves. */
function foldingPlayer(table: PokerTable): void {
  const legal = table.playerLegalActions();
  if (legal !== null) table.playerAct(legal.canCheck ? { kind: 'check' } : { kind: 'fold' });
}

function checkLongSessions(): void {
  section(
    `Long sessions: ${LONG_STREAMS} streams × ${LONG_HANDS_PER_STREAM} hands with a folding player`,
  );
  let refills = 0;
  let errors: string[] = [];
  const groups = new Map<string, TellGroup>();
  for (let s = 0; s < LONG_STREAMS; s++) {
    const tier = POKER_TIER_IDS[s % POKER_TIER_IDS.length];
    const worldSeed = subSeed(BASE_SEED, LONG_SALT + s);
    const personalities = rollPokerPersonalities(worldSeed);
    const random = stream(LONG_SALT + s);
    const newGame = (): ReturnType<typeof createRegularsTable> =>
      createRegularsTable({
        tier,
        worldSeed,
        personalities,
        random,
        equityIterations: LONG_EQUITY_ITERATIONS,
      });
    let game = newGame();
    let emptied = new Set<number>();
    let hands = 0;
    try {
      for (
        let frame = 0;
        frame < LONG_HANDS_PER_STREAM * MAX_FRAMES_PER_HAND && hands < LONG_HANDS_PER_STREAM;
        frame++
      ) {
        if (game.table.phase === 'game_over') {
          addTellGroups(groups, game.regulars);
          game = newGame();
          emptied = new Set<number>();
        }
        const { table } = game;
        foldingPlayer(table);
        if (table.phase === 'player_busted') table.rebuy();
        table.update(FRAME_MS);
        for (const event of table.drainEvents()) {
          if (event.kind === 'hand_complete') hands++;
          if (event.kind === 'seat_vacated') emptied.add(event.seat);
          if (event.kind === 'seat_replaced') refills++;
          const refilled = [...emptied].some((seat) => table.seats[seat].occupantId !== null);
          if (event.kind === 'shuffled' && refilled) refills++;
        }
      }
    } catch (error) {
      errors = [...errors, `stream ${s}: ${String(error)}`];
    }
    if (hands < LONG_HANDS_PER_STREAM) errors = [...errors, `stream ${s}: stalled`];
    addTellGroups(groups, game.regulars);
  }
  check(
    errors.length === 0,
    `long sessions run clean${errors.length > 0 ? `: ${errors.join('; ')}` : ''}`,
  );
  check(refills === 0, `no chair is refilled within a game over long sessions (${refills})`);
  checkTellCalibration(groups, 'over long sessions');

  const personalities = rollPokerPersonalities(subSeed(BASE_SEED, LONG_SALT));

  section('Tilt targets');
  const stung = moodAfterHand(
    CALM_MOOD,
    {
      netBigBlinds: -BIG_LOSS_BIG_BLINDS,
      wonPot: false,
      voluntarilyPlayed: true,
      lostWithEquity: null,
      shownBluff: false,
      beatenBy: { seat: PLAYER_SEAT, occupant: 'player' },
    },
    personalities.wren.profile,
  );
  check(
    stung.target?.occupant === 'player',
    'a big loss alone makes the regular target whoever beat them',
  );
}

// ── Banter pacing ──────────────────────────────────────────────────────────

/** A hand in which someone has already spoken. */
const BANTER_HAND = 20;

/**
 * A chair changing hands is always explained, even in a hand where a regular
 * has already spoken; an ordinary remark in that hand still waits.
 */
function checkBanterPacing(): void {
  section('Banter pacing');
  const spoke = { lastSpokenHand: BANTER_HAND };
  const offer = (trigger: PokerBanterTrigger): boolean =>
    paceBanter(spoke, { trigger, handNumber: BANTER_HAND, chattiness: 1 }, 0).speak;
  check(offer('leaving'), 'a leaving line is spoken in a hand that already had a line');
  check(offer('rebuy'), 'a rebuy line is spoken in a hand that already had a line');
  check(!offer('big_pot_win'), 'an ordinary remark waits when the hand already had a line');
}

// ── New game at the host ───────────────────────────────────────────────────

const HOST_SALT = 15000;
const HOST_STEP_MS = 50;
const HOST_MAX_STEPS = 200000;
/** Enough for several penny buy-ins, so a new game is always affordable. */
const HOST_PURSE_BUY_INS = 5;

/**
 * Through the real host: plays until a regular has rebought, empties the
 * table between hands so the game ends, then starts a new game. The stack is
 * cashed out exactly as leaving does it and the next buy-in taken, and the
 * new lineup starts with no rebuys.
 */
function checkNewGameHost(): void {
  section('A new game through the host');
  let now = 0;
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  const companion = new CatPlayer(1, 0, TILE_SIZE);
  const tier = POKER_STAKES.penny;
  player.coins = tier.buyIn * HOST_PURSE_BUY_INS;
  companion.coins = 0;
  const poker = new ClubPokerSystem(
    null,
    POKER_DEV_SEED,
    () => now,
    stream(HOST_SALT),
    { pokerFast: true, pokerShowCards: false, pokerReads: {}, pokerNotes: {} },
    stream(HOST_SALT + 1),
  );
  poker.buyIn('penny', player, companion);
  poker.dismissRules();
  const someoneRebought = (): boolean =>
    REGULAR_IDS.some((id) => (poker.regulars?.rebuysThisGame(id) ?? 0) > 0);
  let emptied = false;
  for (let i = 0; i < HOST_MAX_STEPS && poker.pokerTable?.phase !== 'game_over'; i++) {
    const table = poker.pokerTable;
    if (table === null) break;
    if (table.phase === 'player_busted') poker.rebuy(player, companion);
    const legal = table.playerLegalActions();
    if (legal !== null) poker.act(legal.allIn !== null ? { kind: 'all_in' } : passiveAction(legal));
    if (!emptied && someoneRebought() && table.phase === 'between_hands') {
      for (const seat of table.seats) if (!seat.isPlayer) table.vacateSeat(seat.index);
      emptied = true;
    }
    now += HOST_STEP_MS;
    poker.update();
  }
  const oldTable = poker.pokerTable;
  check(
    emptied && oldTable?.phase === 'game_over',
    'a regular rebought, then the last regular left and the game ended',
  );
  const purseBefore = partyCoins(player, companion);
  const stack = oldTable?.playerStack ?? 0;
  const started = poker.newGame(player, companion);
  const newTable = poker.pokerTable;
  check(
    started && newTable !== null && newTable !== oldTable && newTable.phase === 'between_hands',
    'New game seats the player at a fresh table',
  );
  check(
    partyCoins(player, companion) === purseBefore + stack - tier.buyIn &&
      newTable?.playerStack === tier.buyIn,
    `the stack is cashed out and the buy-in taken again (${purseBefore} + ${stack} − ${tier.buyIn} → ${partyCoins(player, companion)})`,
  );
  const seatedRegulars = newTable?.seats.filter((seat) => isRegularId(seat.occupantId)).length;
  check(
    seatedRegulars === NPC_SEAT_COUNT && !someoneRebought(),
    `the new game seats a full lineup with every rebuy count back at zero (${seatedRegulars} seated)`,
  );
}

// ── Save fields ────────────────────────────────────────────────────────────

/** Object keys sorted, so two values compare equal whatever order their keys were written in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    return Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)));
  });
}

/** Through JSON and back, the way a save actually travels. */
function viaSave(value: unknown): ClubMembershipCheckpoint | undefined {
  const saved: unknown = JSON.parse(JSON.stringify(value));
  return parseClubMembershipCheckpoint(saved);
}

const SAMPLE_READ: PlayerRead = {
  handsSeen: 64,
  hands: 41.5,
  vpipHands: 12.25,
  pfrHands: 6,
  aggressiveActions: 18,
  passiveActions: 22.75,
  sawFlop: 15,
  wentToShowdown: 7,
  showdownsShown: 5,
  bluffsShown: 2,
};
const SECOND_READ: PlayerRead = { ...SAMPLE_READ, handsSeen: 9, bluffsShown: 0 };

/** A pool grown past its floor, with the fraction of a coin it keeps between spins. */
const SAVED_JACKPOT_POOL = 12345.678;

function checkPersistence(): void {
  section('Save fields: club membership round trip');
  const [firstRegular, secondRegular] = REGULAR_IDS;
  const full: ClubMembershipCheckpoint = {
    hasDesperadoPass: true,
    casinoShoe: createShoe(stream(PERSISTENCE_SALT)),
    casinoHintsEnabled: false,
    pokerReads: { [firstRegular]: SAMPLE_READ, [secondRegular]: SECOND_READ },
    pokerNotes: { [secondRegular]: SAMPLE_READ },
    pokerFast: true,
    pokerShowCards: true,
    escortLevelId: 'level-3',
    slotsJackpotPool: SAVED_JACKPOT_POOL,
    slotsTurbo: true,
  };
  const restored = viaSave(full);
  check(
    restored !== undefined && canonical(restored) === canonical(full),
    'a full membership with reads, notes, Fast, Show cards, the slots jackpot pool and Turbo comes back unchanged',
  );

  const beforePoker = viaSave({
    hasDesperadoPass: true,
    casinoShoe: null,
    casinoHintsEnabled: true,
  });
  check(
    beforePoker !== undefined &&
      beforePoker.hasDesperadoPass &&
      beforePoker.casinoHintsEnabled === true &&
      Object.keys(beforePoker.pokerReads).length === 0 &&
      Object.keys(beforePoker.pokerNotes).length === 0 &&
      !beforePoker.pokerFast &&
      !beforePoker.pokerShowCards &&
      beforePoker.slotsJackpotPool === JACKPOT_FLOOR &&
      !beforePoker.slotsTurbo,
    'a save from before the poker table and slots loads with no reads, no notes, Fast, Show cards and Turbo off, and the jackpot at its floor',
  );

  const beforeHints = viaSave({ hasDesperadoPass: true, casinoShoe: null });
  check(
    beforeHints !== undefined &&
      beforeHints.hasDesperadoPass &&
      beforeHints.casinoHintsEnabled === null,
    'a membership saved without the hints preference keeps its club pass, hints unset',
  );

  const strangers = viaSave({
    ...full,
    pokerReads: {
      [firstRegular]: SAMPLE_READ,
      someone_who_left_the_game: SAMPLE_READ,
      [secondRegular]: { ...SAMPLE_READ, hands: 'many' },
    },
  });
  check(
    strangers !== undefined &&
      canonical(strangers.pokerReads) === canonical({ [firstRegular]: SAMPLE_READ }),
    'an unknown regular and an unreadable read are each dropped, the good read kept',
  );

  const negative = viaSave({
    ...full,
    pokerNotes: { [firstRegular]: { ...SAMPLE_READ, vpipHands: -1 }, [secondRegular]: SECOND_READ },
  });
  check(
    negative !== undefined &&
      canonical(negative.pokerNotes) === canonical({ [secondRegular]: SECOND_READ }) &&
      negative.hasDesperadoPass,
    'a read with a negative count is dropped on its own, the rest of the membership kept',
  );
}

// ── Shown-bluff chuckles ───────────────────────────────────────────────────

const BLUFF_BIG_BLIND = 10;
const BLUFF_BET = 40;
const BLUFF_RAISE = 120;
const BLUFFER = 2;
const SHORT_STACK = 1;
const RAISER = 3;

const WEAK_HOLE: ReadonlyArray<Card> = [
  { rank: '2', suit: 'clubs' },
  { rank: '3', suit: 'diamonds' },
];
const STRONG_HOLE: ReadonlyArray<Card> = [
  { rank: 'K', suit: 'clubs' },
  { rank: 'K', suit: 'diamonds' },
];
const FLOP: ReadonlyArray<Card> = [
  { rank: 'K', suit: 'spades' },
  { rank: 'Q', suit: 'hearts' },
  { rank: 'J', suit: 'diamonds' },
];
/** Turn and river that pair the weak hand twice over: trips by the river, air when it bet. */
const TURN: Card = { rank: '2', suit: 'hearts' };
const RIVER: Card = { rank: '2', suit: 'spades' };

type HandCompleteEvent = Extract<PokerEvent, { kind: 'hand_complete' }>;

function seatList<T>(fill: T): T[] {
  return Array.from({ length: POKER_SEAT_COUNT }, () => fill);
}

function bluffShuffled(): PokerEvent {
  return {
    kind: 'shuffled',
    handNumber: 1,
    stacks: seatList(BUY_IN_BIG_BLINDS * BLUFF_BIG_BLIND),
    cardsRemaining: DECK_SIZE,
    dealt: seatList(true),
  };
}

function bluffBet(seat: number, streetTotal: number): PokerEvent {
  return { kind: 'action', seat, action: 'bet', amount: streetTotal, streetTotal };
}

function bluffShowdown(seat: number, hole: ReadonlyArray<Card>): PokerEvent {
  return { kind: 'showdown_reveal', seat, cards: hole, label: 'shown' };
}

function bluffPot(potIndex: number, seat: number): PokerEvent {
  return {
    kind: 'pot_awarded',
    potIndex,
    seats: [seat],
    amounts: [BLUFF_RAISE],
    uncontested: false,
    label: 'shown',
  };
}

function bluffComplete(
  hole: ReadonlyArray<Card>,
  board: ReadonlyArray<Card>,
  netBySeat: ReadonlyArray<number> = seatList(0),
): HandCompleteEvent {
  return {
    kind: 'hand_complete',
    handNumber: 1,
    netBySeat,
    stacks: seatList(0),
    contributions: seatList(0),
    live: seatList(true),
    holeCards: Array.from({ length: POKER_SEAT_COUNT }, (_, seat) =>
      seat === BLUFFER ? hole : [],
    ),
    board,
    burned: [],
  };
}

/** Plays `events` through a fresh tracker whose regulars all speak in `voice`. */
function reactionAfter(
  events: ReadonlyArray<PokerEvent>,
  complete: HandCompleteEvent,
  voice: ReactionVoice = 'human',
): string | null {
  const reactions = new PokerHandReactions((seat) => (seat === PLAYER_SEAT ? null : voice));
  for (const event of [bluffShuffled(), ...events]) reactions.observe(event);
  return reactions.reactionTo(complete, BLUFF_BIG_BLIND);
}

function checkShownBluffs(): void {
  section('Shown-bluff chuckles');
  const flopDealt: PokerEvent = { kind: 'street_dealt', street: 'flop', cards: FLOP };
  const preflopRaise: PokerEvent = {
    kind: 'action',
    seat: BLUFFER,
    action: 'raise',
    amount: BLUFF_RAISE,
    streetTotal: BLUFF_RAISE,
  };

  check(
    !isShownWinningBluff({ shownBothCards: true, hole: WEAK_HOLE, boardsAtAggression: [[]] }),
    'a raise with air before the flop is never a bluff',
  );
  check(
    reactionAfter(
      [preflopRaise, bluffShowdown(BLUFFER, WEAK_HOLE), bluffPot(0, BLUFFER)],
      bluffComplete(WEAK_HOLE, []),
    ) === null,
    'a hand that ends before the flop never chuckles',
  );
  check(
    reactionAfter(
      [
        flopDealt,
        bluffBet(BLUFFER, BLUFF_BET),
        bluffShowdown(BLUFFER, WEAK_HOLE),
        bluffPot(0, BLUFFER),
      ],
      bluffComplete(WEAK_HOLE, FLOP),
    ) === 'reaction_chuckle',
    'a post-flop bet with air, shown and won, chuckles',
  );
  check(
    reactionAfter(
      [
        flopDealt,
        bluffBet(BLUFFER, BLUFF_BET),
        bluffShowdown(BLUFFER, WEAK_HOLE),
        bluffPot(0, BLUFFER),
      ],
      bluffComplete(WEAK_HOLE, FLOP),
      'skyfowl',
    ) === 'skyfowl_chuckle',
    "a skyfowl regular's shown bluff laughs in the skyfowl voice",
  );
  check(
    reactionAfter(
      [flopDealt, bluffBet(BLUFFER, BLUFF_BET), bluffPot(0, BLUFFER)],
      bluffComplete(WEAK_HOLE, FLOP),
    ) === null,
    'a bluff that wins without being shown stays quiet',
  );
  check(
    reactionAfter(
      [
        flopDealt,
        bluffBet(BLUFFER, BLUFF_BET),
        bluffShowdown(BLUFFER, STRONG_HOLE),
        bluffPot(0, BLUFFER),
      ],
      bluffComplete(STRONG_HOLE, FLOP),
    ) === null,
    'a post-flop bet with a strong hand, shown and won, is no bluff',
  );
  check(
    reactionAfter(
      [
        flopDealt,
        bluffBet(BLUFFER, BLUFF_BET),
        bluffShowdown(BLUFFER, WEAK_HOLE),
        bluffPot(0, SHORT_STACK),
        bluffPot(1, BLUFFER),
      ],
      bluffComplete(WEAK_HOLE, FLOP),
    ) === 'reaction_chuckle',
    'a shown bluff that wins only the side pot chuckles',
  );
  const fullBoard = [...FLOP, TURN, RIVER];
  check(
    reactionAfter(
      [
        flopDealt,
        bluffBet(BLUFFER, BLUFF_BET),
        bluffBet(RAISER, BLUFF_RAISE),
        {
          kind: 'action',
          seat: BLUFFER,
          action: 'call',
          amount: BLUFF_RAISE - BLUFF_BET,
          streetTotal: BLUFF_RAISE,
        },
        { kind: 'street_dealt', street: 'turn', cards: [TURN] },
        { kind: 'street_dealt', street: 'river', cards: [RIVER] },
        bluffShowdown(BLUFFER, WEAK_HOLE),
        bluffPot(0, BLUFFER),
      ],
      bluffComplete(WEAK_HOLE, fullBoard),
    ) === 'reaction_chuckle',
    'a bluff that is re-raised, called down and improves to win still chuckles',
  );

  const showsUncontested = (shown: ShownCardIndices): PokerEvent => ({
    kind: 'uncontested_show',
    seat: BLUFFER,
    shown,
  });
  check(
    reactionAfter(
      [flopDealt, bluffBet(BLUFFER, BLUFF_BET), bluffPot(0, BLUFFER), showsUncontested([0, 1])],
      bluffComplete(WEAK_HOLE, FLOP),
    ) === 'reaction_chuckle',
    'a post-flop bluff that wins uncontested and shows both cards chuckles',
  );
  check(
    reactionAfter(
      [flopDealt, bluffBet(BLUFFER, BLUFF_BET), bluffPot(0, BLUFFER), showsUncontested([0])],
      bluffComplete(WEAK_HOLE, FLOP),
    ) === null,
    'a post-flop bluff that wins uncontested and shows one card stays quiet',
  );

  const acrossHands = new PokerHandReactions((seat) => (seat === PLAYER_SEAT ? null : 'human'));
  const firstHand = [
    bluffShuffled(),
    flopDealt,
    bluffBet(BLUFFER, BLUFF_BET),
    bluffPot(0, SHORT_STACK),
  ];
  for (const event of firstHand) acrossHands.observe(event);
  acrossHands.reactionTo(bluffComplete(WEAK_HOLE, FLOP), BLUFF_BIG_BLIND);
  const checkedDownWin = [
    bluffShuffled(),
    flopDealt,
    bluffShowdown(BLUFFER, WEAK_HOLE),
    bluffPot(0, BLUFFER),
  ];
  for (const event of checkedDownWin) acrossHands.observe(event);
  check(
    acrossHands.reactionTo(bluffComplete(WEAK_HOLE, FLOP), BLUFF_BIG_BLIND) === null,
    "a bluff bet in one hand does not make the next hand's checked-down win a bluff",
  );

  const bigLoss = -GROAN_LOSS_BIG_BLINDS * BLUFF_BIG_BLIND;
  const raiserLosesBig = seatList(0).map((net, seat) => (seat === RAISER ? bigLoss : net));
  check(
    reactionAfter(
      [
        flopDealt,
        bluffBet(BLUFFER, BLUFF_BET),
        bluffShowdown(BLUFFER, WEAK_HOLE),
        bluffPot(0, BLUFFER),
      ],
      bluffComplete(WEAK_HOLE, FLOP, raiserLosesBig),
    ) === 'reaction_chuckle',
    "a shown bluff's chuckle stands in for the groan of the regular it beat",
  );
}

/** A section that throws fails as one check instead of hiding the sections after it. */
function runSection(name: string, body: () => void): void {
  try {
    body();
  } catch (error) {
    check(false, `${name} threw: ${String(error)}`);
  }
}

/**
 * Every table layout the review gallery renders, checked for where a regular's
 * hand turned up at showdown can go: never on the board, the pot, the side
 * pots, the piles, anyone's name and stack, another seat's plate, avatar or
 * tag, or another shown hand; always inside the panel; and always with its
 * name against its own cards, so a glance ties every hand to its player.
 *
 * The search's last resort (cards over the avatar) passes all of that too, so
 * how often it is used is held to account separately: never off a phone, and
 * on a phone no more often than the counts below, so a search that quietly
 * stopped finding spots goes red here.
 */
function checkShownHandLayouts(): void {
  const viewports = [
    { w: 1440, h: 900, density: 'pointer', phone: false },
    { w: 1024, h: 640, density: 'pointer', phone: false },
    { w: 844, h: 390, density: 'touch', phone: false },
    { w: 568, h: 320, density: 'touch', phone: true },
    { w: 390, h: 844, density: 'touch', phone: true },
    { w: 360, h: 640, density: 'touch', phone: true },
    { w: 768, h: 1024, density: 'touch', phone: false },
    { w: 1280, h: 720, density: 'pointer', phone: false },
    { w: 1920, h: 1080, density: 'pointer', phone: false },
  ] as const;
  const uiSizes = ['small', 'medium', 'large'] as const;
  const problems: string[] = [];
  registerUiFontForNode();
  const measuring = createCanvas(1, 1).getContext('2d');
  const widthOf = (line: string, style: TypeStyle): number => {
    measuring.font = fontFor(style);
    return measuring.measureText(line).width;
  };
  // Every hand name the evaluator gives, near enough: the widest lines come
  // from the longest rank words, which a few thousand random hands all reach.
  const labels = new Set<string>();
  const labelRng = stream(LABEL_SALT);
  for (let hand = 0; hand < LABEL_SAMPLE_HANDS; hand++) {
    labels.add(evaluateBest(dealRandom(labelRng, SEVEN_CARDS)).label);
  }
  for (const viewport of viewports) {
    for (const uiSize of uiSizes) {
      const uiScale = clampedUiScale({
        cssWidth: viewport.w,
        cssHeight: viewport.h,
        density: viewport.density,
        uiSize,
        safeArea: NO_INSETS,
      });
      const layout = computePokerLayout({
        width: viewport.w / uiScale,
        height: viewport.h / uiScale,
        uiScale,
        theme: resolveTheme(viewport.density),
      });
      const label = `${viewport.w}x${viewport.h}-${uiSize}`;
      const theme = resolveTheme(viewport.density);
      const caption = theme.type.caption;
      const boldCaption = { ...caption, weight: theme.type.label.weight };
      const widestTwoLine = Math.max(
        ...[...labels].map((name) =>
          Math.max(
            ...handNameLines(name).map((line, row) =>
              widthOf(line, row === 0 ? boldCaption : caption),
            ),
          ),
        ),
      );
      const widestOneLine = Math.max(
        ...[...labels].map((name) => widthOf(handNameShortLine(name), boldCaption)),
      );
      const playerCardW = layout.seats[PLAYER_SEAT].holeCards.h / CARD_ASPECT;
      if (playerCardW < PLAYER_CARD_MIN_WIDTH - LAYOUT_TOLERANCE) {
        problems.push(`${label}: your own cards are ${Math.round(playerCardW)} wide`);
      }
      const pileH = layout.pileCardWidth * CARD_ASPECT;
      const pile = (centre: { x: number; y: number }): Box => ({
        x: centre.x - layout.pileCardWidth / 2,
        y: centre.y - pileH / 2,
        w: layout.pileCardWidth,
        h: pileH,
      });
      const table: Box[] = [
        ...layout.board,
        layout.pot,
        layout.sidePots,
        ...(layout.showPiles ? [pile(layout.deck), pile(layout.muck)] : []),
        ...layout.seats.map((seat) => seat.info),
        layout.seats[PLAYER_SEAT].holeCards,
      ];
      const fallbacks = layout.seats.filter((seat) => seat.shownFallback).length;
      const allowed = viewport.phone ? (PHONE_FALLBACK_ALLOWANCE[label] ?? 0) : 0;
      if (fallbacks > allowed) {
        problems.push(
          `${label}: ${fallbacks} shown hands fell back to the avatar (allowed ${allowed})`,
        );
      }
      layout.seats.forEach((seat, index) => {
        if (index === PLAYER_SEAT) return;
        const neighbours: Box[] = [];
        layout.seats.forEach((other, otherIndex) => {
          if (otherIndex === index) return;
          neighbours.push(other.plate, other.tag, other.avatar);
          if (otherIndex !== PLAYER_SEAT) neighbours.push(other.shownCards, other.handName);
        });
        for (const [part, area] of [
          ['cards', seat.shownCards],
          ['name', seat.handName],
        ] as const) {
          if (!boxInside(area, layout.panel)) {
            problems.push(`${label}: seat ${index}'s shown ${part} leave the panel`);
          }
          if (table.some((obstacle) => rectsOverlap(area, obstacle))) {
            problems.push(
              `${label}: seat ${index}'s shown ${part} lie on the board, a pile or a name`,
            );
          }
          if (neighbours.some((obstacle) => rectsOverlap(area, obstacle))) {
            problems.push(`${label}: seat ${index}'s shown ${part} lie on another seat`);
          }
        }
        const nameStyle = seat.plate.h < LABEL_NAME_MIN_PLATE_H ? boldCaption : theme.type.label;
        const shortName = Math.max(
          ...Object.values(REGULAR_SHORT_NAMES).map((name) => widthOf(name, nameStyle)),
        );
        if (shortName > seat.info.w + LAYOUT_TOLERANCE) {
          problems.push(`${label}: seat ${index}'s plate cuts short names`);
        }
        const twoLines = seat.handName.h >= caption.lineHeight * HAND_NAME_MAX_LINES;
        const needed = (twoLines ? widestTwoLine : widestOneLine) + HAND_NAME_PAD * 2;
        if (needed > seat.handName.w + LAYOUT_TOLERANCE) {
          problems.push(
            `${label}: seat ${index}'s hand name box is ${Math.round(seat.handName.w)} wide, names need ${Math.round(needed)}`,
          );
        }
        if (rectGap(seat.handName, seat.shownCards) > NAME_TOUCH_TOLERANCE) {
          problems.push(`${label}: seat ${index}'s hand name is not against its cards`);
        }
      });
    }
  }
  for (const problem of problems.slice(0, MAX_REPORTED_LAYOUT_PROBLEMS)) {
    console.log(`    ${problem}`);
  }
  check(
    problems.length === 0,
    `shown hands keep clear of the table and every seat, names fit, and fallbacks stay within allowances (${problems.length} problems)`,
  );
}

/**
 * The phone layouts too cramped for every seat's shown hand to find a clear
 * spot, and how many may lie over their avatar instead. Anything above these
 * is a regression in the placement search.
 */
const PHONE_FALLBACK_ALLOWANCE: Readonly<Record<string, number>> = {
  '568x320-medium': 1,
  '568x320-large': 1,
  '390x844-large': 1,
  '360x640-medium': 2,
  '360x640-large': 4,
};

function boxInside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** A name sits within one section gap of its cards; this is the most any layout uses. */
const NAME_TOUCH_TOLERANCE = 13;
const MAX_REPORTED_LAYOUT_PROBLEMS = 12;
/** Float rounding in a layout, in UI units. */
const LAYOUT_TOLERANCE = 0.5;
const LABEL_SAMPLE_HANDS = 6000;
const LABEL_SALT = 13000;
const PERSISTENCE_SALT = 14000;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function rectsOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The empty space between two boxes, 0 when they touch or overlap. */
function rectGap(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Every regular's plate short name is a word of their real name, and short enough to fit. */
function checkShortNames(): void {
  const wrong = REGULAR_IDS.filter((id) => {
    const short = REGULAR_SHORT_NAMES[id];
    const words = POKER_REGULARS[id].name.split(' ');
    return !words.includes(short) || short.length > SHORT_NAME_MAX_LETTERS;
  });
  check(
    wrong.length === 0,
    `every regular's short name is one word of their name, at most ${SHORT_NAME_MAX_LETTERS} letters${wrong.length === 0 ? '' : ` (not: ${wrong.join(', ')})`}`,
  );
}

const SHORT_NAME_MAX_LETTERS = 8;

runSection('short names', checkShortNames);
runSection('shown-hand layouts', checkShownHandLayouts);
runSection('stakes and deck', checkStakesAndDeck);
runSection('evaluator', checkEvaluator);
runSection('pots', checkPots);
runSection('betting', checkBetting);
runSection('sims', checkSims);
runSection('forfeit', checkForfeit);
runSection('guards', checkGuards);
runSection('regulars', checkRegularsSims);
runSection('personalities', checkPersonalities);
runSection('decide', checkDecide);
runSection('long sessions', checkLongSessions);
runSection('visit tells', checkVisitTellCalibration);
runSection('save fields', checkPersistence);
runSection('new game', checkNewGameHost);
runSection('banter pacing', checkBanterPacing);
runSection('shown bluffs', checkShownBluffs);

console.log(
  failures === 0
    ? '\nverify:poker — all checks passed'
    : `\nverify:poker — ${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
