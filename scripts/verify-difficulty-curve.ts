#!/usr/bin/env tsx
/**
 * Headless gate on the mob level curve: does an on-schedule party keep facing
 * roughly the same share of its HP lost per fight as it levels up?
 *
 * A fight's cost is roughly how long the mob survives times how fast it drains
 * the crawler. Every number on both sides of that product comes from the game
 * itself:
 *
 * - The crawler is `referenceStats` — the real stat, HP, dodge and damage
 *   formulas, fed a point allocation, with no gear, skills or consumables.
 * - The mob is the real creature class, built headlessly through the same
 *   factories the spawner uses and levelled through `applyMobLevel`. Its HP is
 *   read off the instance, the player's blows are landed through its own
 *   `takeDamageFrom` (so damage reduction and immunities count), and its damage
 *   output is *measured*: the creature's own `updateAI` is run against a
 *   stationary crawler for a fixed window, and every blow it lands — and every
 *   projectile it launches — is summed. Nothing about a creature's stats is
 *   written into this file.
 *
 * The HP share per fight is then
 * `(presses to kill × frames per press) × mob damage per frame × (1 − dodge) ÷ max HP`,
 * and the rules in the constants below are asserted over it. A creature that
 * cannot be built, cannot be killed, or deals no measurable damage fails the
 * gate rather than being skipped.
 *
 * The roster is read out of the level definitions and the bounty registry, so a
 * creature added to a spawn table is checked without anyone editing this file.
 *
 * The same measured creatures are then put together into the rooms the spawner
 * really rolls, and a whole room fight against both crawlers is held to the
 * target-feel band for HP remaining.
 *
 * Run: npm run verify:difficulty-curve
 */

import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { ALL_STATS, type DamageSource } from '../src/Player';
import { Mob } from '../src/creatures/Mob';
import { BrindleGrub } from '../src/creatures/BrindleGrub';
import { GoblinArcher } from '../src/creatures/GoblinArcher';
import { Llama } from '../src/creatures/Llama';
import { RockGolem } from '../src/creatures/RockGolem';
import { SkeletonArcher } from '../src/creatures/SkeletonArcher';
import { SkeletonLord } from '../src/creatures/SkeletonLord';
import { TheLich } from '../src/creatures/TheLich';
import { EvilClown } from '../src/creatures/EvilClown';
import { DarkKnight } from '../src/creatures/DarkKnight';
import { Mercenary } from '../src/creatures/Mercenary';
import {
  createMob,
  earnedLevelFloor,
  getRegisteredMobTypes,
  progressionRegions,
  MAX_MOB_LEVEL,
  TREASURE_ROOM_EXTRA_MOBS,
  TREASURE_ROOM_LEVEL_BOOST,
  recommendedPartyLevelFor,
  regionLevelBand,
  partyTrackedBand,
  regionLevelBonusFor,
  resolveAmbientLevel,
  resolveBossLevel,
  rollRoomPopulation,
} from '../src/levels/spawner';
import { level1, level2, level3, tutorialLevel } from '../src/levels';
import type { LevelDef, MobLevelRange, MobSpawnRule } from '../src/levels/types';
import { BOUNTY_DEFS, type BountyDef } from '../src/systems/bountyDefs';
import {
  bountyBossLevel,
  bountyMinionLevel,
  stageBountyEncounter,
} from '../src/systems/BountySystem';
import {
  DIFFICULTY_PROFILES,
  type Difficulty,
  type DifficultyProfile,
} from '../src/core/difficultyProfiles';
import { withWorldSeed, worldRandom } from '../src/core/WorldRandom';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import type { GameSystem, SystemContext } from '../src/systems/GameSystem';
import { ClownGasSystem } from '../src/systems/ClownGasSystem';
import { RockThrowSystem } from '../src/systems/RockThrowSystem';
import { SkeletonProjectileSystem } from '../src/systems/SkeletonProjectileSystem';
import { GoblinArrowSystem } from '../src/systems/GoblinArrowSystem';
import { SkeletonSummonSystem } from '../src/systems/SkeletonSummonSystem';
import { KnightMissileSystem } from '../src/systems/KnightMissileSystem';
import { BOUNTY_COMMIT_STAGGER_MAX_FRAMES, EncounterCommitment } from '../src/systems/bountyCommit';
import { settings } from '../src/core/Settings';
import {
  REFERENCE_BUILD_NAMES,
  REFERENCE_CRAWLERS,
  referenceStats,
  type ReferenceBuild,
  type ReferenceCrawler,
  type PointCounting,
  type ReferenceStats,
} from '../src/core/referenceCrawler';
import {
  cooldownScaleForLevel,
  damageScaleForLevel,
  hpScaleForLevel,
  MAX_MOB_DAMAGE_MULTIPLIER,
  MAX_MOB_HP_MULTIPLIER,
  MAX_MOB_PROJECTILE_SPEED_MULTIPLIER,
  MAX_MOB_SPEED_MULTIPLIER,
  projectileSpeedScaleForLevel,
  SHARED_LEVELLED_CURVE,
  type LevelledCurve,
  speedScaleForLevel,
  BOSS_HP_SHARE_CEILING,
  BOUNTY_MAX_BLOW_HP_SHARE,
  HARD_HP_SHARE_CEILING,
  MOB_LEVEL_DAMAGE_SCALE,
  MOB_LEVEL_HP_SCALE,
  MOB_LEVEL_PROJECTILE_SPEED_SCALE,
  MOB_LEVEL_SPEED_SCALE,
  RATIO_CEILING_MIN_HP_SHARE,
  REAL_FIGHT_MIN_PRESSES,
  EARLY_HP_SHARE_DIP_TOLERANCE,
  EARLY_RAMP_PARTY_LEVELS,
  HITS_TO_KILL_MAX,
  HITS_TO_KILL_MIN,
  HP_SHARE_CEILING,
  HP_SHARE_DIP_TOLERANCE,
  HP_SHARE_TREND_WINDOW,
  HP_SHARE_END_MAX,
  HP_SHARE_END_MIN,
  OFF_STAT_HP_SHARE_MAX,
  OFF_STAT_PARTY_HP_SHARE_MAX,
  OFF_STAT_UNAVOIDABLE_HP_REMAINING_MIN,
  HARD_ROOM_FIGHT_HP_REMAINING_MIN,
  LOCKED_TELEGRAPH_MIN_FRAMES,
  ROOM_FIGHT_HP_REMAINING_MAX,
  ROOM_FIGHT_HP_REMAINING_MIN,
  TIME_TO_KILL_MAX_SECONDS,
} from '../src/creatures/mobLevelScaling';
import { TILE_SIZE } from '../src/core/constants';

// ── Harness constants ────────────────────────────────────────────────────────

/** Seed for the stand-in `Math.random`, so every run measures the same fights. */
const SIM_SEED = 0x5eed_c0de;
/** Side of the walled test arena, in tiles — room for a ranged mob to back off to its firing band. */
const ARENA_SIZE_TILES = 24;
/** Where the mob is dropped; the crawler stands on the next tile east. */
const MOB_TILE = 12;
/**
 * Frames each mob is run with no one to fight before it is measured: long
 * enough for anything that grows in the wild (a brindle grub's two moults) to
 * reach the form the party actually meets.
 */
const WARMUP_FRAMES = 6000;
/** Frames of fighting each mob's damage output is averaged over (two minutes at 60 fps). */
const MEASURE_FRAMES = 7200;
/** The blow that opens every measured fight, so a neutral creature is provoked. */
const PROVOKING_BLOW = 1;
/** A mob still standing after this many presses is reported as unkillable. */
const MAX_PRESSES_TO_KILL = 2000;
/** How far past the spawn-level cap the ceiling checks keep sampling. */
const PARTY_LEVELS_PAST_CAP = 5;
/** Floating-point slack for comparisons between two computed reals. */
const EPSILON = 1e-9;
/** A share of a crawler's bar, printed as a percentage. */
const PERCENT = 100;
const FRAMES_PER_SECOND = 60;
/** A level far past any the game hands out, for the multiplier-ceiling checks. */
const ABSURD_LEVEL = 1000;
/** Decimal places the tables print ratios with. */
const TABLE_DECIMALS = 2;
/** Column width the tables pad each cell to. */
const TABLE_CELL_WIDTH = 7;

// ── Output ───────────────────────────────────────────────────────────────────

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

function cell(value: number | string): string {
  const text = typeof value === 'number' ? value.toFixed(TABLE_DECIMALS) : value;
  return text.padStart(TABLE_CELL_WIDTH);
}

// ── Determinism ──────────────────────────────────────────────────────────────

const UINT32_RANGE = 0x1_0000_0000;
const MULBERRY_INCREMENT = 0x6d2b79f5;
const MULBERRY_SHIFT_A = 15;
const MULBERRY_SHIFT_B = 7;
const MULBERRY_SHIFT_C = 14;
const MULBERRY_MUL_B = 61;

/** A small seeded generator, installed over `Math.random` before every measurement. */
function seedRandom(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> MULBERRY_SHIFT_A), t | 1);
    t ^= t + Math.imul(t ^ (t >>> MULBERRY_SHIFT_B), t | MULBERRY_MUL_B);
    return ((t ^ (t >>> MULBERRY_SHIFT_C)) >>> 0) / UINT32_RANGE;
  };
}

// ── The arena and the stand-in crawler ───────────────────────────────────────

function isArenaEdge(x: number, y: number, sizeTiles: number): boolean {
  const last = sizeTiles - 1;
  return x === 0 || y === 0 || x === last || y === last;
}

function makeArena(sizeTiles = ARENA_SIZE_TILES): GameMap {
  const grid: TileContent[][] = Array.from({ length: sizeTiles }, (_, y) =>
    Array.from({ length: sizeTiles }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: isArenaEdge(x, y, sizeTiles) ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
    })),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/**
 * A crawler that records every blow and never falls, flinches or dodges, so a
 * fight can run for the whole window and dodge can be applied afterwards from
 * the reference build instead of rolled.
 *
 * Blows are sorted the way `Player.takeDamage` treats them: a mob's blow is
 * scaled by the difficulty profile and may be dodged unless it is marked
 * undodgeable; a status tick (poison, burn) or other non-mob harm is neither
 * scaled nor dodgeable. Status effects a mob applies run on this crawler's own
 * `tickTimers`, so their ticks arrive here exactly as they would in the game.
 */
class DamageLedger extends HumanPlayer {
  dodgeable = 0;
  undodgeable = 0;
  unscaled = 0;

  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (amount <= 0) return false;
    if (source?.kind !== 'mob') this.unscaled += amount;
    else if (source.undodgeable === true) this.undodgeable += amount;
    else this.dodgeable += amount;
    return true;
  }
}

/** A {@link DamageLedger} that also keeps the largest single blow it took. */
class LargestBlowLedger extends DamageLedger {
  largestBlow = 0;

  override takeDamage(amount: number, source?: DamageSource): boolean {
    this.largestBlow = Math.max(this.largestBlow, amount);
    return super.takeDamage(amount, source);
  }
}

/**
 * The projectile hand-offs this harness knows how to count. Each is drained
 * every frame exactly as its system would, and assumed to land — the crawler
 * is standing still.
 */
const KNOWN_PROJECTILE_HANDOFFS: ReadonlySet<string> = new Set([
  'takePendingShots',
  'takePendingSpits',
  'takePendingThrows',
  'takePendingVials',
  'takePendingMissiles',
  'takePendingSummons',
]);

function projectileDamageLaunched(mob: Mob): number {
  let damage = 0;
  if (mob instanceof GoblinArcher) for (const shot of mob.takePendingShots()) damage += shot.damage;
  if (mob instanceof SkeletonArcher)
    for (const shot of mob.takePendingShots()) damage += shot.damage;
  if (mob instanceof SkeletonLord) for (const shot of mob.takePendingShots()) damage += shot.damage;
  if (mob instanceof TheLich) for (const shot of mob.takePendingShots()) damage += shot.damage;
  if (mob instanceof Llama) for (const spit of mob.takePendingSpits()) damage += spit.damage;
  if (mob instanceof RockGolem) for (const rock of mob.takePendingThrows()) damage += rock.damage;
  if (mob instanceof Mercenary) for (const rock of mob.takePendingThrows()) damage += rock.damage;
  if (mob instanceof EvilClown) for (const vial of mob.takePendingVials()) damage += vial.damage;
  if (mob instanceof DarkKnight)
    for (const bolt of mob.takePendingMissiles()) damage += bolt.damage;
  return damage;
}

/**
 * Every `takePending*` method on the mob's prototype chain. One this harness
 * does not drain is a projectile whose damage would silently go unmeasured, so
 * finding one fails the gate instead.
 */
function projectileHandoffsOf(mob: Mob): string[] {
  const names: string[] = [];
  let proto: unknown = Object.getPrototypeOf(mob);
  while (proto !== null && typeof proto === 'object' && proto !== Mob.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name.startsWith('takePending')) names.push(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return names;
}

// ── Measuring a creature ─────────────────────────────────────────────────────

type MobFactory = (tileX: number, tileY: number, map: GameMap) => Mob;

interface CreatureLevelSample {
  readonly maxHp: number;
  readonly dodgeableDamagePerFrame: number;
  readonly undodgeableDamagePerFrame: number;
  /** Status ticks and other harm the game neither scales by difficulty nor lets be dodged. */
  readonly unscaledDamagePerFrame: number;
}

interface Creature {
  readonly key: string;
  readonly make: MobFactory;
  readonly isBoss: boolean;
  /**
   * The curve a boss's floor levels it on, so its own ratio path reads the
   * boss the game spawns. Regular creatures meet several floors and carry
   * their floor's curve on each encounter instead.
   */
  readonly bossCurve?: LevelledCurve;
  /** The band a boss's floor spawns it in. */
  readonly bossBand?: MobLevelRange;
}

/** A levelled, warmed-up instance standing in the arena, before any fight. */
function buildWarmed(
  creature: Creature,
  level: number,
  map: GameMap,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): Mob {
  const mob = creature.make(MOB_TILE, MOB_TILE, map);
  mob.setMap(map);
  mob.applyMobLevel(level, curve);
  for (let frame = 0; frame < WARMUP_FRAMES; frame++) {
    if (mob instanceof BrindleGrub) mob.tickEvolve();
    mob.updateAI([]);
    mob.tickTimers();
    projectileDamageLaunched(mob);
  }
  return mob;
}

/**
 * Opens a fight the way a player would — a blow of each kind, so a creature
 * that shrugs off one (a calm sky fowl ignores fists) is still provoked — then
 * puts the mob back at full health.
 */
function provoke(mob: Mob, crawler: DamageLedger): void {
  mob.takeDamageFrom(PROVOKING_BLOW, crawler, 'melee');
  mob.takeDamageFrom(PROVOKING_BLOW, crawler, 'missile');
  mob.hp = mob.maxHp;
}

/**
 * Bosses whose harm is resolved by an encounter system this harness does not
 * run, keyed to the reason. Their damage cannot be measured by standing a
 * crawler beside them, so it is priced from the shared damage and cadence
 * curves instead — only the boss band, a ratio against the boss's own level-1
 * fight, is asserted for them, and there the authored numbers cancel. The gate
 * fails if a listed boss is not a boss in the roster, or if it turns out to be
 * measurable after all, so this list cannot go stale.
 */
const CURVE_PRICED_BOSSES: ReadonlyMap<string, string> = new Map([
  [
    'the_hoarder',
    'her vomit is launched through `pendingVomitProjectiles` for the scene to resolve',
  ],
  ['ball_of_swine', 'its trample and stench burst are resolved by `ArenaSystem`'],
]);

const sampleCache = new Map<string, CreatureLevelSample>();

function measure(
  creature: Creature,
  level: number,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): CreatureLevelSample {
  if (CURVE_PRICED_BOSSES.has(creature.key)) return curvePriced(creature, level, curve);
  return measureBehaviour(creature, level, curve);
}

/** A cache-key suffix that tells a floor's own stat scale apart from the shared curves. */
function curveKey(curve: LevelledCurve): string {
  return `~${curve.hpPerLevel}/${curve.damagePerLevel}${curve.roundsUp ? '↑' : ''}`;
}

function curvePriced(creature: Creature, level: number, curve: LevelledCurve): CreatureLevelSample {
  seedRandom(SIM_SEED);
  const mob = buildWarmed(creature, level, makeArena(), curve);
  return {
    maxHp: mob.maxHp,
    dodgeableDamagePerFrame: damageScaleForLevel(level, curve) / cooldownScaleForLevel(level),
    undodgeableDamagePerFrame: 0,
    unscaledDamagePerFrame: 0,
  };
}

function measureBehaviour(
  creature: Creature,
  level: number,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): CreatureLevelSample {
  const cacheKey = `${creature.key}@${level}${curveKey(curve)}`;
  const cached = sampleCache.get(cacheKey);
  if (cached !== undefined) return cached;

  seedRandom(SIM_SEED);
  const map = makeArena();
  const mob = buildWarmed(creature, level, map, curve);
  const maxHp = mob.maxHp;
  const crawler = new DamageLedger(MOB_TILE + 1, MOB_TILE, TILE_SIZE);
  if (creature.isBoss) mob.forceAggro = true;
  provoke(mob, crawler);

  let projectileDamage = 0;
  for (let frame = 0; frame < MEASURE_FRAMES; frame++) {
    if (mob instanceof BrindleGrub) mob.tickEvolve();
    mob.updateAI([crawler]);
    mob.tickTimers();
    crawler.tickTimers();
    projectileDamage += projectileDamageLaunched(mob);
  }
  const sample: CreatureLevelSample = {
    maxHp,
    dodgeableDamagePerFrame: (crawler.dodgeable + projectileDamage) / MEASURE_FRAMES,
    undodgeableDamagePerFrame: crawler.undodgeable / MEASURE_FRAMES,
    unscaledDamagePerFrame: crawler.unscaled / MEASURE_FRAMES,
  };
  sampleCache.set(cacheKey, sample);
  return sample;
}

interface KillCost {
  /** Attack-key presses to empty the mob's health bar, as a real number. */
  readonly pressesFractional: number;
  /** Whole presses a real kill takes. */
  readonly pressesWhole: number;
  readonly framesPerPress: number;
}

const killCache = new Map<string, KillCost>();

/**
 * What the crawler's attack cycle does to this creature at this level, landed
 * through the creature's own `takeDamageFrom`.
 */
function killCost(
  creature: Creature,
  level: number,
  attacker: ReferenceStats,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): KillCost | null {
  const cycleKey = attacker.attackCycle.map((a) => `${a.damageType}${a.damage}`).join(',');
  const cacheKey = `${creature.key}@${level}${curveKey(curve)}:${cycleKey}`;
  const cached = killCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const framesPerPress =
    attacker.attackCycle.reduce((sum, attack) => sum + attack.frames, 0) /
    attacker.attackCycle.length;
  const meanPressDamage =
    attacker.attackCycle.reduce((sum, attack) => sum + attack.damage, 0) /
    attacker.attackCycle.length;

  seedRandom(SIM_SEED);
  const map = makeArena();
  const crawler = new DamageLedger(MOB_TILE + 1, MOB_TILE, TILE_SIZE);
  const probe = buildWarmed(creature, level, map, curve);
  // A curve-priced boss is only vulnerable in the phases its encounter system
  // drives, so its health bar is priced at face value instead of being struck.
  if (CURVE_PRICED_BOSSES.has(creature.key)) {
    const pressesFractional = probe.maxHp / meanPressDamage;
    const faceValue: KillCost = {
      pressesFractional,
      pressesWhole: Math.ceil(pressesFractional),
      framesPerPress,
    };
    killCache.set(cacheKey, faceValue);
    return faceValue;
  }
  provoke(probe, crawler);
  const dropPerAttack = attacker.attackCycle.map((attack) => {
    probe.hp = probe.maxHp;
    probe.takeDamageFrom(attack.damage, crawler, attack.damageType);
    return probe.maxHp - probe.hp;
  });
  const meanDropPerPress =
    dropPerAttack.reduce((sum, drop) => sum + drop, 0) / dropPerAttack.length;

  seedRandom(SIM_SEED);
  const victim = buildWarmed(creature, level, makeArena(), curve);
  provoke(victim, crawler);
  let presses = 0;
  while (victim.isAlive && presses < MAX_PRESSES_TO_KILL) {
    const attack = attacker.attackCycle[presses % attacker.attackCycle.length];
    victim.takeDamageFrom(attack.damage, crawler, attack.damageType);
    presses++;
  }
  if (meanDropPerPress <= 0 || victim.isAlive) return null;

  const cost: KillCost = {
    pressesFractional: probe.maxHp / meanDropPerPress,
    pressesWhole: presses,
    framesPerPress,
  };
  killCache.set(cacheKey, cost);
  return cost;
}

// ── The fight model ──────────────────────────────────────────────────────────

interface FightPrice {
  /** Share of the crawler's max HP one stand-up fight costs. */
  readonly hpShare: number;
  readonly pressesWhole: number;
  readonly pressesFractional: number;
}

function priceFight(
  creature: Creature,
  mobLevel: number,
  crawler: ReferenceCrawler,
  build: ReferenceBuild,
  partyLevel: number,
  profile: DifficultyProfile,
  counting: PointCounting,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): FightPrice | null {
  const stats = referenceStats(crawler, build, partyLevel, counting);
  const sample = measure(creature, mobLevel, curve);
  const cost = killCost(creature, mobLevel, stats, curve);
  if (cost === null) return null;
  const fightFrames = cost.pressesFractional * cost.framesPerPress;
  const blowDamagePerFrame =
    sample.dodgeableDamagePerFrame * (1 - stats.dodgeChance) + sample.undodgeableDamagePerFrame;
  // Status ticks are flat by rule and never scale with level, so they would
  // only dilute the ratio checks; they are counted where a single real fight
  // is priced, which is what whole-point counting stands for.
  const unscaledPerFrame = counting === 'whole' ? sample.unscaledDamagePerFrame : 0;
  const damageTaken =
    blowDamagePerFrame * fightFrames * profile.incomingMobDamageScale +
    unscaledPerFrame * fightFrames;
  return {
    hpShare: damageTaken / stats.maxHp,
    pressesWhole: cost.pressesWhole,
    pressesFractional: cost.pressesFractional,
  };
}

// ── The roster ───────────────────────────────────────────────────────────────

const LEVEL_DEFS: readonly LevelDef[] = [tutorialLevel, level1, level2, level3];
const ARENA_ORIGIN_PREFIX = 'arena:';
/** What `DefendQuestSystem` fields in every wave. */
const DEFEND_WAVE_TYPE = 'bugaboo';
/** Big enough to host every bounty site the generator places. */
const BOUNTY_MAP_SIZE = 220;
/** Levels a bounty encounter is built at to discover its members; defs may size the escort by level. */
const BOUNTY_DISCOVERY_LEVELS = [1, MAX_MOB_LEVEL];

function registryFactory(type: string): MobFactory {
  return (tileX, tileY, map) => createMob(type, tileX, tileY, map);
}

const REGISTERED_TYPES = getRegisteredMobTypes();

/** The registry key whose factory builds the same class as `mob`, if any. */
function registryKeyFor(mob: Mob, scratch: GameMap): string | null {
  for (const type of REGISTERED_TYPES) {
    const probe = createMob(type, 1, 1, scratch);
    if (Object.getPrototypeOf(probe) === Object.getPrototypeOf(mob)) return type;
  }
  return null;
}

/** Where an on-schedule party meets a regular creature: a floor, and the band it rolls in there. */
interface Encounter {
  readonly def: LevelDef;
  readonly band: MobLevelRange;
  /** The floor's stat scale this spawn is levelled with. */
  readonly curve: LevelledCurve;
}

/** One ambient spawn on a floor: what it is, the band it rolls in, and the scale it is levelled with. */
interface AmbientSpawn {
  readonly type: string;
  readonly band: MobLevelRange;
  readonly curve: LevelledCurve;
}

interface Roster {
  readonly encounters: ReadonlyMap<string, readonly Encounter[]>;
  readonly regular: Creature[];
  readonly bosses: Creature[];
  readonly escorts: Creature[];
  readonly bountyMarks: Creature[];
  readonly unbuildable: string[];
}

/**
 * Every ambient spawn on a floor with the band it rolls in and the curve it is
 * levelled on. Rooms take the floor's largest region bonus, as the spawner adds
 * it to every room band; hallways, camps and extra spawns take none, because
 * the spawner never gives them one. A treasure room's guards stand at the top
 * of their room band, bonus included, plus `TREASURE_ROOM_LEVEL_BOOST`. A
 * creature spawned by another's death inherits the dead mob's level, so it is
 * given the whole span of the floor's ambient bands.
 */
function ambientSpawns(def: LevelDef): AmbientSpawn[] {
  const largestBonus = Math.max(0, ...(def.progression?.regionLevelBonus ?? []));
  const spawns: Array<Omit<AmbientSpawn, 'curve'>> = [];
  for (const rule of def.roomMobs) {
    const roomBand = regionLevelBand(rule, largestBonus);
    spawns.push({ type: rule.type, band: roomBand });
    for (const escort of rule.escorts ?? []) {
      spawns.push({ type: escort.type, band: regionLevelBand(escort, largestBonus) });
    }
    if (def.hasTreasureRoomGuards === true) {
      const guardLevel = Math.min(bandTop(roomBand) + TREASURE_ROOM_LEVEL_BOOST, MAX_MOB_LEVEL);
      spawns.push({ type: rule.type, band: { minLevel: guardLevel, maxLevel: guardLevel } });
    }
  }
  for (const rule of def.hallwayMobs) spawns.push({ type: rule.type, band: rule });
  for (const roster of Object.values(def.campSpawns ?? {})) {
    for (const rule of roster) spawns.push({ type: rule.type, band: rule });
  }
  for (const rule of def.extraSpawns ?? []) {
    if (!rule.origin.startsWith(ARENA_ORIGIN_PREFIX)) spawns.push({ type: rule.type, band: rule });
  }
  const floorSpan: MobLevelRange = {
    minLevel: Math.min(...spawns.map((spawn) => spawn.band.minLevel ?? 1)),
    maxLevel: Math.max(...spawns.map((spawn) => bandTop(spawn.band))),
  };
  for (const rule of def.onMobKilledSpawns ?? []) spawns.push({ type: rule.type, band: floorSpan });
  // The defend quest's wave is a mandatory choke, levelled on the same curve
  // from the floor's own band with no region bonus.
  const wave = def.defendQuestWave;
  if (wave !== undefined) spawns.push({ type: DEFEND_WAVE_TYPE, band: wave });
  const curve = def.levelledCurve ?? SHARED_LEVELLED_CURVE;
  return spawns.map((spawn) => ({ ...spawn, curve }));
}

function bandTop(band: MobLevelRange): number {
  return band.maxLevel ?? band.minLevel ?? 1;
}

function arenaBossTypes(def: LevelDef): string[] {
  return (def.extraSpawns ?? [])
    .filter((rule) => rule.origin.startsWith(ARENA_ORIGIN_PREFIX))
    .map((rule) => rule.type);
}

function buildRoster(): Roster {
  const scratch = makeArena();
  const unbuildable: string[] = [];
  const regular = new Map<string, Creature>();
  const bosses = new Map<string, Creature>();

  const encounters = new Map<string, Encounter[]>();

  const admit = (
    type: string,
    forceBoss: boolean,
    bossCurve?: LevelledCurve,
    bossBand?: MobLevelRange,
  ): void => {
    if (regular.has(type) || bosses.has(type)) return;
    if (!REGISTERED_TYPES.includes(type)) {
      unbuildable.push(`${type} (not in the spawner registry)`);
      return;
    }
    let isBoss: boolean;
    try {
      isBoss = forceBoss || createMob(type, 1, 1, scratch).isBoss;
    } catch (error) {
      unbuildable.push(`${type} (${String(error)})`);
      return;
    }
    const creature: Creature = {
      key: type,
      make: registryFactory(type),
      isBoss,
      bossCurve,
      bossBand,
    };
    (isBoss ? bosses : regular).set(type, creature);
  };

  for (const def of LEVEL_DEFS) {
    for (const spawn of ambientSpawns(def)) {
      admit(spawn.type, false);
      const known = encounters.get(spawn.type) ?? [];
      const alreadyMet = known.some(
        (seen) =>
          seen.def === def &&
          bandTop(seen.band) === bandTop(spawn.band) &&
          seen.curve === spawn.curve,
      );
      if (!alreadyMet) known.push({ def, band: spawn.band, curve: spawn.curve });
      encounters.set(spawn.type, known);
    }
    const floorCurve = def.levelledCurve ?? SHARED_LEVELLED_CURVE;
    for (const type of arenaBossTypes(def)) admit(type, true, floorCurve);
    for (const rule of def.bossRooms ?? []) admit(rule.type, true, floorCurve, rule);
  }

  const escorts = new Map<string, Creature>();
  const bountyMarks = new Map<string, Creature>();
  const bountyMap = new GameMap({ mapSize: BOUNTY_MAP_SIZE, mapType: 'overworld' });
  if (bountyMap.bountySites.length === 0) {
    unbuildable.push('every bounty (the overworld produced no bounty site)');
  } else {
    const site = bountyMap.bountySites[0];
    for (const def of BOUNTY_DEFS) {
      for (const level of BOUNTY_DISCOVERY_LEVELS) {
        const { boss, minions } = def.spawn(site.x, site.y, bountyMap, level);
        const markKey = `${def.id} mark`;
        if (!bountyMarks.has(markKey)) {
          bountyMarks.set(markKey, bountyCreature(markKey, boss, scratch, true));
        }
        for (const minion of minions) {
          const registered = registryKeyFor(minion, scratch);
          const key = registered ?? `${def.id} escort ${minion.mobType}`;
          if (escorts.has(key)) continue;
          escorts.set(key, bountyCreature(key, minion, scratch, false));
        }
      }
    }
  }

  return {
    encounters,
    regular: [...regular.values()],
    bosses: [...bosses.values()],
    escorts: [...escorts.values()],
    bountyMarks: [...bountyMarks.values()],
    unbuildable,
  };
}

/**
 * A factory for a class met only inside a bounty encounter: the registry's if
 * it has one, otherwise the class's own constructor, called with the
 * `(tileX, tileY, tileSize)` every creature takes.
 */
function bountyCreature(key: string, sample: Mob, scratch: GameMap, isBoss: boolean): Creature {
  const registered = registryKeyFor(sample, scratch);
  if (registered !== null) return { key, make: registryFactory(registered), isBoss };
  const ctor = sample.constructor;
  const make: MobFactory = (tileX, tileY, map) => {
    const built: unknown = Reflect.construct(ctor, [tileX, tileY, TILE_SIZE]);
    if (!(built instanceof Mob)) throw new Error(`${key} did not construct a Mob`);
    built.setMap(map);
    return built;
  };
  return { key, make, isBoss };
}

// ── Paths through the game ───────────────────────────────────────────────────

/** A band with no authored limits, so the path measures the curve rather than a floor's clamp. */
const UNCLAMPED_BAND: MobLevelRange = { minLevel: 1, maxLevel: MAX_MOB_LEVEL };

/** The first party level whose ambient spawn level reaches the cap, under `profile`. */
function partyLevelAtCap(levelFor: (party: number) => number): number {
  let party = 1;
  while (levelFor(party) < MAX_MOB_LEVEL) party++;
  return party;
}

function ambientLevel(profile: DifficultyProfile): (party: number) => number {
  return (party) => earnedLevelFloor(UNCLAMPED_BAND, party, profile);
}

function bossLevel(profile: DifficultyProfile): (party: number) => number {
  return (party) => resolveBossLevel(UNCLAMPED_BAND, party, profile);
}

function escortLevel(profile: DifficultyProfile): (party: number) => number {
  return (party) => bountyMinionLevel(party, party, profile);
}

function markLevel(profile: DifficultyProfile): (party: number) => number {
  return (party) => bountyBossLevel(party, party, profile);
}

interface PathRow {
  readonly partyLevel: number;
  readonly mobLevel: number;
  readonly hpShare: number;
  readonly ratio: number;
  readonly pressesWhole: number;
  readonly pressesFractional: number;
}

function walkPath(
  creature: Creature,
  crawler: ReferenceCrawler,
  build: ReferenceBuild,
  profile: DifficultyProfile,
  levelFor: (party: number) => number,
  lastPartyLevel: number,
  counting: PointCounting,
  firstPartyLevel = 1,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): PathRow[] | null {
  const rows: PathRow[] = [];
  let baseline: number | null = null;
  for (let partyLevel = firstPartyLevel; partyLevel <= lastPartyLevel; partyLevel++) {
    const mobLevel = levelFor(partyLevel);
    const price = priceFight(
      creature,
      mobLevel,
      crawler,
      build,
      partyLevel,
      profile,
      counting,
      curve,
    );
    if (price === null) return null;
    baseline ??= price.hpShare;
    rows.push({
      partyLevel,
      mobLevel,
      hpShare: price.hpShare,
      ratio: baseline > 0 ? price.hpShare / baseline : Infinity,
      pressesWhole: price.pressesWhole,
      pressesFractional: price.pressesFractional,
    });
  }
  return rows;
}

function printPath(label: string, rows: readonly PathRow[]): void {
  console.log(`      ${label}`);
  console.log(`      ${['party', 'mob', 'share', 'ratio', 'hits'].map(cell).join('')}`);
  for (const row of rows) {
    console.log(
      `      ${[
        cell(String(row.partyLevel)),
        cell(String(row.mobLevel)),
        cell(row.hpShare),
        cell(row.ratio),
        cell(String(row.pressesWhole)),
      ].join('')}`,
    );
  }
}

// ── The checks ───────────────────────────────────────────────────────────────

const NORMAL = DIFFICULTY_PROFILES.normal;
const NORMAL_CAP_PARTY_LEVEL = partyLevelAtCap(ambientLevel(NORMAL));
const LAST_SAMPLED_PARTY_LEVEL = NORMAL_CAP_PARTY_LEVEL + PARTY_LEVELS_PAST_CAP;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/**
 * Each row's ratio averaged with the rows before it, over one trend window.
 * The ceiling reads raw rows instead: the top of a tooth in the sawtooth is a
 * fight the player really has.
 */
function trailingTrend(rows: readonly PathRow[]): number[] {
  return rows.map((_, i) => {
    const window = rows.slice(Math.max(0, i - HP_SHARE_TREND_WINDOW + 1), i + 1);
    return window.reduce((sum, row) => sum + row.ratio, 0) / window.length;
  });
}

/**
 * The rows at which the spawn level rises — the first row, and every row whose
 * mob is a level above the row before.
 *
 * The trend is only compared between these. Spawn levels are rounded from
 * party level, so the mob holds one level for one or two party levels while
 * the crawler keeps growing; comparing inside such a hold measures the
 * crawler's growth against no growth at all, and would fail any curve.
 */
function spawnLevelSteps(rows: readonly PathRow[]): number[] {
  return rows
    .map((row, i) => ({ row, i }))
    .filter(({ row, i }) => i === 0 || row.mobLevel > rows[i - 1].mobLevel)
    .map(({ i }) => i);
}

/** The rules a regular creature's balanced-build path must satisfy, with the offending rows. */
function curveViolations(rows: readonly PathRow[], capPartyLevel: number): string[] {
  const problems: string[] = [];
  const trend = trailingTrend(rows);
  const steps = spawnLevelSteps(rows).filter((i) => rows[i].partyLevel <= capPartyLevel);
  for (let k = 1; k < steps.length; k++) {
    const before = trend[steps[k - 1]];
    const after = trend[steps[k]];
    const tolerance =
      rows[steps[k]].partyLevel <= EARLY_RAMP_PARTY_LEVELS
        ? EARLY_HP_SHARE_DIP_TOLERANCE
        : HP_SHARE_DIP_TOLERANCE;
    if (after < before * (1 - tolerance) - EPSILON) {
      problems.push(
        `trend falls ${before.toFixed(TABLE_DECIMALS)}→${after.toFixed(TABLE_DECIMALS)} at party ${rows[steps[k]].partyLevel}`,
      );
    }
  }
  const capIndex = rows.findIndex((row) => row.partyLevel === capPartyLevel);
  if (capIndex < 0) {
    problems.push(`no row at the cap party level ${capPartyLevel}`);
  } else {
    const atCap = trend[capIndex];
    if (atCap < HP_SHARE_END_MIN - EPSILON || atCap > HP_SHARE_END_MAX + EPSILON) {
      problems.push(
        `trend ends at ${atCap.toFixed(TABLE_DECIMALS)}× (want ${HP_SHARE_END_MIN}–${HP_SHARE_END_MAX}×)`,
      );
    }
  }
  return [...problems, ...ceilingViolations(rows, HP_SHARE_CEILING)];
}

/**
 * Every sampled row whose ratio tops `ceiling`, except a fight that costs less
 * than {@link RATIO_CEILING_MIN_HP_SHARE} of max HP: a ratio ceiling exists to
 * stop a fight becoming unwinnable, and a fight that cheap is not one however
 * far it has risen from its own level-1 cost.
 */
function ceilingViolations(rows: readonly PathRow[], ceiling: number): string[] {
  return rows
    .filter((row) => row.ratio > ceiling + EPSILON && row.hpShare >= RATIO_CEILING_MIN_HP_SHARE)
    .map(
      (row) =>
        `${row.ratio.toFixed(TABLE_DECIMALS)}× at party ${row.partyLevel}, costing ${row.hpShare.toFixed(TABLE_DECIMALS)} of max HP (ceiling ${ceiling}×)`,
    );
}

function hitsViolations(rows: readonly PathRow[]): string[] {
  const outside = rows.filter(
    (row) => row.pressesWhole < HITS_TO_KILL_MIN || row.pressesWhole > HITS_TO_KILL_MAX,
  );
  return outside.map(
    (row) =>
      `${row.pressesWhole} hits at party ${row.partyLevel} (want ${HITS_TO_KILL_MIN}–${HITS_TO_KILL_MAX})`,
  );
}

function offStatViolations(rows: readonly PathRow[]): string[] {
  return rows
    .filter((row) => row.hpShare >= OFF_STAT_HP_SHARE_MAX)
    .map(
      (row) =>
        `loses a 1v1 at party ${row.partyLevel} (share ${row.hpShare.toFixed(TABLE_DECIMALS)})`,
    );
}

/**
 * The path re-read against its first real fight.
 *
 * A baseline over in fewer presses than the shortest real fight (a level-1 rat
 * under a single punch) is a rounding error, and every ratio against it would
 * measure that error rather than the curve. The path is instead read from the
 * first party level whose fight lasts at least {@link REAL_FIGHT_MIN_PRESSES}
 * presses; null when there is none.
 */
function rebasedOnFirstRealFight(rows: readonly PathRow[]): PathRow[] | null {
  const first = rows.findIndex((row) => row.pressesFractional >= REAL_FIGHT_MIN_PRESSES);
  if (first < 0) return null;
  const baseline = rows[first].hpShare;
  return rows.slice(first).map((row) => ({ ...row, ratio: row.hpShare / baseline }));
}

/** Every path read as chaff, so the gate can insist chaff stays the exception. */
const chaffPairs: string[] = [];

/** Runs `rule` over a path read from its first real fight. */
function reportRatios(
  label: string,
  rows: readonly PathRow[] | null,
  rule: (rows: readonly PathRow[]) => string[],
): void {
  if (rows === null) {
    report(label, ['could not be priced'], null);
    return;
  }
  const rebased = rebasedOnFirstRealFight(rows);
  // Chaff: no fight on the whole path lasts past a single blow, so no ratio
  // is readable — and a fight settled in one blow cannot turn unwinnable. The
  // where-met checks still price every one of those fights absolutely.
  if (rebased === null) {
    chaffPairs.push(label);
    console.log(
      `  note ${label}: chaff to this crawler — no fight lasts ${REAL_FIGHT_MIN_PRESSES} presses; held to the where-met checks`,
    );
    return;
  }
  const firstParty = rebased[0].partyLevel;
  const suffix = firstParty > 1 ? ` (read from party ${firstParty}, its first real fight)` : '';
  report(`${label}${suffix}`, rule(rebased), rebased);
}

function report(label: string, problems: readonly string[], rows: readonly PathRow[] | null): void {
  check(problems.length === 0, problems.length === 0 ? label : `${label}: ${problems.join('; ')}`);
  if (problems.length > 0 && rows !== null) printPath(label, rows);
}

// ── Run ──────────────────────────────────────────────────────────────────────

section('multiplier ceilings');
{
  const curves: ReadonlyArray<{
    name: string;
    scale: (level: number) => number;
    perLevel: number;
    ceiling: number;
  }> = [
    {
      name: 'hp',
      scale: hpScaleForLevel,
      perLevel: MOB_LEVEL_HP_SCALE,
      ceiling: MAX_MOB_HP_MULTIPLIER,
    },
    {
      name: 'damage',
      scale: damageScaleForLevel,
      perLevel: MOB_LEVEL_DAMAGE_SCALE,
      ceiling: MAX_MOB_DAMAGE_MULTIPLIER,
    },
    {
      name: 'speed',
      scale: speedScaleForLevel,
      perLevel: MOB_LEVEL_SPEED_SCALE,
      ceiling: MAX_MOB_SPEED_MULTIPLIER,
    },
    {
      name: 'projectile speed',
      scale: projectileSpeedScaleForLevel,
      perLevel: MOB_LEVEL_PROJECTILE_SPEED_SCALE,
      ceiling: MAX_MOB_PROJECTILE_SPEED_MULTIPLIER,
    },
  ];
  for (const curve of curves) {
    check(curve.scale(1) === 1, `${curve.name}: level 1 is unscaled`);
    // Read off the unclamped rate, not the clamped curve: the ceiling is a
    // backstop for a raised level cap, and a raised rate must not be able to
    // hide under it at the levels the game hands out today.
    const unclampedAtCap = 1 + (MAX_MOB_LEVEL - 1) * curve.perLevel;
    check(
      unclampedAtCap <= curve.ceiling + EPSILON,
      `${curve.name}: the rate reaches ${unclampedAtCap.toFixed(TABLE_DECIMALS)} at the level cap, within its ceiling ${curve.ceiling}`,
    );
    check(
      Math.abs(curve.scale(ABSURD_LEVEL) - curve.ceiling) < EPSILON,
      `${curve.name}: a level far past the cap is held at the ceiling`,
    );
  }
}

section('reference crawler');
{
  for (const crawler of REFERENCE_CRAWLERS) {
    for (const build of REFERENCE_BUILD_NAMES) {
      const first = referenceStats(crawler, build, 1);
      const later = referenceStats(crawler, build, LAST_SAMPLED_PARTY_LEVEL);
      const pointsSpent = ALL_STATS.map((stat) => later.stats[stat] - first.stats[stat]).reduce(
        (sum, gained) => sum + gained,
        0,
      );
      check(pointsSpent > 0, `${crawler} ${build}: spends points as the party levels`);
    }
    const offStat = referenceStats(crawler, 'off-stat', LAST_SAMPLED_PARTY_LEVEL);
    const balanced = referenceStats(crawler, 'balanced', LAST_SAMPLED_PARTY_LEVEL);
    const offStatDamage = offStat.attackCycle.reduce((sum, attack) => sum + attack.damage, 0);
    const balancedDamage = balanced.attackCycle.reduce((sum, attack) => sum + attack.damage, 0);
    check(
      offStatDamage < balancedDamage,
      `${crawler}: the off-stat build hits softer than balanced`,
    );
  }
}

section('roster');
const roster = buildRoster();
check(
  roster.unbuildable.length === 0,
  roster.unbuildable.length === 0
    ? 'every creature in a spawn table or bounty can be built headlessly'
    : `cannot build: ${roster.unbuildable.join(', ')}`,
);
check(
  roster.regular.length > 0,
  `${roster.regular.length} regular creatures found in the spawn tables`,
);
check(roster.bosses.length > 0, `${roster.bosses.length} bosses found in the spawn tables`);
check(roster.escorts.length > 0, `${roster.escorts.length} bounty escorts found`);
console.log(`  regular: ${roster.regular.map((c) => c.key).join(', ')}`);
console.log(`  bosses:  ${roster.bosses.map((c) => c.key).join(', ')}`);
console.log(`  escorts: ${roster.escorts.map((c) => c.key).join(', ')}`);
console.log(`  marks:   ${roster.bountyMarks.map((c) => c.key).join(', ')}`);

section('every creature can be measured');
const measurable = new Set<string>();
{
  for (const [key, reason] of CURVE_PRICED_BOSSES) {
    const boss = roster.bosses.find((creature) => creature.key === key);
    check(boss !== undefined, `${key} is priced from the curves because ${reason}, and is a boss`);
    if (boss === undefined) continue;
    const measured = measureBehaviour(boss, 1);
    const measuredDamage = measured.dodgeableDamagePerFrame + measured.undodgeableDamagePerFrame;
    check(measuredDamage === 0, `${key} still deals nothing this harness can measure`);
  }

  const everyone = [...roster.regular, ...roster.bosses, ...roster.escorts, ...roster.bountyMarks];
  for (const creature of everyone) {
    let problem: string | null = null;
    try {
      const probe = creature.make(MOB_TILE, MOB_TILE, makeArena());
      const unknownHandoffs = projectileHandoffsOf(probe).filter(
        (name) => !KNOWN_PROJECTILE_HANDOFFS.has(name),
      );
      if (unknownHandoffs.length > 0) {
        problem = `launches through ${unknownHandoffs.join(', ')}, which this gate does not count`;
      } else {
        const first = measure(creature, 1);
        const damage = first.dodgeableDamagePerFrame + first.undodgeableDamagePerFrame;
        if (damage <= 0) problem = 'dealt no damage in the measured window';
        else if (killCost(creature, 1, referenceStats('human', 'balanced', 1)) === null)
          problem = 'could not be killed by a punch';
      }
    } catch (error) {
      problem = `threw: ${String(error)}`;
    }
    check(
      problem === null,
      `${creature.key}${problem === null ? ' is measurable' : `: ${problem}`}`,
    );
    if (problem === null) measurable.add(creature.key);
  }
}

section(
  `regular creatures, balanced build, normal (party 1–${LAST_SAMPLED_PARTY_LEVEL}, cap at ${NORMAL_CAP_PARTY_LEVEL})`,
);
for (const creature of roster.regular) {
  if (!measurable.has(creature.key)) continue;
  for (const crawler of REFERENCE_CRAWLERS) {
    const rows = walkPath(
      creature,
      crawler,
      'balanced',
      NORMAL,
      ambientLevel(NORMAL),
      LAST_SAMPLED_PARTY_LEVEL,
      'expected',
    );
    reportRatios(`${creature.key} vs ${crawler}`, rows, (path) =>
      curveViolations(path, NORMAL_CAP_PARTY_LEVEL),
    );
  }
}

/**
 * Floors in the order a party plays them, so each floor's window of party
 * levels ends where the next floor's begins.
 */
const FLOOR_ORDER: readonly LevelDef[] = LEVEL_DEFS;

/**
 * The party levels a floor is the party's current floor: from the level it
 * recommends to the level the next floor recommends. A party still on a floor
 * past that has out-levelled it, and one-shotting its chaff is the reward for
 * that, not a flaw in the curve. The last floor is held for a few levels past
 * its recommendation.
 */
function floorWindow(def: LevelDef): { first: number; last: number } {
  const first = recommendedPartyLevelFor(def, NORMAL);
  const index = FLOOR_ORDER.indexOf(def);
  const next = FLOOR_ORDER.find((_, i) => i === index + 1);
  const last =
    next === undefined
      ? first + PARTY_LEVELS_PAST_CAP
      : Math.max(first, recommendedPartyLevelFor(next, NORMAL) - 1);
  return { first, last };
}

/**
 * The rows where an on-schedule party meets `creature` on each floor it
 * spawns on, over that floor's window, against the top of the creature's band
 * there — the worst roll it can make.
 */
function encounterPaths(
  creature: Creature,
  crawler: ReferenceCrawler,
  build: ReferenceBuild,
): Array<{ label: string; rows: PathRow[] | null; curve: LevelledCurve }> {
  const paths: Array<{ label: string; rows: PathRow[] | null; curve: LevelledCurve }> = [];
  for (const encounter of roster.encounters.get(creature.key) ?? []) {
    const window = floorWindow(encounter.def);
    const top = bandTop(encounter.band);
    const rows = walkPath(
      creature,
      crawler,
      build,
      NORMAL,
      () => top,
      window.last,
      'whole',
      window.first,
      encounter.curve,
    );
    paths.push({
      label: `${creature.key} on ${encounter.def.id} (level ${top})`,
      rows,
      curve: encounter.curve,
    });
  }
  return paths;
}

type WhereMetRule = 'hits' | 'offStat';

/**
 * Creatures whose *authored* level-1 stats already sit outside a where-met
 * rule, so no level curve can bring them inside it — keyed to the rule and the
 * reason. They are still held to every ratio check, which is what the curve
 * controls. An entry that stops being needed fails the gate, so the list
 * cannot outlive the reason for it.
 */
/**
 * How far past its own level-1 kill an exempt creature's hits may go where it
 * is met — enough for the curve's gentle growth, not enough to hide a sponge.
 */
const EXEMPT_HITS_GROWTH_ALLOWANCE = 1.25;

const AUTHORED_OUTSIDE_WHERE_MET: ReadonlyMap<string, ReadonlyMap<WhereMetRule, string>> = new Map([
  [
    'rat',
    new Map([['hits', 'authored as chaff: three HP, one punch from a crawler with any strength']]),
  ],
  [
    'troglodyte',
    new Map([
      ['hits', 'authored as a tank: twenty-two HP, eleven punches at level 1 against level 1'],
    ]),
  ],
  [
    'brindle_grub',
    new Map([['hits', 'its final moult is authored as an elite: ten punches at level 1']]),
  ],
]);

function reportWhereMet(
  creature: Creature,
  rule: WhereMetRule,
  label: string,
  rows: readonly PathRow[] | null,
  problemsOf: (rows: readonly PathRow[]) => string[],
): void {
  if (rows === null) {
    report(label, ['could not be priced'], null);
    return;
  }
  const problems = problemsOf(rows);
  const exemption = AUTHORED_OUTSIDE_WHERE_MET.get(creature.key)?.get(rule);
  if (exemption === undefined) {
    report(label, problems, rows);
    return;
  }
  console.log(`  note ${label}: exempt from the band, ${exemption}`);
  if (rule === 'hits') {
    const authored = killCost(creature, 1, referenceStats('human', 'balanced', 1));
    const bound =
      authored === null ? 0 : Math.floor(authored.pressesWhole * EXEMPT_HITS_GROWTH_ALLOWANCE);
    const spongier = rows.filter((row) => row.pressesWhole > bound);
    report(
      `${label} stays within ${EXEMPT_HITS_GROWTH_ALLOWANCE}× its authored level-1 kill (${bound} hits)`,
      spongier.map((row) => `${row.pressesWhole} hits at party ${row.partyLevel}`),
      rows,
    );
  }
  exemptionsStillNeeded.set(
    `${creature.key}/${rule}`,
    (exemptionsStillNeeded.get(`${creature.key}/${rule}`) ?? false) || problems.length > 0,
  );
}

const exemptionsStillNeeded = new Map<string, boolean>();

section('regular creatures where they are met, hits to kill (human, balanced)');
for (const creature of roster.regular) {
  if (!measurable.has(creature.key)) continue;
  const paths = encounterPaths(creature, 'human', 'balanced');
  check(paths.length > 0, `${creature.key} has at least one spawn band to be met in`);
  for (const path of paths) {
    // The hits band is what keeps the shared curve from turning a mob into a
    // sponge. A floor on its own curve is held instead to the fights and blows
    // it was tuned with, below, including the llama it always took eight
    // blows to drop.
    if (path.curve !== SHARED_LEVELLED_CURVE) {
      console.log(
        `  note ${path.label}: on its floor's own curve, held to its tuned fights instead`,
      );
      continue;
    }
    reportWhereMet(creature, 'hits', path.label, path.rows, hitsViolations);
  }
}

section('regular creatures where they are met, the off-stat build still wins');
for (const creature of roster.regular) {
  if (!measurable.has(creature.key)) continue;
  for (const crawler of REFERENCE_CRAWLERS) {
    for (const path of encounterPaths(creature, crawler, 'off-stat')) {
      reportWhereMet(
        creature,
        'offStat',
        `${path.label} vs ${crawler}`,
        path.rows,
        offStatViolations,
      );
    }
  }
}

section('the harness still sees what it prices');
{
  // Chaff is a judgement about a creature, not a way out of the ratio rules:
  // if a threshold drifted so that ordinary fights read as chaff, every ratio
  // check would pass having read nothing.
  const readableRegulars = roster.regular.filter((creature) =>
    REFERENCE_CRAWLERS.some((crawler) => !chaffPairs.includes(`${creature.key} vs ${crawler}`)),
  );
  check(
    readableRegulars.length === roster.regular.length,
    'every regular creature has a readable ratio path against at least one crawler',
  );
  const statusDealers = roster.regular.filter(
    (creature) => measurable.has(creature.key) && measure(creature, 1).unscaledDamagePerFrame > 0,
  );
  check(
    statusDealers.length > 0,
    `status ticks reach the ledger (${statusDealers.map((c) => c.key).join(', ') || 'none'})`,
  );
  for (const def of LEVEL_DEFS) {
    if (def.defendQuestWave === undefined) continue;
    const met = (roster.encounters.get(DEFEND_WAVE_TYPE) ?? []).some((e) => e.def === def);
    check(met, `the ${def.id} defend-quest wave is priced where it is met`);
  }
}

section('where-met exemptions are still needed');
for (const [key, rules] of AUTHORED_OUTSIDE_WHERE_MET) {
  for (const rule of rules.keys()) {
    const needed = exemptionsStillNeeded.get(`${key}/${rule}`);
    check(needed === true, `${key} still falls outside the ${rule} rule where it is met`);
  }
}

// ── Room fights ──────────────────────────────────────────────────────────────
//
// Everything above prices one mob against one crawler. A room is several mobs
// against both crawlers at once, and that is where the target-feel band in
// `docs/difficulty-fairness-rules.md` is read: HP remaining after a regular
// fight, as party HP over party max HP — the quantity the `?difficulty`
// overlay records.
//
// The encounters are the spawner's own. On a floor of rooms: its rule weights,
// `rollRoomPopulation` for the counts (region bonus and over-level
// reinforcement included). On the overworld, which has no rooms: each camp's
// whole roster, and a pair of its scattered hallway mobs. Every body's level
// comes from `resolveAmbientLevel`, so a floor that tracks the party is priced
// as it tracks. Each body is the measured creature from the harness above.
//
// The fight model: both crawlers stand and attack together, as their default
// aggressive stances do, so a mob dies at their combined rate; the party works
// through the room in no particular order; and a living mob's blows fall on
// either crawler alike, each dodged by that crawler's own chance. A room that
// would empty the pooled bar counts as none left rather than as less than none.

/** Encounters rolled per source at each sampled point, so a rare count still shows up. */
const ROOM_SAMPLES_PER_RULE = 60;
/** Seed for the encounter rolls, so every run prices the same rooms. */
const ROOM_ROLL_SEED = 0x7007_5eed;
/**
 * The floor a first-time crawler learns the game on. It is easier on purpose,
 * so it is held only to the bottom of the band — a room there must not force a
 * retreat, but it may cost very little.
 */
const LEARNING_FLOOR_NUMBER = 1;
/** Crawlers a living mob's blows are shared between. */
const PARTY_SIZE = 2;
/**
 * The share of every other mob's kill time a mob stays alive for when the
 * party takes the room in no particular order: in a random order, each other
 * mob dies before it half the time.
 */
const RANDOM_ORDER_SHARE_KILLED_FIRST = 0.5;
/**
 * Scattered overworld mobs met at once. They stand alone, but one fight on the
 * road usually draws a neighbour in before it ends.
 */
const OVERWORLD_ENCOUNTER_BODIES = 2;
/** The build the band is asserted for. */
const ROOM_FIGHT_BUILD: ReferenceBuild = 'balanced';
/** A stronger build, printed beside it: roughly how a player who spends well sees the same rooms. */
const ROOM_FIGHT_STRONG_BUILD: ReferenceBuild = 'offense-heavy';
const MIDPOINT = 0.5;

interface RoomBody {
  readonly creature: Creature;
  readonly level: number;
  /** The spawning floor's `levelledCurve`; absent means the shared curve. */
  readonly curve?: LevelledCurve;
}

/**
 * The party levels a floor's fights are read over: from the level it
 * recommends to the level its XP curve's last tier starts at — the point past
 * which clearing more of the floor barely moves the party, so where a thorough
 * party leaves it. A floor with no curve keeps its window from the where-met
 * checks.
 */
function fightWindow(def: LevelDef): { first: number; last: number } {
  const window = floorWindow(def);
  const tiers = def.xpDiminishingTiers ?? [];
  if (tiers.length === 0) return window;
  const plateau = Math.max(...tiers.map((tier) => tier.minPlayerLevel));
  return { first: window.first, last: Math.max(window.first, plateau) };
}

/** Early, middle and late in {@link fightWindow}. */
function fightSamplePoints(def: LevelDef): Array<{ label: string; partyLevel: number }> {
  const window = fightWindow(def);
  return [
    { label: 'early', partyLevel: window.first },
    { label: 'mid', partyLevel: Math.round((window.first + window.last) * MIDPOINT) },
    { label: 'late', partyLevel: window.last },
  ];
}

/** One kind of regular fight a floor offers, and how to roll one. */
interface EncounterSource {
  readonly label: string;
  /** Share of the floor's fights this source stands for, among its siblings. */
  readonly weight: number;
  readonly roll: (partyLevel: number, profile: DifficultyProfile) => BodyRoll[];
  /**
   * Whether a party crossing the floor cannot help meeting this fight. A camp is
   * a landmark the party can walk around; a room on the path or the roaming
   * mobs on every road are not.
   */
  readonly unavoidable: boolean;
  /** The floor's `levelledCurve`, which every body it rolls is levelled on. */
  readonly curve: LevelledCurve;
}

interface BodyRoll {
  readonly type: string;
  readonly level: number;
}

function roomSources(def: LevelDef): EncounterSource[] {
  const totalChance = def.roomMobs.reduce((sum, rule) => sum + rule.chance, 0);
  const regions = progressionRegions(def);
  return regions.flatMap((region) =>
    def.roomMobs.map((rule) => ({
      label: `region ${region} ${rule.type}`,
      weight: rule.chance / totalChance / regions.length,
      unavoidable: true,
      curve: def.levelledCurve ?? SHARED_LEVELLED_CURVE,
      roll: (partyLevel: number, profile: DifficultyProfile): BodyRoll[] => {
        const levelBonus = regionLevelBonusFor(def, region);
        const levelOf = (band: MobLevelRange): number =>
          resolveAmbientLevel(regionLevelBand(band, levelBonus), def, partyLevel, profile);
        const population = rollRoomPopulation(def, rule, region, partyLevel, profile);
        return [
          ...Array.from({ length: population.hostCount }, () => ({
            type: rule.type,
            level: levelOf(rule),
          })),
          ...population.escorts.map((escort) => ({ type: escort.type, level: levelOf(escort) })),
        ];
      },
    })),
  );
}

function overworldSources(def: LevelDef): EncounterSource[] {
  const sources: EncounterSource[] = [];
  const floorCurve = def.levelledCurve ?? SHARED_LEVELLED_CURVE;
  for (const [kind, roster] of Object.entries(def.campSpawns ?? {})) {
    sources.push({
      label: `${kind} camp`,
      weight: 1,
      unavoidable: false,
      curve: floorCurve,
      roll: (partyLevel, profile) =>
        roster.flatMap((rule) =>
          Array.from({ length: randomCount(rule.minCount, rule.maxCount) }, () => ({
            type: rule.type,
            level: resolveAmbientLevel(rule, def, partyLevel, profile),
          })),
        ),
    });
  }
  const totalChance = def.hallwayMobs.reduce((sum, rule) => sum + rule.chance, 0);
  if (def.hallwayMobs.length > 0) {
    sources.push({
      label: `${OVERWORLD_ENCOUNTER_BODIES} roaming mobs`,
      weight: 1,
      unavoidable: true,
      curve: floorCurve,
      roll: (partyLevel, profile) =>
        Array.from({ length: OVERWORLD_ENCOUNTER_BODIES }, () => {
          const rule = pickWeighted(def.hallwayMobs, totalChance);
          return { type: rule.type, level: resolveAmbientLevel(rule, def, partyLevel, profile) };
        }),
    });
  }
  return sources;
}

function randomCount(min: number | undefined, max: number | undefined): number {
  const low = min ?? 1;
  const high = max ?? low;
  return low + Math.floor(worldRandom() * (high - low + 1));
}

function pickWeighted(rules: readonly MobSpawnRule[], totalChance: number): MobSpawnRule {
  let roll = worldRandom() * totalChance;
  for (const rule of rules) {
    roll -= rule.chance;
    if (roll <= 0) return rule;
  }
  return rules[rules.length - 1];
}

/**
 * The rooms one source fills at `partyLevel`, rolled under a fixed seed, or
 * null when a body is not a creature the harness measured. Rolled before any
 * is priced, because measuring a creature reseeds the harness's random source.
 */
function rollEncounters(
  source: EncounterSource,
  partyLevel: number,
  profile: DifficultyProfile,
): RoomBody[][] | null {
  const unmeasured: string[] = [];
  const rolls = withWorldSeed(ROOM_ROLL_SEED, () =>
    Array.from({ length: ROOM_SAMPLES_PER_RULE }, () => source.roll(partyLevel, profile)),
  );
  const rooms = rolls.map((room) =>
    room.flatMap((body) => {
      const creature = roster.regular.find((candidate) => candidate.key === body.type);
      if (creature === undefined || !measurable.has(body.type)) {
        unmeasured.push(body.type);
        return [];
      }
      return [{ creature, level: body.level, curve: source.curve }];
    }),
  );
  return unmeasured.length > 0 ? null : rooms;
}

/** One body's side of a room fight, against one crawler. */
interface BodyAgainst {
  readonly killFrames: number;
  readonly damagePerFrame: number;
}

function bodyAgainst(
  body: RoomBody,
  stats: ReferenceStats,
  profile: DifficultyProfile,
): BodyAgainst | null {
  const curve = body.curve ?? SHARED_LEVELLED_CURVE;
  const cost = killCost(body.creature, body.level, stats, curve);
  if (cost === null) return null;
  const sample = measure(body.creature, body.level, curve);
  const blowsPerFrame =
    sample.dodgeableDamagePerFrame * (1 - stats.dodgeChance) + sample.undodgeableDamagePerFrame;
  return {
    killFrames: cost.pressesFractional * cost.framesPerPress,
    damagePerFrame: blowsPerFrame * profile.incomingMobDamageScale + sample.unscaledDamagePerFrame,
  };
}

/** A room fight against both crawlers of one build: what it costs, and how long each mob lasts. */
interface PartyFight {
  /** Share of the party's pooled max HP the fight costs; above one is a wipe. */
  readonly hpShare: number;
  /** Frames the party takes to kill each body on its own. */
  readonly killFrames: readonly number[];
}

function partyFight(
  bodies: readonly RoomBody[],
  partyLevel: number,
  build: ReferenceBuild,
  profile: DifficultyProfile,
): PartyFight | null {
  const human = referenceStats('human', build, partyLevel);
  const cat = referenceStats('cat', build, partyLevel);
  const sides: Array<{ human: BodyAgainst; cat: BodyAgainst }> = [];
  for (const body of bodies) {
    const againstHuman = bodyAgainst(body, human, profile);
    const againstCat = bodyAgainst(body, cat, profile);
    if (againstHuman === null || againstCat === null) return null;
    sides.push({ human: againstHuman, cat: againstCat });
  }
  const partyKillFrames = sides.map(
    (side) => 1 / (1 / side.human.killFrames + 1 / side.cat.killFrames),
  );
  const roomKillFrames = partyKillFrames.reduce((sum, frames) => sum + frames, 0);
  const damageTaken = sides.reduce((sum, side, i) => {
    const othersKillFrames = roomKillFrames - partyKillFrames[i];
    const framesAlive = partyKillFrames[i] + othersKillFrames * RANDOM_ORDER_SHARE_KILLED_FIRST;
    const sharedDamagePerFrame = (side.human.damagePerFrame + side.cat.damagePerFrame) / PARTY_SIZE;
    return sum + sharedDamagePerFrame * framesAlive;
  }, 0);
  return { hpShare: damageTaken / (human.maxHp + cat.maxHp), killFrames: partyKillFrames };
}

/** Share of the party's pooled max HP left after one room, or null if a body cannot be killed. */
function roomHpRemaining(
  bodies: readonly RoomBody[],
  partyLevel: number,
  build: ReferenceBuild,
  profile: DifficultyProfile = NORMAL,
): number | null {
  const fight = partyFight(bodies, partyLevel, build, profile);
  return fight === null ? null : Math.max(0, 1 - fight.hpShare);
}

interface EncounterReading {
  /** HP remaining, averaged over the source's rolls. */
  readonly hpRemaining: number;
  readonly bodiesPerFight: number;
}

function readSource(
  source: EncounterSource,
  partyLevel: number,
  build: ReferenceBuild,
  profile: DifficultyProfile,
): EncounterReading | null {
  const rooms = rollEncounters(source, partyLevel, profile);
  if (rooms === null) return null;
  let hpRemaining = 0;
  for (const room of rooms) {
    const remaining = roomHpRemaining(room, partyLevel, build, profile);
    if (remaining === null) return null;
    hpRemaining += remaining / rooms.length;
  }
  const bodies = rooms.reduce((sum, room) => sum + room.length, 0);
  return { hpRemaining, bodiesPerFight: bodies / rooms.length };
}

/** Reads a group of sources as one weighted average: a floor's rooms are one kind of fight. */
function readSources(
  sources: readonly EncounterSource[],
  partyLevel: number,
  build: ReferenceBuild,
  profile: DifficultyProfile,
): EncounterReading | null {
  const totalWeight = sources.reduce((sum, source) => sum + source.weight, 0);
  let hpRemaining = 0;
  let bodiesPerFight = 0;
  for (const source of sources) {
    const reading = readSource(source, partyLevel, build, profile);
    if (reading === null) return null;
    hpRemaining += (reading.hpRemaining * source.weight) / totalWeight;
    bodiesPerFight += (reading.bodiesPerFight * source.weight) / totalWeight;
  }
  return { hpRemaining, bodiesPerFight };
}

/** The kinds of regular fight a floor is read by: its rooms together, or each overworld source alone. */
function fightKinds(def: LevelDef): Array<{ label: string; sources: EncounterSource[] }> {
  if (def.roomMobs.length > 0) return [{ label: 'rooms', sources: roomSources(def) }];
  return overworldSources(def).map((source) => ({ label: source.label, sources: [source] }));
}

section(
  `regular fights, the reference party (${ROOM_FIGHT_BUILD}): ${asPercent(ROOM_FIGHT_HP_REMAINING_MIN)}–${asPercent(ROOM_FIGHT_HP_REMAINING_MAX)} HP left on normal`,
);
{
  const pricedFloors = LEVEL_DEFS.filter((def) => fightKinds(def).length > 0);
  check(
    pricedFloors.length > 0,
    `${pricedFloors.length} floors have regular fights to price (${pricedFloors.map((def) => def.id).join(', ')})`,
  );
  const easy = DIFFICULTY_PROFILES.easy;
  const hard = DIFFICULTY_PROFILES.hard;
  for (const def of pricedFloors) {
    const isLearningFloor = def.floorNumber === LEARNING_FLOOR_NUMBER;
    for (const kind of fightKinds(def)) {
      for (const point of fightSamplePoints(def)) {
        const label = `${def.id} ${kind.label} ${point.label} (party ${point.partyLevel})`;
        const normal = readSources(kind.sources, point.partyLevel, ROOM_FIGHT_BUILD, NORMAL);
        const strong = readSources(kind.sources, point.partyLevel, ROOM_FIGHT_STRONG_BUILD, NORMAL);
        const onEasy = readSources(kind.sources, point.partyLevel, ROOM_FIGHT_BUILD, easy);
        const onHard = readSources(kind.sources, point.partyLevel, ROOM_FIGHT_BUILD, hard);
        if (normal === null || strong === null || onEasy === null || onHard === null) {
          report(label, ['a fight holds a creature that could not be priced'], null);
          continue;
        }
        const left = normal.hpRemaining;
        const tooHard = left < ROOM_FIGHT_HP_REMAINING_MIN - EPSILON;
        const tooEasy = !isLearningFloor && left > ROOM_FIGHT_HP_REMAINING_MAX + EPSILON;
        const bound = isLearningFloor
          ? `at least ${asPercent(ROOM_FIGHT_HP_REMAINING_MIN)}, the learning floor`
          : `${asPercent(ROOM_FIGHT_HP_REMAINING_MIN)}–${asPercent(ROOM_FIGHT_HP_REMAINING_MAX)}`;
        check(
          !tooHard && !tooEasy,
          `${label}: ${asPercent(left)} left over ${normal.bodiesPerFight.toFixed(TABLE_DECIMALS)} bodies (want ${bound}; ${ROOM_FIGHT_STRONG_BUILD} leaves ${asPercent(strong.hpRemaining)})`,
        );
        check(
          onEasy.hpRemaining >= left - EPSILON && onHard.hpRemaining <= left + EPSILON,
          `${label}: easy leaves no less than normal, hard no more (${asPercent(onEasy.hpRemaining)} / ${asPercent(left)} / ${asPercent(onHard.hpRemaining)})`,
        );
        check(
          onHard.hpRemaining >= HARD_ROOM_FIGHT_HP_REMAINING_MIN - EPSILON,
          `${label}: hard leaves at least ${asPercent(HARD_ROOM_FIGHT_HP_REMAINING_MIN)} (${asPercent(onHard.hpRemaining)})`,
        );
      }
    }
  }

  // The band is only worth asserting if the pricer can tell rooms apart: one
  // more body in the same room must cost the party more.
  const probeRule = level2.roomMobs[0];
  const probeCreature = roster.regular.find((creature) => creature.key === probeRule.type);
  const probeLevel = bandTop(probeRule);
  const probeParty = floorWindow(level2).first;
  if (probeCreature === undefined) {
    check(false, `${probeRule.type} is in the roster, to probe the room pricer with`);
  } else {
    const body: RoomBody = { creature: probeCreature, level: probeLevel };
    const smaller = roomHpRemaining([body, body], probeParty, ROOM_FIGHT_BUILD);
    const larger = roomHpRemaining([body, body, body], probeParty, ROOM_FIGHT_BUILD);
    check(
      smaller !== null && larger !== null && larger < smaller,
      `a third ${probeRule.type} costs the party more than two (${smaller === null ? '?' : asPercent(smaller)} → ${larger === null ? '?' : asPercent(larger)} left)`,
    );
  }
}

// ── The learning floor, held where it was tuned ──────────────────────────────
//
// The shared curve was flattened for the deeper floors, and floor 1 was not
// meant to change with it: it keeps the curve it was tuned on through its own
// `levelledCurve`. The band check above holds floor 1 only to a floor, so a
// change that moved it would pass there unseen. This section holds each of its
// fights to what it cost when the floor was tuned, both ways, and each of its
// levelled creatures to the blow and health bar it was tuned with.

/** What one learning-floor fight costs the reference party (balanced, normal). */
interface LearningFloorCost {
  /** Share of the party's pooled max HP the fight takes. */
  readonly hpLost: number;
  /** Seconds the party takes to kill everything in it. */
  readonly killSeconds: number;
}

/**
 * The party levels floor 1's fight window sampled when its tuned costs were
 * recorded. Held against the window's sample points, so a costs table read at
 * the wrong party level fails instead of comparing unlike fights.
 */
const TUNED_EARLY_PARTY_LEVEL = 4;
const TUNED_MID_PARTY_LEVEL = 10;
const TUNED_LATE_PARTY_LEVEL = 15;

/**
 * What floor 1's fights cost when it was tuned, keyed by the party level they
 * were read at: its rooms, a treasure room's guards, and both bosses. Recorded
 * by this section's own pricing, on the curve the floor was tuned on, before
 * that curve became floor 1's alone.
 */
const LEARNING_FLOOR_TUNED_COSTS: ReadonlyMap<
  string,
  ReadonlyMap<number, LearningFloorCost>
> = new Map([
  [
    'rooms',
    new Map([
      [TUNED_EARLY_PARTY_LEVEL, { hpLost: 0.382, killSeconds: 1.856 }],
      [TUNED_MID_PARTY_LEVEL, { hpLost: 0.199, killSeconds: 1.141 }],
      [TUNED_LATE_PARTY_LEVEL, { hpLost: 0.134, killSeconds: 0.91 }],
    ]),
  ],
  [
    'treasure guards',
    new Map([
      [TUNED_EARLY_PARTY_LEVEL, { hpLost: 0.348, killSeconds: 2.012 }],
      [TUNED_MID_PARTY_LEVEL, { hpLost: 0.161, killSeconds: 1.174 }],
      [TUNED_LATE_PARTY_LEVEL, { hpLost: 0.107, killSeconds: 0.924 }],
    ]),
  ],
  [
    'the_hoarder',
    new Map([
      [TUNED_EARLY_PARTY_LEVEL, { hpLost: 0, killSeconds: 5.486 }],
      [TUNED_MID_PARTY_LEVEL, { hpLost: 0, killSeconds: 3.8 }],
      [TUNED_LATE_PARTY_LEVEL, { hpLost: 0, killSeconds: 2.99 }],
    ]),
  ],
  [
    'juicer',
    new Map([
      [TUNED_EARLY_PARTY_LEVEL, { hpLost: 0.337, killSeconds: 8.229 }],
      [TUNED_MID_PARTY_LEVEL, { hpLost: 0.476, killSeconds: 8.4 }],
      [TUNED_LATE_PARTY_LEVEL, { hpLost: 0.316, killSeconds: 6.61 }],
    ]),
  ],
]);

/**
 * How far a learning-floor fight may read from its tuned cost, either way, as a
 * share of that cost. The curve is the one it was tuned on, so what is left is
 * behaviour: creature code that has moved since — a tactics trait, a telegraph
 * — may nudge a fight, but not by as much as a player would notice.
 */
const LEARNING_FLOOR_COST_TOLERANCE = 0.05;

/**
 * Floor 1's multi-point blows and health bars as they were tuned, at levels the
 * floor spawns them: the largest single blow each creature lands, and its max
 * HP. The one-point blows are left out on purpose: rounding up is what made
 * them two from level 2, and the room costs above already hold that.
 */
const LEARNING_FLOOR_TUNED_BLOWS: ReadonlyArray<{
  readonly type: string;
  readonly level: number;
  readonly largestBlow: number;
  readonly maxHp: number;
}> = [
  { type: 'goblin', level: 2, largestBlow: 3, maxHp: 8 },
  { type: 'goblin', level: 5, largestBlow: 4, maxHp: 14 },
  { type: 'goblin_archer', level: 5, largestBlow: 4, maxHp: 11 },
  { type: 'llama', level: 3, largestBlow: 3, maxHp: 16 },
  { type: 'llama', level: 6, largestBlow: 4, maxHp: 25 },
  { type: 'troglodyte', level: 3, largestBlow: 5, maxHp: 36 },
  { type: 'bugaboo', level: 3, largestBlow: 3, maxHp: 13 },
  { type: 'juicer', level: 3, largestBlow: 6, maxHp: 192 },
  { type: 'juicer', level: 7, largestBlow: 9, maxHp: 336 },
];

/** Every fight is held on both readings except where one is not real. */
type LearningFloorReading = keyof LearningFloorCost;

function readingOf(cost: LearningFloorCost, reading: LearningFloorReading): string {
  return reading === 'hpLost'
    ? `${asPercent(cost.hpLost)} of pooled HP`
    : `${cost.killSeconds.toFixed(TABLE_DECIMALS)} s to kill`;
}

/** How far `cost` reads from `tuned`, as a share of the tuned value; negative is easier. */
function driftFromTuned(
  cost: LearningFloorCost,
  tuned: LearningFloorCost,
  reading: LearningFloorReading,
): number {
  return cost[reading] / tuned[reading] - 1;
}

/** The learning floor's regular rooms at `partyLevel`, levelled on `curve`. */
function learningFloorRoomCost(partyLevel: number, curve: LevelledCurve): LearningFloorCost | null {
  const sources = roomSources(level1).map((source) => ({ ...source, curve }));
  const reading = readSources(sources, partyLevel, ROOM_FIGHT_BUILD, NORMAL);
  if (reading === null) return null;
  let weightedKillFrames = 0;
  let weightedRooms = 0;
  for (const source of sources) {
    for (const room of rollEncounters(source, partyLevel, NORMAL) ?? []) {
      const fight = partyFight(room, partyLevel, ROOM_FIGHT_BUILD, NORMAL);
      if (fight === null) return null;
      const roomKillFrames = fight.killFrames.reduce((sum, frames) => sum + frames, 0);
      weightedKillFrames += roomKillFrames * source.weight;
      weightedRooms += source.weight;
    }
  }
  const meanKillFrames = weightedKillFrames / weightedRooms;
  return { hpLost: 1 - reading.hpRemaining, killSeconds: meanKillFrames / FRAMES_PER_SECOND };
}

/**
 * A treasure room's guards at `partyLevel`, levelled on `curve`: every draw of
 * the room's guards from the floor's room rules, weighted by how likely the
 * spawner is to make it, each guard at the top of its band in the last region
 * plus `TREASURE_ROOM_LEVEL_BOOST`, as `spawnTreasureRoomMobs` levels them.
 */
function learningFloorTreasureCost(
  partyLevel: number,
  curve: LevelledCurve,
): LearningFloorCost | null {
  const largestBonus = Math.max(0, ...(level1.progression?.regionLevelBonus ?? []));
  const totalChance = level1.roomMobs.reduce((sum, rule) => sum + rule.chance, 0);
  const guardChoices: Array<{ body: RoomBody; chance: number }> = [];
  for (const rule of level1.roomMobs) {
    const creature = roster.regular.find((candidate) => candidate.key === rule.type);
    if (creature === undefined) return null;
    const level = bandTop(regionLevelBand(rule, largestBonus)) + TREASURE_ROOM_LEVEL_BOOST;
    guardChoices.push({ body: { creature, level, curve }, chance: rule.chance / totalChance });
  }
  let draws: Array<{ bodies: RoomBody[]; chance: number }> = [{ bodies: [], chance: 1 }];
  for (let guard = 0; guard < TREASURE_ROOM_EXTRA_MOBS; guard++) {
    draws = draws.flatMap((draw) =>
      guardChoices.map((choice) => ({
        bodies: [...draw.bodies, choice.body],
        chance: draw.chance * choice.chance,
      })),
    );
  }
  let hpLost = 0;
  let killFrames = 0;
  for (const draw of draws) {
    const fight = partyFight(draw.bodies, partyLevel, ROOM_FIGHT_BUILD, NORMAL);
    if (fight === null) return null;
    hpLost += Math.min(1, fight.hpShare) * draw.chance;
    killFrames += fight.killFrames.reduce((sum, frames) => sum + frames, 0) * draw.chance;
  }
  return { hpLost, killSeconds: killFrames / FRAMES_PER_SECOND };
}

/** One learning-floor boss alone against the reference party, at the level it spawns at for `partyLevel`. */
function learningFloorBossCost(
  creature: Creature,
  band: MobLevelRange,
  partyLevel: number,
  curve: LevelledCurve,
): LearningFloorCost | null {
  const level = resolveBossLevel(band, partyLevel, NORMAL);
  const fight = partyFight([{ creature, level, curve }], partyLevel, ROOM_FIGHT_BUILD, NORMAL);
  if (fight === null) return null;
  const killFrames = fight.killFrames.reduce((sum, frames) => sum + frames, 0);
  return { hpLost: fight.hpShare, killSeconds: killFrames / FRAMES_PER_SECOND };
}

/**
 * Holds one learning-floor fight within its tolerance of the tuned cost on
 * each reading, and checks that the same fight on the shared curve reads
 * easier than tuned — the change this gate exists for, which it must be able
 * to see.
 */
function checkLearningFloorFight(
  label: string,
  tuned: LearningFloorCost | undefined,
  readings: readonly LearningFloorReading[],
  price: (curve: LevelledCurve) => LearningFloorCost | null,
): void {
  const cost = price(level1.levelledCurve ?? SHARED_LEVELLED_CURVE);
  const onSharedCurve = price(SHARED_LEVELLED_CURVE);
  if (tuned === undefined || cost === null || onSharedCurve === null) {
    check(false, `${label}: has a tuned cost at this party level and can be priced`);
    return;
  }
  for (const reading of readings) {
    const drift = driftFromTuned(cost, tuned, reading);
    check(
      Math.abs(drift) <= LEARNING_FLOOR_COST_TOLERANCE + EPSILON,
      `${label}: ${readingOf(cost, reading)}, tuned at ${readingOf(tuned, reading)} (${asPercent(drift)} drift, want within ±${asPercent(LEARNING_FLOOR_COST_TOLERANCE)})`,
    );
  }
  const primary = readings[0];
  check(
    driftFromTuned(onSharedCurve, tuned, primary) < -LEARNING_FLOOR_COST_TOLERANCE,
    `${label}: on the shared curve it would read easier (${readingOf(onSharedCurve, primary)})`,
  );
}

/** The largest single blow `creature` lands at `level` on `curve`, and its max HP. */
function largestBlowOf(
  creature: Creature,
  level: number,
  curve: LevelledCurve,
): { largestBlow: number; maxHp: number } {
  seedRandom(SIM_SEED);
  const map = makeArena();
  const mob = buildWarmed(creature, level, map, curve);
  const crawler = new LargestBlowLedger(MOB_TILE + 1, MOB_TILE, TILE_SIZE);
  if (creature.isBoss) mob.forceAggro = true;
  provoke(mob, crawler);
  let largestProjectile = 0;
  for (let frame = 0; frame < MEASURE_FRAMES; frame++) {
    mob.updateAI([crawler]);
    mob.tickTimers();
    crawler.tickTimers();
    largestProjectile = Math.max(largestProjectile, projectileDamageLaunched(mob));
  }
  return { largestBlow: Math.max(crawler.largestBlow, largestProjectile), maxHp: mob.maxHp };
}

section('the learning floor plays as it was tuned (balanced, normal)');
{
  const samplePoints = fightSamplePoints(level1);
  for (const [fight, byParty] of LEARNING_FLOOR_TUNED_COSTS) {
    const recorded = [...byParty.keys()].join(', ');
    const sampled = samplePoints.map((point) => point.partyLevel).join(', ');
    check(
      recorded === sampled,
      `${fight}: tuned costs recorded at party ${recorded}, the levels the fight window samples (${sampled})`,
    );
  }

  const tunedAt = (fight: string, partyLevel: number): LearningFloorCost | undefined =>
    LEARNING_FLOOR_TUNED_COSTS.get(fight)?.get(partyLevel);
  for (const point of samplePoints) {
    const at = `${point.label} (party ${point.partyLevel})`;
    checkLearningFloorFight(
      `${level1.id} rooms ${at}`,
      tunedAt('rooms', point.partyLevel),
      ['hpLost', 'killSeconds'],
      (curve) => learningFloorRoomCost(point.partyLevel, curve),
    );
    checkLearningFloorFight(
      `${level1.id} treasure guards ${at}`,
      tunedAt('treasure guards', point.partyLevel),
      ['hpLost', 'killSeconds'],
      (curve) => learningFloorTreasureCost(point.partyLevel, curve),
    );
  }

  for (const rule of level1.bossRooms ?? []) {
    const creature = roster.bosses.find((candidate) => candidate.key === rule.type);
    if (creature === undefined) {
      check(false, `${rule.type} is a priced boss`);
      continue;
    }
    // A boss whose harm is priced from the curves has no real HP reading, and
    // how long it lasts is its whole threat: the Hoarder's swarm and vomit
    // never scale.
    const readings: readonly LearningFloorReading[] = CURVE_PRICED_BOSSES.has(rule.type)
      ? ['killSeconds']
      : ['hpLost', 'killSeconds'];
    for (const point of samplePoints) {
      checkLearningFloorFight(
        `${rule.type} ${point.label} (party ${point.partyLevel})`,
        tunedAt(rule.type, point.partyLevel),
        readings,
        (curve) => learningFloorBossCost(creature, rule, point.partyLevel, curve),
      );
    }
  }

  const floorCurve = level1.levelledCurve ?? SHARED_LEVELLED_CURVE;
  const everyone = [...roster.regular, ...roster.bosses];
  for (const tuned of LEARNING_FLOOR_TUNED_BLOWS) {
    const creature = everyone.find((candidate) => candidate.key === tuned.type);
    if (creature === undefined) {
      check(false, `${tuned.type} is in the roster, to check its tuned blow`);
      continue;
    }
    const now = largestBlowOf(creature, tuned.level, floorCurve);
    check(
      Math.abs(now.largestBlow - tuned.largestBlow) < EPSILON &&
        Math.abs(now.maxHp - tuned.maxHp) < EPSILON,
      `${tuned.type} level ${tuned.level} on ${level1.id}: hits for ${now.largestBlow} with ${now.maxHp} HP, tuned at ${tuned.largestBlow} and ${tuned.maxHp}`,
    );
  }
}

// ── Tracked levels ───────────────────────────────────────────────────────────
//
// A floor that tracks the party raises its mobs past the authored bands the
// where-met checks read. The one-on-one rules are restated there, not dropped:
// the off-stat build has no damage growth of its own to meet a mob that keeps
// levelling, so past the authored band it is held to winning as the party it
// actually plays in, and the sponge check reads time-to-kill instead of blows.

section('tracked levels: the off-stat party still wins, and no mob turns sponge');
{
  const trackingFloors = LEVEL_DEFS.filter((def) => def.ambientTracking !== undefined);
  check(trackingFloors.length > 0, `${trackingFloors.length} floors track the party's level`);
  const expectedPairs = trackingFloors.flatMap((def) =>
    [...new Set(ambientSpawns(def).map((spawn) => spawn.type))].map((type) => `${type}@${def.id}`),
  );
  const checkedPairs = new Set<string>();
  // Hard is held only to a bare win: its ratio tracks the party higher, and a
  // player who chose it and also spent badly has asked for the fight.
  const profiles: ReadonlyArray<{ name: Difficulty; shareMax: number }> = [
    { name: 'normal', shareMax: OFF_STAT_PARTY_HP_SHARE_MAX },
    { name: 'hard', shareMax: OFF_STAT_HP_SHARE_MAX },
  ];
  for (const creature of roster.regular) {
    if (!measurable.has(creature.key)) continue;
    for (const encounter of roster.encounters.get(creature.key) ?? []) {
      if (encounter.def.ambientTracking === undefined) continue;
      checkedPairs.add(`${creature.key}@${encounter.def.id}`);
      const window = fightWindow(encounter.def);
      for (const { name, shareMax } of profiles) {
        const profile = DIFFICULTY_PROFILES[name];
        const offStatLosses: string[] = [];
        const sponges: string[] = [];
        let highestLevel = 0;
        for (let partyLevel = window.first; partyLevel <= window.last; partyLevel++) {
          const tracked = partyTrackedBand(encounter.band, encounter.def, partyLevel, profile);
          const level = bandTop(tracked);
          highestLevel = Math.max(highestLevel, level);
          const offStat = partyFight([{ creature, level }], partyLevel, 'off-stat', profile);
          if (offStat === null || offStat.hpShare >= shareMax) {
            offStatLosses.push(
              `costs ${offStat === null ? '?' : asPercent(offStat.hpShare)} at party ${partyLevel}`,
            );
          }
          const kill = killCost(creature, level, referenceStats('human', 'balanced', partyLevel));
          const seconds =
            kill === null
              ? Infinity
              : (kill.pressesWhole * kill.framesPerPress) / FRAMES_PER_SECOND;
          if (seconds > TIME_TO_KILL_MAX_SECONDS) {
            sponges.push(`${seconds.toFixed(TABLE_DECIMALS)} s at party ${partyLevel}`);
          }
        }
        const label = `${creature.key} on ${encounter.def.id}, ${name} (to level ${highestLevel})`;
        report(
          `${label}: the off-stat party wins with over ${asPercent(1 - shareMax)} of its bar left`,
          offStatLosses,
          null,
        );
        report(
          `${label}: the balanced human kills it within ${TIME_TO_KILL_MAX_SECONDS} s`,
          sponges,
          null,
        );
      }
    }
  }
  const missing = expectedPairs.filter((pair) => !checkedPairs.has(pair));
  check(
    missing.length === 0 && checkedPairs.size === expectedPairs.length,
    `every ambient creature on a tracking floor is checked (${checkedPairs.size} of ${expectedPairs.length}${missing.length > 0 ? `; missing ${missing.join(', ')}` : ''})`,
  );

  // Whole encounters, too: a camp is several tracked mobs at once. Taken whole
  // and standing still, an off-stat party is not owed a comfortable win against
  // an optional one on normal — it can walk around a camp, pull it apart,
  // retreat or drink — but easy is where a struggling build is sent, and there
  // it must be able to finish every one. A fight it cannot avoid is held on
  // normal too, with a margin: the badly built party walks away from it with
  // enough of its bar to reach the next.
  for (const def of trackingFloors) {
    for (const kind of fightKinds(def)) {
      const unavoidable = kind.sources.every((source) => source.unavoidable);
      const lostOnEasy: string[] = [];
      const shortOnNormal: string[] = [];
      const readings: string[] = [];
      for (const point of fightSamplePoints(def)) {
        for (const difficulty of DIFFICULTIES) {
          const profile = DIFFICULTY_PROFILES[difficulty];
          const reading = readSources(kind.sources, point.partyLevel, 'off-stat', profile);
          const left = reading === null ? 0 : reading.hpRemaining;
          readings.push(`${difficulty} ${asPercent(left)} at party ${point.partyLevel}`);
          if (difficulty === 'easy' && left <= 0) {
            lostOnEasy.push(`wiped at party ${point.partyLevel}`);
          }
          const belowMinimum = left < OFF_STAT_UNAVOIDABLE_HP_REMAINING_MIN - EPSILON;
          if (difficulty === 'normal' && unavoidable && belowMinimum) {
            shortOnNormal.push(`${asPercent(left)} left at party ${point.partyLevel}`);
          }
        }
      }
      report(
        `${def.id} ${kind.label}: the off-stat party survives it whole on easy`,
        lostOnEasy,
        null,
      );
      if (unavoidable) {
        report(
          `${def.id} ${kind.label}, unavoidable: the off-stat party leaves it with at least ${asPercent(OFF_STAT_UNAVOIDABLE_HP_REMAINING_MIN)} on normal`,
          shortOnNormal,
          null,
        );
      }
      console.log(`  note ${def.id} ${kind.label}, off-stat party whole: ${readings.join(', ')}`);
    }
  }
  check(
    trackingFloors.some((def) =>
      fightKinds(def).some((kind) => kind.sources.every((source) => source.unavoidable)),
    ),
    'every tracking floor offers an unavoidable fight for the off-stat minimum to read',
  );
}

section('difficulty profiles, balanced build');
for (const creature of roster.regular) {
  if (!measurable.has(creature.key)) continue;
  for (const crawler of REFERENCE_CRAWLERS) {
    const byProfile = new Map<Difficulty, PathRow[] | null>();
    for (const difficulty of DIFFICULTIES) {
      const profile = DIFFICULTY_PROFILES[difficulty];
      byProfile.set(
        difficulty,
        walkPath(
          creature,
          crawler,
          'balanced',
          profile,
          ambientLevel(profile),
          LAST_SAMPLED_PARTY_LEVEL,
          'expected',
        ),
      );
    }
    const hard = byProfile.get('hard') ?? null;
    const easy = byProfile.get('easy') ?? null;
    const normal = byProfile.get('normal') ?? null;
    const label = `${creature.key} vs ${crawler}`;
    reportRatios(`${label}, hard`, hard, (path) => ceilingViolations(path, HARD_HP_SHARE_CEILING));
    if (easy === null || normal === null) {
      report(`${label}, easy`, ['could not be priced'], null);
      continue;
    }
    const aboveNormal = easy.filter((row, i) => row.hpShare > normal[i].hpShare + EPSILON);
    report(
      `${label}, easy never costs more than normal`,
      aboveNormal.map((row) => `easy costs more at party ${row.partyLevel}`),
      easy,
    );
  }
}

section('bounty escorts at their full party ratio, balanced build');
for (const creature of roster.escorts) {
  if (!measurable.has(creature.key)) continue;
  for (const difficulty of DIFFICULTIES) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    const levelFor = escortLevel(profile);
    const last = partyLevelAtCap(levelFor) + PARTY_LEVELS_PAST_CAP;
    for (const crawler of REFERENCE_CRAWLERS) {
      const rows = walkPath(creature, crawler, 'balanced', profile, levelFor, last, 'expected');
      reportRatios(`${creature.key} vs ${crawler}, ${difficulty}`, rows, (path) =>
        ceilingViolations(path, HP_SHARE_CEILING),
      );
    }
  }
}

section('bosses, balanced build');
for (const creature of roster.bosses) {
  if (!measurable.has(creature.key)) continue;
  for (const difficulty of DIFFICULTIES) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    // A floor's own curve only ever levels a boss inside that floor's band;
    // walked on to the cap it would price fights the game never makes. The
    // shared curve is walked to the cap, because every floor levels on it.
    const ownBand =
      creature.bossCurve !== undefined && creature.bossCurve !== SHARED_LEVELLED_CURVE
        ? creature.bossBand
        : undefined;
    const levelFor =
      ownBand === undefined
        ? bossLevel(profile)
        : (party: number): number => resolveBossLevel(ownBand, party, profile);
    const last = partyLevelAtCap(bossLevel(profile)) + PARTY_LEVELS_PAST_CAP;
    for (const crawler of REFERENCE_CRAWLERS) {
      const rows = walkPath(
        creature,
        crawler,
        'balanced',
        profile,
        levelFor,
        last,
        'expected',
        1,
        creature.bossCurve,
      );
      reportRatios(`${creature.key} vs ${crawler}, ${difficulty}`, rows, (path) =>
        ceilingViolations(path, BOSS_HP_SHARE_CEILING),
      );
    }
  }
}

section('bounty marks, balanced build');
for (const creature of roster.bountyMarks) {
  if (!measurable.has(creature.key)) continue;
  for (const difficulty of DIFFICULTIES) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    const levelFor = markLevel(profile);
    const last = partyLevelAtCap(levelFor) + PARTY_LEVELS_PAST_CAP;
    for (const crawler of REFERENCE_CRAWLERS) {
      const rows = walkPath(creature, crawler, 'balanced', profile, levelFor, last, 'expected');
      reportRatios(`${creature.key} vs ${crawler}, ${difficulty}`, rows, (path) =>
        ceilingViolations(path, BOSS_HP_SHARE_CEILING),
      );
    }
  }
}

// ── Bounty encounters, whole ─────────────────────────────────────────────────
//
// Everything above prices one creature at a time and, for bosses and escorts,
// only against its own level-1 fight — so a mark authored to kill from full at
// level 1 passes every ratio it is held to. This section stages each bounty
// through `stageBountyEncounter` and commits it through `EncounterCommitment`,
// exactly as `BountySystem` does, against a reference crawler standing her
// ground, runs the real mob loop and every projectile system a bounty uses, and
// holds the result to absolute bounds rather than ratios. Dodge is left out of
// every bound: a promise that holds only on the expected roll fails on the
// unlucky one, and the unlucky one is the death a player remembers.

/** Side of the open field a bounty is staged on, in tiles. */
const BOUNTY_FIELD_TILES = 40;
/** The mark's tile on both axes: the middle of the field. */
const BOUNTY_SITE_TILE = 20;
/**
 * How far south of the mark the crawler stands, in tiles: inside every
 * escort's notice range, as she is the moment the encounter commits.
 */
const BOUNTY_CRAWLER_OFFSET_TILES = 6;
/** Tile the idle crawler is parked on, far outside every escort's reach. */
const BOUNTY_PARK_TILE = 2;
/**
 * Frames each encounter is fought for: thirty seconds, long enough for every
 * mark's special — the clown's juggle, the mantid's rage, the knight's slam —
 * to come round at least once.
 */
const BOUNTY_FIGHT_FRAMES = 1800;
/** Seed for the encounter's trait rolls, so every run fights the same pack. */
const BOUNTY_TRAIT_SEED = 0x0b0_7a11;
/**
 * The least time a crawler standing her ground may live after the fight first
 * draws blood: a second, long enough to see the bar drop and answer it with a
 * potion or a step back. Anything faster is a death she had no turn in.
 *
 * Derived from the widest commit stagger rather than written beside it: that
 * gap is the whole reason a small pack's second body arrives a second after
 * the first, so the floor and the gap are one number. Narrow the stagger and
 * this floor narrows with it, where a copied constant would go red on packs
 * that sit one frame past it today.
 */
const BOUNTY_MIN_SECONDS_FIRST_BLOOD_TO_DEATH =
  BOUNTY_COMMIT_STAGGER_MAX_FRAMES / FRAMES_PER_SECOND;
/**
 * The floor on hard, and for the companion: the lock every telegraph keeps.
 * Hard may kill in two blows a moment apart — its incoming damage is scaled up
 * for exactly that — and Donut's few points go in two capped blows by design,
 * but neither may die inside a window no reaction fits in.
 */
const BOUNTY_LOCKED_FLOOR_SECONDS = LOCKED_TELEGRAPH_MIN_FRAMES / FRAMES_PER_SECOND;
/** Seconds of fighting the pressure column reports bars lost over. */
const BOUNTY_PRESSURE_WINDOW_SECONDS = 10;
/** Slack for a capped blow, which lands exactly on the cap by construction. */
const BLOW_SHARE_EPSILON = 1e-9;
/** The starting gear every human is handed; the reference crawler has none. */
const HUMAN_STARTING_GEAR = 'enchanted_bigboi_boxers';
const BOUNTY_DIFFICULTIES: readonly Difficulty[] = ['normal', 'hard'];

/** One blow a staged bounty landed on the crawler, priced as it lands, before any dodge. */
interface BountyBlow {
  readonly frame: number;
  readonly source: string;
  readonly amount: number;
}

function describeSource(source: DamageSource | undefined): string {
  if (source === undefined) return 'unattributed';
  if (source.kind === 'mob') return `${source.mobType} ${source.attackType ?? 'blow'}`;
  return source.kind;
}

/**
 * A crawler who holds her ground, keeps every blow on a ledger and never falls,
 * so the whole fight is on record. Each blow is priced through the crawler's
 * own `incomingDamage` — the difficulty scale and the blow cap — so the ledger
 * reads what the real crawler would lose.
 */
class HumanLedger extends HumanPlayer {
  readonly blows: BountyBlow[] = [];
  frame = 0;

  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (amount <= 0) return false;
    this.blows.push({
      frame: this.frame,
      source: describeSource(source),
      amount: this.incomingDamage(amount, source),
    });
    return true;
  }
}

/** {@link HumanLedger}, for Donut. */
class CatLedger extends CatPlayer {
  readonly blows: BountyBlow[] = [];
  frame = 0;

  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (amount <= 0) return false;
    this.blows.push({
      frame: this.frame,
      source: describeSource(source),
      amount: this.incomingDamage(amount, source),
    });
    return true;
  }
}

type BountyLedger = HumanLedger | CatLedger;

function makeBountyLedgers(
  crawler: ReferenceCrawler,
  stats: ReferenceStats,
): { fighter: BountyLedger; idle: BountyLedger; human: HumanLedger; cat: CatLedger } {
  const standTile = BOUNTY_SITE_TILE + BOUNTY_CRAWLER_OFFSET_TILES;
  const fighterX = BOUNTY_SITE_TILE;
  const human =
    crawler === 'human'
      ? new HumanLedger(fighterX, standTile, TILE_SIZE)
      : new HumanLedger(BOUNTY_PARK_TILE, BOUNTY_PARK_TILE, TILE_SIZE);
  const cat =
    crawler === 'cat'
      ? new CatLedger(fighterX, standTile, TILE_SIZE)
      : new CatLedger(BOUNTY_PARK_TILE, BOUNTY_PARK_TILE, TILE_SIZE);
  const fighter = crawler === 'human' ? human : cat;
  const idle = crawler === 'human' ? cat : human;
  idle.godMode = true;
  human.inventory.equipment.unequipById(HUMAN_STARTING_GEAR);
  for (const stat of ALL_STATS) fighter.setBaseStat(stat, stats.stats[stat]);
  fighter.hp = fighter.maxHp;
  return { fighter, idle, human, cat };
}

interface BountyFight {
  readonly crawler: ReferenceCrawler;
  readonly partyLevel: number;
  readonly markLevel: number;
  readonly crawlerMaxHp: number;
  /** The crawler's own max HP matched the reference's, so shares read the right bar. */
  readonly matchesReference: boolean;
  readonly blows: readonly BountyBlow[];
  readonly markType: string;
  readonly escortTypes: readonly string[];
  readonly blowCapped: boolean;
}

/** Stages one bounty exactly as `BountySystem` does, commits it the same way, and fights it. */
function fightBounty(
  def: BountyDef,
  crawler: ReferenceCrawler,
  partyLevel: number,
  difficulty: Difficulty,
): BountyFight {
  seedRandom(SIM_SEED);
  settings.setDifficulty(difficulty);
  const profile = DIFFICULTY_PROFILES[difficulty];
  const map = makeArena(BOUNTY_FIELD_TILES);
  const site = { x: BOUNTY_SITE_TILE, y: BOUNTY_SITE_TILE };
  const { boss, minions, bossLevel } = withWorldSeed(BOUNTY_TRAIT_SEED, () =>
    stageBountyEncounter(def, site, map, partyLevel, partyLevel, profile),
  );

  const stats = referenceStats(crawler, 'balanced', partyLevel);
  const { fighter, human, cat } = makeBountyLedgers(crawler, stats);

  const mobRoster = new MobRoster(map, new SpellSystem());
  const encounter = [boss, ...minions];
  for (const mob of encounter) mobRoster.add(mob);
  const ctx: SystemContext = {
    human,
    cat,
    active: fighter,
    inactive: fighter === human ? cat : human,
    activeIsMoving: false,
    roster: mobRoster,
    gameMap: map,
  };
  const mobLoop = new MobUpdateLoop();
  const clownGas = new ClownGasSystem(map);
  mobLoop.registerHazardSource(clownGas);
  const commitment = new EncounterCommitment();
  const projectileSystems: ReadonlyArray<Required<Pick<GameSystem, 'update'>>> = [
    clownGas,
    new RockThrowSystem(map),
    new SkeletonProjectileSystem(map),
    new GoblinArrowSystem(map),
    new SkeletonSummonSystem(map, (mob) => mobRoster.add(mob)),
    new KnightMissileSystem(map),
  ];

  let press = 0;
  let framesUntilNextPress = 0;
  for (let frame = 0; frame < BOUNTY_FIGHT_FRAMES; frame++) {
    fighter.frame = frame;
    mobLoop.update(ctx);
    commitment.update(encounter);
    for (const system of projectileSystems) system.update(ctx);
    fighter.tickTimers();
    framesUntilNextPress--;
    if (framesUntilNextPress > 0) continue;
    const victim = nearestLivingMob(mobRoster.mobs, fighter);
    if (victim === null || victim.distance > fighter.getMeleeRange()) continue;
    const attack = stats.attackCycle[press % stats.attackCycle.length];
    victim.mob.takeDamageFrom(attack.damage, fighter, attack.damageType);
    press++;
    framesUntilNextPress = attack.frames;
  }
  commitment.release();
  mobLoop.dispose();
  settings.setDifficulty('normal');

  return {
    crawler,
    partyLevel,
    markLevel: bossLevel,
    crawlerMaxHp: fighter.maxHp,
    matchesReference: fighter.maxHp === stats.maxHp,
    blows: fighter.blows,
    markType: boss.mobType,
    escortTypes: [...new Set(minions.map((minion) => minion.mobType))],
    blowCapped: encounter.every((mob) => mob.blowCapShareOfTargetHp === BOUNTY_MAX_BLOW_HP_SHARE),
  };
}

function nearestLivingMob(
  mobs: readonly Mob[],
  crawler: BountyLedger,
): { mob: Mob; distance: number } | null {
  let nearest: { mob: Mob; distance: number } | null = null;
  for (const mob of mobs) {
    if (!mob.isAlive) continue;
    const distance = Math.hypot(mob.x - crawler.x, mob.y - crawler.y);
    if (nearest === null || distance < nearest.distance) nearest = { mob, distance };
  }
  return nearest;
}

/** Each source's heaviest blow of the fight, as a share of the crawler's max HP. */
function heaviestBlowBySource(fight: BountyFight): Map<string, number> {
  const bySource = new Map<string, number>();
  for (const blow of fight.blows) {
    const share = blow.amount / fight.crawlerMaxHp;
    bySource.set(blow.source, Math.max(bySource.get(blow.source) ?? 0, share));
  }
  return bySource;
}

function heaviestBlowShare(fight: BountyFight): number {
  return Math.max(0, ...heaviestBlowBySource(fight).values());
}

/** Seconds from first blood until the blows landed since empty her bar; null if she lasts. */
function secondsFromFirstBloodToDeath(fight: BountyFight): number | null {
  if (fight.blows.length === 0) return null;
  const firstBlood = fight.blows[0];
  let loss = 0;
  for (const blow of fight.blows) {
    loss += blow.amount;
    if (loss >= fight.crawlerMaxHp) return (blow.frame - firstBlood.frame) / FRAMES_PER_SECOND;
  }
  return null;
}

/** Full bars the pack takes in the pressure window after first blood: how much weight the fight has. */
function barsLostInPressureWindow(fight: BountyFight): number {
  if (fight.blows.length === 0) return 0;
  const windowEnds = fight.blows[0].frame + BOUNTY_PRESSURE_WINDOW_SECONDS * FRAMES_PER_SECOND;
  const loss = fight.blows
    .filter((blow) => blow.frame <= windowEnds)
    .reduce((sum, blow) => sum + blow.amount, 0);
  return loss / fight.crawlerMaxHp;
}

function asPercent(share: number): string {
  return `${Math.round(share * PERCENT)}%`;
}

function landedBlowFrom(fight: BountyFight, mobType: string): boolean {
  return fight.blows.some((blow) => blow.source.startsWith(`${mobType} `));
}

function listed(problems: readonly string[]): string {
  return problems.length === 0 ? '' : ` — ${problems.join('; ')}`;
}

section('bounty encounters whole, against a crawler standing her ground (balanced build)');
{
  const lastPartyLevel = partyLevelAtCap(markLevel(NORMAL)) + PARTY_LEVELS_PAST_CAP;
  for (const def of BOUNTY_DEFS) {
    for (const difficulty of BOUNTY_DIFFICULTIES) {
      for (const crawler of REFERENCE_CRAWLERS) {
        const label = `${def.id} vs ${crawler}, ${difficulty}`;
        const fights: BountyFight[] = [];
        for (let partyLevel = 1; partyLevel <= lastPartyLevel; partyLevel++) {
          fights.push(fightBounty(def, crawler, partyLevel, difficulty));
        }
        console.log(`      ${label}`);
        console.log(
          `      ${['party', 'mark', 'blow', 'death', 'bars'].map(cell).join('')}  (bars in ${BOUNTY_PRESSURE_WINDOW_SECONDS} s)`,
        );
        for (const fight of fights) {
          const death = secondsFromFirstBloodToDeath(fight);
          console.log(
            `      ${[
              cell(String(fight.partyLevel)),
              cell(String(fight.markLevel)),
              cell(heaviestBlowShare(fight)),
              cell(death ?? 'never'),
              cell(barsLostInPressureWindow(fight)),
            ].join('')}`,
          );
        }

        check(
          fights.every((fight) => fight.matchesReference && fight.blowCapped),
          `${label}: the staged crawler has the reference's max HP and every member carries the bounty blow cap`,
        );
        // A pack that never reached her would pass every bound below having
        // measured nothing, so each member has to be seen landing a blow.
        const silent = fights.filter((fight) => !landedBlowFrom(fight, fight.markType));
        check(
          silent.length === 0,
          `${label}: the mark lands a blow at every party level${listed(
            silent.map((fight) => `none at party ${fight.partyLevel}`),
          )}`,
        );
        const escortTypes = [...new Set(fights.flatMap((fight) => fight.escortTypes))];
        const quietEscorts = escortTypes.filter(
          (mobType) => !fights.some((fight) => landedBlowFrom(fight, mobType)),
        );
        check(
          escortTypes.length > 0 && quietEscorts.length === 0,
          `${label}: every escort lands a blow (${escortTypes.join(', ')})${listed(quietEscorts)}`,
        );

        const overweight = fights.flatMap((fight) =>
          [...heaviestBlowBySource(fight)]
            .filter(([, share]) => share > BOUNTY_MAX_BLOW_HP_SHARE + BLOW_SHARE_EPSILON)
            .map(([source, share]) => `party ${fight.partyLevel}: ${source} ${asPercent(share)}`),
        );
        check(
          overweight.length === 0,
          `${label}: no single blow takes more than ${asPercent(BOUNTY_MAX_BLOW_HP_SHARE)} of a full bar${listed(overweight)}`,
        );

        // The companion's bar is fixed at a few points by design and dodge is
        // her whole defence, so with dodge left out any two capped blows empty
        // it; she is held only to the locked-telegraph floor, the human to the
        // time to act.
        const minSeconds =
          difficulty === 'hard' || crawler !== 'human'
            ? BOUNTY_LOCKED_FLOOR_SECONDS
            : BOUNTY_MIN_SECONDS_FIRST_BLOOD_TO_DEATH;
        const quickDeaths = fights.flatMap((fight) => {
          const death = secondsFromFirstBloodToDeath(fight);
          return death !== null && death < minSeconds
            ? [`party ${fight.partyLevel}: dead ${death.toFixed(2)} s after first blood`]
            : [];
        });
        check(
          quickDeaths.length === 0,
          `${label}: standing her ground, she lives at least ${minSeconds.toFixed(2)} s past first blood${listed(quickDeaths)}`,
        );
      }
    }
  }
}

console.log(
  failures === 0 ? '\nAll difficulty-curve checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
