#!/usr/bin/env tsx
/**
 * Headless gate on levelled mob tactics: which mobs learn a trait, how likely
 * they are to, and how each learned behaviour is bounded once it is running.
 *
 * Every behaviour check drives a real creature through the real code on a
 * small hand-built `GameMap`, and measures a distance or a frame count rather
 * than counting outcomes, so a run that happens to be lucky cannot pass broken
 * code. Where a check needs a random outcome to happen at all (a guard to go
 * up), it retries a bounded number of times and fails if it never sees one —
 * a gate that cannot find what it measures is red, not green.
 *
 * Layout: each trait's behaviour lives in its own section function, all run
 * from the `SECTIONS` list at the bottom, so a behaviour that gains live
 * wiring adds a section there without touching the others.
 *
 * Run: npm run verify:tactics
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MOB_GRID_CELL_SIZE, PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mob, PlayerDamageType } from '../src/creatures/Mob';
import type { SpatialGrid } from '../src/core/SpatialGrid';
import { createMob, getRegisteredMobTypes, MAX_MOB_LEVEL } from '../src/levels/spawner';
import {
  DIFFICULTY_PROFILES,
  applySpawnDifficulty,
  type Difficulty,
} from '../src/core/difficultyProfiles';
import { withWorldSeed } from '../src/core/WorldRandom';
import { mulberry32, type Rng } from '../src/sprites/person/rng';
import {
  TACTICS_MIN_MOB_LEVEL,
  TACTICS_TRAITS,
  TRAIT_RAMPS,
  rollTacticsTraits,
  traitChance,
  type TacticsTrait,
} from '../src/creatures/tactics/tacticsTraits';
import {
  GUARD_COOLDOWN_FRAMES,
  GUARD_KNOCKBACK_FRAMES,
  GUARD_KNOCKBACK_TILES,
  GUARD_LOW_HP_FRACTION,
} from '../src/creatures/tactics/blockGuard';
import { ITEM_DEF, type ItemId } from '../src/core/ItemDefs';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import type { GroundHazardSource } from '../src/systems/GroundHazardSource';
import { GOBLIN_MAX_SPEED, Goblin } from '../src/creatures/Goblin';
import { GOBLIN_ATTACKS, type GoblinWeapon } from '../src/sprites/goblinSprite';
import {
  KITE_COOLDOWN_FRAMES,
  KITE_MAX_DISTANCE_TILES,
  KITE_MAX_FRAMES,
  REGROUP_HP_FRACTION,
  REGROUP_MAX_FRAMES,
} from '../src/creatures/tactics/retreat';
import { RIPOSTE_READY_FRAMES } from '../src/creatures/tactics/riposte';
import {
  FLANK_RELEASE_TILES,
  FLANK_STAGED_TILES,
  FLANK_STAGING_TILES,
} from '../src/creatures/tactics/flank';
import {
  DifficultyTelemetrySystem,
  FIGHT_END_GRACE_FRAMES,
  MIN_COUNTED_FIGHT_FRAMES,
} from '../src/systems/DifficultyTelemetrySystem';
import { difficultyStats } from '../src/core/DifficultyStats';
import {
  noteGuardBlock,
  noteKiteEnd,
  noteKiteStart,
} from '../src/creatures/tactics/tacticsTelemetry';
import { checkRangedTactics } from './tacticsSections/ranged';
import { checkSpecialCaseTactics } from './tacticsSections/special';
import { checkMeleeTactics } from './tacticsSections/melee';
import { checkTierTableFitsFloors } from './tacticsSections/tierTable';
import { checkGrubTactics } from './tacticsSections/grub';
import { checkFallBackSandwich } from './tacticsSections/sandwich';
import { chasedKitesRunOn, describeKiteLengths } from './tacticsSections/chasedKites';

// ── Harness ────────────────────────────────────────────────────────────────

let failures = 0;
function check(ok: boolean, message: string): void {
  if (ok) {
    console.log(`  ok   ${message}`);
  } else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

const ALL_DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** A source that says yes to every roll, so "no trait" can only mean "not eligible". */
const ALWAYS_YES: Rng = () => 0;

/** Fixed seeds, so every frequency below is reproducible to the digit. */
const ROLL_SEED = 0x7ac71c5;
const GUARD_SEED = 0x6a4d;
const RUN_SEED = 0x7ac7;

/** Decimal places a chance is printed to. */
const CHANCE_PRINT_DIGITS = 3;
/** Offending creatures listed on a failure before the rest are elided. */
const MAX_OFFENDERS_PRINTED = 5;

/** Floating-point slack when comparing a chance against its restated value. */
const CHANCE_EPSILON = 1e-9;

// ── The synthetic floor ────────────────────────────────────────────────────

/** An open walled room, big enough that nothing in it touches a wall by accident. */
const ROOM_SIZE_TILES = 24;
const ROOM_LAST_TILE = ROOM_SIZE_TILES - 1;
const ROOM_MIDDLE_TILE = Math.floor(ROOM_SIZE_TILES / 2);

function makeRoom(): GameMap {
  const grid: TileContent[][] = Array.from({ length: ROOM_SIZE_TILES }, (_, y) =>
    Array.from({ length: ROOM_SIZE_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === ROOM_LAST_TILE || y === ROOM_LAST_TILE;
      return {
        tileId: `${x}#${y}`,
        type: isBorder ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  // Built at the real tile height: a `GameMap` left on its default measures
  // world pixels against a ten-pixel grid and answers every sight test false.
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** The tile under a body's centre, which is the tile a mob is standing in. */
function centreTile(body: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.floor((body.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE / 2) / TILE_SIZE),
  };
}

function centreDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Slightly less than one cell, so a rectangle query covers exactly one cell. */
const CELL_QUERY_INSET_PX = 1e-6;

/**
 * Whether `mob` is filed under the grid cell its position is actually in.
 *
 * A query over exactly that one cell only looks in that cell's bucket, so a mob
 * that moved without being re-bucketed is still sitting in its old bucket and
 * is not returned here — which is also why melee and missiles miss it in game.
 */
function isFiledUnderOwnCell(grid: SpatialGrid<Mob>, mob: Mob): boolean {
  const cellLeft = Math.floor(mob.x / MOB_GRID_CELL_SIZE) * MOB_GRID_CELL_SIZE;
  const cellTop = Math.floor(mob.y / MOB_GRID_CELL_SIZE) * MOB_GRID_CELL_SIZE;
  const span = MOB_GRID_CELL_SIZE - CELL_QUERY_INSET_PX;
  return grid.queryRect(cellLeft, cellTop, span, span).includes(mob);
}

// ── Mob factories ──────────────────────────────────────────────────────────

/** A goblin at the top level with every trait it is eligible for. */
function makeBlocker(map: GameMap, tileX: number, tileY: number): Mob {
  const goblin = createMob('goblin', tileX, tileY, map);
  goblin.applyMobLevel(MAX_MOB_LEVEL);
  goblin.rollTactics(DIFFICULTY_PROFILES.normal.tacticsChanceScale, ALWAYS_YES);
  return goblin;
}

/** How far west of a probe mob its attacker stands, in tiles. */
const ATTACKER_OFFSET_TILES = 3;
/** How far east of a probe mob an unrelated goblin stands, in tiles. */
const BYSTANDER_OFFSET_TILES = 2;
/** The first floor tile inside the room's wall, where a crawler is out of the way. */
const FAR_CORNER_TILE = 1;

/** A non-lethal blow's size: small against any levelled goblin's health. */
const PROBE_BLOW_DAMAGE = 1;

/** Put a mob back at full health so the low-HP rule never interferes with a probe. */
function healFully(mob: Mob): void {
  mob.hp = mob.maxHp;
}

function tickFrames(mob: Mob, frames: number): void {
  for (let frame = 0; frame < frames; frame++) mob.tickTimers();
}

// ── Roll floor: nothing below the minimum level ────────────────────────────

/** The highest mob level that must behave exactly as the untuned early game. */
const HIGHEST_TRAITLESS_LEVEL = TACTICS_MIN_MOB_LEVEL - 1;
/**
 * The same ceiling, restated rather than derived, so that lowering the game's
 * minimum tactics level cannot quietly lower the bar this gate holds it to.
 */
const EARLY_GAME_TOP_MOB_LEVEL = 4;

/** Pure rolls per level for the "across many rolls" half of the floor check. */
const FLOOR_ROLLS_PER_LEVEL = 2000;

function checkNothingBelowMinimumLevel(map: GameMap): void {
  section('No mob below the minimum tactics level rolls any trait');

  check(
    HIGHEST_TRAITLESS_LEVEL >= EARLY_GAME_TOP_MOB_LEVEL,
    `traits start above the early game: none up to level ${HIGHEST_TRAITLESS_LEVEL} (need ${EARLY_GAME_TOP_MOB_LEVEL})`,
  );

  const rng = mulberry32(ROLL_SEED);
  let pureRollTraits = 0;
  for (let level = 1; level <= EARLY_GAME_TOP_MOB_LEVEL; level++) {
    for (const difficulty of ALL_DIFFICULTIES) {
      const scale = DIFFICULTY_PROFILES[difficulty].tacticsChanceScale;
      for (let roll = 0; roll < FLOOR_ROLLS_PER_LEVEL; roll++) {
        pureRollTraits += rollTacticsTraits(level, TACTICS_TRAITS, scale, rng).length;
      }
      pureRollTraits += rollTacticsTraits(level, TACTICS_TRAITS, scale, ALWAYS_YES).length;
    }
  }
  check(
    pureRollTraits === 0,
    `levels 1-${EARLY_GAME_TOP_MOB_LEVEL}, every trait eligible, every profile: ${pureRollTraits} traits rolled`,
  );

  const offenders: string[] = [];
  const eligibleAtTop: string[] = [];
  const unbuildable: string[] = [];
  for (const type of getRegisteredMobTypes()) {
    try {
      for (let level = 1; level <= EARLY_GAME_TOP_MOB_LEVEL; level++) {
        for (const difficulty of ALL_DIFFICULTIES) {
          const mob = createMob(type, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, map);
          mob.applyMobLevel(level);
          // A roll that says yes to everything is the worst case: any trait
          // this mob could ever be given would show up here.
          mob.rollTactics(DIFFICULTY_PROFILES[difficulty].tacticsChanceScale, ALWAYS_YES);
          if (mob.tactics.hasAnyTrait) {
            offenders.push(`${type}@${level}/${difficulty}: ${mob.tactics.traits.join(',')}`);
          }
        }
      }
      const top = createMob(type, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, map);
      top.applyMobLevel(MAX_MOB_LEVEL);
      top.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
      if (top.tactics.hasAnyTrait) eligibleAtTop.push(`${type}(${top.tactics.traits.join(',')})`);
    } catch (error) {
      unbuildable.push(`${type}: ${String(error)}`);
    }
  }
  check(
    unbuildable.length === 0,
    `every registered creature builds headlessly ${unbuildable.join('; ')}`,
  );
  check(
    offenders.length === 0,
    `no registered creature at levels 1-${EARLY_GAME_TOP_MOB_LEVEL} rolls a trait ${offenders.slice(0, MAX_OFFENDERS_PRINTED).join('; ')}`,
  );
  // The floor check above is only meaningful if some creature can roll at all.
  check(
    eligibleAtTop.length > 0,
    `at least one creature learns a trait at the top level: ${eligibleAtTop.join(' ') || 'none'}`,
  );
  check(
    eligibleAtTop.some((entry) => entry.startsWith('goblin(') && entry.includes('block')),
    'the goblin is eligible to block',
  );
}

// ── Roll table: chances at unlock, at the top level, under the cap ─────────

/**
 * The chance the table should give, restated from the ramp's own fields so the
 * game's arithmetic — the zero below unlock, the scale applied before the cap —
 * is checked against an independent copy rather than against itself. The
 * table's *values* are held to shipped content by {@link checkTierTableFitsFloors}.
 */
function expectedChance(trait: TacticsTrait, level: number, scale: number): number {
  const ramp = TRAIT_RAMPS[trait];
  if (level < TACTICS_MIN_MOB_LEVEL || level < ramp.unlockLevel) return 0;
  const levelsPastUnlock = level - ramp.unlockLevel;
  return Math.min(
    ramp.maxChance,
    (ramp.chanceAtUnlock + ramp.chancePerLevel * levelsPastUnlock) * scale,
  );
}

/** Seeded draws per measured frequency; the tolerance below is ~4.5 standard errors. */
const FREQUENCY_SAMPLES = 20000;
const FREQUENCY_TOLERANCE = 0.015;

/** Real goblins spawned through `applySpawnDifficulty` for the wiring check. */
const SPAWNED_GOBLIN_SAMPLES = 2000;
const SPAWNED_GOBLIN_TOLERANCE = 0.045;

function checkRollTable(map: GameMap): void {
  section('Trait chances follow TRAIT_RAMPS under every profile');

  const scales = ALL_DIFFICULTIES.map((d) => DIFFICULTY_PROFILES[d].tacticsChanceScale);
  check(
    DIFFICULTY_PROFILES.normal.tacticsChanceScale === 1 &&
      DIFFICULTY_PROFILES.easy.tacticsChanceScale < 1 &&
      DIFFICULTY_PROFILES.hard.tacticsChanceScale > 1,
    `profile scales: easy < 1, normal = 1, hard > 1 (${scales.join(' / ')})`,
  );

  for (const trait of TACTICS_TRAITS) {
    const ramp = TRAIT_RAMPS[trait];
    for (const difficulty of ALL_DIFFICULTIES) {
      const scale = DIFFICULTY_PROFILES[difficulty].tacticsChanceScale;
      const belowUnlock = traitChance(trait, ramp.unlockLevel - 1, scale);
      const atUnlock = traitChance(trait, ramp.unlockLevel, scale);
      const atTop = traitChance(trait, MAX_MOB_LEVEL, scale);
      let highest = 0;
      for (let level = 1; level <= MAX_MOB_LEVEL; level++) {
        highest = Math.max(highest, traitChance(trait, level, scale));
      }
      check(
        belowUnlock === 0 &&
          atUnlock > 0 &&
          Math.abs(atUnlock - expectedChance(trait, ramp.unlockLevel, scale)) < CHANCE_EPSILON &&
          Math.abs(atTop - expectedChance(trait, MAX_MOB_LEVEL, scale)) < CHANCE_EPSILON &&
          highest <= ramp.maxChance + CHANCE_EPSILON,
        `${trait}/${difficulty}: 0 below ${ramp.unlockLevel}, ${atUnlock.toFixed(CHANCE_PRINT_DIGITS)} at unlock, ${atTop.toFixed(CHANCE_PRINT_DIGITS)} at ${MAX_MOB_LEVEL}, peak ${highest.toFixed(CHANCE_PRINT_DIGITS)} <= cap ${ramp.maxChance}`,
      );
    }
  }

  // Measured frequencies from the real roll, at unlock and at the top.
  for (const trait of TACTICS_TRAITS) {
    const ramp = TRAIT_RAMPS[trait];
    const eligibility: readonly TacticsTrait[] =
      trait === 'riposte' ? ['block', 'riposte'] : [trait];
    for (const level of [ramp.unlockLevel, MAX_MOB_LEVEL]) {
      const scale = DIFFICULTY_PROFILES.hard.tacticsChanceScale;
      const rng = mulberry32(ROLL_SEED + level);
      let hits = 0;
      for (let sample = 0; sample < FREQUENCY_SAMPLES; sample++) {
        if (rollTacticsTraits(level, eligibility, scale, rng).includes(trait)) hits++;
      }
      const measured = hits / FREQUENCY_SAMPLES;
      // Riposte is conditional on block, so its unconditional rate is the product.
      const expected =
        trait === 'riposte'
          ? expectedChance('block', level, scale) * expectedChance('riposte', level, scale)
          : expectedChance(trait, level, scale);
      check(
        Math.abs(measured - expected) <= FREQUENCY_TOLERANCE,
        `${trait} at level ${level} (hard): measured ${measured.toFixed(CHANCE_PRINT_DIGITS)} vs ${expected.toFixed(CHANCE_PRINT_DIGITS)}`,
      );
    }
  }

  const riposteAlone = rollTacticsTraits(MAX_MOB_LEVEL, ['riposte'], 1, ALWAYS_YES);
  check(riposteAlone.length === 0, 'riposte is never rolled without block eligibility');
  const withBlock = rollTacticsTraits(MAX_MOB_LEVEL, ['block', 'riposte'], 1, ALWAYS_YES);
  check(
    withBlock.includes('block') && withBlock.includes('riposte'),
    'riposte is rolled on top of block when both are eligible',
  );
  const rngRefusingBlock: Rng = (() => {
    let draw = 0;
    // First draw (block) fails, every later one would pass.
    return () => (draw++ === 0 ? 1 : 0);
  })();
  check(
    rollTacticsTraits(MAX_MOB_LEVEL, ['block', 'riposte'], 1, rngRefusingBlock).length === 0,
    'a mob that failed its block roll never gets riposte',
  );

  // End to end through the spawn helper every spawn site calls, on real goblins.
  const normal = DIFFICULTY_PROFILES.normal;
  const spawnGoblins = (level: number): Mob[] =>
    withWorldSeed(ROLL_SEED, () => {
      const goblins: Mob[] = [];
      for (let i = 0; i < SPAWNED_GOBLIN_SAMPLES; i++) {
        const goblin = createMob('goblin', ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, map);
        goblin.applyMobLevel(level);
        applySpawnDifficulty(goblin, normal);
        goblins.push(goblin);
      }
      return goblins;
    });
  const topGoblins = spawnGoblins(MAX_MOB_LEVEL);
  const blockRate = topGoblins.filter((g) => g.tactics.has('block')).length / topGoblins.length;
  const expectedBlock = expectedChance('block', MAX_MOB_LEVEL, normal.tacticsChanceScale);
  check(
    Math.abs(blockRate - expectedBlock) <= SPAWNED_GOBLIN_TOLERANCE,
    `goblins spawned at level ${MAX_MOB_LEVEL} through applySpawnDifficulty block at ${blockRate.toFixed(CHANCE_PRINT_DIGITS)} (table ${expectedBlock.toFixed(CHANCE_PRINT_DIGITS)})`,
  );
  const blockers = topGoblins.filter((g) => g.tactics.has('block'));
  check(
    blockers.every((g) => Math.abs(g.tactics.guardChancePerBlow - expectedBlock) < CHANCE_EPSILON),
    'a blocking goblin guards each blow at its trait chance',
  );
  const replay = spawnGoblins(MAX_MOB_LEVEL);
  check(
    replay.every((g, i) => g.tactics.traits.join() === topGoblins[i].tactics.traits.join()),
    'the same world seed replays the same traits',
  );
  const lowGoblins = spawnGoblins(EARLY_GAME_TOP_MOB_LEVEL);
  check(
    lowGoblins.every((g) => !g.tactics.hasAnyTrait),
    `goblins spawned at level ${EARLY_GAME_TOP_MOB_LEVEL} through applySpawnDifficulty have no traits`,
  );
}

// ── Spawn sites: every levelled spawn also rolls ───────────────────────────

/** Files where `applyMobLevel` is defined or documented rather than called at a spawn. */
const SPAWN_SCAN_EXEMPT = new Set(['src/creatures/Mob.ts']);
/** Far fewer levelled spawn sites than exist would mean the scan stopped finding them. */
const MIN_LEVELLED_SPAWN_FILES = 5;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function checkSpawnSites(): void {
  section('Every spawn site that levels a mob also rolls its traits');
  const levelCall = /\b\w+\.applyMobLevel\(/g;
  const spawnCall = /\bapplySpawnDifficulty\(\s*\w/g;
  const shortfalls: string[] = [];
  let levelledFiles = 0;
  for (const file of listSourceFiles('src')) {
    if (SPAWN_SCAN_EXEMPT.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    const levelled = countMatches(source, levelCall);
    if (levelled === 0) continue;
    levelledFiles++;
    const rolled = countMatches(source, spawnCall);
    if (rolled < levelled) shortfalls.push(`${file} (${levelled} levelled, ${rolled} rolled)`);
  }
  check(
    levelledFiles >= MIN_LEVELLED_SPAWN_FILES,
    `found ${levelledFiles} files that level mobs (at least ${MIN_LEVELLED_SPAWN_FILES})`,
  );
  check(
    shortfalls.length === 0,
    `each pairs applyMobLevel with applySpawnDifficulty ${shortfalls.join('; ')}`,
  );
}

// ── Block: which blows, how often, and the shove ───────────────────────────

/** Blows thrown in each streak probe. */
const STREAK_PROBE_BLOWS = 3000;
/** A guard probe that never sees a guard is not measuring anything. */
const MIN_GUARDS_OBSERVED = 20;
/** Attempts per refused channel; at the top chance that is ~120 expected guards if it leaked. */
const REFUSED_CHANNEL_ATTEMPTS = 400;
/** Retries allowed while waiting for a guard to go up in the knockback probes. */
const GUARD_WAIT_ATTEMPTS = 500;

/**
 * Throw `blows` melee blows spaced `spacingFrames` apart and return every
 * frame on which one was guarded, plus whether two blows in a row were.
 */
function runStreakProbe(
  mob: Mob,
  human: HumanPlayer,
  blows: number,
  spacingFrames: number,
): { guardFrames: number[]; consecutive: number } {
  const guardFrames: number[] = [];
  let consecutive = 0;
  let previousGuarded = false;
  let frame = 0;
  const rng = mulberry32(GUARD_SEED);
  const savedRandom = Math.random;
  Math.random = rng;
  try {
    for (let blow = 0; blow < blows; blow++) {
      healFully(mob);
      mob.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'melee');
      const guarded = mob.lastBlowWasGuarded;
      if (guarded) guardFrames.push(frame);
      if (guarded && previousGuarded) consecutive++;
      previousGuarded = guarded;
      mob.clearKnockback();
      tickFrames(mob, spacingFrames);
      frame += spacingFrames;
    }
  } finally {
    Math.random = savedRandom;
  }
  return { guardFrames, consecutive };
}

function smallestGap(frames: readonly number[]): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < frames.length; i++) smallest = Math.min(smallest, frames[i] - frames[i - 1]);
  return smallest;
}

function checkBlockStreaks(map: GameMap): void {
  section('Block: never two in a row, never inside the cooldown');
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );

  const blocker = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  check(blocker.tactics.has('block'), 'the probe goblin rolled block');

  // Blows further apart than the cooldown: only the "clean hit between" rule
  // can stop a streak here.
  const slow = runStreakProbe(blocker, human, STREAK_PROBE_BLOWS, GUARD_COOLDOWN_FRAMES + 1);
  check(
    slow.guardFrames.length >= MIN_GUARDS_OBSERVED,
    `slow blows: ${slow.guardFrames.length} guards seen (need ${MIN_GUARDS_OBSERVED})`,
  );
  check(slow.consecutive === 0, `slow blows: ${slow.consecutive} back-to-back guards`);

  // A blow every frame: only the cooldown can hold guards apart here.
  blocker.resetToSpawn();
  const fast = runStreakProbe(blocker, human, STREAK_PROBE_BLOWS, 1);
  const fastGap = smallestGap(fast.guardFrames);
  check(
    fast.guardFrames.length >= 2,
    `fast blows: ${fast.guardFrames.length} guards seen (need 2 to measure a gap)`,
  );
  check(fast.consecutive === 0, `fast blows: ${fast.consecutive} back-to-back guards`);
  check(
    fastGap >= GUARD_COOLDOWN_FRAMES,
    `fast blows: closest guards ${fastGap} frames apart (cooldown ${GUARD_COOLDOWN_FRAMES})`,
  );
}

type RefusedChannel = {
  readonly label: string;
  readonly strike: (mob: Mob, human: HumanPlayer, other: Mob) => void;
};

const SPELL_AND_AREA_TYPES: readonly PlayerDamageType[] = [
  'missile',
  'shell',
  'smush',
  'explosion',
];

const REFUSED_CHANNELS: readonly RefusedChannel[] = [
  {
    label: 'a poison status tick',
    strike: (mob, human) =>
      mob.takeDamage(PROBE_BLOW_DAMAGE, { kind: 'status', effectType: 'poison', applier: human }),
  },
  {
    label: 'an owned damage-over-time tick',
    strike: (mob, human) => mob.takeDamageFrom(PROBE_BLOW_DAMAGE, human, null),
  },
  ...SPELL_AND_AREA_TYPES.map((type): RefusedChannel => ({
    label: `a crawler's ${type}`,
    strike: (mob, human) => mob.takeDamageFrom(PROBE_BLOW_DAMAGE, human, type),
  })),
  {
    label: 'unowned environmental melee',
    strike: (mob) => mob.takeDamageFrom(PROBE_BLOW_DAMAGE, null, 'melee'),
  },
  {
    label: 'another creature’s melee',
    strike: (mob, _human, other) => mob.takeDamageFrom(PROBE_BLOW_DAMAGE, other, 'melee'),
  },
  {
    label: 'environmental damage with no source',
    strike: (mob) => mob.takeDamage(PROBE_BLOW_DAMAGE),
  },
];

function checkRefusedChannels(map: GameMap): void {
  section('Block: status ticks, spells, blasts and the environment are never guarded');
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const bystander = createMob(
    'goblin',
    ROOM_MIDDLE_TILE + BYSTANDER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    map,
  );

  for (const channel of REFUSED_CHANNELS) {
    const blocker = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
    let guarded = 0;
    let missedDamage = 0;
    let readyAttempts = 0;
    for (let attempt = 0; attempt < REFUSED_CHANNEL_ATTEMPTS; attempt++) {
      healFully(blocker);
      if (blocker.tactics.isGuardReady) readyAttempts++;
      const before = blocker.hp;
      channel.strike(blocker, human, bystander);
      if (blocker.lastBlowWasGuarded) guarded++;
      if (blocker.hp >= before) missedDamage++;
    }
    check(
      readyAttempts === REFUSED_CHANNEL_ATTEMPTS && guarded === 0 && missedDamage === 0,
      `${channel.label}: ${guarded} guarded, ${missedDamage} dealt no damage, guard ready on ${readyAttempts}/${REFUSED_CHANNEL_ATTEMPTS}`,
    );
  }

  // The same setup with a guardable blow must guard, or the zeros above prove nothing.
  const control = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  let controlGuards = 0;
  for (let attempt = 0; attempt < REFUSED_CHANNEL_ATTEMPTS; attempt++) {
    healFully(control);
    control.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'slingshot');
    if (control.lastBlowWasGuarded) controlGuards++;
    control.tactics.clearLiveState();
  }
  check(controlGuards > 0, `control: a sling stone is guarded (${controlGuards} times)`);
}

function checkLowHpNeverGuards(map: GameMap): void {
  section('Block: a mob at or below the low-HP line never guards');
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const blocker = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  const lowHp = Math.floor(blocker.maxHp * GUARD_LOW_HP_FRACTION);
  check(lowHp > PROBE_BLOW_DAMAGE, `the probe goblin has room below the line (${lowHp} HP)`);

  let lowGuards = 0;
  let aboveGuards = 0;
  for (let attempt = 0; attempt < REFUSED_CHANNEL_ATTEMPTS; attempt++) {
    blocker.hp = lowHp;
    blocker.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'melee');
    if (blocker.lastBlowWasGuarded) lowGuards++;
    blocker.tactics.clearLiveState();
    // One point above the line: the nearest blow that *may* be guarded.
    blocker.hp = lowHp + 1;
    blocker.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'melee');
    if (blocker.lastBlowWasGuarded) aboveGuards++;
    blocker.tactics.clearLiveState();
  }
  check(lowGuards === 0, `at ${lowHp}/${blocker.maxHp} HP: ${lowGuards} guards`);
  check(aboveGuards > 0, `control at ${lowHp + 1}/${blocker.maxHp} HP: ${aboveGuards} guards`);
}

/**
 * Room a shove may lose to the ease-out's per-step cap and to rounding in the
 * collision step. A mob's own walking is not allowed for: it must not move
 * itself at all while it is being shoved.
 */
const SHOVE_SLACK_PX = 2;
/** The least a shove into a wall must still move the mob before stopping it. */
const WALL_APPROACH_MIN_PX = TILE_SIZE / 2;
/** Extra frames watched after the shove ends, for a late re-bucket or a wall slip. */
const SHOVE_SETTLE_FRAMES = 4;

interface ShoveTrace {
  readonly guarded: boolean;
  readonly startDistance: number;
  /** Distance from the attacker on the frame the shove's last step lands. */
  readonly shoveEndDistance: number;
  readonly startX: number;
  readonly endX: number;
  /** The furthest east the mob reached, which is toward the wall in the wall probe. */
  readonly maxX: number;
  readonly framesInWall: number;
  readonly framesMisfiled: number;
  readonly crossedCell: boolean;
  readonly finished: boolean;
}

/**
 * Hit `mob` from `human` until it guards, then run the real mob update loop
 * over the shove and trace where it goes.
 */
function traceGuardShove(map: GameMap, mob: Mob, human: HumanPlayer, cat: CatPlayer): ShoveTrace {
  const roster = new MobRoster(map, new SpellSystem());
  roster.add(mob);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
  const loop = new MobUpdateLoop();

  let guarded = false;
  for (let attempt = 0; attempt < GUARD_WAIT_ATTEMPTS && !guarded; attempt++) {
    healFully(mob);
    mob.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'melee');
    guarded = mob.lastBlowWasGuarded;
  }

  const startX = mob.x;
  const startCell = Math.floor(mob.x / MOB_GRID_CELL_SIZE);
  const startDistance = centreDistance(mob, human);
  let framesInWall = 0;
  let framesMisfiled = 0;
  let crossedCell = false;
  let shoveEndDistance = startDistance;
  let maxX = startX;
  for (let frame = 0; frame < GUARD_KNOCKBACK_FRAMES + SHOVE_SETTLE_FRAMES; frame++) {
    loop.update(ctx);
    maxX = Math.max(maxX, mob.x);
    if (frame === GUARD_KNOCKBACK_FRAMES - 1) shoveEndDistance = centreDistance(mob, human);
    const tile = centreTile(mob);
    if (!map.isWalkable(tile.x, tile.y)) framesInWall++;
    if (!isFiledUnderOwnCell(roster.grid, mob)) framesMisfiled++;
    if (Math.floor(mob.x / MOB_GRID_CELL_SIZE) !== startCell) crossedCell = true;
  }
  loop.dispose();
  return {
    guarded,
    startDistance,
    shoveEndDistance,
    startX,
    endX: mob.x,
    maxX,
    framesInWall,
    framesMisfiled,
    crossedCell,
    finished: mob.knockbackFramesRemaining === 0,
  };
}

/** Where the open-floor shove starts: just west of a grid-cell edge, so it must cross it. */
const OPEN_SHOVE_CELL_EDGE_TILE = 12;
const OPEN_SHOVE_START_INSET_PX = 12;
/** Floor tiles between the wall probe's mob and the wall it is shoved at. */
const WALL_PROBE_TILES_FROM_WALL = 2;

function checkGuardShove(map: GameMap): void {
  section('Block: the shove moves the mob away, stays out of walls, and keeps its grid cell');
  check(
    (OPEN_SHOVE_CELL_EDGE_TILE * TILE_SIZE) % MOB_GRID_CELL_SIZE === 0,
    'the open-floor probe starts beside a real grid-cell edge',
  );

  const openStartX = OPEN_SHOVE_CELL_EDGE_TILE * TILE_SIZE - OPEN_SHOVE_START_INSET_PX;
  const openMob = makeBlocker(map, OPEN_SHOVE_CELL_EDGE_TILE - 1, ROOM_MIDDLE_TILE);
  openMob.x = openStartX;
  const openHuman = new HumanPlayer(
    OPEN_SHOVE_CELL_EDGE_TILE - 1 - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  openHuman.godMode = true;
  const farCat = new CatPlayer(FAR_CORNER_TILE, FAR_CORNER_TILE, TILE_SIZE);
  farCat.godMode = true;
  const open = traceGuardShove(map, openMob, openHuman, farCat);
  // The shove is the room the player is given back, so on open floor it must
  // arrive whole: the mob chasing back mid-shove would quietly eat it.
  const shoveLengthPx = GUARD_KNOCKBACK_TILES * TILE_SIZE;
  const minGainPx = shoveLengthPx - SHOVE_SLACK_PX;
  const gainPx = open.shoveEndDistance - open.startDistance;
  check(open.guarded, 'open floor: a guard went up');
  check(
    gainPx >= minGainPx,
    `open floor: the mob ends the shove ${gainPx.toFixed(1)} px further from the attacker (need ${minGainPx.toFixed(1)})`,
  );
  check(open.finished, 'open floor: the shove ends within its frame budget');
  check(open.crossedCell, 'open floor: the shove carried the mob into another grid cell');
  check(
    open.framesMisfiled === 0,
    `open floor: ${open.framesMisfiled} frames filed under a stale grid cell`,
  );
  check(open.framesInWall === 0, `open floor: ${open.framesInWall} frames standing in a wall`);

  // One tile off the east wall with the attacker to the west: less room than
  // the shove is long, so it must travel toward the masonry and then stop.
  const wallTile = ROOM_LAST_TILE - WALL_PROBE_TILES_FROM_WALL;
  const wallMob = makeBlocker(map, wallTile, ROOM_MIDDLE_TILE);
  const wallHuman = new HumanPlayer(wallTile - ATTACKER_OFFSET_TILES, ROOM_MIDDLE_TILE, TILE_SIZE);
  wallHuman.godMode = true;
  const wallCat = new CatPlayer(FAR_CORNER_TILE, FAR_CORNER_TILE, TILE_SIZE);
  wallCat.godMode = true;
  const wall = traceGuardShove(map, wallMob, wallHuman, wallCat);
  const wallFaceX = ROOM_LAST_TILE * TILE_SIZE;
  const wallApproachPx = wall.maxX - wall.startX;
  check(wall.guarded, 'against a wall: a guard went up');
  check(
    wallApproachPx >= WALL_APPROACH_MIN_PX,
    `against a wall: moved ${wallApproachPx.toFixed(1)} px toward the wall first (need ${WALL_APPROACH_MIN_PX})`,
  );
  check(
    wallApproachPx < shoveLengthPx - SHOVE_SLACK_PX,
    `against a wall: the wall cut the ${shoveLengthPx} px shove short at ${wallApproachPx.toFixed(1)} px`,
  );
  check(
    wall.framesInWall === 0,
    `against a wall: ${wall.framesInWall} frames standing in the wall`,
  );
  check(
    wall.endX + TILE_SIZE / 2 < wallFaceX,
    `against a wall: centre ends ${(wallFaceX - wall.endX - TILE_SIZE / 2).toFixed(1)} px short of the wall face`,
  );
  check(
    wall.framesMisfiled === 0,
    `against a wall: ${wall.framesMisfiled} frames filed under a stale grid cell`,
  );
}

// ── Credited blows: judged by whoever struck ───────────────────────────────

/** Reflections to watch land in each thorns probe. */
const REFLECT_EVENTS_WANTED = 40;
/** Frames of goblin AI allowed per reflection before the probe gives up. */
const REFLECT_FRAME_BUDGET = 2000;
/** Tiles north of the probe mob a second crawler stands, off the attacker's line. */
const NORTH_STRIKER_OFFSET_TILES = 3;
/** How closely a shove must line up with "away from the striker" (cosine). */
const SHOVE_ALIGNMENT_MIN = 0.99;
/** The reflect gear the thorns probe wears. */
const REFLECT_GEAR: ItemId = 'shade_gnoll_kneepads';

type ReflectOutcome = 'landed' | 'guarded' | 'timeout';

/**
 * Let `mob` swing at a thorns-wearing `human` until one of its blows comes back
 * at it, through the goblin's own AI and `Mob.reflectMeleeDamage`.
 */
function awaitReflection(mob: Mob, human: HumanPlayer): ReflectOutcome {
  const hpBefore = mob.hp;
  // `lastBlowWasGuarded` describes the latest call, so a harmless zero blow
  // clears a guard left over from before the probe began.
  mob.takeDamageFrom(0, null, null);
  for (let frame = 0; frame < REFLECT_FRAME_BUDGET; frame++) {
    human.hp = human.maxHp;
    mob.updateAI([human]);
    mob.tickTimers();
    if (mob.lastBlowWasGuarded) return 'guarded';
    if (mob.hp < hpBefore) return 'landed';
  }
  return 'timeout';
}

function makeThornsHuman(tileX: number, tileY: number): HumanPlayer {
  const human = new HumanPlayer(tileX, tileY, TILE_SIZE);
  human.inventory.equipment.equip({ ...ITEM_DEF[REFLECT_GEAR], quantity: 1 });
  return human;
}

/** Files that deal damage in a hireling's name, and so must name the real striker. */
const HIRELING_DAMAGE_FILES = [
  'src/creatures/mercenaries/mercenaryStrike.ts',
  'src/creatures/mercenaries/golemKit.ts',
  'src/creatures/mercenaries/brawlerKit.ts',
  'src/creatures/mercenaries/lancerKit.ts',
  'src/systems/RockThrowSystem.ts',
  'src/systems/HirelingBoltSystem.ts',
];

function checkCreditedBlows(map: GameMap): void {
  section('Block: reflected and hireling damage is judged by whoever struck');

  const thornsHuman = makeThornsHuman(ROOM_MIDDLE_TILE - 1, ROOM_MIDDLE_TILE);
  check(
    thornsHuman.inventory.equipment.getDamageReflectPct() > 0,
    'fixture: the thorns probe wears reflect gear',
  );

  // Thorns is never guarded.
  const target = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  let landed = 0;
  let guarded = 0;
  let timedOut = 0;
  for (let event = 0; event < REFLECT_EVENTS_WANTED; event++) {
    healFully(target);
    target.tactics.clearLiveState();
    target.clearKnockback();
    const outcome = awaitReflection(target, thornsHuman);
    if (outcome === 'landed') landed++;
    else if (outcome === 'guarded') guarded++;
    else timedOut++;
  }
  check(
    guarded === 0 && landed === REFLECT_EVENTS_WANTED,
    `thorns: ${landed} reflections landed, ${guarded} guarded, ${timedOut} never came`,
  );

  // Thorns does not count as the clean hit that ends a run of guards.
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const latched = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  const spent = spendGuard(latched, human);
  latched.clearKnockback();
  tickFrames(latched, GUARD_COOLDOWN_FRAMES);
  const latchedBefore = !latched.tactics.isGuardReady;
  healFully(latched);
  const reflected = awaitReflection(latched, thornsHuman);
  check(
    spent && latchedBefore && reflected === 'landed' && !latched.tactics.isGuardReady,
    `thorns after a guard: reflection ${reflected}, guard ready afterwards: ${latched.tactics.isGuardReady} (must stay spent)`,
  );
  latched.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'melee');
  check(latched.tactics.isGuardReady, 'control: a real blow after the cooldown readies the guard');

  // A hireling's blow is a creature's: never guarded, but it is a clean hit.
  const bystander = createMob(
    'goblin',
    ROOM_MIDDLE_TILE + BYSTANDER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    map,
  );
  const hired = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  let hiredGuards = 0;
  for (let attempt = 0; attempt < REFUSED_CHANNEL_ATTEMPTS; attempt++) {
    healFully(hired);
    hired.takeCreditedDamage(PROBE_BLOW_DAMAGE, human, 'melee', bystander);
    if (hired.lastBlowWasGuarded) hiredGuards++;
  }
  check(hiredGuards === 0, `a hireling's blow credited to a crawler: ${hiredGuards} guarded`);
  const hiredSpent = spendGuard(hired, human);
  tickFrames(hired, GUARD_COOLDOWN_FRAMES);
  healFully(hired);
  hired.takeCreditedDamage(PROBE_BLOW_DAMAGE, human, 'melee', bystander);
  check(
    hiredSpent && hired.tactics.isGuardReady,
    "a hireling's blow after the cooldown still breaks a run of guards",
  );

  // A guard shoves away from the striker, not from whoever is credited.
  const northStriker = new CatPlayer(
    ROOM_MIDDLE_TILE,
    ROOM_MIDDLE_TILE - NORTH_STRIKER_OFFSET_TILES,
    TILE_SIZE,
  );
  const shoved = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  let shovedGuarded = false;
  for (let attempt = 0; attempt < GUARD_WAIT_ATTEMPTS && !shovedGuarded; attempt++) {
    healFully(shoved);
    shoved.takeCreditedDamage(PROBE_BLOW_DAMAGE, human, 'melee', northStriker);
    shovedGuarded = shoved.lastBlowWasGuarded;
  }
  const awayX = shoved.x - northStriker.x;
  const awayY = shoved.y - northStriker.y;
  const awayLength = Math.hypot(awayX, awayY);
  const alignment =
    (shoved.knockbackDirX * awayX + shoved.knockbackDirY * awayY) / Math.max(awayLength, 1);
  check(
    shovedGuarded && alignment >= SHOVE_ALIGNMENT_MIN,
    `a guard against a crawler striking for another shoves away from the striker (alignment ${alignment.toFixed(CHANCE_PRINT_DIGITS)})`,
  );

  const ownerCreditedDirect = /takeDamageFrom\([^;]*\bowner\b/g;
  for (const file of HIRELING_DAMAGE_FILES) {
    const source = readFileSync(file, 'utf8');
    const direct = countMatches(source, ownerCreditedDirect);
    const credited = countMatches(source, /\btakeCreditedDamage\(/g);
    check(
      direct === 0 && credited > 0,
      `${file} names the real striker for owner-credited damage (${direct} direct, ${credited} credited)`,
    );
  }
}

// ── Traits outlive every fight reset ───────────────────────────────────────

/** Guard the mob once, so it has live state for a reset to clear. */
function spendGuard(mob: Mob, human: HumanPlayer): boolean {
  for (let attempt = 0; attempt < GUARD_WAIT_ATTEMPTS; attempt++) {
    healFully(mob);
    mob.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'melee');
    if (mob.lastBlowWasGuarded) return true;
  }
  return false;
}

function checkTraitsSurviveResets(map: GameMap): void {
  section('Traits survive every reset; live state does not');
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const mob = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  const traits = mob.tactics.traits.join();
  check(traits.length > 0, `the probe goblin has traits (${traits})`);

  const resets: ReadonlyArray<{ label: string; run: () => void }> = [
    { label: 'resetToSpawn', run: () => mob.resetToSpawn() },
    { label: 'healAndForgetFight', run: () => mob.healAndForgetFight() },
    {
      label: 'reviveForCheckpoint',
      run: () => {
        // Killed by a blast, which a guard never meets, so the kill is certain.
        mob.takeDamageFrom(mob.hp, human, 'explosion');
        mob.reviveForCheckpoint();
      },
    },
  ];
  for (const reset of resets) {
    const spent = spendGuard(mob, human);
    const spentState = !mob.tactics.isGuardReady;
    reset.run();
    check(
      spent && spentState && mob.tactics.traits.join() === traits && mob.tactics.isGuardReady,
      `${reset.label}: traits ${mob.tactics.traits.join() || 'none'} (were ${traits}), guard ready again: ${mob.tactics.isGuardReady}`,
    );
  }

  const savedWarn = console.warn;
  console.warn = () => undefined;
  try {
    mob.rollTactics(DIFFICULTY_PROFILES.easy.tacticsChanceScale, () => 1);
  } finally {
    console.warn = savedWarn;
  }
  check(mob.tactics.traits.join() === traits, 'a second roll is refused rather than re-rolling');
}

// ── Movement tactics: a live fight on the real mob loop ────────────────────

/** A fight staged on the real mob update loop, with both crawlers placed by hand. */
interface Arena {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly loop: MobUpdateLoop;
  readonly ctx: SystemContext;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
}

function makeArena(
  map: GameMap,
  humanTile: { x: number; y: number },
  catTile: { x: number; y: number },
): Arena {
  const human = new HumanPlayer(humanTile.x, humanTile.y, TILE_SIZE);
  human.godMode = true;
  const cat = new CatPlayer(catTile.x, catTile.y, TILE_SIZE);
  cat.godMode = true;
  const roster = new MobRoster(map, new SpellSystem());
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
  return { map, roster, loop: new MobUpdateLoop(), ctx, human, cat };
}

/**
 * A source that answers yes to exactly the traits in `wanted`, draw by draw, in
 * the order the roll asks — which skips riposte unless block came up.
 */
function rollOnly(wanted: readonly TacticsTrait[]): Rng {
  const draws: number[] = [];
  let blockRolled = false;
  for (const trait of TACTICS_TRAITS) {
    if (trait === 'riposte' && !blockRolled) continue;
    const yes = wanted.includes(trait);
    if (trait === 'block') blockRolled = yes;
    draws.push(yes ? 0 : 1);
  }
  let index = 0;
  return () => draws[index++] ?? 1;
}

/** A top-level goblin with exactly `wanted`, added to the arena. */
function addTactician(
  arena: Arena,
  tile: { x: number; y: number },
  wanted: readonly TacticsTrait[],
  weapon?: GoblinWeapon,
): Mob {
  const goblin =
    weapon === undefined
      ? createMob('goblin', tile.x, tile.y, arena.map)
      : new Goblin(tile.x, tile.y, TILE_SIZE, weapon);
  goblin.applyMobLevel(MAX_MOB_LEVEL);
  goblin.rollTactics(DIFFICULTY_PROFILES.normal.tacticsChanceScale, rollOnly(wanted));
  arena.roster.add(goblin);
  return goblin;
}

/**
 * Wound `mob` by `share` of its health with a blast — which no guard meets —
 * from `crawler`, so it has shed the party's blood and counts as in the fight.
 * A share of zero leaves it at full health but still bloodied.
 */
function bloody(mob: Mob, crawler: HumanPlayer, share: number): void {
  mob.takeDamageFrom(PROBE_BLOW_DAMAGE, crawler, 'explosion');
  mob.hp = Math.max(1, Math.round(mob.maxHp * (1 - share)));
}

/** A rectangle of damaging ground, in tiles, that can be switched on mid-test. */
class HazardStrip implements GroundHazardSource {
  active = true;
  constructor(
    private readonly left: number,
    private readonly top: number,
    private readonly right: number,
    private readonly bottom: number,
  ) {}

  /** Read through a call so a switch made inside a frame callback is seen. */
  isLive(): boolean {
    return this.active;
  }

  covers(x: number, y: number): boolean {
    if (!this.active) return false;
    const tile = centreTile({ x, y });
    return (
      tile.x >= this.left && tile.x <= this.right && tile.y >= this.top && tile.y <= this.bottom
    );
  }

  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    return this.covers(x, y) ? { dx: -1, dy: 0 } : null;
  }
}

/** What a kiter did over a stretch of frames. */
interface KiteTrace {
  readonly kitesStarted: number;
  readonly longestKiteFrames: number;
  readonly longestKiteWalkPx: number;
  readonly fastestKiteStepPx: number;
  readonly shortestCooldownGap: number;
  readonly endReasons: readonly string[];
  readonly farthestFromHomePx: number;
  readonly framesOnHazardWhileKiting: number;
  readonly widestChaseGapGrowthPx: number;
  /** Frames each finished kite ran. */
  readonly kiteLengths: readonly number[];
}

interface KiteRunOptions {
  readonly frames: number;
  /** Walk the human straight at the kiter at player speed while it retreats. */
  readonly chase?: boolean;
  readonly hazard?: HazardStrip;
  /** Called every frame before the loop runs, with the frame index. */
  readonly beforeFrame?: (frame: number) => void;
}

function traceKiter(arena: Arena, kiter: Mob, options: KiteRunOptions): KiteTrace {
  let kitesStarted = 0;
  let currentRun = 0;
  let currentWalk = 0;
  let longestKiteFrames = 0;
  let longestKiteWalkPx = 0;
  let fastestKiteStepPx = 0;
  let lastKiteEnd = Number.NEGATIVE_INFINITY;
  let shortestCooldownGap = Number.POSITIVE_INFINITY;
  let farthestFromHomePx = 0;
  let framesOnHazardWhileKiting = 0;
  let chaseStartGap = 0;
  let widestChaseGapGrowthPx = 0;
  const endReasons: string[] = [];
  const kiteLengths: number[] = [];
  let wasKiting = false;
  for (let frame = 0; frame < options.frames; frame++) {
    options.beforeFrame?.(frame);
    if (options.chase === true && wasKiting) {
      const dx = kiter.x - arena.human.x;
      const dy = kiter.y - arena.human.y;
      const gap = Math.hypot(dx, dy);
      if (gap > 0) {
        const step = Math.min(PLAYER_SPEED, gap);
        arena.human.x += (dx / gap) * step;
        arena.human.y += (dy / gap) * step;
      }
    }
    const beforeX = kiter.x;
    const beforeY = kiter.y;
    arena.loop.update(arena.ctx);
    const kiting = kiter.tactics.activeRetreat === 'kite';
    const stepPx = Math.hypot(kiter.x - beforeX, kiter.y - beforeY);
    if (kiting && !wasKiting) {
      kitesStarted++;
      currentRun = 0;
      currentWalk = 0;
      chaseStartGap = centreDistance(kiter, arena.human);
      if (Number.isFinite(lastKiteEnd)) {
        shortestCooldownGap = Math.min(shortestCooldownGap, frame - lastKiteEnd);
      }
    }
    if (kiting) {
      currentRun++;
      currentWalk += stepPx;
      fastestKiteStepPx = Math.max(fastestKiteStepPx, stepPx);
      longestKiteFrames = Math.max(longestKiteFrames, currentRun);
      longestKiteWalkPx = Math.max(longestKiteWalkPx, currentWalk);
      if (options.hazard?.covers(kiter.x, kiter.y) === true) framesOnHazardWhileKiting++;
      if (options.chase === true) {
        const growth = centreDistance(kiter, arena.human) - chaseStartGap;
        widestChaseGapGrowthPx = Math.max(widestChaseGapGrowthPx, growth);
      }
    }
    if (!kiting && wasKiting) {
      lastKiteEnd = frame;
      endReasons.push(kiter.tactics.lastRetreatEnd ?? 'unknown');
      kiteLengths.push(currentRun);
    }
    const home = kiter.homePoint;
    if (home !== undefined) {
      farthestFromHomePx = Math.max(farthestFromHomePx, centreDistance(kiter, home));
    }
    wasKiting = kiting;
  }
  arena.loop.dispose();
  return {
    kitesStarted,
    longestKiteFrames,
    longestKiteWalkPx,
    fastestKiteStepPx,
    shortestCooldownGap,
    endReasons,
    farthestFromHomePx,
    framesOnHazardWhileKiting,
    widestChaseGapGrowthPx,
    kiteLengths,
  };
}

/**
 * The kite layout: the human at `HUMAN`, the kiter one tile east of it, and a
 * friend further east fighting the cat, so the friend holds its ground rather
 * than walking into the kiter's path.
 */
const KITE_HUMAN_TILE = { x: 6, y: ROOM_MIDDLE_TILE };
const KITE_KITER_TILE = { x: 7, y: ROOM_MIDDLE_TILE };
const KITE_HELPER_TILE = { x: 13, y: ROOM_MIDDLE_TILE };
const KITE_HELPER_CAT_TILE = { x: 14, y: ROOM_MIDDLE_TILE };
const FAR_CORNER = { x: FAR_CORNER_TILE, y: FAR_CORNER_TILE };

/** Frames each kite scenario runs: long enough for several kites and cooldowns. */
const KITE_RUN_FRAMES = 900;
/** One frame's walk at the fastest a goblin can go, allowed past a cap it checks once a frame. */
const ONE_STEP_SLACK_PX = GOBLIN_MAX_SPEED;
/** Rounding room on a per-frame step measured against a speed. */
const STEP_EPSILON_PX = 1e-6;
/**
 * How much the gap to a chasing player may open while a kiter retreats, in
 * pixels: the separation shove that keeps the two a tile apart can hand the
 * kiter a few pixels on a frame the player's own step does not cancel.
 */
const CHASE_GAP_SLACK_TILES = 0.25;
const CHASE_GAP_SLACK_PX = TILE_SIZE * CHASE_GAP_SLACK_TILES;

function kiteArena(map: GameMap, withHelper: boolean): { arena: Arena; kiter: Mob } {
  const arena = makeArena(map, KITE_HUMAN_TILE, withHelper ? KITE_HELPER_CAT_TILE : FAR_CORNER);
  const kiter = addTactician(arena, KITE_KITER_TILE, ['kite']);
  bloody(kiter, arena.human, 0);
  if (withHelper) {
    const helper = addTactician(arena, KITE_HELPER_TILE, []);
    bloody(helper, arena.human, 0);
  }
  return { arena, kiter };
}

function checkKite(map: GameMap): void {
  section('Kite: needs a friend, is bounded, stays catchable');

  const lone = kiteArena(map, false);
  check(lone.kiter.tactics.traits.join() === 'kite', `the lone probe rolled only kite`);
  const loneTrace = traceKiter(lone.arena, lone.kiter, { frames: KITE_RUN_FRAMES });
  check(loneTrace.kitesStarted === 0, `a lone kiter started ${loneTrace.kitesStarted} kites`);

  const paired = kiteArena(map, true);
  const trace = traceKiter(paired.arena, paired.kiter, { frames: KITE_RUN_FRAMES });
  const kiteMaxWalkPx = KITE_MAX_DISTANCE_TILES * TILE_SIZE;
  check(
    trace.kitesStarted >= 2,
    `with a friend fighting, ${trace.kitesStarted} kites started (ended: ${trace.endReasons.join(', ')})`,
  );
  check(
    trace.longestKiteFrames <= KITE_MAX_FRAMES,
    `longest kite ${trace.longestKiteFrames} frames (cap ${KITE_MAX_FRAMES})`,
  );
  check(
    trace.longestKiteWalkPx <= kiteMaxWalkPx + ONE_STEP_SLACK_PX,
    `longest kite walked ${trace.longestKiteWalkPx.toFixed(1)} px (cap ${kiteMaxWalkPx} + one step)`,
  );
  check(
    trace.shortestCooldownGap >= KITE_COOLDOWN_FRAMES,
    `closest kites ${trace.shortestCooldownGap} frames apart (cooldown ${KITE_COOLDOWN_FRAMES})`,
  );
  check(
    trace.fastestKiteStepPx <= paired.kiter.moveSpeed + STEP_EPSILON_PX &&
      trace.fastestKiteStepPx < PLAYER_SPEED,
    `fastest kite step ${trace.fastestKiteStepPx.toFixed(2)} px: within the goblin's own ${paired.kiter.moveSpeed.toFixed(2)} and under the player's ${PLAYER_SPEED}`,
  );

  // Slowed to well under a third of its pace, the walk cap is out of reach
  // within the frame cap, so only the frame cap can end these kites.
  const slowed = kiteArena(map, true);
  slowed.kiter.slowedByBarrier = true;
  const slowTrace = traceKiter(slowed.arena, slowed.kiter, { frames: KITE_RUN_FRAMES });
  check(
    slowTrace.kitesStarted > 0 && slowTrace.endReasons.includes('frame-cap'),
    `a slowed kiter's kites end on the frame cap (${slowTrace.endReasons.join(', ') || 'no kites'})`,
  );
  check(
    slowTrace.longestKiteFrames <= KITE_MAX_FRAMES,
    `slowed: longest kite ${slowTrace.longestKiteFrames} frames (cap ${KITE_MAX_FRAMES})`,
  );

  const chased = kiteArena(map, true);
  const chaseTrace = traceKiter(chased.arena, chased.kiter, {
    frames: KITE_RUN_FRAMES,
    chase: true,
  });
  check(chaseTrace.kitesStarted > 0, `chased: ${chaseTrace.kitesStarted} kites started`);
  const chasedRunOn = chasedKitesRunOn(chaseTrace.kiteLengths, trace.kiteLengths);
  check(
    chasedRunOn,
    `a player following a kite does not end it: ${describeKiteLengths(chaseTrace.kiteLengths, trace.kiteLengths)}`,
  );
  check(
    chasedRunOn && chaseTrace.widestChaseGapGrowthPx <= CHASE_GAP_SLACK_PX,
    `a player chasing at player speed never loses ground over full-length kites: the gap opened by at most ${chaseTrace.widestChaseGapGrowthPx.toFixed(1)} px (slack ${CHASE_GAP_SLACK_PX})`,
  );
}

/** The leash a kiter is given in the leash probes, in tiles. */
const KITE_LEASH_TILES = 4;
/** How far east of home the edge probe's kiter starts, in tiles. */
const LEASH_EDGE_OFFSET_TILES = 2;

function checkKiteLeash(map: GameMap): void {
  section('Kite: never carries a mob past its leash');
  const leashPx = KITE_LEASH_TILES * TILE_SIZE;

  const roomy = kiteArena(map, true);
  roomy.kiter.homePoint = { x: roomy.kiter.x, y: roomy.kiter.y };
  roomy.kiter.leashRadiusTiles = KITE_LEASH_TILES;
  const roomyTrace = traceKiter(roomy.arena, roomy.kiter, { frames: KITE_RUN_FRAMES });
  check(roomyTrace.kitesStarted > 0, `at home: ${roomyTrace.kitesStarted} kites started`);
  check(
    roomyTrace.farthestFromHomePx <= leashPx,
    `at home: farthest ${roomyTrace.farthestFromHomePx.toFixed(1)} px from home (leash ${leashPx})`,
  );

  // Home sits west, behind the player: a kite east toward the friend would
  // walk straight out of the leash.
  const edge = kiteArena(map, true);
  edge.kiter.homePoint = {
    x: edge.kiter.x - LEASH_EDGE_OFFSET_TILES * TILE_SIZE,
    y: edge.kiter.y,
  };
  edge.kiter.leashRadiusTiles = KITE_LEASH_TILES;
  const edgeTrace = traceKiter(edge.arena, edge.kiter, { frames: KITE_RUN_FRAMES });
  check(
    edgeTrace.kitesStarted === 0 && edgeTrace.farthestFromHomePx <= leashPx,
    `near the edge: no kite may start; farthest ${edgeTrace.farthestFromHomePx.toFixed(1)} px from home (leash ${leashPx}), ${edgeTrace.kitesStarted} kites`,
  );
}

/** The marked strip that sits across the kite's path east, in tiles. */
const HAZARD_STRIP_LEFT = 9;
const HAZARD_STRIP_RIGHT = 10;
const HAZARD_STRIP_HALF_HEIGHT = 2;
/** Kite frames run before the strip is switched on under the kiter's feet ahead. */
const HAZARD_SWITCH_ON_FRAME = 8;
/** Frames watched after a mid-kite hazard, enough for a restart if one were allowed. */
const HAZARD_RUN_FRAMES = 400;

function checkKiteHazard(map: GameMap): void {
  section('Kite: never walks onto marked ground, and a kite toward it is abandoned');

  const planned = kiteArena(map, true);
  const plannedStrip = new HazardStrip(
    HAZARD_STRIP_LEFT,
    ROOM_MIDDLE_TILE - HAZARD_STRIP_HALF_HEIGHT,
    HAZARD_STRIP_RIGHT,
    ROOM_MIDDLE_TILE + HAZARD_STRIP_HALF_HEIGHT,
  );
  planned.arena.loop.registerHazardSource(plannedStrip);
  const plannedTrace = traceKiter(planned.arena, planned.kiter, {
    frames: KITE_RUN_FRAMES,
    hazard: plannedStrip,
  });
  check(
    plannedTrace.kitesStarted > 0 && plannedTrace.framesOnHazardWhileKiting === 0,
    `strip across the way: ${plannedTrace.framesOnHazardWhileKiting} kite frames on marked ground (${plannedTrace.kitesStarted} kites)`,
  );

  // The strip goes live a tile ahead of a kite already under way.
  const midway = kiteArena(map, true);
  const midwayStrip = new HazardStrip(
    KITE_KITER_TILE.x + 1,
    ROOM_MIDDLE_TILE - HAZARD_STRIP_HALF_HEIGHT,
    HAZARD_STRIP_RIGHT,
    ROOM_MIDDLE_TILE + HAZARD_STRIP_HALF_HEIGHT,
  );
  midwayStrip.active = false;
  midway.arena.loop.registerHazardSource(midwayStrip);
  let kiteFramesSeen = 0;
  const midwayTrace = traceKiter(midway.arena, midway.kiter, {
    frames: HAZARD_RUN_FRAMES,
    hazard: midwayStrip,
    beforeFrame: () => {
      if (midway.kiter.tactics.activeRetreat === 'kite') kiteFramesSeen++;
      if (kiteFramesSeen === HAZARD_SWITCH_ON_FRAME) midwayStrip.active = true;
    },
  });
  check(
    midwayStrip.isLive() && midwayTrace.endReasons[0] === 'hazard',
    `a kite with marked ground ahead ends for the hazard (${midwayTrace.endReasons.join(', ') || 'no kite ended'})`,
  );
  check(
    midwayTrace.framesOnHazardWhileKiting === 0,
    `mid-kite hazard: ${midwayTrace.framesOnHazardWhileKiting} kite frames on marked ground`,
  );
  check(
    midwayTrace.shortestCooldownGap >= KITE_COOLDOWN_FRAMES,
    `no kite restarts inside the cooldown after a hazard turned one back (closest restart ${midwayTrace.shortestCooldownGap} frames later)`,
  );
}

// ── Flank ──────────────────────────────────────────────────────────────────

/** Centre distance, in tiles, at which a flanker counts as having arrived at the target. */
const FLANK_ARRIVAL_TILES = 1.5;
/** Frames a flank approach may take before the probe gives up on an arrival. */
const FLANK_RUN_FRAMES = 600;
/** Two arrival bearings further apart than this, in degrees, are distinct approach angles. */
const FLANK_DISTINCT_DEGREES = 40;
const DEGREES_PER_HALF_TURN = 180;
/** How far north of the main corridor its bypass runs, in tiles. */
const BYPASS_OFFSET_TILES = 2;
/**
 * The corridor's mouth, where the player stands; the room it opens into
 * starts one column further east, so the bypass ends blind beside the mouth.
 */
const CORRIDOR_ROOM_LEFT = 14;
/** How far the room reaches either side of the corridor's row, in tiles. */
const CORRIDOR_ROOM_HALF_HEIGHT = 4;
/**
 * The column joining the bypass to the main corridor, just behind the pack:
 * close enough that the long way round is a route the mob's own pathfinding
 * would find and take, so only the flank rule stands in its way.
 */
const BYPASS_JOIN_X = 6;

/** Where the flank probes put the player and the pack, in tiles. */
const FLANK_HUMAN_TILE = { x: CORRIDOR_ROOM_LEFT, y: ROOM_MIDDLE_TILE };
const FLANK_PACK_X = 9;
/** Rows the three pack members start on, relative to the player's row. */
const FLANK_PACK_ROW_OFFSETS = [-1, 0, 1];

interface FlankTrace {
  /** Bearing from the target to each mob as it first arrives, in radians; NaN if never. */
  readonly arrivalBearings: readonly number[];
  readonly arrivalFrames: readonly number[];
  /** Pixels walked by each mob up to its arrival. */
  readonly walkedPx: readonly number[];
  readonly startDistancePx: readonly number[];
  /** The furthest each mob ever got from the target, over the whole run. */
  readonly farthestPx: readonly number[];
}

function traceFlankers(arena: Arena, pack: readonly Mob[]): FlankTrace {
  const arrivalBearings = pack.map(() => Number.NaN);
  const arrivalFrames = pack.map(() => Number.NaN);
  const walkedPx = pack.map(() => 0);
  const startDistancePx = pack.map((mob) => centreDistance(mob, arena.human));
  const farthestPx = [...startDistancePx];
  const arrivalPx = FLANK_ARRIVAL_TILES * TILE_SIZE;
  for (let frame = 0; frame < FLANK_RUN_FRAMES; frame++) {
    const before = pack.map((mob) => ({ x: mob.x, y: mob.y }));
    arena.loop.update(arena.ctx);
    pack.forEach((mob, index) => {
      farthestPx[index] = Math.max(farthestPx[index], centreDistance(mob, arena.human));
      if (!Number.isNaN(arrivalFrames[index])) return;
      walkedPx[index] += centreDistance(mob, before[index]);
      if (centreDistance(mob, arena.human) <= arrivalPx) {
        arrivalFrames[index] = frame;
        arrivalBearings[index] = Math.atan2(mob.y - arena.human.y, mob.x - arena.human.x);
      }
    });
  }
  arena.loop.dispose();
  return { arrivalBearings, arrivalFrames, walkedPx, startDistancePx, farthestPx };
}

function widestBearingSpreadDegrees(bearings: readonly number[]): number {
  let widest = 0;
  for (const a of bearings) {
    for (const b of bearings) {
      let difference = Math.abs(a - b) % (Math.PI * 2);
      if (difference > Math.PI) difference = Math.PI * 2 - difference;
      widest = Math.max(widest, (difference * DEGREES_PER_HALF_TURN) / Math.PI);
    }
  }
  return widest;
}

function flankPack(map: GameMap, traits: readonly TacticsTrait[]): { arena: Arena; pack: Mob[] } {
  const arena = makeArena(map, FLANK_HUMAN_TILE, FAR_CORNER);
  const pack = FLANK_PACK_ROW_OFFSETS.map((offset) =>
    addTactician(arena, { x: FLANK_PACK_X, y: ROOM_MIDDLE_TILE + offset }, traits),
  );
  return { arena, pack };
}

/**
 * A one-tile corridor opening into a room, with a second one-tile corridor
 * running parallel two rows north, joined to the first only behind the pack
 * and ending blind beside the mouth.
 *
 * The bypass is what makes a detour possible at all: a flank slot beside the
 * corridor mouth lands on its floor, walkable and in sight of the player, but
 * reachable from the main corridor only the long way round.
 */
function makeCorridor(): GameMap {
  const bypassRow = ROOM_MIDDLE_TILE - BYPASS_OFFSET_TILES;
  const grid: TileContent[][] = Array.from({ length: ROOM_SIZE_TILES }, (_, y) =>
    Array.from({ length: ROOM_SIZE_TILES }, (_, x) => {
      const inBounds = x > 0 && x < ROOM_LAST_TILE && y > 0 && y < ROOM_LAST_TILE;
      const isMain = y === ROOM_MIDDLE_TILE;
      const isBypass = y === bypassRow && x >= BYPASS_JOIN_X && x < CORRIDOR_ROOM_LEFT;
      const isJoin = x === BYPASS_JOIN_X && y >= bypassRow && y <= ROOM_MIDDLE_TILE;
      const isRoom =
        x > CORRIDOR_ROOM_LEFT && Math.abs(y - ROOM_MIDDLE_TILE) <= CORRIDOR_ROOM_HALF_HEIGHT;
      const isCorridor = inBounds && (isMain || isBypass || isJoin || isRoom);
      return {
        tileId: `${x}#${y}`,
        type: isCorridor ? FloorTypeValue.tile_floor : FloorTypeValue.wall,
      };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** Where the corridor probe's pack stands, in tiles along the corridor. */
const CORRIDOR_PACK_XS = FLANK_PACK_ROW_OFFSETS.map((offset) => FLANK_PACK_X - 1 + offset);
/** A direct approach walks no further than this multiple of its straight-line gap. */
const CORRIDOR_MAX_WALK_RATIO = 1.1;
/**
 * Frames the front of a direct corridor approach may take beyond the straight
 * walk at its own speed: the first-noticing frames, and room to be shoved by
 * the pack behind it.
 */
const CORRIDOR_ARRIVAL_SLACK_FRAMES = 30;
/** How far a queued mob may be jostled back down the corridor by the pack ahead of it. */
const CORRIDOR_BACKSTEP_SLACK_PX = TILE_SIZE / 2;

function checkFlank(map: GameMap): void {
  section('Flank: an open room is approached from several angles, a corridor directly');

  const open = flankPack(map, ['flank']);
  check(
    open.pack.every((mob) => mob.tactics.traits.join() === 'flank'),
    'the open-room pack rolled only flank',
  );
  const openTrace = traceFlankers(open.arena, open.pack);
  const arrived = openTrace.arrivalBearings.filter((bearing) => !Number.isNaN(bearing));
  const spread = widestBearingSpreadDegrees(arrived);
  check(arrived.length === open.pack.length, `open room: ${arrived.length}/3 flankers arrived`);
  check(
    spread >= FLANK_DISTINCT_DEGREES,
    `open room: arrival bearings span ${spread.toFixed(1)}° (need ${FLANK_DISTINCT_DEGREES}°)`,
  );

  // The same pack without the trait, so the spread above is the tactic's doing.
  const plain = flankPack(map, []);
  const plainTrace = traceFlankers(plain.arena, plain.pack);
  const plainSpread = widestBearingSpreadDegrees(
    plainTrace.arrivalBearings.filter((bearing) => !Number.isNaN(bearing)),
  );
  check(
    plainSpread < FLANK_DISTINCT_DEGREES,
    `control: the same pack without flank arrives within ${plainSpread.toFixed(1)}°`,
  );

  const corridor = makeCorridor();
  const corridorArena = makeArena(corridor, FLANK_HUMAN_TILE, FAR_CORNER);
  const corridorPack = CORRIDOR_PACK_XS.map((x) =>
    addTactician(corridorArena, { x, y: ROOM_MIDDLE_TILE }, ['flank']),
  );
  const corridorTrace = traceFlankers(corridorArena, corridorPack);
  const front = corridorPack.length - 1;
  const frontSpeed = corridorPack[front].moveSpeed;
  const directFrames =
    (corridorTrace.startDistancePx[front] - FLANK_ARRIVAL_TILES * TILE_SIZE) / frontSpeed;
  const frontFrames = corridorTrace.arrivalFrames[front];
  check(
    frontFrames <= directFrames + CORRIDOR_ARRIVAL_SLACK_FRAMES,
    `corridor: the front flanker arrives on frame ${frontFrames} (direct walk ${directFrames.toFixed(0)} + ${CORRIDOR_ARRIVAL_SLACK_FRAMES})`,
  );
  const frontRatio =
    corridorTrace.walkedPx[front] /
    (corridorTrace.startDistancePx[front] - FLANK_ARRIVAL_TILES * TILE_SIZE);
  check(
    frontRatio <= CORRIDOR_MAX_WALK_RATIO,
    `corridor: the front flanker walked ${frontRatio.toFixed(2)}× its straight gap (max ${CORRIDOR_MAX_WALK_RATIO})`,
  );
  // A flanker sent round by the bypass would first walk away from the player.
  const retreats = corridorPack.map(
    (_, index) => corridorTrace.farthestPx[index] - corridorTrace.startDistancePx[index],
  );
  const worstRetreat = Math.max(...retreats);
  check(
    worstRetreat <= CORRIDOR_BACKSTEP_SLACK_PX,
    `corridor: no flanker ever backs away from the player to go round (worst ${worstRetreat.toFixed(1)} px, slack ${CORRIDOR_BACKSTEP_SLACK_PX})`,
  );
}

/** A long open hall for a chase, in tiles: room to run away for several cycles. */
const HALL_WIDTH_TILES = 64;
const HALL_HEIGHT_TILES = 13;
const HALL_MIDDLE_ROW = Math.floor(HALL_HEIGHT_TILES / 2);

function makeHall(): GameMap {
  const lastX = HALL_WIDTH_TILES - 1;
  const lastY = HALL_HEIGHT_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: HALL_HEIGHT_TILES }, (_, y) =>
    Array.from({ length: HALL_WIDTH_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === lastX || y === lastY;
      return {
        tileId: `${x}#${y}`,
        type: isBorder ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** Where the retreat probe's player and pack start in the hall, in tiles. */
const HALL_HUMAN_TILE = { x: 8, y: HALL_MIDDLE_ROW };
const HALL_FLANKER_TILE = { x: 3, y: HALL_MIDDLE_ROW - 1 };
const HALL_PACKMATE_TILE = { x: 3, y: HALL_MIDDLE_ROW + 1 };
/** The cat waits at the hall's far end, out of the pack's way until the chase is over. */
const HALL_CAT_TILE = { x: HALL_WIDTH_TILES - 2, y: FAR_CORNER_TILE };
/**
 * One cycle of a player backing off: a stand long enough for the pack to close
 * in, then a sprint long enough to open the gap past the staging ring — the
 * pack is slower — but never as far as the release distance.
 */
const RETREAT_SPRINT_FRAMES = 150;
const RETREAT_STAND_FRAMES = 150;
const RETREAT_CYCLES = 4;
/**
 * Behaviour changes a flanker may make across the whole chase: onto its slot
 * and off it again. Every change throws its route away, so a flanker that
 * flips each time the player crosses the staging ring is the failure.
 */
const RETREAT_MAX_BEHAVIOUR_SWITCHES = 2;

function checkFlankHysteresis(): void {
  section('Flank: a player backing off does not make a flanker flip-flop');
  const hall = makeHall();
  const arena = makeArena(hall, HALL_HUMAN_TILE, HALL_CAT_TILE);
  const flanker = addTactician(arena, HALL_FLANKER_TILE, ['flank']);
  addTactician(arena, HALL_PACKMATE_TILE, []);
  let switches = 0;
  let flankFrames = 0;
  let previous = flanker.tactics.lastMove;
  let widestGapPx = 0;
  let hasClosedIn = false;
  const ringPx = (FLANK_STAGING_TILES + FLANK_STAGED_TILES) * TILE_SIZE;
  const cycleFrames = RETREAT_SPRINT_FRAMES + RETREAT_STAND_FRAMES;
  for (let frame = 0; frame < cycleFrames * RETREAT_CYCLES; frame++) {
    if (frame % cycleFrames >= RETREAT_STAND_FRAMES) arena.human.x += PLAYER_SPEED;
    arena.loop.update(arena.ctx);
    const move = flanker.tactics.lastMove;
    if (move !== previous) switches++;
    if (move === 'flank') flankFrames++;
    previous = move;
    const gapPx = centreDistance(flanker, arena.human);
    if (gapPx <= ringPx) hasClosedIn = true;
    if (hasClosedIn) widestGapPx = Math.max(widestGapPx, gapPx);
  }
  arena.loop.dispose();
  const releasePx = FLANK_RELEASE_TILES * TILE_SIZE;
  check(
    widestGapPx > ringPx && widestGapPx < releasePx,
    `fixture: once closed in, the gap reopens past the staging ring but short of release (${widestGapPx.toFixed(0)} px; ring ${ringPx.toFixed(0)}, release ${releasePx})`,
  );
  check(flankFrames > 0, `the flanker did flank on the way in (${flankFrames} frames)`);
  check(
    switches <= RETREAT_MAX_BEHAVIOUR_SWITCHES,
    `${switches} behaviour switches over ${RETREAT_CYCLES} back-offs (max ${RETREAT_MAX_BEHAVIOUR_SWITCHES})`,
  );
}

// ── Regroup ────────────────────────────────────────────────────────────────

/** Share of its health the regroup probe is wounded by, below the regroup line. */
const REGROUP_PROBE_WOUND_SHARE = 0.7;
const REGROUP_RUN_FRAMES = 900;
/** The frame the probe is put back beside the player, well after the first regroup ends. */
const REGROUP_SECOND_CHANCE_FRAME = 450;
/** How far north of the probe its friend stands, in tiles: inside the regroup radius. */
const REGROUP_ALLY_ROWS_NORTH = 4;
/**
 * Where the regroup probe's friend stands, in tiles: straight north of the
 * probe, off the player's line, so the walk to it never passes the player. It
 * fights the cat one tile beyond it, which holds it where it stands.
 */
const REGROUP_ALLY_TILE = { x: KITE_KITER_TILE.x, y: ROOM_MIDDLE_TILE - REGROUP_ALLY_ROWS_NORTH };
const REGROUP_ALLY_CAT_TILE = { x: KITE_KITER_TILE.x, y: REGROUP_ALLY_TILE.y - 1 };
/**
 * A friend far enough off that a slowed mob cannot reach it inside the frame
 * cap, so only the cap can end that regroup.
 */
const REGROUP_FAR_ALLY_TILES_NORTH = 5;
const REGROUP_FAR_ALLY_TILE = {
  x: KITE_KITER_TILE.x,
  y: ROOM_MIDDLE_TILE - REGROUP_FAR_ALLY_TILES_NORTH,
};
/** The cat the far friend fights, one tile beyond it, so the friend holds still. */
const REGROUP_FAR_ALLY_CAT_TILE = {
  x: KITE_KITER_TILE.x,
  y: REGROUP_FAR_ALLY_TILE.y - 1,
};

interface RegroupTrace {
  readonly regroupsStarted: number;
  readonly endReasons: readonly string[];
  readonly longestRegroupFrames: number;
  readonly hpRose: boolean;
  readonly impacts: number;
  /** Swings landed after the first regroup ended: the mob back in the fight. */
  readonly impactsAfterRegroup: number;
}

/**
 * Whether `mob` swung a blow home since the last call — landed, dodged or
 * absorbed, every impact sets the attack sound — and clear it for the next.
 */
function takeSwingLanded(mob: Mob): boolean {
  const landed = mob.attackSoundPending;
  mob.attackSoundPending = false;
  return landed;
}

function traceRegroup(
  arena: Arena,
  mob: Mob,
  frames: number,
  beforeFrame?: (frame: number) => void,
): RegroupTrace {
  let regroupsStarted = 0;
  let run = 0;
  let longest = 0;
  let hpRose = false;
  let impacts = 0;
  let impactsAfterRegroup = 0;
  let was = false;
  let previousHp = mob.hp;
  const endReasons: string[] = [];
  takeSwingLanded(mob);
  for (let frame = 0; frame < frames; frame++) {
    beforeFrame?.(frame);
    arena.loop.update(arena.ctx);
    const swung = takeSwingLanded(mob);
    if (mob.hp > previousHp) hpRose = true;
    previousHp = mob.hp;
    const regrouping = mob.tactics.activeRetreat === 'regroup';
    if (swung) impacts++;
    if (swung && endReasons.length > 0 && !regrouping) impactsAfterRegroup++;
    if (regrouping && !was) {
      regroupsStarted++;
      run = 0;
    }
    if (regrouping) {
      run++;
      longest = Math.max(longest, run);
    }
    if (was && !regrouping) endReasons.push(mob.tactics.lastRetreatEnd ?? 'unknown');
    was = regrouping;
  }
  arena.loop.dispose();
  return {
    regroupsStarted,
    endReasons,
    longestRegroupFrames: longest,
    hpRose,
    impacts,
    impactsAfterRegroup,
  };
}

function checkRegroup(map: GameMap): void {
  section('Regroup: wounded mobs fall back on a friend once, briefly, and never heal');

  const arena = makeArena(map, KITE_HUMAN_TILE, REGROUP_ALLY_CAT_TILE);
  const wounded = addTactician(arena, KITE_KITER_TILE, ['regroup']);
  bloody(wounded, arena.human, REGROUP_PROBE_WOUND_SHARE);
  const ally = addTactician(arena, REGROUP_ALLY_TILE, []);
  bloody(ally, arena.human, 0);
  check(
    wounded.hp / wounded.maxHp <= REGROUP_HP_FRACTION,
    `the probe is wounded below the line (${wounded.hp}/${wounded.maxHp})`,
  );
  // Halfway through, the probe is put back beside the player, away from its
  // friend, so a mob allowed a second regroup would have every reason to take it.
  const trace = traceRegroup(arena, wounded, REGROUP_RUN_FRAMES, (frame) => {
    if (frame !== REGROUP_SECOND_CHANCE_FRAME) return;
    const fromX = wounded.x;
    const fromY = wounded.y;
    wounded.x = KITE_KITER_TILE.x * TILE_SIZE;
    wounded.y = KITE_KITER_TILE.y * TILE_SIZE;
    arena.roster.grid.move(wounded, fromX, fromY);
  });
  check(
    trace.regroupsStarted === 1,
    `with a friend: ${trace.regroupsStarted} regroups in one life`,
  );
  check(
    trace.longestRegroupFrames <= REGROUP_MAX_FRAMES,
    `longest regroup ${trace.longestRegroupFrames} frames (cap ${REGROUP_MAX_FRAMES})`,
  );
  check(!trace.hpRose, 'a regrouping mob never heals');
  check(
    trace.impactsAfterRegroup > 0,
    `after regrouping it fights again (${trace.impactsAfterRegroup} swings landed after the regroup ended)`,
  );

  wounded.resetToSpawn();
  check(!wounded.tactics.hasRegrouped, 'a new life gets a new regroup');

  const slowArena = makeArena(map, KITE_HUMAN_TILE, REGROUP_FAR_ALLY_CAT_TILE);
  const slow = addTactician(slowArena, KITE_KITER_TILE, ['regroup']);
  slow.slowedByBarrier = true;
  bloody(slow, slowArena.human, REGROUP_PROBE_WOUND_SHARE);
  const farAlly = addTactician(slowArena, REGROUP_FAR_ALLY_TILE, []);
  bloody(farAlly, slowArena.human, 0);
  const slowTrace = traceRegroup(slowArena, slow, REGROUP_RUN_FRAMES);
  check(
    slowTrace.endReasons.includes('frame-cap') &&
      slowTrace.longestRegroupFrames <= REGROUP_MAX_FRAMES,
    `slowed: the regroup ends on its frame cap after ${slowTrace.longestRegroupFrames} frames (cap ${REGROUP_MAX_FRAMES}; ${slowTrace.endReasons.join(', ') || 'none ended'})`,
  );

  const loneArena = makeArena(map, KITE_HUMAN_TILE, FAR_CORNER);
  const lone = addTactician(loneArena, KITE_KITER_TILE, ['regroup']);
  bloody(lone, loneArena.human, REGROUP_PROBE_WOUND_SHARE);
  const loneTrace = traceRegroup(loneArena, lone, REGROUP_RUN_FRAMES);
  check(loneTrace.regroupsStarted === 0, `alone: ${loneTrace.regroupsStarted} regroups`);
  check(loneTrace.impacts > 0, `alone, it fights on (${loneTrace.impacts} swings landed)`);
}

// ── Riposte ────────────────────────────────────────────────────────────────

/**
 * The shortest a locked telegraph may be, restated from P2 of
 * `docs/difficulty-fairness-rules.md` rather than imported, so the game cannot
 * lower the bar this gate holds it to.
 */
const FAIRNESS_MIN_TELEGRAPH_FRAMES = 21;
/**
 * The weapon both riposte probes carry, fixed so the riposting and the plain
 * goblin swing on the same timing table and the windup floor is its own.
 */
const RIPOSTE_PROBE_WEAPON: GoblinWeapon = 'sword';
/** Guards to measure a riposte after. */
const RIPOSTE_GUARDS_WANTED = 8;
const RIPOSTE_RUN_FRAMES = 20000;

/** Frames from each guard to the next blow landing, for a goblin with `traits`. */
function measureGuardToImpact(map: GameMap, traits: readonly TacticsTrait[]): number[] {
  const arena = makeArena(map, KITE_HUMAN_TILE, FAR_CORNER);
  const goblin = addTactician(arena, KITE_KITER_TILE, traits, RIPOSTE_PROBE_WEAPON);
  const intervals: number[] = [];
  let guardFrame: number | null = null;
  takeSwingLanded(goblin);
  const rng = mulberry32(GUARD_SEED);
  const savedRandom = Math.random;
  Math.random = rng;
  try {
    for (let frame = 0; frame < RIPOSTE_RUN_FRAMES; frame++) {
      if (intervals.length >= RIPOSTE_GUARDS_WANTED) break;
      // The player presses in after the shove, the way a real one would: so
      // nothing but the goblin's own timing stands between a guard and its
      // answer, and a shortened answer would show.
      arena.human.x = goblin.x - TILE_SIZE;
      arena.human.y = goblin.y;
      arena.loop.update(arena.ctx);
      if (!takeSwingLanded(goblin)) continue;
      if (guardFrame !== null) {
        intervals.push(frame - guardFrame);
        guardFrame = null;
      }
      // Struck back the moment a blow lands: the swing that landed it is past
      // its impact, so whatever lands next belongs to a fresh swing.
      healFully(goblin);
      goblin.takeDamageFrom(PROBE_BLOW_DAMAGE, arena.human, 'melee');
      if (goblin.lastBlowWasGuarded) guardFrame = frame;
    }
  } finally {
    Math.random = savedRandom;
    arena.loop.dispose();
  }
  return intervals;
}

/** A sheet's one-shot row samples the middle of each frame. */
const HALF_FRAME = 0.5;

/** The soonest a goblin with `weapon` lands a blow after starting its swing, either kind. */
function shortestImpactDelay(weapon: GoblinWeapon): number {
  let shortest = Number.POSITIVE_INFINITY;
  for (const timing of Object.values(GOBLIN_ATTACKS[weapon])) {
    const delay = Math.max(
      1,
      Math.round((timing.animFrames * (timing.impactFrame + HALF_FRAME)) / timing.spriteFrames),
    );
    shortest = Math.min(shortest, delay);
  }
  return shortest;
}

function checkRiposte(map: GameMap): void {
  section('Riposte: answers a guard sooner, never with a shorter telegraph');

  const riposte = measureGuardToImpact(map, ['block', 'riposte']);
  const plain = measureGuardToImpact(map, ['block']);
  check(
    riposte.length >= RIPOSTE_GUARDS_WANTED && plain.length >= RIPOSTE_GUARDS_WANTED,
    `guards measured: ${riposte.length} riposting, ${plain.length} plain (need ${RIPOSTE_GUARDS_WANTED})`,
  );
  const soonestRiposte = Math.min(...riposte);
  const soonestPlain = Math.min(...plain);
  const probeWindup = shortestImpactDelay(RIPOSTE_PROBE_WEAPON);
  const minimumAnswer = RIPOSTE_READY_FRAMES + probeWindup;
  check(
    soonestRiposte >= FAIRNESS_MIN_TELEGRAPH_FRAMES,
    `a riposte lands ${soonestRiposte} frames after the guard at the soonest (fairness floor ${FAIRNESS_MIN_TELEGRAPH_FRAMES})`,
  );
  check(
    soonestRiposte >= minimumAnswer,
    `the riposte's own swing is not shortened: ${soonestRiposte} >= ${RIPOSTE_READY_FRAMES} ready + ${probeWindup} ${RIPOSTE_PROBE_WEAPON} windup`,
  );
  const meanRiposte = riposte.reduce((sum, value) => sum + value, 0) / Math.max(1, riposte.length);
  const meanPlain = plain.reduce((sum, value) => sum + value, 0) / Math.max(1, plain.length);
  check(
    meanRiposte < meanPlain,
    `a riposte answers sooner than a plain guard: mean ${meanRiposte.toFixed(1)} vs ${meanPlain.toFixed(1)} frames (soonest ${soonestRiposte} vs ${soonestPlain})`,
  );
}

// ── Difficulty telemetry: blocks, kites, and the trait-fight HP split ──────

/** Frames run engaged, well past the threshold a fight must clear to be counted. */
const TELEMETRY_ENGAGED_FRAMES = MIN_COUNTED_FIGHT_FRAMES + 1;
/** Frames run idle, well past the grace period a fight closes on. */
const TELEMETRY_IDLE_FRAMES = FIGHT_END_GRACE_FRAMES + 1;
/** A handful of frames run idle before any fight has started, for the leak probe. */
const TELEMETRY_PRE_FIGHT_IDLE_FRAMES = 5;
const TELEMETRY_STRAY_BLOCKS = 3;
const TELEMETRY_STRAY_KITE_FRAMES = 12;
const TELEMETRY_IN_FIGHT_BLOCKS = 1;

function makeTelemetryCtx(
  map: GameMap,
  human: HumanPlayer,
  cat: CatPlayer,
  mob: Mob,
): SystemContext {
  const roster = new MobRoster(map, new SpellSystem());
  roster.add(mob);
  return { human, cat, active: human, inactive: cat, activeIsMoving: false, roster, gameMap: map };
}

function runTelemetryFrames(
  telemetry: DifficultyTelemetrySystem,
  ctx: SystemContext,
  frames: number,
): void {
  for (let frame = 0; frame < frames; frame++) telemetry.update(ctx);
}

function currentFightBlocksSum(): number {
  const tally = difficultyStats.tallyFor(difficultyStats.segment);
  return tally === null ? 0 : tally.blocksSum;
}

function checkTelemetryDoesNotLeakAcrossFights(map: GameMap): void {
  section(
    'Difficulty telemetry: a block or kite outside a fight is not attributed to the next one',
  );
  difficultyStats.beginRun();
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const cat = new CatPlayer(FAR_CORNER_TILE, FAR_CORNER_TILE, TILE_SIZE);
  const mob = createMob('goblin', ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, map);
  mob.applyMobLevel(1);
  const ctx = makeTelemetryCtx(map, human, cat, mob);
  const telemetry = new DifficultyTelemetrySystem();

  // Struck before anything has noticed anybody: no fight is open yet.
  for (let i = 0; i < TELEMETRY_STRAY_BLOCKS; i++) noteGuardBlock();
  noteKiteStart();
  noteKiteEnd(TELEMETRY_STRAY_KITE_FRAMES);
  runTelemetryFrames(telemetry, ctx, TELEMETRY_PRE_FIGHT_IDLE_FRAMES);

  // Now a genuine, unrelated fight happens and closes with no blocks of its own.
  mob.currentTarget = human;
  runTelemetryFrames(telemetry, ctx, TELEMETRY_ENGAGED_FRAMES);
  mob.currentTarget = null;
  runTelemetryFrames(telemetry, ctx, TELEMETRY_IDLE_FRAMES);

  const tally = difficultyStats.tallyFor(difficultyStats.segment);
  check(tally !== null && tally.roomFights === 1, 'the unrelated fight was counted');
  check(
    tally !== null && tally.blocksSum === 0 && tally.kiteStarts === 0 && tally.kiteEnds === 0,
    `the stray pre-fight block and kite were dropped, not carried in (blocks ${tally?.blocksSum}, kiteStarts ${tally?.kiteStarts}, kiteEnds ${tally?.kiteEnds})`,
  );
}

function checkTelemetryCountsOncePerFrame(map: GameMap): void {
  section('Difficulty telemetry: a block is counted once, even with two updates in one callback');
  difficultyStats.beginRun();
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const cat = new CatPlayer(FAR_CORNER_TILE, FAR_CORNER_TILE, TILE_SIZE);
  const mob = createMob('goblin', ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, map);
  mob.applyMobLevel(1);
  const ctx = makeTelemetryCtx(map, human, cat, mob);
  const telemetry = new DifficultyTelemetrySystem();

  mob.currentTarget = human;
  runTelemetryFrames(telemetry, ctx, 1);
  for (let i = 0; i < TELEMETRY_IN_FIGHT_BLOCKS; i++) noteGuardBlock();
  // Scene.loop's catch-up can run two simulated frames inside one callback;
  // the sink must not be drained twice for what was noted once.
  telemetry.update(ctx);
  telemetry.update(ctx);
  runTelemetryFrames(telemetry, ctx, TELEMETRY_ENGAGED_FRAMES);
  mob.currentTarget = null;
  runTelemetryFrames(telemetry, ctx, TELEMETRY_IDLE_FRAMES);

  check(
    currentFightBlocksSum() === TELEMETRY_IN_FIGHT_BLOCKS,
    `exactly ${TELEMETRY_IN_FIGHT_BLOCKS} block was counted (got ${currentFightBlocksSum()})`,
  );
}

function checkTelemetryTraitFightNeedsBlood(map: GameMap): void {
  section('Difficulty telemetry: a trait-bearing fight needs blood, not just a notice');
  difficultyStats.beginRun();
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const cat = new CatPlayer(FAR_CORNER_TILE, FAR_CORNER_TILE, TILE_SIZE);

  // Noticed only: currentTarget is set, but nobody has struck anybody.
  const noticer = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  check(noticer.tactics.hasAnyTrait, 'the noticing probe rolled a trait');
  const noticerCtx = makeTelemetryCtx(map, human, cat, noticer);
  const noticerTelemetry = new DifficultyTelemetrySystem();
  noticer.currentTarget = human;
  runTelemetryFrames(noticerTelemetry, noticerCtx, TELEMETRY_ENGAGED_FRAMES);
  noticer.currentTarget = null;
  runTelemetryFrames(noticerTelemetry, noticerCtx, TELEMETRY_IDLE_FRAMES);
  const noticerTally = difficultyStats.tallyFor(difficultyStats.segment);
  check(
    noticerTally !== null && noticerTally.traitFights === 0 && noticerTally.noTraitFights === 1,
    `a merely-noticing trait mob lands in the no-trait bucket (trait ${noticerTally?.traitFights}, none ${noticerTally?.noTraitFights})`,
  );

  // Same trait mob, but it actually lands a blow this time.
  difficultyStats.beginRun();
  const striker = makeBlocker(map, ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE);
  const strikerCtx = makeTelemetryCtx(map, human, cat, striker);
  const strikerTelemetry = new DifficultyTelemetrySystem();
  striker.currentTarget = human;
  striker.noteStruckPlayer(human);
  runTelemetryFrames(strikerTelemetry, strikerCtx, TELEMETRY_ENGAGED_FRAMES);
  striker.currentTarget = null;
  runTelemetryFrames(strikerTelemetry, strikerCtx, TELEMETRY_IDLE_FRAMES);
  const strikerTally = difficultyStats.tallyFor(difficultyStats.segment);
  check(
    strikerTally !== null && strikerTally.traitFights === 1 && strikerTally.noTraitFights === 0,
    `a trait mob that actually struck lands in the trait bucket (trait ${strikerTally?.traitFights}, none ${strikerTally?.noTraitFights})`,
  );
}

function checkpointFieldsEqual(
  a: ReturnType<DifficultyTelemetrySystem['captureCheckpoint']>,
  b: ReturnType<DifficultyTelemetrySystem['captureCheckpoint']>,
): boolean {
  return (
    a.engagedFrames === b.engagedFrames &&
    a.idleFrames === b.idleFrames &&
    a.inFight === b.inFight &&
    a.fightBlocks === b.fightBlocks &&
    a.fightKiteStarts === b.fightKiteStarts &&
    a.fightKiteEnds === b.fightKiteEnds &&
    a.fightKiteFrames === b.fightKiteFrames &&
    a.fightHasTraitMob === b.fightHasTraitMob &&
    JSON.stringify(a.stairwellHunt) === JSON.stringify(b.stairwellHunt)
  );
}

function checkTelemetryCheckpointRoundTrips(map: GameMap): void {
  section('Difficulty telemetry: checkpoint capture/restore round-trips the tactics counters');
  difficultyStats.beginRun();
  const human = new HumanPlayer(
    ROOM_MIDDLE_TILE - ATTACKER_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    TILE_SIZE,
  );
  const cat = new CatPlayer(FAR_CORNER_TILE, FAR_CORNER_TILE, TILE_SIZE);
  const mob = createMob('goblin', ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, map);
  mob.applyMobLevel(1);
  const ctx = makeTelemetryCtx(map, human, cat, mob);
  const telemetry = new DifficultyTelemetrySystem();

  mob.currentTarget = human;
  runTelemetryFrames(telemetry, ctx, 1);
  noteGuardBlock();
  noteGuardBlock();
  noteKiteStart();
  telemetry.update(ctx);

  const before = telemetry.captureCheckpoint();
  // Diverge state after the snapshot, so a restore that silently no-ops would
  // still be caught comparing against a snapshot taken right after.
  noteGuardBlock();
  telemetry.update(ctx);
  runTelemetryFrames(telemetry, ctx, TELEMETRY_ENGAGED_FRAMES);

  telemetry.restoreCheckpoint(before);
  const restored = telemetry.captureCheckpoint();
  check(
    checkpointFieldsEqual(before, restored),
    'a restore reproduces the captured checkpoint exactly',
  );

  // Prove the comparison itself can fail: one more engaged frame must change
  // the checkpoint, or the equality check above would pass no matter what
  // restore actually did.
  runTelemetryFrames(telemetry, ctx, 1);
  check(
    !checkpointFieldsEqual(restored, telemetry.captureCheckpoint()),
    'the harness itself can tell two different checkpoints apart',
  );
}

// ── Run ────────────────────────────────────────────────────────────────────

const SECTIONS: ReadonlyArray<(map: GameMap) => void> = [
  checkNothingBelowMinimumLevel,
  checkRollTable,
  () => checkSpawnSites(),
  checkBlockStreaks,
  checkRefusedChannels,
  checkLowHpNeverGuards,
  checkGuardShove,
  checkCreditedBlows,
  checkTraitsSurviveResets,
  checkKite,
  checkKiteLeash,
  checkKiteHazard,
  checkFlank,
  () => checkFlankHysteresis(),
  checkRegroup,
  checkRiposte,
  checkTelemetryDoesNotLeakAcrossFights,
  checkTelemetryCountsOncePerFrame,
  checkTelemetryTraitFightNeedsBlood,
  checkTelemetryCheckpointRoundTrips,
  (map) => checkRangedTactics(map, { check, section }),
  (map) => checkSpecialCaseTactics(map, { check, section }),
  (map) => checkMeleeTactics(map, { check, section }),
  (map) => checkTierTableFitsFloors(map, { check, section }),
  (map) => checkGrubTactics(map, { check, section }),
  (map) => checkFallBackSandwich(map, { check, section }),
];

// Every creature draws on `Math.random` — a goblin's weapon, its heavy-or-light
// choice, its wander — so the whole run is seeded, and two runs print the same
// numbers to the digit.
Math.random = mulberry32(RUN_SEED);
for (const run of SECTIONS) run(makeRoom());

console.log(failures === 0 ? '\nverify:tactics passed' : `\nverify:tactics FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
