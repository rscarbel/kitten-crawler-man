#!/usr/bin/env tsx
/**
 * Headless gate on the craft-perk lookup tables in `src/core/craftPerks.ts`.
 *
 * Every function in that file is a pure lookup by level, across two tables
 * (Resourcing and Construction). This gate checks each table's numeric
 * effects row by row — the 15-row construction speed table, and every yield,
 * luck and discount level — and separately checks that the player-facing
 * perk text is present exactly on the levels where an effect actually
 * changes, without pinning to the text's exact wording.
 *
 * Run: npx tsx scripts/verify-craft-perks.ts
 */

import {
  resourcingSpeedFactor,
  resourcingNodeCapacityBonus,
  resourcingDoubles,
  refinedChance,
  trapKitChances,
  thrallCount,
  constructionTimeFactor,
  constructionDiscount,
  spikesUnlocked,
  constructionHpMultiplier,
  unlimitedAmmo,
  infernalTrebuchets,
  snareConvertChance,
  describeResourcingPerk,
  describeConstructionPerk,
  nextResourcingUnlock,
  nextConstructionUnlock,
} from '../src/core/craftPerks';
import { MAX_CRAFT_LEVEL } from '../src/core/CraftSkills';

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

function section(name: string): void {
  console.log(`\n${name}`);
}

const EPSILON = 1e-9;
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

section('Construction: the 15-row speed table, exactly');
{
  // level → total time = 1 - 0.05 * (level - 1), taken verbatim from the request.
  const expectedTotalTime: Record<number, number> = {
    1: 1,
    2: 0.95,
    3: 0.9,
    4: 0.85,
    5: 0.8,
    6: 0.75,
    7: 0.7,
    8: 0.65,
    9: 0.6,
    10: 0.55,
    11: 0.5,
    12: 0.45,
    13: 0.4,
    14: 0.35,
    15: 0.3,
  };
  for (const [levelText, expected] of Object.entries(expectedTotalTime)) {
    const level = Number(levelText);
    const actual = constructionTimeFactor(level);
    check(approxEqual(actual, expected), `L${level}: total time factor ${actual} === ${expected}`);
  }
}

section('Resourcing: speed steps at levels 2, 3, 4, 6, 7, 8, 9, 11, 12, 13');
{
  const speedLevels = [2, 3, 4, 6, 7, 8, 9, 11, 12, 13];
  let expectedFactor = 1;
  let previousLevel = 0;
  for (const level of speedLevels) {
    // Every level up to but excluding the next step keeps the prior factor.
    for (let probe = previousLevel + 1; probe < level; probe++) {
      check(
        approxEqual(resourcingSpeedFactor(probe), expectedFactor),
        `L${probe}: speed factor holds at ${expectedFactor} before the next step`,
      );
    }
    expectedFactor -= 0.05;
    check(
      approxEqual(resourcingSpeedFactor(level), expectedFactor),
      `L${level}: speed factor steps to ${expectedFactor}`,
    );
    previousLevel = level;
  }
  for (let probe = previousLevel; probe <= MAX_CRAFT_LEVEL; probe++) {
    check(
      approxEqual(resourcingSpeedFactor(probe), expectedFactor),
      `L${probe}: speed factor holds at ${expectedFactor} after the last step`,
    );
  }
}

section('Resourcing: node capacity bonus at 2, 4, 7, 9, 13');
{
  const yieldTable: Record<number, number> = {
    1: 0,
    2: 1,
    3: 1,
    4: 2,
    5: 2,
    6: 2,
    7: 3,
    8: 3,
    9: 5,
    10: 5,
    11: 5,
    12: 5,
    13: 10,
    14: 10,
    15: 10,
  };
  for (const [levelText, expected] of Object.entries(yieldTable)) {
    const level = Number(levelText);
    check(
      resourcingNodeCapacityBonus(level) === expected,
      `L${level}: node capacity bonus ${resourcingNodeCapacityBonus(level)} === ${expected}`,
    );
  }
}

section('Resourcing: double yield only at 15');
{
  for (let level = 1; level < 15; level++) {
    check(!resourcingDoubles(level), `L${level}: no double yield`);
  }
  check(resourcingDoubles(15), 'L15: double yield');
}

section('Resourcing: refined-material chance (7% wood / 4% stone at L5-14, 100% at L15)');
{
  for (let level = 1; level < 5; level++) {
    check(refinedChance(level, 'wood') === 0, `L${level}: no refined chance for wood`);
    check(refinedChance(level, 'stone') === 0, `L${level}: no refined chance for stone`);
  }
  for (let level = 5; level <= 14; level++) {
    check(refinedChance(level, 'wood') === 0.07, `L${level}: 7% refined chance for wood`);
    check(refinedChance(level, 'stone') === 0.04, `L${level}: 4% refined chance for stone`);
  }
  check(refinedChance(15, 'wood') === 1, 'L15: certain refined material for wood');
  check(refinedChance(15, 'stone') === 1, 'L15: certain refined material for stone');
}

section('Resourcing: trap kit chances (1% treb / 5% snare from L14)');
{
  for (let level = 1; level < 14; level++) {
    const chances = trapKitChances(level);
    check(chances.treb === 0 && chances.snare === 0, `L${level}: no trap kit chance`);
  }
  for (const level of [14, 15]) {
    const chances = trapKitChances(level);
    check(chances.treb === 0.01, `L${level}: 1% trebuchet kit chance`);
    check(chances.snare === 0.05, `L${level}: 5% snare kit chance`);
  }
}

section('Resourcing: thrall count (0 below 10, 1 at 10-14, 3 at 15)');
{
  for (let level = 1; level < 10; level++) {
    check(thrallCount(level) === 0, `L${level}: no thrall`);
  }
  for (let level = 10; level <= 14; level++) {
    check(thrallCount(level) === 1, `L${level}: one thrall`);
  }
  check(thrallCount(15) === 3, 'L15: three thralls');
}

section('Construction: resource discount (0, 1 at >=10, 2 at >=14)');
{
  for (let level = 1; level < 10; level++) {
    check(constructionDiscount(level) === 0, `L${level}: no discount`);
  }
  for (let level = 10; level < 14; level++) {
    check(constructionDiscount(level) === 1, `L${level}: 1 discount`);
  }
  for (const level of [14, 15]) {
    check(constructionDiscount(level) === 2, `L${level}: 2 discount`);
  }
}

section('Construction: spikes unlock at 5');
{
  for (let level = 1; level < 5; level++) {
    check(!spikesUnlocked(level), `L${level}: spikes locked`);
  }
  for (let level = 5; level <= 15; level++) {
    check(spikesUnlocked(level), `L${level}: spikes unlocked`);
  }
}

section('Construction: HP doubling only at 15');
{
  for (let level = 1; level < 15; level++) {
    check(constructionHpMultiplier(level) === 1, `L${level}: no HP multiplier`);
  }
  check(constructionHpMultiplier(15) === 2, 'L15: HP doubled');
}

section('Construction: unlimited ammo, infernal trebuchets, and snare conversion only at 15');
{
  for (let level = 1; level < 15; level++) {
    check(!unlimitedAmmo(level), `L${level}: ammo still limited`);
    check(!infernalTrebuchets(level), `L${level}: trebuchets not infernal`);
    check(snareConvertChance(level) === 0, `L${level}: no snare conversion`);
  }
  check(unlimitedAmmo(15), 'L15: unlimited ammo');
  check(infernalTrebuchets(15), 'L15: infernal trebuchets');
  check(snareConvertChance(15) === 0.5, 'L15: 50% snare conversion');
}

// The perk-text checks below assert that a level has perk text if and only if
// its own numeric effects actually changed from the level below it — tying the
// gate to the lookup tables above rather than to the exact wording of the
// description, which is free to be reworded without breaking this gate. A
// level whose effects match the level below but which still carries new perk
// text (or vice versa) is exactly the kind of data/text drift this catches.
// Level 1 is always treated as "changed" since it is the initial unlock, which
// isn't expressed as a delta from a lower level.

section('Resourcing perk text: present exactly on levels with a real effect change');
{
  interface ResourcingSnapshot {
    speedFactor: number;
    capacityBonus: number;
    doubles: boolean;
    refinedWood: number;
    refinedStone: number;
    trebChance: number;
    snareChance: number;
    thralls: number;
  }

  function resourcingSnapshotAt(level: number): ResourcingSnapshot {
    const traps = trapKitChances(level);
    return {
      speedFactor: resourcingSpeedFactor(level),
      capacityBonus: resourcingNodeCapacityBonus(level),
      doubles: resourcingDoubles(level),
      refinedWood: refinedChance(level, 'wood'),
      refinedStone: refinedChance(level, 'stone'),
      trebChance: traps.treb,
      snareChance: traps.snare,
      thralls: thrallCount(level),
    };
  }

  const noResourcingPerkText = describeResourcingPerk(0);
  let previous = resourcingSnapshotAt(0);
  for (let level = 1; level <= MAX_CRAFT_LEVEL; level++) {
    const current = resourcingSnapshotAt(level);
    const effectChanged =
      level === 1 ||
      current.speedFactor !== previous.speedFactor ||
      current.capacityBonus !== previous.capacityBonus ||
      current.doubles !== previous.doubles ||
      current.refinedWood !== previous.refinedWood ||
      current.refinedStone !== previous.refinedStone ||
      current.trebChance !== previous.trebChance ||
      current.snareChance !== previous.snareChance ||
      current.thralls !== previous.thralls;
    const hasPerkText = describeResourcingPerk(level) !== noResourcingPerkText;
    check(
      hasPerkText === effectChanged,
      `L${level}: Resourcing perk text present (${hasPerkText}) matches an actual effect change (${effectChanged})`,
    );
    previous = current;
  }
}

section('Construction perk text: present exactly on levels with a real effect change');
{
  interface ConstructionSnapshot {
    timeFactor: number;
    discount: number;
    spikes: boolean;
    hpMultiplier: number;
    unlimitedAmmo: boolean;
    infernalTrebuchets: boolean;
    snareConvertChance: number;
  }

  function constructionSnapshotAt(level: number): ConstructionSnapshot {
    return {
      timeFactor: constructionTimeFactor(level),
      discount: constructionDiscount(level),
      spikes: spikesUnlocked(level),
      hpMultiplier: constructionHpMultiplier(level),
      unlimitedAmmo: unlimitedAmmo(level),
      infernalTrebuchets: infernalTrebuchets(level),
      snareConvertChance: snareConvertChance(level),
    };
  }

  const noConstructionPerkText = describeConstructionPerk(0);
  let previous = constructionSnapshotAt(0);
  for (let level = 1; level <= MAX_CRAFT_LEVEL; level++) {
    const current = constructionSnapshotAt(level);
    const effectChanged =
      level === 1 ||
      current.timeFactor !== previous.timeFactor ||
      current.discount !== previous.discount ||
      current.spikes !== previous.spikes ||
      current.hpMultiplier !== previous.hpMultiplier ||
      current.unlimitedAmmo !== previous.unlimitedAmmo ||
      current.infernalTrebuchets !== previous.infernalTrebuchets ||
      current.snareConvertChance !== previous.snareConvertChance;
    const hasPerkText = describeConstructionPerk(level) !== noConstructionPerkText;
    check(
      hasPerkText === effectChanged,
      `L${level}: Construction perk text present (${hasPerkText}) matches an actual effect change (${effectChanged})`,
    );
    previous = current;
  }
}

section('Next-unlock helpers point at the next row above the given level, and null once maxed');
{
  for (let level = 1; level < MAX_CRAFT_LEVEL; level++) {
    const resourcingNext = nextResourcingUnlock(level);
    const constructionNext = nextConstructionUnlock(level);
    check(
      resourcingNext !== null && resourcingNext.level > level,
      `L${level}: next Resourcing unlock is above the current level`,
    );
    check(
      constructionNext !== null && constructionNext.level > level,
      `L${level}: next Construction unlock is above the current level`,
    );
  }
  check(nextResourcingUnlock(MAX_CRAFT_LEVEL) === null, 'no Resourcing unlock past the max level');
  check(
    nextConstructionUnlock(MAX_CRAFT_LEVEL) === null,
    'no Construction unlock past the max level',
  );
}

// The perk-text checks above detect an effect change by comparing each
// level's text against the "no perk" placeholder returned for an out-of-table
// level. That comparison is only meaningful if the placeholder can never
// coincide with a real level's text — checked here directly.
section('Sentinel check: the "no perk" placeholder never matches a real level\'s text');
{
  const noResourcingPerkText = describeResourcingPerk(0);
  const noConstructionPerkText = describeConstructionPerk(0);
  for (let level = 1; level <= MAX_CRAFT_LEVEL; level++) {
    check(
      describeResourcingPerk(level) !== noResourcingPerkText,
      `L${level}: Resourcing perk text differs from the "no perk" placeholder`,
    );
    check(
      describeConstructionPerk(level) !== noConstructionPerkText,
      `L${level}: Construction perk text differs from the "no perk" placeholder`,
    );
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
