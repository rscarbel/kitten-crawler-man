#!/usr/bin/env tsx
/**
 * Headless gate on the craft-skill event drain: `CraftSkills.pendingEvents`
 * (queued because a `Player` has no event bus in scope) has to reach the
 * `EventBus` as `craftSkillLearned` / `craftSkillLevelUp`, through
 * `SystemNoticeSystem.drainFor`, and only for the crawler that actually
 * earned the XP.
 *
 * Run: npx tsx scripts/verify-craft-level-ups.ts
 */

import { EventBus } from '../src/core/EventBus';
import { SystemNoticeSystem } from '../src/systems/SystemNoticeSystem';
import { HotbarToast } from '../src/ui/HotbarToast';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { TILE_SIZE } from '../src/core/constants';
import { RESOURCING_XP_PER_BASIC_HARVEST } from '../src/core/CraftSkills';

/** Harvests simulated to comfortably cross several Resourcing levels (L1→L2 alone costs 1000 XP at 26 XP/harvest, i.e. ~39 harvests). */
const SIMULATED_HARVEST_COUNT = 300;
/** A large multiple of one harvest's XP, big enough to have crossed several levels had the skill been learned. */
const UNLEARNED_XP_ATTEMPT_MULTIPLIER = 1000;

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

function freshRig(): {
  bus: EventBus;
  notices: SystemNoticeSystem;
  human: HumanPlayer;
  cat: CatPlayer;
  learnedEvents: { crawler: string; id: string }[];
  levelUpEvents: { crawler: string; id: string; level: number }[];
} {
  const bus = new EventBus();
  const notices = new SystemNoticeSystem(bus, new HotbarToast());
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const learnedEvents: { crawler: string; id: string }[] = [];
  const levelUpEvents: { crawler: string; id: string; level: number }[] = [];
  bus.on('craftSkillLearned', (e) => learnedEvents.push({ crawler: e.crawler, id: e.id }));
  bus.on('craftSkillLevelUp', (e) =>
    levelUpEvents.push({ crawler: e.crawler, id: e.id, level: e.level }),
  );
  return { bus, notices, human, cat, learnedEvents, levelUpEvents };
}

section('Learning a craft skill drains as craftSkillLearned, for the taught crawler only');
{
  const { notices, human, cat, learnedEvents, levelUpEvents } = freshRig();
  human.craftSkills.learn('resourcing');
  notices.drainFor(human, cat);

  check(
    learnedEvents.length === 1,
    `exactly one craftSkillLearned fired (got ${learnedEvents.length})`,
  );
  check(
    learnedEvents[0]?.crawler === 'human' && learnedEvents[0]?.id === 'resourcing',
    `event names the human crawler and resourcing (got ${JSON.stringify(learnedEvents[0])})`,
  );
  check(levelUpEvents.length === 0, 'learning alone fires no level-up');
  check(human.craftSkills.pendingEvents.length === 0, 'the drain empties the queue');
}

section('XP earned by one crawler forwards a level-up for that crawler only');
{
  const { notices, human, cat, learnedEvents, levelUpEvents } = freshRig();
  cat.craftSkills.learn('resourcing');
  notices.drainFor(human, cat);
  learnedEvents.length = 0;

  for (let i = 0; i < SIMULATED_HARVEST_COUNT; i++) {
    cat.craftSkills.addXp('resourcing', RESOURCING_XP_PER_BASIC_HARVEST);
  }
  notices.drainFor(human, cat);

  check(
    levelUpEvents.length > 0,
    `at least one craftSkillLevelUp fired (got ${levelUpEvents.length})`,
  );
  check(
    levelUpEvents.every((e) => e.crawler === 'cat' && e.id === 'resourcing'),
    'every level-up names the cat crawler and resourcing',
  );
  check(
    levelUpEvents.every((e, i) => i === 0 || e.level > levelUpEvents[i - 1].level),
    'levels reported in increasing order',
  );

  // The human never earned XP, so nothing about them should have been queued or drained.
  check(human.craftSkills.pendingEvents.length === 0, "the untouched crawler's queue stays empty");
}

section(
  'Negative test: a level-up on an unlearned skill is a no-op, and the gate would catch a drain that fired anyway',
);
{
  const { notices, human, cat, levelUpEvents } = freshRig();
  // Resourcing was never taught, so addXp is a documented no-op — CraftSkills.addXp bails when !state.learned.
  human.craftSkills.addXp(
    'resourcing',
    RESOURCING_XP_PER_BASIC_HARVEST * UNLEARNED_XP_ATTEMPT_MULTIPLIER,
  );
  notices.drainFor(human, cat);
  check(levelUpEvents.length === 0, 'no level-up fires for a skill that was never learned');

  // Prove the assertion above is a real gate, not a vacuous one: force a fake
  // pending event past the no-op and confirm the drain forwards it, so a
  // silently broken drain (one that stopped emitting) would fail the check
  // just above instead of passing by accident.
  human.craftSkills.pendingEvents.push({ kind: 'leveled', id: 'resourcing', level: 2 });
  notices.drainFor(human, cat);
  check(
    levelUpEvents.length === 1 && levelUpEvents[0]?.crawler === 'human',
    'a forced pending event does reach the bus, confirming the assertion above is not vacuous',
  );
}

console.log(`\n${checks} checks, ${failures} failures.`);
if (failures > 0) process.exit(1);
