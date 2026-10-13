#!/usr/bin/env tsx
/**
 * Prints what the slot machine's strips and paytable add up to over many
 * seeded spins: return to player (with and without the progressive), hit
 * frequency, how often free spins trigger and what the feature pays, and how
 * often each win tier fires. A report to read while tuning, never a gate: it
 * exits 0 whatever the numbers say.
 *
 * Run: npm run report:slots-rtp [-- --spins=N --seed=S --bet=B]
 */

import { SlotMachine } from '../src/systems/casino/slots/SlotMachine';
import {
  JACKPOT_FLOOR,
  MIN_BET_PER_LINE,
  isBetPerLine,
  type WinTier,
} from '../src/systems/casino/slots/slotBets';

const DEFAULT_SPINS = 1_000_000;
const DEFAULT_SEED = 0x51075;
const PERCENT = 100;
const DECIMALS = 2;

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (raw === undefined) return fallback;
  const parsed = Number(raw.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const spins = numberArg('spins', DEFAULT_SPINS);
const seed = numberArg('seed', DEFAULT_SEED);
const requestedBet = numberArg('bet', MIN_BET_PER_LINE);
const betPerLine = isBetPerLine(requestedBet) ? requestedBet : MIN_BET_PER_LINE;

const machine = new SlotMachine({ seed });
let pool = JACKPOT_FLOOR;
let wagered = 0;
let paidSpinWins = 0;
let featureWins = 0;
let jackpotPaid = 0;
let jackpotFed = 0;
let hits = 0;
let triggers = 0;
const tierCounts: Record<WinTier, number> = { none: 0, big: 0, mega: 0, epic: 0, jackpot: 0 };

for (let spin = 0; spin < spins; spin++) {
  const start = machine.spin({ betPerLine, jackpotPool: pool });
  if (start.kind === 'refused') throw new Error(`spin refused: ${start.reason}`);
  pool = start.jackpotPool;
  wagered += start.charged;
  for (const event of machine.drainEvents()) {
    if (event.kind === 'bet_placed') jackpotFed += event.jackpotContribution;
  }
  const { outcome } = start;
  paidSpinWins += outcome.totalWin - outcome.jackpot.amount;
  jackpotPaid += outcome.jackpot.amount;
  if (outcome.totalWin > 0) hits++;
  if (outcome.scatter.freeSpinsAwarded > 0) triggers++;
  tierCounts[outcome.tier]++;

  pool = machine.settleNow() ?? pool;
  machine.drainEvents();
  while (machine.freeSpins !== null) {
    const free = machine.spin({ betPerLine, jackpotPool: pool });
    if (free.kind === 'refused') throw new Error(`free spin refused: ${free.reason}`);
    pool = free.jackpotPool;
    featureWins += free.outcome.totalWin - free.outcome.jackpot.amount;
    jackpotPaid += free.outcome.jackpot.amount;
    pool = machine.settleNow() ?? pool;
    machine.drainEvents();
  }
}

const percent = (part: number, whole: number): string =>
  `${((part / Math.max(1, whole)) * PERCENT).toFixed(DECIMALS)}%`;
const oneIn = (count: number): string =>
  count === 0 ? 'never' : `1 in ${(spins / count).toFixed(1)}`;

console.log(`slots RTP report — ${spins} paid spins at ${betPerLine}/line, seed ${seed}`);
console.log(
  `  RTP (lines + scatters + free spins): ${percent(paidSpinWins + featureWins, wagered)}`,
);
console.log(`    base game:   ${percent(paidSpinWins, wagered)}`);
console.log(`    free spins:  ${percent(featureWins, wagered)}`);
console.log(
  `  RTP with progressive wins: ${percent(paidSpinWins + featureWins + jackpotPaid, wagered)}`,
);
console.log(`  progressive fed: ${percent(jackpotFed, wagered)} of wagers; paid ${jackpotPaid}`);
console.log(`  hit frequency: ${percent(hits, spins)} (${oneIn(hits)})`);
console.log(
  `  free-spin trigger: ${oneIn(triggers)}; avg feature pays ${(featureWins / Math.max(1, triggers)).toFixed(1)} coins`,
);
for (const tier of ['big', 'mega', 'epic', 'jackpot'] as const) {
  console.log(`  ${tier.toUpperCase()} WIN: ${oneIn(tierCounts[tier])}`);
}
console.log(`  machine ledger: wagered ${machine.totalWagered}, paid ${machine.totalPaid}`);
