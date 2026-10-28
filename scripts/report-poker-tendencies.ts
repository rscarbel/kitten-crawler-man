#!/usr/bin/env tsx
/**
 * Prints how the Texas Hold'em regulars actually play once the decision code
 * runs them: measured VPIP, PFR, postflop aggression factor, went-to-showdown
 * and bluff share, per archetype across several world seeds and per regular
 * for one seed. A report to read by eye, never a gate: it exits 0 whatever
 * the numbers say.
 *
 * With `--seed=N` it also prints that run's rolled roster, including every
 * tell and how often each fired truthfully.
 *
 * Run: npm run report:poker-tendencies [-- --seed=N --seeds=K --hands=H]
 */

import type {
  PokerActionKind,
  PokerAction,
  LegalActions,
} from '../src/systems/casino/poker/bettingRound';
import type { PokerEvent } from '../src/systems/casino/poker/pokerEvents';
import { POKER_TIER_IDS, type PokerTierId } from '../src/systems/casino/poker/pokerStakes';
import {
  PLAYER_SEAT,
  POKER_SEAT_COUNT,
  PokerTable,
  type PokerSeatBrain,
} from '../src/systems/casino/poker/PokerTable';
import {
  PokerRegulars,
  type RegularDecisionRecord,
} from '../src/systems/casino/poker/npc/PokerRegulars';
import {
  POKER_DEV_SEED,
  rollPokerPersonalities,
  selectTable,
  type PokerPersonalities,
} from '../src/systems/casino/poker/npc/personality';
import {
  ARCHETYPES,
  ARCHETYPE_PRESETS,
  type Archetype,
} from '../src/systems/casino/poker/npc/profiles';
import { REGULAR_IDS, type RegularId } from '../src/systems/casino/poker/npc/regularIds';
import {
  TELL_KINDS,
  type TellKind,
  type TellPolarity,
  type TellTally,
} from '../src/systems/casino/poker/npc/tells';
import { lineOf } from '../src/systems/casino/poker/npc/ranges';
import { chance, mulberry32, rangeInt, subSeed, type Rng } from '../src/sprites/person/rng';

const DEFAULT_SEEDS = 6;
const DEFAULT_HANDS = 300;
const FRAME_MS = 100;
const MAX_FRAMES_PER_HAND = 4000;
const PERCENT = 100;
/** Column widths, wide enough for the longest value each column prints. */
const HANDS_COLUMN = 5;
const PERCENT_COLUMN = 4;
const RATIO_COLUMN = 5;
const ARCHETYPE_COLUMN = 16;
const NAME_COLUMN = 13;
const RATIO_DECIMALS = 2;
const SECONDS_DECIMALS = 1;
const MS_PER_SECOND = 1000;
const PRIOR_DECIMALS = 2;
const STREAM_SALT = 0x7e4d;
const PLAYER_SALT = 0x51a7;
const SEED_STEP = 7919;

function numericArgument(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const hasSeedArgument = process.argv.some((arg) => arg.startsWith('--seed='));
const measureTellPriors = process.argv.includes('--measure-tell-priors');

/** How often each tell kind × polarity's condition held at its chances, over every regular simulated. */
interface ConditionTotal {
  chances: number;
  held: number;
}
const conditionTotals = new Map<TellKind, Map<TellPolarity, ConditionTotal>>();
const focusSeed = numericArgument('seed', POKER_DEV_SEED);
const seedCount = numericArgument('seeds', DEFAULT_SEEDS);
const handsPerTable = numericArgument('hands', DEFAULT_HANDS);

// ── The stand-in player ────────────────────────────────────────────────────

/** A middling human: enters about a third of pots, calls more than raises. */
const PLAYER_FOLD_TO_BET = 0.45;
const PLAYER_RAISE = 0.12;
const PLAYER_BET = 0.25;

function playerAction(legal: LegalActions, rng: Rng): PokerAction {
  if (legal.canFold && chance(rng, PLAYER_FOLD_TO_BET)) return { kind: 'fold' };
  const range = legal.bet ?? legal.raise;
  const aggressionChance = legal.bet !== null ? PLAYER_BET : PLAYER_RAISE;
  if (range !== null && chance(rng, aggressionChance)) {
    const amount = rangeInt(rng, range.min, Math.min(range.max, range.min * 2));
    return legal.bet !== null ? { kind: 'bet', amount } : { kind: 'raise', amount };
  }
  if (legal.canCheck) return { kind: 'check' };
  if (legal.call !== null) return { kind: 'call' };
  return legal.allIn !== null ? { kind: 'all_in' } : { kind: 'fold' };
}

// ── Tallies ─────────────────────────────────────────────────────────────────

interface Stats {
  hands: number;
  vpip: number;
  pfr: number;
  postflopAggressive: number;
  postflopCalls: number;
  sawFlop: number;
  showdowns: number;
  postflopBets: number;
  bluffs: number;
}

function emptyStats(): Stats {
  return {
    hands: 0,
    vpip: 0,
    pfr: 0,
    postflopAggressive: 0,
    postflopCalls: 0,
    sawFlop: 0,
    showdowns: 0,
    postflopBets: 0,
    bluffs: 0,
  };
}

function addStats(into: Stats, from: Stats): void {
  into.hands += from.hands;
  into.vpip += from.vpip;
  into.pfr += from.pfr;
  into.postflopAggressive += from.postflopAggressive;
  into.postflopCalls += from.postflopCalls;
  into.sawFlop += from.sawFlop;
  into.showdowns += from.showdowns;
  into.postflopBets += from.postflopBets;
  into.bluffs += from.bluffs;
}

const AGGRESSIVE_KINDS: ReadonlySet<PokerActionKind> = new Set<PokerActionKind>([
  'bet',
  'raise',
  'all_in',
]);

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * PERCENT).toFixed(0)}%` : '—';
}

function statsLine(stats: Stats): string {
  const af =
    stats.postflopCalls > 0
      ? (stats.postflopAggressive / stats.postflopCalls).toFixed(RATIO_DECIMALS)
      : '∞';
  return [
    `hands ${String(stats.hands).padStart(HANDS_COLUMN)}`,
    `VPIP ${percent(stats.vpip, stats.hands).padStart(PERCENT_COLUMN)}`,
    `PFR ${percent(stats.pfr, stats.hands).padStart(PERCENT_COLUMN)}`,
    `AF ${af.padStart(RATIO_COLUMN)}`,
    `WTSD ${percent(stats.showdowns, stats.sawFlop).padStart(PERCENT_COLUMN)}`,
    `bluff ${percent(stats.bluffs, stats.postflopBets).padStart(PERCENT_COLUMN)} of bets`,
  ].join('  ');
}

// ── One table ───────────────────────────────────────────────────────────────

interface TableRun {
  readonly statsByRegular: Map<RegularId, Stats>;
  readonly tells: Map<RegularId, TellTally>;
}

function statsFor(map: Map<RegularId, Stats>, id: RegularId): Stats {
  const existing = map.get(id);
  if (existing !== undefined) return existing;
  const fresh = emptyStats();
  map.set(id, fresh);
  return fresh;
}

function runTable(
  personalities: PokerPersonalities,
  tier: PokerTierId,
  streamSeed: number,
): TableRun {
  const random = mulberry32(subSeed(streamSeed, STREAM_SALT));
  const playerRng = mulberry32(subSeed(streamSeed, PLAYER_SALT));
  const statsByRegular = new Map<RegularId, Stats>();
  const seatedNow: Array<RegularId | null> = Array.from({ length: POKER_SEAT_COUNT }, () => null);
  const countDecision = (record: RegularDecisionRecord): void => {
    if (record.street === 'preflop') return;
    if (!AGGRESSIVE_KINDS.has(record.decision.action.kind)) return;
    const stats = statsFor(statsByRegular, record.regularId);
    stats.postflopBets++;
    if (record.decision.intent === 'bluff') stats.bluffs++;
  };
  const seated = selectTable(personalities, tier, random);
  const regulars = new PokerRegulars({
    tier,
    personalities,
    seated,
    random,
    onDecision: countDecision,
  });
  const recordHand = (table: PokerTable): void => {
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      const id = seatedNow[seat];
      const tableSeat = table.seats[seat];
      if (seat === PLAYER_SEAT || id === null || !tableSeat.inHand) continue;
      const stats = statsFor(statsByRegular, id);
      const line = lineOf(table.history, seat);
      const mine = table.history.filter((record) => record.seat === seat);
      const foldedPreflop = mine.some(
        (record) => record.kind === 'fold' && record.street === 'preflop',
      );
      const postflop = mine.filter((record) => record.street !== 'preflop');
      stats.hands++;
      if (line.preflopRaises > 0 || line.preflopCalled) stats.vpip++;
      if (line.preflopRaises > 0) stats.pfr++;
      stats.postflopAggressive += postflop.filter((record) => record.aggressive).length;
      stats.postflopCalls += postflop.filter(
        (record) => !record.aggressive && record.chipsAdded > 0,
      ).length;
      const sawFlop = table.board.length > 0 && !foldedPreflop;
      if (sawFlop) stats.sawFlop++;
      if (
        sawFlop &&
        !tableSeat.folded &&
        table.seats.filter((s) => s.inHand && !s.folded).length > 1
      )
        stats.showdowns++;
    }
  };
  const brain: PokerSeatBrain = {
    decide: (context) => regulars.decide(context),
    showsLosingHand: (context) => regulars.showsLosingHand(context),
    uncontestedShow: (context) => regulars.uncontestedShow(context),
    observe: (event: PokerEvent, table: PokerTable) => {
      if (event.kind === 'shuffled') {
        for (let seat = 0; seat < POKER_SEAT_COUNT; seat++)
          seatedNow[seat] = regulars.regularAt(seat);
      }
      if (event.kind === 'hand_complete') recordHand(table);
      return regulars.observe(event, table);
    },
  };
  const table = new PokerTable({
    tier,
    brain,
    seatManager: regulars,
    npcs: seated.map((occupantId) => ({ occupantId, stack: regulars.buyInFor(occupantId) })),
    random,
    fast: true,
  });
  for (let frame = 0; frame < handsPerTable * MAX_FRAMES_PER_HAND; frame++) {
    if (table.handNumber > handsPerTable || table.phase === 'game_over') break;
    const legal = table.playerLegalActions();
    if (legal !== null) table.playerAct(playerAction(legal, playerRng));
    if (table.phase === 'player_busted') table.rebuy();
    table.update(FRAME_MS);
    table.drainEvents();
  }
  const tells = new Map<RegularId, TellTally>();
  for (const id of REGULAR_IDS) {
    tells.set(id, regulars.tellTally(id));
    const counts = regulars.tellConditionCounts(id);
    regulars.personalityOf(id).tells.forEach((tell, index) => {
      const byPolarity =
        conditionTotals.get(tell.signal.kind) ?? new Map<TellPolarity, ConditionTotal>();
      const total = byPolarity.get(tell.polarity) ?? { chances: 0, held: 0 };
      total.chances += counts[index]?.chances ?? 0;
      total.held += counts[index]?.held ?? 0;
      byPolarity.set(tell.polarity, total);
      conditionTotals.set(tell.signal.kind, byPolarity);
    });
  }
  return { statsByRegular, tells };
}

function runSeed(worldSeed: number): {
  personalities: PokerPersonalities;
  stats: Map<RegularId, Stats>;
  tells: Map<RegularId, TellTally>;
} {
  const personalities = rollPokerPersonalities(worldSeed);
  const stats = new Map<RegularId, Stats>();
  const tells = new Map<RegularId, TellTally>();
  POKER_TIER_IDS.forEach((tier, index) => {
    const run = runTable(personalities, tier, subSeed(worldSeed, index));
    for (const [id, tableStats] of run.statsByRegular) addStats(statsFor(stats, id), tableStats);
    for (const [id, tally] of run.tells) {
      const before = tells.get(id);
      const merged = Object.fromEntries(
        TELL_KINDS.map((kind) => [
          kind,
          {
            fired: (before?.[kind].fired ?? 0) + tally[kind].fired,
            truthful: (before?.[kind].truthful ?? 0) + tally[kind].truthful,
          },
        ]),
      );
      tells.set(id, {
        think_time: merged.think_time,
        bet_size: merged.bet_size,
        chip_fidget: merged.chip_fidget,
        card_recheck: merged.card_recheck,
        chatter: merged.chatter,
        bet_motion: merged.bet_motion,
      });
    }
  });
  return { personalities, stats, tells };
}

// ── Report ──────────────────────────────────────────────────────────────────

const started = Date.now();
const byArchetype = new Map<Archetype, Stats>();
for (const archetype of ARCHETYPES) byArchetype.set(archetype, emptyStats());

const seeds = Array.from({ length: seedCount }, (_, i) => focusSeed + i * SEED_STEP);
let focus: ReturnType<typeof runSeed> | null = null;
for (const seed of seeds) {
  const result = runSeed(seed);
  if (seed === focusSeed) focus = result;
  for (const [id, stats] of result.stats) {
    const archetype = result.personalities[id].archetype;
    const into = byArchetype.get(archetype);
    if (into !== undefined) addStats(into, stats);
  }
}

console.log(
  `Poker tendencies — ${seeds.length} world seeds × ${POKER_TIER_IDS.length} tiers × ${handsPerTable} hands\n`,
);
console.log('Per archetype (measured; preset VPIP/PFR band in brackets)');
for (const archetype of ARCHETYPES) {
  const stats = byArchetype.get(archetype) ?? emptyStats();
  const bands = ARCHETYPE_PRESETS[archetype].bands;
  const band = `[${percent(bands.vpip.min, 1)}–${percent(bands.vpip.max, 1)} / ${percent(bands.pfr.min, 1)}–${percent(bands.pfr.max, 1)}]`;
  console.log(`  ${archetype.padEnd(ARCHETYPE_COLUMN)} ${statsLine(stats)}  ${band}`);
}

if (focus !== null) {
  console.log(`\nPer regular, world seed ${focusSeed}${hasSeedArgument ? '' : ' (dev seed)'}`);
  for (const id of REGULAR_IDS) {
    const personality = focus.personalities[id];
    const stats = focus.stats.get(id) ?? emptyStats();
    const profile = personality.profile;
    console.log(
      `  ${id.padEnd(NAME_COLUMN)} ${personality.archetype.padEnd(ARCHETYPE_COLUMN)} ${statsLine(stats)}  (rolled vpip ${percent(profile.vpip, 1)}, pfr ${percent(profile.pfr, 1)}, sizing ${profile.sizing})`,
    );
  }
  if (hasSeedArgument) {
    console.log(`\nRolled roster and tells, world seed ${focusSeed}`);
    for (const id of REGULAR_IDS) {
      const personality = focus.personalities[id];
      const tally = focus.tells.get(id);
      console.log(
        `  ${id.padEnd(NAME_COLUMN)} ${personality.archetype.padEnd(ARCHETYPE_COLUMN)} banter ${personality.profile.banterSet}, buy-in ${personality.profile.buyInBigBlinds.min}–${personality.profile.buyInBigBlinds.max} BB`,
      );
      if (personality.tells.length === 0) console.log('      no tells');
      for (const tell of personality.tells) {
        const kind = tell.signal.kind;
        const fired = tally?.[kind].fired ?? 0;
        const truthful = tally?.[kind].truthful ?? 0;
        const detail = Object.entries(tell.signal)
          .filter(([key]) => key !== 'kind')
          .map(([, value]) => value)
          .join(' ');
        console.log(
          `      ${kind}${detail ? ` (${detail})` : ''} on ${tell.polarity}, reliability ${percent(tell.reliability, 1)}: fired ${fired}×, truthfully ${percent(truthful, fired)}`,
        );
      }
    }
  }
}

console.log(`\n${((Date.now() - started) / MS_PER_SECOND).toFixed(SECONDS_DECIMALS)} s`);

if (measureTellPriors) {
  console.log('\nMeasured tell condition rates (paste into TELL_CONDITION_PRIOR in tells.ts):');
  for (const kind of TELL_KINDS) {
    const entries = [
      ...(conditionTotals.get(kind) ?? new Map<TellPolarity, ConditionTotal>()).entries(),
    ]
      .filter(([, total]) => total.chances > 0)
      .map(
        ([polarity, total]) =>
          `${polarity}: ${(total.held / total.chances).toFixed(PRIOR_DECIMALS)} /* ${total.chances} chances */`,
      );
    console.log(`  ${kind}: { ${entries.join(', ')} },`);
  }
}
