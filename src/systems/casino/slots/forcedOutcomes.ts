/**
 * Stops that produce a chosen kind of spin, for the dev route's outcome picker
 * and the gate. The search plays honest stops through `evaluateSpin`, so a
 * forced spin is always one the strips can really land.
 */

import { MAX_BET_PER_LINE, type BetPerLine } from './slotBets';
import { evaluateSpin, type SpinOutcome } from './evaluateSpin';
import { PAYLINES } from './slotPaylines';
import { REEL_COUNT, ROW_COUNT, randomStops, wrapStop, type ReelStrips } from './slotReels';
import {
  MIN_LINE_MATCH,
  PAYING_SYMBOLS,
  SCATTER,
  SCATTER_TRIGGER_COUNT,
  WILD,
  type SlotSymbol,
} from './slotSymbols';

export const FORCED_OUTCOMES = [
  'loss',
  'line_win',
  'big_win',
  'mega_win',
  'epic_win',
  'free_spins',
  'jackpot',
  'near_miss_scatter',
  'near_miss_line',
] as const;

export type ForcedOutcome = (typeof FORCED_OUTCOMES)[number];

/** Enough tries that every kind is found on the shipped strips within a frame or two. */
const MAX_FORCE_ATTEMPTS = 20000;
/** Every other attempt plants symbols rather than rolling freely, so rare kinds turn up fast. */
const PLANT_EVERY = 2;
/** The row just above the glass, where a near-miss scatter is planted. */
const ROW_ABOVE_GLASS = -1;

/** Whether `outcome` is a clean example of `kind`, with nothing louder layered on top. */
export function matchesForcedOutcome(kind: ForcedOutcome, outcome: SpinOutcome): boolean {
  const triggered = outcome.scatter.freeSpinsAwarded > 0;
  const quiet = !triggered && !outcome.jackpot.won;
  switch (kind) {
    case 'loss':
      return outcome.totalWin === 0 && outcome.nearMisses.length === 0 && quiet;
    case 'line_win':
      return outcome.lineWins.length > 0 && outcome.tier === 'none' && quiet;
    case 'big_win':
      return outcome.tier === 'big' && quiet;
    case 'mega_win':
      return outcome.tier === 'mega' && quiet;
    case 'epic_win':
      return outcome.tier === 'epic' && quiet;
    case 'free_spins':
      return triggered && !outcome.jackpot.won;
    case 'jackpot':
      return outcome.jackpot.won;
    case 'near_miss_scatter':
      return (
        quiet && outcome.tier === 'none' && outcome.nearMisses.some((m) => m.kind === 'scatter')
      );
    case 'near_miss_line':
      return quiet && outcome.tier === 'none' && outcome.nearMisses.some((m) => m.kind === 'line');
  }
}

function randomIndex(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function copiesOf(strip: ReadonlyArray<SlotSymbol>, symbol: SlotSymbol): number[] {
  const positions: number[] = [];
  strip.forEach((found, position) => {
    if (found === symbol) positions.push(position);
  });
  return positions;
}

/** Sets `reel`'s stop so a copy of `symbol` shows at `row` (which may be just off the glass). */
function plant(
  stops: number[],
  strips: ReelStrips,
  reel: number,
  row: number,
  symbol: SlotSymbol,
  random: () => number,
): void {
  const strip = strips[reel];
  const copies = copiesOf(strip, symbol);
  if (copies.length === 0) return;
  const copy = copies[randomIndex(random, copies.length)];
  stops[reel] = wrapStop(copy - row, strip.length);
}

function distinctReels(random: () => number, count: number, below: number): number[] {
  const reels = Array.from({ length: below }, (_, reel) => reel);
  for (let i = reels.length - 1; i > 0; i--) {
    const j = randomIndex(random, i + 1);
    [reels[i], reels[j]] = [reels[j], reels[i]];
  }
  return reels.slice(0, count).sort((a, b) => a - b);
}

function plantedStops(kind: ForcedOutcome, strips: ReelStrips, random: () => number): number[] {
  const stops = randomStops(strips, random);
  const randomRow = (): number => randomIndex(random, ROW_COUNT);

  if (kind === 'free_spins') {
    for (const reel of distinctReels(random, SCATTER_TRIGGER_COUNT, REEL_COUNT)) {
      plant(stops, strips, reel, randomRow(), SCATTER, random);
    }
    return stops;
  }

  if (kind === 'near_miss_scatter') {
    const landed = SCATTER_TRIGGER_COUNT - 1;
    const reels = distinctReels(random, landed + 1, REEL_COUNT);
    reels
      .slice(0, landed)
      .forEach((reel) => plant(stops, strips, reel, randomRow(), SCATTER, random));
    plant(stops, strips, reels[landed], ROW_ABOVE_GLASS, SCATTER, random);
    return stops;
  }

  const line = PAYLINES[randomIndex(random, PAYLINES.length)];
  const lineSymbolPool: ReadonlyArray<SlotSymbol> = [...PAYING_SYMBOLS, WILD];
  const symbol =
    kind === 'jackpot' ? 'seven' : lineSymbolPool[randomIndex(random, lineSymbolPool.length)];
  const runLength =
    kind === 'jackpot'
      ? REEL_COUNT
      : MIN_LINE_MATCH + randomIndex(random, REEL_COUNT - MIN_LINE_MATCH + 1);
  for (let reel = 0; reel < runLength; reel++)
    plant(stops, strips, reel, line[reel], symbol, random);
  return stops;
}

/** Share of `!lucky` spins that land the jackpot. */
const LUCKY_JACKPOT_CHANCE = 0.1;

/**
 * The paying kinds a `!lucky` spin draws from when it is not the jackpot,
 * smallest prize first, each weighted twice the next so smaller wins are
 * steadily more common than bigger ones.
 */
const LUCKY_WIN_WEIGHTS = [
  { kind: 'line_win', weight: 8 },
  { kind: 'big_win', weight: 4 },
  { kind: 'mega_win', weight: 2 },
  { kind: 'epic_win', weight: 1 },
] as const satisfies ReadonlyArray<{ readonly kind: ForcedOutcome; readonly weight: number }>;

/**
 * The kind of win a `!lucky` spin at `betPerLine` lands: the jackpot one time
 * in ten, otherwise a smaller win weighted toward the smaller prizes. The
 * jackpot only pays at max bet, so below it there is no jackpot roll at all;
 * folding that share into any one win would make it outrank a smaller prize.
 */
export function pickLuckyOutcome(betPerLine: BetPerLine, random: () => number): ForcedOutcome {
  const jackpotPayable = betPerLine === MAX_BET_PER_LINE;
  if (jackpotPayable && random() < LUCKY_JACKPOT_CHANCE) return 'jackpot';
  const totalWeight = LUCKY_WIN_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = random() * totalWeight;
  let reached = 0;
  for (const entry of LUCKY_WIN_WEIGHTS) {
    reached += entry.weight;
    if (roll < reached) return entry.kind;
  }
  return LUCKY_WIN_WEIGHTS[0].kind;
}

/** Every paying kind, most likely first: where a lucky spin falls back if its own kind turned up no stops. */
export const LUCKY_FALLBACK_OUTCOMES: ReadonlyArray<ForcedOutcome> = LUCKY_WIN_WEIGHTS.map(
  (entry) => entry.kind,
);

/**
 * Stops whose spin at `betPerLine` is a clean `kind`, or null when none turned
 * up — always null for the jackpot below max bet, which cannot win it.
 */
export function findForcedStops(
  kind: ForcedOutcome,
  betPerLine: BetPerLine,
  jackpotPool: number,
  strips: ReelStrips,
  random: () => number,
): number[] | null {
  if (kind === 'jackpot' && betPerLine !== MAX_BET_PER_LINE) return null;
  for (let attempt = 0; attempt < MAX_FORCE_ATTEMPTS; attempt++) {
    const stops =
      attempt % PLANT_EVERY === 0
        ? randomStops(strips, random)
        : plantedStops(kind, strips, random);
    const outcome = evaluateSpin({ stops, betPerLine, jackpotPool, strips });
    if (matchesForcedOutcome(kind, outcome)) return stops;
  }
  return null;
}
