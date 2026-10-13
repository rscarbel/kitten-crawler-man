/**
 * Turns a set of reel stops into everything the spin paid and everything the
 * view needs to show it: the winning lines and their cells, the scatters, the
 * free spins, the jackpot, the win tier, the near misses and which reels
 * deserve an anticipation slow-down. Pure and canvas-free.
 */

import {
  MAX_BET_PER_LINE,
  jackpotPayableCoins,
  jackpotPoolAfterWin,
  normalizeJackpotPool,
  totalBetFor,
  winTierFor,
  type BetPerLine,
  type WinTier,
} from './slotBets';
import { PAYLINES, type Payline } from './slotPaylines';
import {
  REEL_COUNT,
  REEL_STRIPS,
  ROW_COUNT,
  gridFor,
  symbolAt,
  type GridCell,
  type ReelStops,
  type ReelStrips,
  type SlotGrid,
} from './slotReels';
import {
  FREE_SPINS_PER_TRIGGER,
  MIN_LINE_MATCH,
  NEAR_MISS_SYMBOLS,
  SCATTER,
  SCATTER_TRIGGER_COUNT,
  WILD,
  isPayingSymbol,
  linePayFor,
  scatterPayFor,
  type PayingSymbol,
} from './slotSymbols';

/** The symbol a line was paid as: a paying symbol, or the wild when a run of wilds pays best. */
export type LineSymbol = PayingSymbol | typeof WILD;

export interface LineWin {
  /** Index into `PAYLINES`. */
  readonly lineIndex: number;
  readonly symbol: LineSymbol;
  /** How many reels, from the left, the run covers. */
  readonly count: number;
  /** The cells of the run, left to right, for highlighting. */
  readonly cells: ReadonlyArray<GridCell>;
  /** How many of the run's cells are wilds (all of them when `symbol` is the wild). */
  readonly wildsUsed: number;
  readonly payout: number;
}

export interface ScatterResult {
  readonly count: number;
  readonly cells: ReadonlyArray<GridCell>;
  readonly payout: number;
  readonly freeSpinsAwarded: number;
}

export interface JackpotResult {
  readonly won: boolean;
  /** Whole coins the jackpot pays; zero when it was not won. */
  readonly amount: number;
  /**
   * The pool once this spin's jackpot is paid: back at the floor (plus any
   * unpaid fraction of a coin) after a win, otherwise the pool played for.
   * The machine hands it to the host only when the jackpot is actually paid.
   */
  readonly poolAfter: number;
  /** The payline the five golden 7s sat on, when won. */
  readonly lineIndex: number | null;
}

/**
 * A pay the spin came close to: a premium run one reel short with the missing
 * symbol just off the line, or a third scatter just off the glass.
 */
export type NearMiss =
  | {
      readonly kind: 'line';
      readonly reel: number;
      readonly symbol: LineSymbol;
      readonly lineIndex: number;
    }
  | { readonly kind: 'scatter'; readonly reel: number };

export interface SpinOutcome {
  readonly stops: ReelStops;
  readonly grid: SlotGrid;
  readonly betPerLine: BetPerLine;
  /** The bet wins are measured against; a free spin is measured against its triggering bet. */
  readonly totalBet: number;
  readonly lineWins: ReadonlyArray<LineWin>;
  readonly scatter: ScatterResult;
  readonly jackpot: JackpotResult;
  /** Line wins, the scatter pay and the jackpot together. */
  readonly totalWin: number;
  readonly tier: WinTier;
  /** At most one per reel. */
  readonly nearMisses: ReadonlyArray<NearMiss>;
  /** Reels that start their stop with two scatters already showing to their left. */
  readonly anticipationReels: ReadonlyArray<number>;
}

export interface SpinRequest {
  readonly stops: ReelStops;
  readonly betPerLine: BetPerLine;
  /** The progressive pool this spin plays for, already including its own contribution. */
  readonly jackpotPool: number;
  readonly strips?: ReelStrips;
}

function lineSymbols(grid: SlotGrid, line: Payline): ReadonlyArray<SlotGrid[number][number]> {
  return line.map((row, reel) => grid[reel][row]);
}

function lineCells(line: Payline, count: number): GridCell[] {
  return line.slice(0, count).map((row, reel) => ({ reel, row }));
}

/**
 * The best pay a line offers. The first non-wild symbol from the left fixes
 * what the wilds before and after it stand in for; a leading run of wilds can
 * also pay as wilds in its own right, and the line takes whichever reading
 * pays more. A line of five wilds therefore pays the wild's top pay, and a
 * wild-wild-wild-7-7 line pays five 7s if that beats three wilds.
 */
export function evaluateLine(
  grid: SlotGrid,
  lineIndex: number,
  betPerLine: number,
): LineWin | null {
  const line = PAYLINES[lineIndex];
  const symbols = lineSymbols(grid, line);

  let wildRun = 0;
  while (wildRun < REEL_COUNT && symbols[wildRun] === WILD) wildRun++;

  const readings: LineWin[] = [];
  const read = (symbol: LineSymbol, count: number, wildsUsed: number): void => {
    const payout = linePayFor(symbol, count) * betPerLine;
    if (payout > 0) {
      readings.push({ lineIndex, symbol, count, cells: lineCells(line, count), wildsUsed, payout });
    }
  };

  if (wildRun >= MIN_LINE_MATCH) read(WILD, wildRun, wildRun);

  const target = wildRun < REEL_COUNT ? symbols[wildRun] : null;
  if (target !== null && isPayingSymbol(target)) {
    let count = wildRun;
    let wildsUsed = wildRun;
    while (count < REEL_COUNT && (symbols[count] === target || symbols[count] === WILD)) {
      if (symbols[count] === WILD) wildsUsed++;
      count++;
    }
    read(target, count, wildsUsed);
  }

  return readings.reduce<LineWin | null>(
    (best, reading) => (best === null || reading.payout > best.payout ? reading : best),
    null,
  );
}

function scatterCells(grid: SlotGrid): GridCell[] {
  const cells: GridCell[] = [];
  grid.forEach((column, reel) =>
    column.forEach((symbol, row) => {
      if (symbol === SCATTER) cells.push({ reel, row });
    }),
  );
  return cells;
}

/** Five literal golden 7s; a wild never completes the progressive. */
function jackpotLine(grid: SlotGrid): number | null {
  const index = PAYLINES.findIndex((line) =>
    lineSymbols(grid, line).every((symbol) => symbol === 'seven'),
  );
  return index === -1 ? null : index;
}

/** Whether `symbol` (or a wild standing in for it) sits one row above or below `row` on `reel`. */
function landsJustOff(
  strips: ReelStrips,
  stops: ReelStops,
  reel: number,
  row: number,
  symbol: LineSymbol,
): boolean {
  const matches = (offset: number): boolean => {
    const found = symbolAt(strips, stops, reel, offset);
    return found === symbol || (symbol !== WILD && found === WILD);
  };
  return matches(row - 1) || matches(row + 1);
}

function findNearMisses(
  strips: ReelStrips,
  stops: ReelStops,
  grid: SlotGrid,
  lineWins: ReadonlyArray<LineWin>,
  scatters: ReadonlyArray<GridCell>,
): NearMiss[] {
  const byReel = new Map<number, NearMiss>();

  if (scatters.length === SCATTER_TRIGGER_COUNT - 1) {
    const firstScatterReel = Math.min(...scatters.map((cell) => cell.reel));
    for (let reel = firstScatterReel + 1; reel < REEL_COUNT; reel++) {
      if (grid[reel].includes(SCATTER)) continue;
      const above = symbolAt(strips, stops, reel, -1);
      const below = symbolAt(strips, stops, reel, ROW_COUNT);
      if (above === SCATTER || below === SCATTER) byReel.set(reel, { kind: 'scatter', reel });
    }
  }

  for (const win of lineWins) {
    if (win.count >= REEL_COUNT || !NEAR_MISS_SYMBOLS.has(win.symbol)) continue;
    const reel = win.count;
    if (byReel.has(reel)) continue;
    const row = PAYLINES[win.lineIndex][reel];
    if (landsJustOff(strips, stops, reel, row, win.symbol)) {
      byReel.set(reel, { kind: 'line', reel, symbol: win.symbol, lineIndex: win.lineIndex });
    }
  }

  return [...byReel.values()].sort((a, b) => a.reel - b.reel);
}

function findAnticipationReels(grid: SlotGrid): number[] {
  const reels: number[] = [];
  let scattersSoFar = 0;
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    if (scattersSoFar >= SCATTER_TRIGGER_COUNT - 1) reels.push(reel);
    scattersSoFar += grid[reel].filter((symbol) => symbol === SCATTER).length;
  }
  return reels;
}

export function evaluateSpin(request: SpinRequest): SpinOutcome {
  const strips = request.strips ?? REEL_STRIPS;
  const { stops, betPerLine } = request;
  const grid = gridFor(strips, stops);
  const totalBet = totalBetFor(betPerLine);

  const lineWins: LineWin[] = [];
  for (let lineIndex = 0; lineIndex < PAYLINES.length; lineIndex++) {
    const win = evaluateLine(grid, lineIndex, betPerLine);
    if (win !== null) lineWins.push(win);
  }
  const lineTotal = lineWins.reduce((sum, win) => sum + win.payout, 0);

  const cells = scatterCells(grid);
  const scatterTriggered = cells.length >= SCATTER_TRIGGER_COUNT;
  const scatter: ScatterResult = {
    count: cells.length,
    cells,
    payout: scatterPayFor(cells.length) * totalBet,
    freeSpinsAwarded: scatterTriggered ? FREE_SPINS_PER_TRIGGER : 0,
  };

  const pool = normalizeJackpotPool(request.jackpotPool);
  const sevensLine = betPerLine === MAX_BET_PER_LINE ? jackpotLine(grid) : null;
  const jackpot: JackpotResult =
    sevensLine === null
      ? { won: false, amount: 0, poolAfter: pool, lineIndex: null }
      : {
          won: true,
          amount: jackpotPayableCoins(pool),
          poolAfter: jackpotPoolAfterWin(pool),
          lineIndex: sevensLine,
        };

  const totalWin = lineTotal + scatter.payout + jackpot.amount;

  return {
    stops: [...stops],
    grid,
    betPerLine,
    totalBet,
    lineWins,
    scatter,
    jackpot,
    totalWin,
    tier: winTierFor(totalWin, totalBet, jackpot.won),
    nearMisses: findNearMisses(strips, stops, grid, lineWins, cells),
    anticipationReels: findAnticipationReels(grid),
  };
}
