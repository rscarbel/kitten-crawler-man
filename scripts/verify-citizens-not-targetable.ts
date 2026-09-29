#!/usr/bin/env tsx
/**
 * Citizens (`Townsperson`) are never `Mob`s, so nothing that sweeps a mob
 * roster to pick a target — Mongo, hirelings and mercenaries (including bolt
 * fire), `SpellSystem`'s homing missiles, the fairy systems — may ever select
 * one. This is a two-part gate:
 *
 * 1. Runtime: a real `Townsperson` is not `instanceof Mob`, and carries none
 *    of the mob-only surface a targeting sweep reads (`isHostile`,
 *    `isPetAttackable`, `takesPlayerDamage`).
 * 2. Static: the file list to scan is not hand-maintained. It is found by
 *    walking `src/systems` and `src/creatures` for any file that both reads a
 *    mob roster (`roster.mobs`, `mobGrid`, `SpatialGrid<Mob>`, or the
 *    `allMobs` field those roster reads get assigned into) and carries a
 *    hostile-target-selection signal (`nearestHostile`, `pickTarget`,
 *    `.isHostile`, and the like) — the combination a system needs before it
 *    could ever hand a citizen to its own targeting logic. `src/scenes` is
 *    excluded: scene files legitimately hold a `Townsperson` reference for
 *    citizen dialog while delegating all combat targeting to the systems
 *    this scan already covers, so including them would flag safe code.
 *    Every matched file's own source is then scanned for the word
 *    `Townsperson` — since every one of these systems types its candidate
 *    list as `Mob`/`Mob[]`, a system that could ever hand a citizen to its
 *    own targeting logic would first have to import or reference the class,
 *    and none of them do. Both scan functions are proven non-vacuous against
 *    a synthetic fixture that does match before being trusted against the
 *    real files, and the derived list is checked against a floor of systems
 *    it must always find — if the scan logic regresses to matching nothing,
 *    that floor catches it instead of the gate going quietly green.
 *
 * Run: npm run verify:citizens-not-targetable
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Mob } from '../src/creatures/Mob';
import { Townsperson } from '../src/creatures/Townsperson';

let failures = 0;

function check(label: string, ok: boolean): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}

// ── Part 1: a real citizen has no mob surface ───────────────────────────────

const citizen = new Townsperson({
  x: 0,
  y: 0,
  role: 'commoner',
  species: 'human',
  seed: 1,
  speed: 1,
  wander: {
    pickTarget: () => ({ x: 0, y: 0 }),
    arriveDist: 1,
    pauseMin: 1,
    pauseMax: 1,
  },
});

check('a citizen is not instanceof Mob', !(citizen instanceof Mob));
check('a citizen carries no isHostile', !('isHostile' in citizen));
check('a citizen carries no isPetAttackable', !('isPetAttackable' in citizen));
check('a citizen carries no takesPlayerDamage', !('takesPlayerDamage' in citizen));
check('a citizen self-reports as non-combatant', citizen.isNonCombatant);

// ── Part 2: no mob-roster-targeting system's own source ever names the citizen class ──

const SCAN_ROOTS = ['src/systems', 'src/creatures'];

/** A file reads a live mob roster, by one of its names in this codebase. */
const ROSTER_READ_PATTERN = /roster\.mobs|\bmobGrid\b|SpatialGrid<Mob>|\ballMobs\b/;

/** A file selects a target out of that roster by hostility. */
const TARGET_SELECTION_SIGNAL_PATTERN =
  /nearestHostile|nearestEnemy|nearestPartyThreat|pickTarget|findTarget|acquireTarget|bestTarget|closestHostile|selectTarget|\.currentTarget *=|\.isHostile\b/;

function readsRoster(source: string): boolean {
  return ROSTER_READ_PATTERN.test(source);
}

function selectsHostileTarget(source: string): boolean {
  return TARGET_SELECTION_SIGNAL_PATTERN.test(source);
}

function referencesTownsperson(source: string): boolean {
  return /\bTownsperson\b/.test(source);
}

function listTsFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      found.push(...listTsFiles(path));
    } else if (entry.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/** Every file that reads a mob roster and picks a hostile target from it. */
function findTargetingSystems(): string[] {
  const found: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const path of listTsFiles(root)) {
      const source = readFileSync(path, 'utf8');
      if (readsRoster(source) && selectsHostileTarget(source)) found.push(path);
    }
  }
  return found.sort();
}

// Prove both scan predicates can fail before trusting them against real files —
// a check that cannot go red is not a check.
check(
  'the roster-read scan catches a synthetic reference (mutation check)',
  readsRoster('const nearest = ctx.roster.mobs.find((mob) => mob.isAlive);'),
);
check('the roster-read scan passes clean source', !readsRoster('const party = ctx.roster.party;'));
check(
  'the target-selection scan catches a synthetic reference (mutation check)',
  selectsHostileTarget('if (mob.isHostile) candidates.push(mob);'),
);
check(
  'the target-selection scan passes clean source',
  !selectsHostileTarget('if (mob.isAlive) candidates.push(mob);'),
);
check(
  'the Townsperson-reference scan catches a synthetic reference (mutation check)',
  referencesTownsperson('import { Townsperson } from "../creatures/Townsperson";'),
);
check(
  'the Townsperson-reference scan passes clean source',
  !referencesTownsperson('import { Mob } from "./Mob";'),
);

const targetingSystems = findTargetingSystems();

/**
 * Systems the scan must always find. Not exhaustive — the whole point of
 * scanning is to catch systems this list doesn't name — but if the scan
 * logic regresses to matching nothing, or stops seeing the systems already
 * known to sweep a mob roster for a hostile target, this floor catches that
 * instead of the gate going quietly green on an empty scan.
 */
const EXPECTED_TARGETING_SYSTEMS: readonly string[] = [
  'src/creatures/Mob.ts',
  'src/creatures/Mongo.ts',
  'src/creatures/Mercenary.ts',
  'src/systems/HirelingBoltSystem.ts',
  'src/systems/MercenarySystem.ts',
  'src/systems/MongoSystem.ts',
  'src/systems/SpellSystem.ts',
  'src/systems/FairySystem.ts',
];

for (const expected of EXPECTED_TARGETING_SYSTEMS) {
  check(`scan floor: found ${expected}`, targetingSystems.includes(expected));
}

console.log(`scanned ${targetingSystems.length} mob-roster-targeting file(s):`);
for (const path of targetingSystems) console.log(`  ${path}`);

for (const path of targetingSystems) {
  const source = readFileSync(path, 'utf8');
  check(`${path} never references Townsperson`, !referencesTownsperson(source));
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All citizens-not-targetable checks passed');
