/**
 * `verify:tactics` section holding `TRAIT_RAMPS` to the floors that ship.
 *
 * The roll-table section proves the game computes what `TRAIT_RAMPS` says;
 * this one proves what it says is worth computing. A trait whose unlock level
 * no floor mob ever reaches is a behaviour the player never meets outside a
 * bounty, and a trait that is already at its cap, or already common, on the
 * middle floor has left the rest of the game nowhere to grow.
 *
 * Levels are read from the real `LevelDef`s through the spawner's own band
 * arithmetic, and whether a creature can learn a trait is read from the real
 * creature, so retuning a band, a bonus or an eligibility list moves this gate
 * with it.
 */

import type { GameMap } from '../../src/map/GameMap';
import { createMob, MAX_MOB_LEVEL, regionLevelBand } from '../../src/levels/spawner';
import { level1, level2, level3 } from '../../src/levels';
import type { LevelDef, MobLevelRange } from '../../src/levels/types';
import { DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles';
import type { Rng } from '../../src/sprites/person/rng';
import {
  TACTICS_MIN_MOB_LEVEL,
  TACTICS_TRAITS,
  TRAIT_RAMPS,
  traitChance,
  type TacticsTrait,
} from '../../src/creatures/tactics/tacticsTraits';
import type { TacticsHarness } from './special';

/** Every floor a crawler descends through, in order. */
const SHIPPED_FLOORS: readonly LevelDef[] = [level1, level2, level3];

/** The floor that is the middle of the game rather than its end. */
const MIDDLE_FLOOR_NUMBER = 2;

/**
 * A trait's first appearance should be an occasional surprise, not the norm:
 * at its unlock level, under the normal profile, at most this share of the
 * mobs able to learn it have.
 */
const UNLOCK_CHANCE_CEILING = 0.2;

/**
 * On the middle floor, at the highest level its mobs reach, no trait is on more
 * than this share of the mobs able to learn it — so the floor where the party
 * first meets clever enemies does not already feel like the last one.
 */
const MIDDLE_FLOOR_CHANCE_CEILING = 0.25;

/** Decimal places a chance is printed to. */
const CHANCE_PRINT_DIGITS = 3;

const PROBE_TILE = 12;

/** A source that says yes to every roll, so "no trait" can only mean "not eligible". */
const ALWAYS_YES: Rng = () => 0;

/** One ambient spawn source on a shipped floor, with the highest level it can roll. */
interface AmbientSpawn {
  readonly floorNumber: number;
  readonly label: string;
  readonly type: string;
  readonly topLevel: number;
}

/**
 * The highest level a band can roll on `def`: its own top, or the floor's
 * tracking ceiling when an over-levelled party can slide it past that.
 */
function reachableTop(def: LevelDef, band: MobLevelRange): number {
  const authoredTop = band.maxLevel ?? band.minLevel ?? 1;
  return Math.max(authoredTop, Math.min(def.ambientTracking?.maxLevel ?? 0, MAX_MOB_LEVEL));
}

/**
 * Every source of ordinary floor mobs — rooms (under each region's level bonus)
 * and their escorts, hallways, camps and extra spawns. Treasure-room guards are
 * left out: a trait only met behind a chest is not one a floor has.
 */
function ambientSpawns(def: LevelDef): AmbientSpawn[] {
  const spawns: AmbientSpawn[] = [];
  const add = (label: string, type: string, band: MobLevelRange): void => {
    spawns.push({ floorNumber: def.floorNumber, label, type, topLevel: reachableTop(def, band) });
  };
  const regionBonuses = def.progression?.regionLevelBonus ?? [];
  const bonuses = regionBonuses.length > 0 ? regionBonuses : [0];
  for (const rule of def.roomMobs) {
    for (const bonus of bonuses) {
      add('room', rule.type, regionLevelBand(rule, bonus));
      for (const escort of rule.escorts ?? []) {
        add('room escort', escort.type, regionLevelBand(escort, bonus));
      }
    }
  }
  for (const rule of def.hallwayMobs) add('hallway', rule.type, rule);
  for (const roster of Object.values(def.campSpawns ?? {})) {
    for (const rule of roster) add('camp', rule.type, rule);
  }
  for (const rule of def.extraSpawns ?? []) add('extra', rule.type, rule);
  return spawns;
}

/** Every trait a spawner `type` could ever roll, or none for a boss. */
function learnableTraits(type: string, map: GameMap): readonly TacticsTrait[] {
  const mob = createMob(type, PROBE_TILE, PROBE_TILE, map);
  if (mob.isBoss) return [];
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
  return mob.tactics.traits;
}

function describe(spawn: AmbientSpawn): string {
  return `floor ${spawn.floorNumber} ${spawn.label} ${spawn.type} @${spawn.topLevel}`;
}

function checkUnlockOrder(harness: TacticsHarness): void {
  const unlocks = TACTICS_TRAITS.map((trait) => TRAIT_RAMPS[trait].unlockLevel);
  const ascending = unlocks.every((level, i) => i === 0 || level > unlocks[i - 1]);
  harness.check(
    ascending && unlocks[0] >= TACTICS_MIN_MOB_LEVEL,
    `traits unlock one after another from level ${TACTICS_MIN_MOB_LEVEL}: ${TACTICS_TRAITS.map((t, i) => `${t} ${unlocks[i]}`).join(', ')}`,
  );
  for (const trait of TACTICS_TRAITS) {
    const prerequisite = TRAIT_RAMPS[trait].requires;
    if (prerequisite === undefined) continue;
    harness.check(
      TRAIT_RAMPS[prerequisite].unlockLevel <= TRAIT_RAMPS[trait].unlockLevel,
      `${trait} unlocks no earlier than ${prerequisite}, which it needs`,
    );
  }
}

function checkUnlockChances(harness: TacticsHarness): void {
  const scale = DIFFICULTY_PROFILES.normal.tacticsChanceScale;
  for (const trait of TACTICS_TRAITS) {
    const chance = traitChance(trait, TRAIT_RAMPS[trait].unlockLevel, scale);
    harness.check(
      chance > 0 && chance <= UNLOCK_CHANCE_CEILING,
      `${trait} at unlock (normal): ${chance.toFixed(CHANCE_PRINT_DIGITS)} <= ${UNLOCK_CHANCE_CEILING}`,
    );
  }
}

export function checkTierTableFitsFloors(map: GameMap, harness: TacticsHarness): void {
  harness.section('Tier table: every trait is met on a shipped floor, and grows past it');

  checkUnlockOrder(harness);
  checkUnlockChances(harness);

  const spawns = SHIPPED_FLOORS.flatMap(ambientSpawns);
  harness.check(
    SHIPPED_FLOORS.every((def) => spawns.some((spawn) => spawn.floorNumber === def.floorNumber)),
    `every shipped floor contributes ambient spawns (${spawns.length} sources)`,
  );
  const learnable = new Map<string, readonly TacticsTrait[]>();
  for (const spawn of spawns) {
    if (!learnable.has(spawn.type)) learnable.set(spawn.type, learnableTraits(spawn.type, map));
  }
  const learners = (trait: TacticsTrait): AmbientSpawn[] =>
    spawns.filter((spawn) => (learnable.get(spawn.type) ?? []).includes(trait));

  const normalScale = DIFFICULTY_PROFILES.normal.tacticsChanceScale;
  for (const trait of TACTICS_TRAITS) {
    const ramp = TRAIT_RAMPS[trait];
    const able = learners(trait);
    const meeting = able.filter((spawn) => spawn.topLevel >= ramp.unlockLevel);
    harness.check(
      meeting.length > 0,
      `${trait} (unlocks ${ramp.unlockLevel}) is met on a floor: ${meeting.slice(0, 1).map(describe).join('') || `none of ${able.length} learners reaches it`}`,
    );

    const highest = able.reduce<AmbientSpawn | undefined>(
      (best, spawn) => (best === undefined || spawn.topLevel > best.topLevel ? spawn : best),
      undefined,
    );
    const highestChance =
      highest === undefined ? 0 : traitChance(trait, highest.topLevel, normalScale);
    harness.check(
      highest !== undefined && highestChance < ramp.maxChance,
      `${trait} is still under its cap at the highest floor level (normal): ${highestChance.toFixed(CHANCE_PRINT_DIGITS)} < ${ramp.maxChance}${highest === undefined ? '' : ` at ${describe(highest)}`}`,
    );

    const middle = able.filter((spawn) => spawn.floorNumber === MIDDLE_FLOOR_NUMBER);
    const middleTop = Math.max(0, ...middle.map((spawn) => spawn.topLevel));
    const middleChance = traitChance(trait, middleTop, normalScale);
    harness.check(
      middleChance <= MIDDLE_FLOOR_CHANCE_CEILING,
      `${trait} on floor ${MIDDLE_FLOOR_NUMBER} (normal, level ${middleTop}): ${middleChance.toFixed(CHANCE_PRINT_DIGITS)} <= ${MIDDLE_FLOOR_CHANCE_CEILING}`,
    );
  }
}
