#!/usr/bin/env tsx
/**
 * Headless gate on the slot machine engine (`src/systems/casino/slots/`):
 * payline evaluation with wilds, scatter counting, the jackpot pool, the
 * free-spin feature's bookkeeping, forced outcomes, and the money invariants
 * over thousands of seeded spins played through the `SlotMachine` API the way
 * a host would.
 *
 * Behaviour only: it never checks RTP, hit rates or any other balance number.
 *
 * Run: npm run verify:slots
 */

import { mulberry32, subSeed, type Rng } from '../src/sprites/person/rng';
import {
  BET_LADDER,
  JACKPOT_FLOOR,
  MAX_BET_PER_LINE,
  MIN_BET_PER_LINE,
  JACKPOT_CONTRIBUTION_RATE,
  jackpotContributionFor,
  normalizeJackpotPool,
  totalBetFor,
  type BetPerLine,
} from '../src/systems/casino/slots/slotBets';
import {
  evaluateLine,
  evaluateSpin,
  type SpinOutcome,
} from '../src/systems/casino/slots/evaluateSpin';
import {
  FORCED_OUTCOMES,
  findForcedStops,
  matchesForcedOutcome,
} from '../src/systems/casino/slots/forcedOutcomes';
import { PAYLINES, PAYLINE_COUNT } from '../src/systems/casino/slots/slotPaylines';
import {
  REEL_COUNT,
  REEL_STRIPS,
  REEL_WEIGHTS,
  ROW_COUNT,
  areValidStops,
  type ReelStrips,
  type SlotGrid,
} from '../src/systems/casino/slots/slotReels';
import { SlotMachine, type SlotEvent } from '../src/systems/casino/slots/SlotMachine';
import {
  FREE_SPINS_PER_TRIGGER,
  SCATTER,
  SLOT_SYMBOLS,
  WILD,
  linePayFor,
  scatterPayFor,
  type SlotSymbol,
} from '../src/systems/casino/slots/slotSymbols';

let failures = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ok   ${description}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${description}`);
}

function runSection(name: string, body: () => void): void {
  console.log(`\n${name}`);
  try {
    body();
  } catch (error) {
    check(false, `${name} threw: ${String(error)}`);
  }
}

const BASE_SEED = 0x51075_9a7e;
const SIM_STREAMS = 12;
const SPINS_PER_STREAM = 600;
const STARTING_WALLET = 200_000;
const MIDDLE_ROW = 1;
/** A filler with no line pay, so hand-built glass only pays where a case puts symbols. */
const FILLER: SlotSymbol = SCATTER;
const NO_SCATTER_FILLER: SlotSymbol = 'bell';
/** A pool carrying a fraction of a coin, so every jackpot check also covers the carry. */
const BIG_POOL = 123_456.3;
const POOL_TOLERANCE = 1e-6;
/** How often the wallet streams force a jackpot, so pool resets happen inside the sim. */
const JACKPOT_FORCE_EVERY = 150;

// ── Hand-built glass ──────────────────────────────────────────────────────

/**
 * Strips whose stop 0 shows exactly `grid`, so a hand-built glass can be
 * played through `evaluateSpin`. `above` and `below` set what sits just off
 * the glass on each reel, for near-miss cases.
 */
function stripsShowing(
  grid: SlotGrid,
  above: ReadonlyArray<SlotSymbol> = [],
  below: ReadonlyArray<SlotSymbol> = [],
): ReelStrips {
  return grid.map((column, reel) => [
    ...column,
    below[reel] ?? NO_SCATTER_FILLER,
    NO_SCATTER_FILLER,
    above[reel] ?? NO_SCATTER_FILLER,
  ]);
}

const ZERO_STOPS = Array.from({ length: REEL_COUNT }, () => 0);

/** A glass of `fill` with the middle row replaced by `middle`. */
function gridWithMiddle(middle: ReadonlyArray<SlotSymbol>, fill: SlotSymbol = FILLER): SlotGrid {
  return middle.map((symbol) => [fill, symbol, fill]);
}

function middleLine(middle: ReadonlyArray<SlotSymbol>, bet: BetPerLine = MIN_BET_PER_LINE) {
  const lineIndex = PAYLINES.findIndex((line) => line.every((row) => row === MIDDLE_ROW));
  return evaluateLine(gridWithMiddle(middle), lineIndex, bet);
}

function glassOutcome(
  grid: SlotGrid,
  bet: BetPerLine,
  pool: number,
  above: ReadonlyArray<SlotSymbol> = [],
  below: ReadonlyArray<SlotSymbol> = [],
): SpinOutcome {
  return evaluateSpin({
    stops: ZERO_STOPS,
    betPerLine: bet,
    jackpotPool: pool,
    strips: stripsShowing(grid, above, below),
  });
}

function checkStructure(): void {
  check(PAYLINE_COUNT === 20, 'there are twenty paylines');
  const keys = new Set(PAYLINES.map((line) => line.join(',')));
  check(keys.size === PAYLINE_COUNT, 'no two paylines are the same');
  check(
    PAYLINES.every(
      (line) => line.length === REEL_COUNT && line.every((row) => row >= 0 && row < ROW_COUNT),
    ),
    'every payline crosses every reel on a real row',
  );
  check(REEL_STRIPS.length === REEL_COUNT, 'there is one strip per reel');
  check(
    REEL_STRIPS.every((strip, reel) =>
      SLOT_SYMBOLS.every(
        (symbol) => strip.filter((found) => found === symbol).length === REEL_WEIGHTS[reel][symbol],
      ),
    ),
    'each strip carries exactly its weight table',
  );
  check(
    REEL_STRIPS.every((strip) => strip.length >= ROW_COUNT),
    'every strip is longer than the glass is tall',
  );
  check(
    BET_LADDER.every((rung) => totalBetFor(rung) === rung * PAYLINE_COUNT),
    'every rung of the bet ladder stakes its bet on every line',
  );
  check(
    BET_LADDER.every((rung, index) => index === 0 || rung > BET_LADDER[index - 1]),
    'the bet ladder climbs',
  );
}

function checkPaylines(): void {
  const five = middleLine(['cherries', 'cherries', 'cherries', 'cherries', 'cherries']);
  check(
    five?.symbol === 'cherries' && five.count === 5 && five.payout === linePayFor('cherries', 5),
    'five cherries pay the five-cherry line pay',
  );
  const atBet = middleLine(['bar', 'bar', 'bar', 'lemon', 'lemon'], MAX_BET_PER_LINE);
  check(
    atBet?.count === 3 && atBet.payout === linePayFor('bar', 3) * MAX_BET_PER_LINE,
    'a line pays its multiple times the coins per line',
  );
  check(
    middleLine(['bell', 'bell', 'lemon', 'bell', 'bell']) === null,
    'two of a kind pays nothing',
  );
  check(
    middleLine(['lemon', 'bell', 'bell', 'bell', 'bell']) === null,
    'a run that does not start on the leftmost reel pays nothing',
  );

  const wildMiddle = middleLine(['tiara', WILD, 'tiara', 'cherries', 'tiara']);
  check(
    wildMiddle?.symbol === 'tiara' && wildMiddle.count === 3 && wildMiddle.wildsUsed === 1,
    'a wild inside a run stands in for the symbol',
  );
  const leadingWilds = middleLine([WILD, WILD, 'seven', 'seven', 'bell']);
  check(
    leadingWilds?.symbol === 'seven' && leadingWilds.count === 4 && leadingWilds.wildsUsed === 2,
    'leading wilds take on the first real symbol',
  );
  const wildsBeatLowRun = middleLine([WILD, WILD, WILD, 'cherries', 'cherries']);
  check(
    wildsBeatLowRun?.symbol === WILD && wildsBeatLowRun.count === 3,
    'three wilds pay as wilds when that beats five cherries',
  );
  const sevensBeatWilds = middleLine([WILD, WILD, WILD, 'seven', 'seven']);
  check(
    sevensBeatWilds?.symbol === 'seven' && sevensBeatWilds.count === 5,
    'three wilds pay as five 7s when that beats three wilds',
  );
  const allWild = middleLine([WILD, WILD, WILD, WILD, WILD]);
  check(
    allWild?.symbol === WILD && allWild.count === 5 && allWild.payout === linePayFor(WILD, 5),
    'five wilds pay the wild top pay',
  );
  check(
    middleLine([SCATTER, 'boots', 'boots', 'boots', 'boots']) === null,
    'a scatter on the first reel starts no line',
  );
  check(
    middleLine(['boots', 'boots', SCATTER, 'boots', 'boots']) === null,
    'the wild never stands in for a scatter, and a scatter breaks a run',
  );
  check(
    middleLine([WILD, WILD, SCATTER, 'seven', 'seven']) === null,
    'two wilds before a scatter pay nothing',
  );
  const cells = middleLine(['mongo', 'mongo', WILD, 'mongo', 'lemon'])?.cells ?? [];
  check(
    cells.length === 4 &&
      cells.every((cell, reel) => cell.reel === reel && cell.row === MIDDLE_ROW),
    'a win names the cells of its run, left to right',
  );

  const pool = JACKPOT_FLOOR;
  const outcome = glassOutcome(
    [
      ['lemon', 'lemon', 'lemon'],
      ['lemon', 'lemon', 'lemon'],
      ['lemon', 'lemon', 'lemon'],
      ['bell', 'bell', 'bell'],
      ['bell', 'bell', 'bell'],
    ],
    MIN_BET_PER_LINE,
    pool,
  );
  check(
    outcome.lineWins.length === PAYLINE_COUNT &&
      outcome.totalWin === PAYLINE_COUNT * linePayFor('lemon', 3),
    'a glass that pays every line pays all twenty, once each',
  );
}

function checkScatters(): void {
  const twoScatters = glassOutcome(
    [
      [SCATTER, 'bell', 'bar'],
      ['bar', 'lemon', 'mongo'],
      ['mongo', SCATTER, 'bell'],
      ['lemon', 'bar', 'mongo'],
      ['bar', 'mongo', 'lemon'],
    ],
    MIN_BET_PER_LINE,
    JACKPOT_FLOOR,
  );
  check(
    twoScatters.scatter.count === 2 &&
      twoScatters.scatter.freeSpinsAwarded === 0 &&
      twoScatters.scatter.payout === 0,
    'two scatters award nothing',
  );
  check(
    twoScatters.anticipationReels.join(',') === '3,4',
    'reels after the second scatter get anticipation',
  );

  const sameReel = glassOutcome(
    [
      [SCATTER, SCATTER, 'bar'],
      ['bar', 'lemon', 'mongo'],
      ['mongo', 'bell', 'bell'],
      ['lemon', 'bar', SCATTER],
      ['bar', 'mongo', 'lemon'],
    ],
    MAX_BET_PER_LINE,
    JACKPOT_FLOOR,
  );
  check(
    sameReel.scatter.count === 3 && sameReel.scatter.cells.length === 3,
    'scatters are counted per cell, anywhere on the glass',
  );
  check(
    sameReel.scatter.freeSpinsAwarded === FREE_SPINS_PER_TRIGGER &&
      sameReel.scatter.payout === scatterPayFor(3) * totalBetFor(MAX_BET_PER_LINE),
    'three scatters award the free spins and pay against the whole bet',
  );

  const nearMiss = glassOutcome(
    [
      [SCATTER, 'bell', 'bar'],
      ['bar', SCATTER, 'mongo'],
      ['mongo', 'lemon', 'bell'],
      ['lemon', 'bar', 'mongo'],
      ['bar', 'mongo', 'lemon'],
    ],
    MIN_BET_PER_LINE,
    JACKPOT_FLOOR,
    [NO_SCATTER_FILLER, NO_SCATTER_FILLER, NO_SCATTER_FILLER, SCATTER],
  );
  check(
    nearMiss.nearMisses.some((miss) => miss.kind === 'scatter' && miss.reel === 3),
    'a third scatter just above the glass is a near miss on its reel',
  );
  check(
    nearMiss.nearMisses.every((miss) => miss.reel === 3),
    'reels with nothing just off the glass are not near misses',
  );
}

function checkJackpot(): void {
  const sevens = gridWithMiddle(['seven', 'seven', 'seven', 'seven', 'seven'], 'bell');
  const won = glassOutcome(sevens, MAX_BET_PER_LINE, BIG_POOL);
  const carried = normalizeJackpotPool(JACKPOT_FLOOR + BIG_POOL - Math.floor(BIG_POOL));
  check(
    won.jackpot.won &&
      won.jackpot.amount === Math.floor(BIG_POOL) &&
      won.jackpot.poolAfter === carried,
    'five golden 7s at max bet pay the pool in whole coins and reset it to its floor plus the unpaid fraction',
  );
  check(won.tier === 'jackpot', 'a jackpot spin is the jackpot tier');
  check(
    won.totalWin === won.jackpot.amount + won.lineWins.reduce((sum, win) => sum + win.payout, 0),
    'the jackpot is paid on top of the line wins',
  );
  const lowBet = glassOutcome(sevens, BET_LADDER[BET_LADDER.length - 2], BIG_POOL);
  check(
    !lowBet.jackpot.won && lowBet.jackpot.poolAfter === BIG_POOL,
    'five 7s below max bet leave the pool alone',
  );
  const withWild = glassOutcome(
    gridWithMiddle(['seven', 'seven', WILD, 'seven', 'seven'], 'bell'),
    MAX_BET_PER_LINE,
    BIG_POOL,
  );
  check(!withWild.jackpot.won, 'a wild never completes the progressive');
  const lowPool = glassOutcome(sevens, MAX_BET_PER_LINE, 1);
  check(lowPool.jackpot.amount === JACKPOT_FLOOR, 'a pool below its floor pays the floor');

  check(
    BET_LADDER.every((rung) => {
      const totalBet = totalBetFor(rung);
      return (
        Math.abs(jackpotContributionFor(totalBet) - totalBet * JACKPOT_CONTRIBUTION_RATE) <
        POOL_TOLERANCE
      );
    }),
    'every rung feeds the same fixed fraction of its bet to the pool',
  );

  const machine = new SlotMachine({ seed: BASE_SEED });
  const plain = machine.spin({ betPerLine: MIN_BET_PER_LINE, jackpotPool: BIG_POOL });
  const fedAtMin = normalizeJackpotPool(
    BIG_POOL + totalBetFor(MIN_BET_PER_LINE) * JACKPOT_CONTRIBUTION_RATE,
  );
  check(
    plain.kind === 'started' && plain.jackpotPool === fedAtMin,
    'a paid spin feeds its slice into the pool',
  );
  machine.settleNow();

  const forced = machine.forceNext('jackpot', MAX_BET_PER_LINE, BIG_POOL);
  const hit = machine.spin({ betPerLine: MAX_BET_PER_LINE, jackpotPool: BIG_POOL });
  const fedPool = normalizeJackpotPool(
    BIG_POOL + totalBetFor(MAX_BET_PER_LINE) * JACKPOT_CONTRIBUTION_RATE,
  );
  const resetPool = normalizeJackpotPool(JACKPOT_FLOOR + fedPool - Math.floor(fedPool));
  check(
    forced &&
      hit.kind === 'started' &&
      hit.jackpotPool === fedPool &&
      hit.outcome.jackpot.amount === Math.floor(fedPool),
    'a jackpot spin hands back the fed pool, not yet reset, when it starts',
  );
  machine.stopAllReels();
  check(
    machine.phase === 'celebrating' && eventsOf(machine.drainEvents(), 'jackpot_won').length === 0,
    'the pool is not reset while the jackpot is still being celebrated',
  );
  const settledPool = machine.settleNow();
  const jackpotEvents = eventsOf(machine.drainEvents(), 'jackpot_won');
  check(
    jackpotEvents.length === 1 &&
      jackpotEvents[0].amount === Math.floor(fedPool) &&
      jackpotEvents[0].poolAfter === resetPool &&
      settledPool === resetPool,
    'paying the jackpot hands back the floor plus the unpaid fraction',
  );

  const leaver = new SlotMachine({ seed: subSeed(BASE_SEED, 9) });
  leaver.forceNext('jackpot', MAX_BET_PER_LINE, BIG_POOL);
  const leaving = leaver.spin({ betPerLine: MAX_BET_PER_LINE, jackpotPool: BIG_POOL });
  leaver.stopReel();
  const storedOnExit = leaver.settleAll(
    leaving.kind === 'started' ? leaving.jackpotPool : BIG_POOL,
  );
  check(
    storedOnExit === resetPool && eventsOf(leaver.drainEvents(), 'jackpot_won').length === 1,
    'leaving mid-jackpot pays it and returns the reset pool',
  );
  check(
    !machine.forceNext('jackpot', MIN_BET_PER_LINE, BIG_POOL),
    'the jackpot cannot be forced below max bet',
  );
}

function checkForcedOutcomes(): void {
  const random = mulberry32(subSeed(BASE_SEED, 1));
  for (const kind of FORCED_OUTCOMES) {
    const stops = findForcedStops(kind, MAX_BET_PER_LINE, JACKPOT_FLOOR, REEL_STRIPS, random);
    const outcome =
      stops === null
        ? null
        : evaluateSpin({ stops, betPerLine: MAX_BET_PER_LINE, jackpotPool: JACKPOT_FLOOR });
    check(
      stops !== null &&
        areValidStops(REEL_STRIPS, stops) &&
        outcome !== null &&
        matchesForcedOutcome(kind, outcome),
      `a forced ${kind} lands valid stops that play as a ${kind}`,
    );
  }
  const machine = new SlotMachine({ seed: subSeed(BASE_SEED, 2) });
  check(
    !machine.forceNextStops([0, 0, 0, 0, REEL_STRIPS[REEL_COUNT - 1].length]),
    'stops off the end of a strip are refused',
  );
}

// ── The machine ───────────────────────────────────────────────────────────

function eventsOf<K extends SlotEvent['kind']>(
  events: ReadonlyArray<SlotEvent>,
  kind: K,
): Extract<SlotEvent, { kind: K }>[] {
  return events.filter((event): event is Extract<SlotEvent, { kind: K }> => event.kind === kind);
}

function checkPhases(): void {
  const machine = new SlotMachine({ seed: subSeed(BASE_SEED, 3) });
  check(machine.phase === 'idle', 'a new machine is idle');
  check(
    machine.spin({ betPerLine: 3, jackpotPool: JACKPOT_FLOOR }).kind === 'refused' &&
      machine.drainEvents().length === 0 &&
      machine.totalWagered === 0,
    'a bet off the ladder is refused and charges nothing',
  );
  machine.forceNext('line_win', MIN_BET_PER_LINE, JACKPOT_FLOOR);
  machine.spin({ betPerLine: MIN_BET_PER_LINE, jackpotPool: JACKPOT_FLOOR });
  check(machine.phase === 'spinning', 'a spin starts the reels');
  const busy = machine.spin({ betPerLine: MIN_BET_PER_LINE, jackpotPool: JACKPOT_FLOOR });
  check(busy.kind === 'refused' && busy.reason === 'busy', 'a second spin mid-spin is refused');
  machine.stopReel();
  check(
    machine.phase === 'stopping' && machine.reelsStopped === 1,
    'the first stop moves to stopping',
  );
  machine.stopAllReels();
  check(machine.phase === 'celebrating', 'a winning spin celebrates once the last reel stops');
  const beforePay = machine.drainEvents();
  check(
    eventsOf(beforePay, 'reel_stopped')
      .map((event) => event.reel)
      .join(',') === '0,1,2,3,4',
    'the reels stop left to right',
  );
  check(eventsOf(beforePay, 'win_paid').length === 0, 'nothing is paid until the celebration ends');
  check(machine.stopReel() === null, 'no reel stops while celebrating');
  machine.finishCelebration();
  check(machine.phase === 'idle', 'the machine rests after the celebration');
  check(
    eventsOf(machine.drainEvents(), 'win_paid').length === 1,
    'the celebration pays the win once',
  );

  machine.forceNext('loss', MIN_BET_PER_LINE, JACKPOT_FLOOR);
  machine.spin({ betPerLine: MIN_BET_PER_LINE, jackpotPool: JACKPOT_FLOOR });
  machine.stopAllReels();
  check(machine.phase === 'idle', 'a losing spin settles straight back to idle');

  const nearMissGlass: SlotGrid = [
    [SCATTER, 'bell', 'bar'],
    ['bar', SCATTER, 'mongo'],
    ['mongo', 'lemon', 'bell'],
    ['lemon', 'bar', 'mongo'],
    ['bar', 'mongo', 'lemon'],
  ];
  const glassMachine = new SlotMachine({
    seed: subSeed(BASE_SEED, 8),
    strips: stripsShowing(nearMissGlass, [], [NO_SCATTER_FILLER, NO_SCATTER_FILLER, SCATTER]),
  });
  glassMachine.forceNextStops(ZERO_STOPS);
  const nearMiss = glassMachine.spin({ betPerLine: MIN_BET_PER_LINE, jackpotPool: JACKPOT_FLOOR });
  glassMachine.settleNow();
  const events = glassMachine.drainEvents();
  const misses = eventsOf(events, 'near_miss');
  check(
    nearMiss.kind === 'started' &&
      misses.length === 1 &&
      misses[0].miss.kind === 'scatter' &&
      misses[0].miss.reel === 2,
    'a near miss is emitted when its reel stops',
  );
  const scatterOrdinals = eventsOf(events, 'scatter_landed').map((event) => event.ordinal);
  check(scatterOrdinals.join(',') === '1,2', 'each landed scatter is numbered in order');
  const anticipated = nearMiss.kind === 'started' ? nearMiss.outcome.anticipationReels : [];
  const anticipationOrder = anticipated.every((reel) => {
    const announced = events.findIndex((e) => e.kind === 'anticipation_started' && e.reel === reel);
    const stopped = events.findIndex((e) => e.kind === 'reel_stopped' && e.reel === reel);
    return announced !== -1 && announced < stopped;
  });
  check(
    anticipated.length > 0 && anticipationOrder,
    'anticipation is announced before its reel stops',
  );
}

function checkFreeSpins(): void {
  const machine = new SlotMachine({ seed: subSeed(BASE_SEED, 4) });
  const bet = BET_LADDER[1];
  check(machine.forceNext('free_spins', bet, JACKPOT_FLOOR), 'a free-spin trigger can be forced');
  const trigger = machine.spin({ betPerLine: bet, jackpotPool: JACKPOT_FLOOR });
  machine.settleNow();
  const awarded = eventsOf(machine.drainEvents(), 'free_spins_awarded');
  check(
    trigger.kind === 'started' && awarded.length === 1 && !awarded[0].retrigger,
    'a trigger awards the feature once',
  );
  const feature = machine.freeSpins;
  check(
    feature !== null &&
      feature.remaining === FREE_SPINS_PER_TRIGGER &&
      feature.betPerLine === bet &&
      feature.played === 0 &&
      machine.phase === 'free_spins',
    'the feature starts with ten spins at the triggering bet',
  );

  const free = machine.spin({ betPerLine: MAX_BET_PER_LINE, jackpotPool: JACKPOT_FLOOR });
  check(
    free.kind === 'started' && free.free && free.charged === 0 && free.outcome.betPerLine === bet,
    'a free spin charges nothing and plays at the locked bet, whatever is asked',
  );
  check(
    free.kind === 'started' && free.jackpotPool === JACKPOT_FLOOR,
    'a free spin feeds nothing to the pool',
  );
  check(machine.freeSpins?.remaining === FREE_SPINS_PER_TRIGGER - 1, 'a free spin uses one up');
  machine.settleNow();

  const remainingBefore = machine.freeSpins?.remaining ?? 0;
  machine.forceNext('free_spins', bet, JACKPOT_FLOOR);
  machine.spin({ betPerLine: bet, jackpotPool: JACKPOT_FLOOR });
  machine.settleNow();
  check(
    machine.freeSpins?.remaining === remainingBefore - 1 + FREE_SPINS_PER_TRIGGER,
    'a re-trigger adds ten more spins',
  );
  const retrigger = eventsOf(machine.drainEvents(), 'free_spins_awarded');
  check(retrigger.length === 1 && retrigger[0].retrigger, 'a re-trigger is reported as one');

  let featureWins = 0;
  let featureSpins = 0;
  const watched = new SlotMachine({ seed: subSeed(BASE_SEED, 5) });
  watched.forceNext('free_spins', bet, JACKPOT_FLOOR);
  watched.spin({ betPerLine: bet, jackpotPool: JACKPOT_FLOOR });
  watched.settleNow();
  watched.drainEvents();
  let ended: Extract<SlotEvent, { kind: 'free_spins_ended' }> | null = null;
  let pool = JACKPOT_FLOOR;
  while (watched.freeSpins !== null) {
    const start = watched.spin({ betPerLine: bet, jackpotPool: pool });
    if (start.kind === 'refused') break;
    pool = start.jackpotPool;
    watched.settleNow();
    for (const event of watched.drainEvents()) {
      if (event.kind === 'win_paid' && event.free) featureWins += event.amount;
      if (event.kind === 'free_spin_started') featureSpins++;
      if (event.kind === 'free_spins_ended') ended = event;
    }
  }
  check(
    ended !== null && ended.totalWon === featureWins && ended.played === featureSpins,
    'the feature ends reporting every free spin and everything they paid',
  );
  check(watched.phase === 'idle', 'the machine is idle once the feature ends');

  const leaver = new SlotMachine({ seed: subSeed(BASE_SEED, 6) });
  leaver.forceNext('free_spins', bet, JACKPOT_FLOOR);
  leaver.spin({ betPerLine: bet, jackpotPool: JACKPOT_FLOOR });
  leaver.stopReel();
  leaver.settleAll(JACKPOT_FLOOR);
  const leaverEvents = leaver.drainEvents();
  const settledTotal = eventsOf(leaverEvents, 'spin_settled').reduce(
    (s, e) => s + e.outcome.totalWin,
    0,
  );
  const paidTotal = eventsOf(leaverEvents, 'win_paid').reduce((s, e) => s + e.amount, 0);
  check(
    leaver.freeSpins === null && leaver.phase === 'idle' && paidTotal === settledTotal,
    'leaving mid-feature plays every owed spin out and pays it',
  );
}

interface WalletTally {
  wallet: number;
  bets: number;
  wins: number;
  settledWins: number;
  invalidStops: number;
  mismatchedCharges: number;
  pool: number;
  poolBelowFloor: boolean;
  poolFed: number;
  /** How far each jackpot dropped the pool: what it paid above the floor it reset to. */
  poolDrained: number;
  jackpots: number;
  fractionalPayouts: number;
}

/** One host session: bets what it can afford, reveals reel by reel, pays what it is told. */
function playWalletStream(streamSeed: number): { tally: WalletTally; machine: SlotMachine } {
  const random: Rng = mulberry32(subSeed(streamSeed, 0));
  const machine = new SlotMachine({ seed: subSeed(streamSeed, 1) });
  const tally: WalletTally = {
    wallet: STARTING_WALLET,
    bets: 0,
    wins: 0,
    settledWins: 0,
    invalidStops: 0,
    mismatchedCharges: 0,
    pool: JACKPOT_FLOOR,
    poolBelowFloor: false,
    poolFed: 0,
    poolDrained: 0,
    jackpots: 0,
    fractionalPayouts: 0,
  };

  const drain = (): void => {
    for (const event of machine.drainEvents()) {
      if (event.kind === 'bet_placed') {
        tally.bets += event.totalBet;
        tally.poolFed += event.jackpotContribution;
      }
      if (event.kind === 'win_paid') {
        if (!Number.isInteger(event.amount)) tally.fractionalPayouts++;
        tally.wallet += event.amount;
        tally.wins += event.amount;
      }
      if (event.kind === 'jackpot_won') {
        tally.jackpots++;
        tally.poolDrained += event.amount - JACKPOT_FLOOR;
        tally.pool = event.poolAfter;
      }
      if (event.kind === 'spin_settled') tally.settledWins += event.outcome.totalWin;
    }
  };

  for (let spin = 0; spin < SPINS_PER_STREAM; spin++) {
    const affordable = BET_LADDER.filter((rung) => totalBetFor(rung) <= tally.wallet);
    if (affordable.length === 0 && machine.freeSpins === null) break;
    const forceJackpot =
      spin % JACKPOT_FORCE_EVERY === 0 &&
      machine.freeSpins === null &&
      affordable.includes(MAX_BET_PER_LINE);
    const bet = forceJackpot
      ? MAX_BET_PER_LINE
      : (affordable[Math.floor(random() * affordable.length)] ?? MIN_BET_PER_LINE);
    if (forceJackpot) machine.forceNext('jackpot', bet, tally.pool);
    const start = machine.spin({ betPerLine: bet, jackpotPool: tally.pool });
    if (start.kind === 'refused') break;
    tally.wallet -= start.charged;
    tally.pool = start.jackpotPool;
    if (tally.pool < JACKPOT_FLOOR) tally.poolBelowFloor = true;
    if (!areValidStops(machine.strips, start.outcome.stops)) tally.invalidStops++;
    const placed = eventsOf(machine.drainEvents(), 'bet_placed');
    const placedTotal = placed.reduce((sum, event) => sum + event.totalBet, 0);
    if (placedTotal !== start.charged) tally.mismatchedCharges++;
    tally.bets += placedTotal;
    tally.poolFed += placed.reduce((sum, event) => sum + event.jackpotContribution, 0);

    while (machine.phase === 'spinning' || machine.phase === 'stopping') {
      if (machine.spin({ betPerLine: bet, jackpotPool: tally.pool }).kind !== 'refused') {
        tally.mismatchedCharges++;
      }
      machine.stopReel();
    }
    drain();
    machine.finishCelebration();
    drain();
  }
  tally.pool = machine.settleAll(tally.pool);
  drain();
  return { tally, machine };
}

function checkMoney(): void {
  let wallets = true;
  let ledgers = true;
  let settled = true;
  let stops = true;
  let charges = true;
  let pools = true;
  let poolLedgers = true;
  let wholeCoins = true;
  let jackpots = 0;
  let spins = 0;
  for (let stream = 0; stream < SIM_STREAMS; stream++) {
    const { tally, machine } = playWalletStream(subSeed(BASE_SEED, stream + SIM_STREAMS));
    spins += machine.paidSpins + machine.freeSpinsPlayed;
    if (tally.wallet !== STARTING_WALLET - tally.bets + tally.wins) wallets = false;
    if (machine.totalWagered !== tally.bets || machine.totalPaid !== tally.wins) ledgers = false;
    if (tally.settledWins !== tally.wins) settled = false;
    if (tally.invalidStops > 0) stops = false;
    if (tally.mismatchedCharges > 0) charges = false;
    if (tally.poolBelowFloor) pools = false;
    const expectedPool = JACKPOT_FLOOR + tally.poolFed - tally.poolDrained;
    if (Math.abs(tally.pool - expectedPool) > POOL_TOLERANCE) poolLedgers = false;
    if (tally.fractionalPayouts > 0) wholeCoins = false;
    jackpots += tally.jackpots;
  }
  console.log(`  (${spins} spins, ${jackpots} jackpots, across ${SIM_STREAMS} seeded streams)`);
  check(stops, 'every reel stop is a real position on its strip');
  check(settled, 'total paid equals the sum of every evaluated win');
  check(wallets, 'the wallet moves only by bets taken and wins paid');
  check(ledgers, "the machine's ledger matches the host's wallet");
  check(charges, 'every charge is announced once, and no spin starts mid-reveal');
  check(pools, 'the jackpot pool never drops below its floor');
  check(jackpots > 0, 'the streams hit the jackpot');
  check(wholeCoins, 'every payout is whole coins');
  check(
    poolLedgers,
    'the pool holds exactly its floor plus every slice fed, less every jackpot paid',
  );

  const freeWallet = new SlotMachine({ seed: subSeed(BASE_SEED, 7) });
  freeWallet.forceNext('free_spins', MIN_BET_PER_LINE, JACKPOT_FLOOR);
  freeWallet.spin({ betPerLine: MIN_BET_PER_LINE, jackpotPool: JACKPOT_FLOOR });
  freeWallet.settleNow();
  freeWallet.drainEvents();
  const wageredBefore = freeWallet.totalWagered;
  freeWallet.settleAll(JACKPOT_FLOOR);
  check(
    freeWallet.totalWagered === wageredBefore &&
      eventsOf(freeWallet.drainEvents(), 'bet_placed').length === 0,
    'free spins never take a bet',
  );
}

runSection('structure', checkStructure);
runSection('paylines', checkPaylines);
runSection('scatters', checkScatters);
runSection('jackpot', checkJackpot);
runSection('forced outcomes', checkForcedOutcomes);
runSection('phases', checkPhases);
runSection('free spins', checkFreeSpins);
runSection('money', checkMoney);

console.log(
  failures === 0
    ? '\nverify:slots — all checks passed'
    : `\nverify:slots — ${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
