#!/usr/bin/env tsx
/**
 * Headless gate on the kill-XP catch-up split (`splitKillXp` in
 * `src/systems/CombatSystem.ts`): the lower-levelled crawler's guaranteed
 * floor by level gap, the floor never displacing a larger top-dealer share,
 * the split always accounting for the whole kill, and the equal-level shape
 * staying exactly what it shipped as.
 *
 * Run: npx tsx scripts/verify-xp-split.ts
 */

import { splitKillXp, xpCatchUpFloorFraction } from '../src/systems/CombatSystem';

let failures = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ok   ${description}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${description}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const TOTAL_XP = 1000;
const XP_TOP_DEALER_FRACTION = 0.85;
const MAX_GAP_TESTED = 5;
const LOW_LEVEL = 5;
const EQUAL_LEVEL = 10;
const GAP_1 = 1;
const GAP_2 = 2;
const GAP_3 = 3;
const GAP_4 = 4;
const PAST_FLOOR_TABLE_GAP = 9;
const FLOOR_GAP_1 = 0.25;
const FLOOR_GAP_2 = 0.4;
const FLOOR_GAP_3 = 0.5;
const FLOOR_GAP_4_PLUS = 0.75;

/** The level pair to test for a given gap, low crawler first. */
function levelsForGap(gap: number): { low: number; high: number } {
  return { low: LOW_LEVEL, high: LOW_LEVEL + gap };
}

section('Every kill is fully accounted for once there is a gap to close');
// At no gap and no crawler dealer, the shipped 85/15 split leaves the top
// share unclaimed — see the equal-levels section below — so that one
// combination is deliberately excluded here.
for (let gap = 0; gap <= MAX_GAP_TESTED; gap++) {
  const { low, high } = levelsForGap(gap);
  for (const topDealer of ['human', 'cat', null] as const) {
    if (gap === 0 && topDealer === null) continue;
    const split = splitKillXp({
      totalXp: TOTAL_XP,
      humanLevel: low,
      catLevel: high,
      topDealer,
    });
    check(
      split.human + split.cat === TOTAL_XP,
      `gap ${gap}, human low, top=${String(topDealer)}: ${split.human} + ${split.cat} === ${TOTAL_XP}`,
    );
  }
}

section(
  "Equal levels: today's 85/15 dealer split, unclaimed top share when neither crawler dealt it",
);
{
  const human = splitKillXp({
    totalXp: TOTAL_XP,
    humanLevel: EQUAL_LEVEL,
    catLevel: EQUAL_LEVEL,
    topDealer: 'human',
  });
  check(
    human.human === Math.round(TOTAL_XP * XP_TOP_DEALER_FRACTION) &&
      human.cat === TOTAL_XP - human.human,
    `human top dealer: ${human.human}/${human.cat}`,
  );
  const cat = splitKillXp({
    totalXp: TOTAL_XP,
    humanLevel: EQUAL_LEVEL,
    catLevel: EQUAL_LEVEL,
    topDealer: 'cat',
  });
  check(
    cat.cat === Math.round(TOTAL_XP * XP_TOP_DEALER_FRACTION) && cat.human === TOTAL_XP - cat.cat,
    `cat top dealer: ${cat.human}/${cat.cat}`,
  );
  const nobody = splitKillXp({
    totalXp: TOTAL_XP,
    humanLevel: EQUAL_LEVEL,
    catLevel: EQUAL_LEVEL,
    topDealer: null,
  });
  const unclaimedShareXp = TOTAL_XP - Math.round(TOTAL_XP * XP_TOP_DEALER_FRACTION);
  check(
    nobody.cat === 0 && nobody.human === unclaimedShareXp,
    `no crawler dealt it: the 85% stays unclaimed, same as it always has (${nobody.human}/${nobody.cat})`,
  );
}

section('Named floors by level gap');
check(xpCatchUpFloorFraction(0) === 0, 'gap 0: no floor');
check(xpCatchUpFloorFraction(GAP_1) === FLOOR_GAP_1, 'gap 1: 25%');
check(xpCatchUpFloorFraction(GAP_2) === FLOOR_GAP_2, 'gap 2: 40%');
check(xpCatchUpFloorFraction(GAP_3) === FLOOR_GAP_3, 'gap 3: 50%');
check(xpCatchUpFloorFraction(GAP_4) === FLOOR_GAP_4_PLUS, 'gap 4: 75%');
check(
  xpCatchUpFloorFraction(PAST_FLOOR_TABLE_GAP) === FLOOR_GAP_4_PLUS,
  'gap 9 (past 4): still 75%',
);

section('The floor is a guarantee, not a cap, for both dealer orderings');
for (let gap = 1; gap <= MAX_GAP_TESTED; gap++) {
  const { low, high } = levelsForGap(gap);
  const floor = xpCatchUpFloorFraction(gap);
  const floorXp = Math.max(1, Math.round(TOTAL_XP * floor));

  // The lower-levelled crawler is human here — she is guaranteed the floor
  // whoever dealt the damage, and never less of it.
  const higherIsTopDealer = splitKillXp({
    totalXp: TOTAL_XP,
    humanLevel: low,
    catLevel: high,
    topDealer: 'cat',
  });
  check(
    higherIsTopDealer.human === floorXp,
    `gap ${gap}, higher-levelled cat is top dealer: lower-levelled human gets exactly the floor (${higherIsTopDealer.human} vs ${floorXp})`,
  );
  check(
    higherIsTopDealer.cat === TOTAL_XP - floorXp,
    `gap ${gap}: the higher-levelled crawler gets the rest (${higherIsTopDealer.cat})`,
  );

  const nobodyDealt = splitKillXp({
    totalXp: TOTAL_XP,
    humanLevel: low,
    catLevel: high,
    topDealer: null,
  });
  check(
    nobodyDealt.human === floorXp && nobodyDealt.cat === TOTAL_XP - floorXp,
    `gap ${gap}, non-crawler top dealer: nothing is left unclaimed (${nobodyDealt.human}/${nobodyDealt.cat})`,
  );

  // The lower-levelled crawler landing the kill herself keeps the 85% dealer
  // share, which is larger than every floor above.
  const lowerIsTopDealer = splitKillXp({
    totalXp: TOTAL_XP,
    humanLevel: low,
    catLevel: high,
    topDealer: 'human',
  });
  const dealerXp = Math.max(1, Math.round(TOTAL_XP * XP_TOP_DEALER_FRACTION));
  check(
    lowerIsTopDealer.human === dealerXp,
    `gap ${gap}: lower-levelled top dealer keeps the 85% dealer share (${lowerIsTopDealer.human} vs ${dealerXp})`,
  );

  // Same gap, roles reversed: the cat is now the lower-levelled crawler.
  const reversedHigherIsTopDealer = splitKillXp({
    totalXp: TOTAL_XP,
    humanLevel: high,
    catLevel: low,
    topDealer: 'human',
  });
  check(
    reversedHigherIsTopDealer.cat === floorXp,
    `gap ${gap}, reversed: lower-levelled cat gets exactly the floor when the human is top dealer (${reversedHigherIsTopDealer.cat} vs ${floorXp})`,
  );
}

section('A trash-mob kill is split without conjuring or losing XP');
// Rats and cockroaches are worth a couple of points, where rounding each side
// separately would round both up (or both down) and break the sum.
const SMALL_KILL_MAX_XP = 7;
for (let totalXp = 1; totalXp <= SMALL_KILL_MAX_XP; totalXp++) {
  for (let gap = 1; gap <= MAX_GAP_TESTED; gap++) {
    const { low, high } = levelsForGap(gap);
    for (const topDealer of ['human', 'cat', null] as const) {
      const split = splitKillXp({ totalXp, humanLevel: low, catLevel: high, topDealer });
      check(
        split.human + split.cat === totalXp && split.human >= 1,
        `${totalXp} XP, gap ${gap}, top dealer ${topDealer ?? 'none'}: ${split.human} + ${split.cat}, lower-levelled human gets at least one`,
      );
    }
  }
}

console.log(failures === 0 ? '\nAll XP-split checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
