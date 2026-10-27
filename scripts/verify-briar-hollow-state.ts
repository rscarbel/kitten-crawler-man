#!/usr/bin/env tsx
/**
 * Headless gate on Briar Hollow's persisted state: `src/core/quests/briarHollowState.ts`
 * (village quest/structures/soldiers/talk/stock), the per-crawler craft-skill
 * snapshot round-trip through `PlayerSnapshot`, and `GameProgress.crafts`
 * parsing through `src/core/labour/partyCrafts.ts`.
 *
 * Checks:
 *  - a populated `BriarHollowState` survives capture → JSON round-trip →
 *    parse → restore with deep equality;
 *  - a record that is absent, missing a sub-field, or holds any malformed
 *    entry or wrong-typed value is refused whole;
 *  - the human's and the cat's craft-skill levels round-trip through
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
} from '../src/core/quests/briarHollowState';
import { createPartyCraftsState, parsePartyCraftsState } from '../src/core/labour/partyCrafts';
import { teachBoth } from '../src/core/labour/CraftSkills';
import { parsePlayerSnapshot, snapPlayer, restorePlayer } from '../src/core/save/PlayerSnapshot';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { TILE_SIZE } from '../src/core/constants';
import { shopStockKey } from '../src/economy/shopStock';
import { HOLLOW_BELL_MAX_HP } from '../src/systems/briarHollow/hollowBell';

/** Not a valid `StructureRecord`, `onceFlag` or top-level shape — a wrong-typed value used across several checks below. */
const GARBAGE_NUMBER = 42;
/** Enough Resourcing XP to clear every level, so the human and cat land on visibly different levels. */
const HUMAN_RESOURCING_XP = 50000;
const CAT_RESOURCING_XP = 500;
const HUMAN_CONSTRUCTION_XP = 200;
const SAMPLE_HAMBURGER_OFFSET = -2;
const SAMPLE_STEW_OFFSET = 3;
const SAMPLE_RESTOCK_CLOCK = 120;

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
    bellTowerBroken: false,
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
  state.shopStock = {
    offsets: {
      [shopStockKey('trading_post', 'hamburger')]: SAMPLE_HAMBURGER_OFFSET,
      [shopStockKey('cookhouse', 'hollow_stew')]: SAMPLE_STEW_OFFSET,
    },
    ticksSinceRestock: SAMPLE_RESTOCK_CLOCK,
  };
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

// ── Missing or corrupted fields: the whole record is refused ──
{
  check(parseBriarHollowStateSnapshot(undefined) === undefined, 'an absent record is refused');
  check(parseBriarHollowStateSnapshot({}) === undefined, 'an empty record is refused');

  const captured = captureBriarHollowState(populatedState());
  const corruptions: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['a missing quest', { quest: undefined }],
    [
      'a siege phase, which a capture never writes',
      { quest: { ...captured.quest, phase: 'assault' } },
    ],
    [
      'a negative gathering counter',
      { quest: { ...captured.quest, gathering: { ...captured.quest.gathering, woodChopped: -1 } } },
    ],
    ['missing unlocks', { unlocks: undefined }],
    [
      'an unknown construction unlock',
      { unlocks: { ...captured.unlocks, construction: ['no_such_unlock'] } },
    ],
    [
      'a structure missing its tier, hp and builder',
      { structures: [...captured.structures, { kind: 'segment', id: 'seg-bad' }] },
    ],
    [
      'a structure of an unknown kind',
      { structures: [...captured.structures, { kind: 'not_a_real_kind', x: 0, y: 0 }] },
    ],
    ['a non-object structure', { structures: [...captured.structures, null] }],
    [
      'an order for an unknown villager',
      {
        soldierOrders: [...captured.soldierOrders, { soldierId: 'not-a-villager', order: 'hold' }],
      },
    ],
    [
      'an unknown order',
      {
        soldierOrders: [
          ...captured.soldierOrders,
          { soldierId: 'marta', order: 'not-a-real-order' },
        ],
      },
    ],
    ['a wrong-typed talk count', { talkCounts: { ...captured.talkCounts, tikka: 'four' } }],
    ['a non-string once flag', { onceFlags: ['fine', GARBAGE_NUMBER] }],
  ];
  for (const [label, override] of corruptions) {
    const corrupted: unknown = JSON.parse(JSON.stringify({ ...captured, ...override }));
    check(parseBriarHollowStateSnapshot(corrupted) === undefined, `${label} is refused`);
  }
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
  check(
    cat.craftSkills.getLevel('construction') === 1,
    "XP given to the human doesn't touch the cat",
  );

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

  const { craftSkillStates: _dropped, ...withoutCraftSkills } = humanSnap;
  check(
    parsePlayerSnapshot(JSON.parse(JSON.stringify(withoutCraftSkills)), 'human') === undefined,
    'a saved snapshot with no craftSkillStates fails validation',
  );
}

// ── GameProgress.crafts: validation ──
{
  check(parsePartyCraftsState(undefined) === undefined, 'an absent crafts field is rejected');
  check(parsePartyCraftsState('garbage') === undefined, 'a garbage crafts field is rejected');
  check(parsePartyCraftsState({}) === undefined, 'an empty crafts record is rejected');
  const fresh = createPartyCraftsState();
  check(
    isDeepStrictEqual(parsePartyCraftsState(JSON.parse(JSON.stringify(fresh))), fresh),
    'a written crafts record round-trips',
  );
  check(
    parsePartyCraftsState({ ...fresh, explainersSeen: ['resourcing', 'not_a_skill'] }) ===
      undefined,
    'an unknown explainersSeen entry fails the whole record',
  );
  check(
    parsePartyCraftsState({ ...fresh, tools: { axeTier: 99, pickaxeTier: null } }) === undefined,
    'an out-of-range tool tier fails the whole record',
  );
}

console.log(
  failures === 0
    ? `\nAll ${checks} Briar Hollow state checks passed.`
    : `\n${failures}/${checks} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
