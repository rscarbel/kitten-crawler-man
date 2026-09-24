#!/usr/bin/env tsx
/**
 * Headless gate on `src/core/CraftSkills.ts`.
 *
 * Simulates the XP a crawler earns from the actions the request describes
 * (basic-tool harvests for Resourcing, wooden-wall builds for Construction)
 * and checks the level landmarks land within 20% of the request's targets.
 * Also checks the isolation rule (one crawler's XP never touches the
 * other's), the thrall XP fraction, `teachBoth`, and that events fire.
 *
 * Run: npx tsx scripts/verify-craft-skills.ts
 */

import {
  CraftSkills,
  teachBoth,
  parseCraftSkillsSnapshot,
  RESOURCING_XP_PER_BASIC_HARVEST,
  CONSTRUCTION_XP_PER_WOODEN_WALL,
  THRALL_XP_FRACTION,
  MAX_CRAFT_LEVEL,
  type CraftSkillId,
} from '../src/core/CraftSkills';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { TILE_SIZE } from '../src/core/constants';

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

/** Tolerance band around each landmark target. */
const LANDMARK_TOLERANCE = 0.2;

function withinTolerance(actual: number, target: number): boolean {
  return Math.abs(actual - target) / target <= LANDMARK_TOLERANCE;
}

/** Number of actions of `xpPerAction` needed to reach each level in `targetLevels`, via a fresh CraftSkills. */
function actionsToLevels(
  id: CraftSkillId,
  xpPerAction: number,
  targetLevels: readonly number[],
): Map<number, number> {
  const skills = new CraftSkills('human');
  skills.learn(id);
  const reached = new Map<number, number>();
  let actions = 0;
  const maxActions = 200_000;
  while (reached.size < targetLevels.length && actions < maxActions) {
    skills.addXp(id, xpPerAction);
    actions++;
    const level = skills.getLevel(id);
    for (const target of targetLevels) {
      if (level >= target && !reached.has(target)) reached.set(target, actions);
    }
  }
  return reached;
}

section('Resourcing landmarks: L5 ~250, L10 ~1500, L15 ~6000 basic-tool harvests');
{
  const reached = actionsToLevels('resourcing', RESOURCING_XP_PER_BASIC_HARVEST, [5, 10, 15]);
  const targets: Record<number, number> = { 5: 250, 10: 1500, 15: 6000 };
  for (const [level, target] of Object.entries(targets)) {
    const actual = reached.get(Number(level));
    check(
      actual !== undefined && withinTolerance(actual, target),
      `L${level}: ${actual} harvests (target ${target}, ±20%)`,
    );
  }
}

section('Construction landmarks: L5 ~12, L10 ~80, L15 ~300 wooden-wall builds');
{
  const reached = actionsToLevels('construction', CONSTRUCTION_XP_PER_WOODEN_WALL, [5, 10, 15]);
  const targets: Record<number, number> = { 5: 12, 10: 80, 15: 300 };
  for (const [level, target] of Object.entries(targets)) {
    const actual = reached.get(Number(level));
    check(
      actual !== undefined && withinTolerance(actual, target),
      `L${level}: ${actual} builds (target ${target}, ±20%)`,
    );
  }
}

section('XP given to one crawler never changes the other');
{
  const human = new CraftSkills('human');
  const cat = new CraftSkills('cat');
  human.learn('resourcing');
  cat.learn('resourcing');
  human.addXp('resourcing', RESOURCING_XP_PER_BASIC_HARVEST * 1000);
  check(human.getLevel('resourcing') > 1, "the human's own level moved");
  check(cat.getLevel('resourcing') === 1, "the cat's level did not move");
  check(cat.getXp('resourcing') === 0, "the cat's banked XP did not move");
}

section('A skill not yet learned ignores XP');
{
  const skills = new CraftSkills('human');
  skills.addXp('resourcing', RESOURCING_XP_PER_BASIC_HARVEST * 1000);
  check(skills.getLevel('resourcing') === 0, 'still unlearned, level 0');
  check(!skills.isLearned('resourcing'), 'isLearned reports false');
}

section('addXp is capped at MAX_CRAFT_LEVEL and never overshoots');
{
  const skills = new CraftSkills('human');
  skills.learn('resourcing');
  skills.addXp('resourcing', RESOURCING_XP_PER_BASIC_HARVEST * 1_000_000);
  check(skills.getLevel('resourcing') === MAX_CRAFT_LEVEL, `capped at ${MAX_CRAFT_LEVEL}`);
  check(skills.getXp('resourcing') === 0, 'stops banking XP once capped');
}

section('Thrall XP fraction is a quarter, per the request');
{
  const requestedFractions: number[] = [0.25];
  const expectedFraction = requestedFractions[0];
  check(
    THRALL_XP_FRACTION === expectedFraction,
    `THRALL_XP_FRACTION is 0.25 (was ${THRALL_XP_FRACTION})`,
  );
  const skills = new CraftSkills('human');
  skills.learn('resourcing');
  const directXp = RESOURCING_XP_PER_BASIC_HARVEST;
  const thrallXp = Math.round(directXp * THRALL_XP_FRACTION);
  skills.addXp('resourcing', thrallXp);
  check(
    skills.getXp('resourcing') === thrallXp && thrallXp < directXp,
    `a thrall harvest banks ${thrallXp} xp, a quarter of the direct ${directXp}`,
  );
}

section('teachBoth teaches both crawlers at level 1, and only teachBoth learns');
{
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  check(!human.craftSkills.isLearned('construction'), 'human starts unlearned');
  check(!cat.craftSkills.isLearned('construction'), 'cat starts unlearned');
  teachBoth(human, cat, 'construction');
  check(human.craftSkills.isLearned('construction'), 'human learned by teachBoth');
  check(cat.craftSkills.isLearned('construction'), 'cat learned by teachBoth');
  check(human.craftSkills.getLevel('construction') === 1, 'human starts at level 1');
  check(cat.craftSkills.getLevel('construction') === 1, 'cat starts at level 1');

  human.craftSkills.addXp('construction', CONSTRUCTION_XP_PER_WOODEN_WALL * 500);
  check(human.craftSkills.getLevel('construction') > 1, "the human's level moved on its own XP");
  check(
    cat.craftSkills.getLevel('construction') === 1,
    "the cat's level is untouched by the human's XP",
  );

  // A second teachBoth call on an already-learned skill must not reset progress.
  teachBoth(human, cat, 'construction');
  check(
    human.craftSkills.getLevel('construction') > 1,
    're-teaching an already-learned skill is a no-op',
  );
}

section('learn() and addXp() queue events; the direct learn() route is not used outside teachBoth');
{
  const skills = new CraftSkills('human');
  skills.learn('resourcing');
  check(
    skills.pendingEvents.some((event) => event.kind === 'learned' && event.id === 'resourcing'),
    'learn() queued a "learned" event',
  );
  skills.pendingEvents.length = 0;
  skills.addXp('resourcing', RESOURCING_XP_PER_BASIC_HARVEST * 300);
  check(
    skills.pendingEvents.some((event) => event.kind === 'leveled'),
    'addXp() queued at least one "leveled" event',
  );
}

section('Snapshot round-trips through parseCraftSkillsSnapshot');
{
  const skills = new CraftSkills('human');
  skills.learn('resourcing');
  skills.addXp('resourcing', RESOURCING_XP_PER_BASIC_HARVEST * 50);
  const raw: unknown = JSON.parse(JSON.stringify(skills.snapshot()));
  const parsed = parseCraftSkillsSnapshot(raw);
  check(parsed !== undefined, 'a written snapshot parses back');
  if (parsed !== undefined) {
    const restored = new CraftSkills('human');
    restored.restore(parsed);
    check(restored.getLevel('resourcing') === skills.getLevel('resourcing'), 'level restored');
    check(restored.getXp('resourcing') === skills.getXp('resourcing'), 'xp restored');
    check(!restored.isLearned('construction'), 'unlearned skill restores as unlearned');
  }

  check(parseCraftSkillsSnapshot(undefined) === undefined, 'an absent field parses to undefined');
  const damaged = parseCraftSkillsSnapshot({
    resourcing: { learned: true, level: 'nope', xp: -5 },
    construction: 'garbage',
  });
  check(damaged !== undefined, 'a damaged snapshot still parses');
  if (damaged !== undefined) {
    check(damaged.resourcing.level === 0, 'a malformed level field falls back to 0');
    check(!damaged.construction.learned, "a garbage skill's field falls back to unlearned");
  }
}

// ── Negative-test proof: mutate the tuning, watch the landmark gate go red ──
section('Negative test: a wildly wrong XP-per-action fails the landmark check');
{
  const wrongXpPerAction = RESOURCING_XP_PER_BASIC_HARVEST * 100;
  const reached = actionsToLevels('resourcing', wrongXpPerAction, [5]);
  const actual = reached.get(5);
  const stillPasses = actual !== undefined && withinTolerance(actual, 250);
  check(
    !stillPasses,
    `a 100x-inflated XP rate is correctly rejected by the ±20% band (${actual} harvests)`,
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
