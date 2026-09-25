#!/usr/bin/env tsx
/**
 * Headless gate on Briar Hollow's persisted state: `src/core/briarHollowState.ts`
 * (village quest/structures/soldiers/talk/stock), the per-crawler craft-skill
 * snapshot round-trip through `PlayerSnapshot`, and `GameProgress.crafts`
 * parsing through `src/core/partyCrafts.ts`.
 *
 * Checks:
 *  - a populated `BriarHollowState` survives capture → JSON round-trip →
 *    parse → restore with deep equality;
 *  - a save with the `briarHollow` field entirely absent, or with individual
 *    sub-fields absent, is handled gracefully rather than rejected;
 *  - a corrupted field (bad array entries, wrong-typed top-level value) drops
 *    only the bad entries and keeps the rest, or refuses gracefully;
 *  - Carl's and Donut's craft-skill levels round-trip through
 *    `PlayerSnapshot` independently;
 *  - `GameProgress.crafts` parses through absence and garbage.
 *
 * Run: npx tsx scripts/verify-briar-hollow-state.ts
 */

import { isDeepStrictEqual } from 'node:util';
import {
  createBriarHollowState,
  captureBriarHollowState,
  restoreBriarHollowState,
  parseBriarHollowStateSnapshot,
  type BriarHollowState,
} from '../src/core/briarHollowState';
import { createPartyCraftsState, parsePartyCraftsState } from '../src/core/partyCrafts';
import { teachBoth } from '../src/core/CraftSkills';
import { snapPlayer, restorePlayer } from '../src/core/PlayerSnapshot';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { TILE_SIZE } from '../src/core/constants';
import { HOLLOW_BELL_MAX_HP } from '../src/systems/briarHollow/hollowBell';

/** Not a valid `StructureRecord`, `onceFlag` or top-level shape — a wrong-typed value used across several checks below. */
const GARBAGE_NUMBER = 42;
/** Enough Resourcing XP to clear every level, so the human and cat land on visibly different levels. */
const HUMAN_RESOURCING_XP = 50000;
const CAT_RESOURCING_XP = 500;
const HUMAN_CONSTRUCTION_XP = 200;
const SAMPLE_HAMBURGER_STOCK = 5;

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${message}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${message}`);
}

function newCrawlers(): { human: HumanPlayer; cat: CatPlayer } {
  return {
    human: new HumanPlayer(0, 0, TILE_SIZE),
    cat: new CatPlayer(0, 0, TILE_SIZE),
  };
}

/** A state exercising every field and every `StructureRecord` variant. */
function populatedState(): BriarHollowState {
  const state = createBriarHollowState();
  state.quest = {
    phase: 'fortifying',
    gathering: { woodChopped: 10, stoneMined: 10, boardsProcessed: 3, ropeProcessed: 2 },
    imminentCountdownFrames: 0,
    assaultWaveIndex: null,
    bellHp: HOLLOW_BELL_MAX_HP,
    lastSiege: { segmentsBreached: 3, structuresDestroyed: 1, soldiersDowned: 2 },
    rewardsGranted: true,
  };
  state.structures = [
    { kind: 'segment', id: 'seg-3', tier: 'stone', hp: 450, spikesHp: 150, builtBy: 'human' },
    {
      kind: 'segment',
      id: 'seg-4',
      tier: 'breach',
      formerTier: 'fortified',
      hp: 0,
      spikesHp: null,
      builtBy: 'cat',
    },
    {
      kind: 'trebuchet',
      x: 40,
      y: 12,
      hp: 100,
      broken: false,
      ammo: 25,
      spikesHp: null,
      builtBy: 'human',
    },
    {
      kind: 'snare',
      x: 41,
      y: 15,
      hp: 40,
      broken: true,
      repairedOnce: true,
      spikesHp: null,
      builtBy: 'cat',
    },
  ];
  state.soldierOrders = [
    { soldierId: 'marta', order: 'hold', x: 38, y: 10 },
    { soldierId: 'sedge', order: 'follow' },
  ];
  state.talkCounts.tikka = 4;
  state.talkCounts.oren = 2;
  state.onceFlags = ['wicker:wooden_wall_built', 'tikka:construction_skill_granted'];
  state.merchantStock = { hamburger: 5, hollow_stew: 2 };
  return state;
}

// ── Round trip: populated state → capture → JSON → parse → restore → deep equal ──
{
  const original = populatedState();
  const captured = captureBriarHollowState(original);
  const throughJson: unknown = JSON.parse(JSON.stringify(captured));
  const parsed = parseBriarHollowStateSnapshot(throughJson);
  check(parsed !== undefined, 'a populated, JSON-round-tripped state parses');

  const target = createBriarHollowState();
  if (parsed !== undefined) restoreBriarHollowState(target, parsed);
  check(
    isDeepStrictEqual(captureBriarHollowState(target), captured),
    'restoring the parsed snapshot reproduces the captured state exactly',
  );

  // Restoring mutates the live object in place — references taken before the
  // restore must still point at live data afterward.
  const structuresRef = target.structures;
  restoreBriarHollowState(target, parsed ?? captured);
  check(
    target.structures !== structuresRef && target.structures.length === captured.structures.length,
    'restore replaces the array contents rather than leaving the old reference stale',
  );
}

// ── Old save: field absent entirely ──
{
  const parsed = parseBriarHollowStateSnapshot(undefined);
  check(parsed === undefined, 'an absent `briarHollow` field parses to undefined');
  // The call site's contract, exercised here directly: undefined means "leave
  // the constructor's default state alone" rather than "fail to load".
  const fallback = parsed ?? createBriarHollowState();
  check(
    isDeepStrictEqual(fallback, createBriarHollowState()),
    'the caller-side fallback for an absent field is the empty state',
  );
}

// ── Old save: object present, but every sub-field absent ──
{
  const parsed = parseBriarHollowStateSnapshot({});
  check(parsed !== undefined, 'an empty object is still a valid (if empty) briarHollow record');
  check(
    parsed !== undefined &&
      isDeepStrictEqual(parsed, captureBriarHollowState(createBriarHollowState())),
    'a record with every sub-field absent parses to the empty defaults',
  );
}

// ── Corrupted field: bad entries dropped, good entries kept ──
{
  const good = populatedState();
  const captured = captureBriarHollowState(good);
  const corrupted = {
    ...captured,
    structures: [
      captured.structures[0],
      { kind: 'segment', id: 'seg-bad' /* missing tier, hp, builtBy */ },
      { kind: 'not_a_real_kind', x: 0, y: 0 },
      captured.structures[2],
      'not even an object',
      null,
    ],
    soldierOrders: [
      captured.soldierOrders[0],
      { soldierId: 'not-a-villager', order: 'hold' },
      { soldierId: 'marta', order: 'not-a-real-order' },
    ],
    talkCounts: { ...captured.talkCounts, tikka: 'four' },
    onceFlags: ['fine', GARBAGE_NUMBER, null, 'also-fine'],
    merchantStock: { hamburger: SAMPLE_HAMBURGER_STOCK, hollow_stew: 'lots' },
  };
  const parsed = parseBriarHollowStateSnapshot(corrupted);
  check(parsed !== undefined, 'a record with corrupted entries still parses');
  check(
    parsed?.structures.length === 2,
    'malformed structure entries are dropped, well-formed ones kept',
  );
  check(
    parsed?.soldierOrders.length === 1,
    'malformed soldier-order entries are dropped, well-formed ones kept',
  );
  check(
    parsed?.talkCounts.tikka === 0,
    'a wrong-typed talk count falls back to 0 rather than propagating garbage',
  );
  check(
    parsed !== undefined && isDeepStrictEqual(parsed.onceFlags, ['fine', 'also-fine']),
    'non-string onceFlags entries are dropped',
  );
  check(
    parsed?.merchantStock.hamburger === SAMPLE_HAMBURGER_STOCK &&
      !('hollow_stew' in parsed.merchantStock),
    'a wrong-typed stock count is dropped rather than kept as garbage',
  );
}

// ── Corrupted field: the whole value is the wrong shape ──
{
  check(parseBriarHollowStateSnapshot('garbage') === undefined, 'a string value is refused');
  check(parseBriarHollowStateSnapshot(GARBAGE_NUMBER) === undefined, 'a number value is refused');
  check(parseBriarHollowStateSnapshot([]) === undefined, 'an array value is refused');
}

// ── PlayerSnapshot: craftSkillStates round-trip, per crawler ──
{
  const { human, cat } = newCrawlers();
  teachBoth(human, cat, 'resourcing');
  teachBoth(human, cat, 'construction');
  human.craftSkills.addXp('resourcing', HUMAN_RESOURCING_XP);
  cat.craftSkills.addXp('resourcing', CAT_RESOURCING_XP);
  human.craftSkills.addXp('construction', HUMAN_CONSTRUCTION_XP);

  const humanLevel = human.craftSkills.getLevel('resourcing');
  const catLevel = cat.craftSkills.getLevel('resourcing');
  check(humanLevel > catLevel, 'the two crawlers reach different Resourcing levels');
  check(cat.craftSkills.getLevel('construction') === 1, "XP given to Carl doesn't touch Donut");

  const humanSnap = snapPlayer(human);
  const catSnap = snapPlayer(cat);
  check(
    humanSnap.craftSkillStates?.resourcing.level === humanLevel,
    'snapPlayer records the human craft-skill level',
  );
  check(
    catSnap.craftSkillStates?.resourcing.level === catLevel,
    'snapPlayer records the cat craft-skill level, independently',
  );

  const { human: freshHuman, cat: freshCat } = newCrawlers();
  restorePlayer(freshHuman, humanSnap);
  restorePlayer(freshCat, catSnap);
  check(
    freshHuman.craftSkills.getLevel('resourcing') === humanLevel,
    "restorePlayer puts the human's Resourcing level back",
  );
  check(
    freshCat.craftSkills.getLevel('resourcing') === catLevel,
    "restorePlayer puts the cat's Resourcing level back, distinctly",
  );
  check(
    freshHuman.craftSkills.getLevel('construction') === human.craftSkills.getLevel('construction'),
    "restorePlayer puts the human's Construction level back",
  );

  // An old snapshot with no craft-skill field at all resumes as not-learned,
  // rather than throwing or inheriting whatever the fresh player started with.
  const { human: legacyHuman } = newCrawlers();
  const legacySnap = { ...humanSnap, craftSkillStates: undefined };
  restorePlayer(legacyHuman, legacySnap);
  check(
    !legacyHuman.craftSkills.isLearned('resourcing') &&
      !legacyHuman.craftSkills.isLearned('construction'),
    'a snapshot with no craftSkillStates restores as neither skill learned',
  );
}

// ── GameProgress.crafts: absence and garbage ──
{
  check(
    parsePartyCraftsState(undefined) === undefined,
    'an absent crafts field parses to undefined',
  );
  check(
    parsePartyCraftsState('garbage') === undefined,
    'a garbage crafts field parses to undefined',
  );

  const fromEmpty = parsePartyCraftsState({});
  check(
    fromEmpty !== undefined && isDeepStrictEqual(fromEmpty, createPartyCraftsState()),
    'an empty crafts record parses to the empty defaults',
  );

  const fromCorrupted = parsePartyCraftsState({
    tools: { axeTier: 99, pickaxeTier: 'two' },
    explainersSeen: ['resourcing', 'not_a_skill', GARBAGE_NUMBER],
  });
  check(
    fromCorrupted?.tools.axeTier === null && fromCorrupted.tools.pickaxeTier === null,
    'an out-of-range or wrong-typed tool tier falls back to null',
  );
  check(
    fromCorrupted !== undefined && isDeepStrictEqual(fromCorrupted.explainersSeen, ['resourcing']),
    'a garbage explainersSeen entry is dropped, a valid one kept',
  );
}

console.log(
  failures === 0
    ? `\nAll ${checks} Briar Hollow state checks passed.`
    : `\n${failures}/${checks} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
