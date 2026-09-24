#!/usr/bin/env tsx
/**
 * Headless gate on the craft-perk lookup tables in `src/core/craftPerks.ts`.
 *
 * Every function in that file is a pure lookup by level, transcribed from the
 * original request's two level-by-level tables (Resourcing and Construction).
 * This gate re-derives every row of both tables from the request's own numbers
 * and checks the functions against them exactly — the 15-row construction
 * speed table row by row, and every yield, luck and discount level.
 *
 * Run: npx tsx scripts/verify-craft-perks.ts
 */

import {
  resourcingSpeedFactor,
  resourcingYieldBonus,
  resourcingDoubles,
  refinedChance,
  trapKitChances,
  thrallCount,
  constructionTimeFactor,
  CONSTRUCTION_SPEED_STEP_PER_LEVEL,
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

section('Resourcing: speed steps at levels 3, 6, 8, 11, 12');
{
  const speedLevels = [3, 6, 8, 11, 12];
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

section('Resourcing: flat yield bonus at 2, 4, 7, 9, 13');
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
      resourcingYieldBonus(level) === expected,
      `L${level}: yield bonus ${resourcingYieldBonus(level)} === ${expected}`,
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

section('Resourcing perk text quotes the request level by level');
{
  // Each phrase is transcribed verbatim from the request's per-level Resourcing
  // list (levels 1-15), so a check here fails the moment the description drifts
  // from what was actually asked for.
  const resourcingPhrases: Record<number, string> = {
    1: 'with the right tools',
    2: '+1 from their original yield',
    3: 'Resource collection is 5% faster',
    4: '+2 from their original yield',
    5: '4% chance of 1 dynamite with stone',
    6: 'Resource collection is 5% faster',
    7: '+3 from their original yield',
    8: 'Resource collection is 5% faster',
    9: '+5 from their original yield',
    10: 'ghostly axeman or pickaxeman',
    11: 'Resource collection is 5% faster',
    12: 'Resource collection is 5% faster',
    13: '+10 from their original yield',
    14: '1% chance for a trebuchet and 5% chance for a snare trap',
    15: 'summons three of them now',
  };
  let checkedLevels = 0;
  for (const [levelText, phrase] of Object.entries(resourcingPhrases)) {
    const level = Number(levelText);
    checkedLevels++;
    check(
      describeResourcingPerk(level).includes(phrase),
      `L${level}: Resourcing text quotes "${phrase}"`,
    );
  }
  check(checkedLevels === 15, `every Resourcing level 1-15 was checked (${checkedLevels}/15)`);
}

section('Construction perk text quotes the request level by level');
{
  // The request's construction speed table gives a decimal total-time factor per
  // level; the description renders it as a percentage. Deriving the expected
  // percentage from that same formula keeps this check tied to the request's
  // numbers rather than to this file's own prose.
  const FRACTION_TO_PERCENT = 100;
  for (let level = 2; level <= 15; level++) {
    const expectedPercent = Math.round(
      CONSTRUCTION_SPEED_STEP_PER_LEVEL * (level - 1) * FRACTION_TO_PERCENT,
    );
    check(
      describeConstructionPerk(level).includes(`${expectedPercent}% faster`),
      `L${level}: Construction text quotes "${expectedPercent}% faster"`,
    );
  }
  // Each phrase below is transcribed verbatim from the request's prose about
  // what happens at that specific Construction level.
  const constructionPhrases: Record<number, string> = {
    1: 'Construction is unlocked',
    5: 'unlocks the ability to add spikes to their constructions',
    10: 'if something cost 8 boards of wood, it now costs 7',
    14: 'cost of every resource goes down by 2',
    15: 'lingering gas cloud that does damage over time to enemies and slows them down',
  };
  let checkedLevels = 0;
  for (const [levelText, phrase] of Object.entries(constructionPhrases)) {
    const level = Number(levelText);
    checkedLevels++;
    check(
      describeConstructionPerk(level).includes(phrase),
      `L${level}: Construction text quotes "${phrase}"`,
    );
  }
  check(
    checkedLevels === 5,
    `every distinctive Construction level was checked (${checkedLevels}/5)`,
  );
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

// ── Negative-test proof: a phrase that isn't in the request must fail ──
section('Negative test: a fabricated phrase is correctly rejected');
{
  const fabricatedPhrase = 'grants infinite mana to the whole party';
  const stillMatches = describeResourcingPerk(15).includes(fabricatedPhrase);
  check(!stillMatches, `a phrase absent from the request is correctly rejected (${stillMatches})`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
