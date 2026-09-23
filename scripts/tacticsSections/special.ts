/**
 * `verify:tactics` sections for the creatures whose tactics are a special case
 * of the melee brawler: the rat (a tiny swarmer that only flanks), the circus
 * lemur (a knife-thrower that outruns the player), the krasue (a flier that
 * steers by its own drift rather than by pathfinding) and the sky fowl (calm
 * until provoked) — plus the creatures deliberately left with none.
 *
 * Each behaviour check drives the real creature through the real mob loop on
 * the room `verify-tactics.ts` hands in, runs the same layout again without the
 * trait so the difference is the trait's doing, and measures an angle, a
 * distance or a frame gap rather than counting hits.
 */

import { MOB_GRID_CELL_SIZE, PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants';
import type { GameMap } from '../../src/map/GameMap';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { TACTICAL_RETREAT_MAX_SPEED, type Mob } from '../../src/creatures/Mob';
import type { SpatialGrid } from '../../src/core/SpatialGrid';
import { createMob, getRegisteredMobTypes, MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles';
import { mulberry32, type Rng } from '../../src/sprites/person/rng';
import {
  TACTICS_MIN_MOB_LEVEL,
  TACTICS_TRAITS,
  type TacticsTrait,
} from '../../src/creatures/tactics/tacticsTraits';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { chasedKitesRunOn, describeKiteLengths } from './chasedKites';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import {
  KITE_MAX_DISTANCE_TILES,
  KITE_MAX_FRAMES,
  REGROUP_HP_FRACTION,
  REGROUP_MAX_FRAMES,
} from '../../src/creatures/tactics/retreat';
import { FLANK_STAGING_TILES } from '../../src/creatures/tactics/flank';
import { RIPOSTE_READY_FRAMES } from '../../src/creatures/tactics/riposte';
import {
  GUARD_KNOCKBACK_FRAMES,
  GUARD_KNOCKBACK_TILES,
} from '../../src/creatures/tactics/blockGuard';
import { Rat } from '../../src/creatures/Rat';
import { ShrineVermin } from '../../src/creatures/ShrineVermin';
import { CIRCUS_LEMUR_THROW_STANDOFF_TILES, CircusLemur } from '../../src/creatures/CircusLemur';
import { Krasue } from '../../src/creatures/Krasue';
import { SkyFowl } from '../../src/creatures/SkyFowl';
import { Bugaboo } from '../../src/creatures/Bugaboo';
import { SmallSpider } from '../../src/creatures/SmallSpider';
import { Cockroach } from '../../src/creatures/Cockroach';
import { Tuskling } from '../../src/creatures/Tuskling';
import { KrakarenTentacle } from '../../src/creatures/KrakarenTentacle';
import { InkMarauder } from '../../src/creatures/InkMarauder';

/** The pass/fail reporting `verify-tactics.ts` owns, so its failure count covers these too. */
export interface TacticsHarness {
  check(ok: boolean, message: string): void;
  section(name: string): void;
}

/** A source that says yes to every roll, so "no trait" can only mean "not eligible". */
const ALWAYS_YES: Rng = () => 0;
const GUARD_SEED = 0x5bec1a1;
const SECTION_SEED = 0x5bec1a2;
/** The highest mob level that must behave exactly as the untuned early game. */
const HIGHEST_TRAITLESS_LEVEL = TACTICS_MIN_MOB_LEVEL - 1;

// ── Eligibility: what each special-case creature can ever learn ────────────

interface EligibilityCase {
  readonly name: string;
  readonly build: (map: GameMap) => Mob;
  /** Whether the built mob really is the class under test, not a fallback. */
  readonly isExpectedClass: (mob: Mob) => boolean;
  readonly expected: readonly TacticsTrait[];
}

const PROBE_TILE = 12;

/** Built through the spawner, so a mistyped key that falls back to a goblin is caught. */
function spawned(type: string): (map: GameMap) => Mob {
  return (map) => createMob(type, PROBE_TILE, PROBE_TILE, map);
}

function summonedKrasue(): Mob {
  const krasue = new Krasue(PROBE_TILE, PROBE_TILE, TILE_SIZE);
  krasue.isSummon = true;
  return krasue;
}

const ELIGIBILITY_CASES: readonly EligibilityCase[] = [
  {
    name: 'rat',
    build: spawned('rat'),
    isExpectedClass: (mob) => mob instanceof Rat && !(mob instanceof ShrineVermin),
    expected: ['flank'],
  },
  {
    name: 'circus_lemur',
    build: spawned('circus_lemur'),
    isExpectedClass: (mob) => mob instanceof CircusLemur,
    expected: ['flank', 'kite', 'regroup'],
  },
  {
    name: 'krasue',
    build: spawned('krasue'),
    isExpectedClass: (mob) => mob instanceof Krasue,
    expected: ['flank', 'block', 'regroup', 'riposte'],
  },
  {
    name: 'sky_fowl',
    build: spawned('sky_fowl'),
    isExpectedClass: (mob) => mob instanceof SkyFowl,
    expected: ['flank', 'regroup'],
  },
  {
    name: 'bugaboo',
    build: spawned('bugaboo'),
    isExpectedClass: (mob) => mob instanceof Bugaboo,
    expected: [],
  },
  {
    name: 'small_spider',
    build: spawned('small_spider'),
    isExpectedClass: (mob) => mob instanceof SmallSpider,
    expected: [],
  },
  {
    name: 'cockroach',
    build: spawned('cockroach'),
    isExpectedClass: (mob) => mob instanceof Cockroach,
    expected: [],
  },
  {
    name: 'tuskling',
    build: spawned('tuskling'),
    isExpectedClass: (mob) => mob instanceof Tuskling,
    expected: [],
  },
  {
    name: 'shrine vermin',
    build: () => new ShrineVermin(PROBE_TILE, PROBE_TILE, TILE_SIZE),
    isExpectedClass: (mob) => mob instanceof ShrineVermin,
    expected: [],
  },
  {
    name: 'krakaren tentacle',
    build: () => new KrakarenTentacle(PROBE_TILE, PROBE_TILE, TILE_SIZE),
    isExpectedClass: (mob) => mob instanceof KrakarenTentacle,
    expected: [],
  },
  {
    name: 'ink marauder',
    build: () => new InkMarauder(PROBE_TILE, PROBE_TILE, TILE_SIZE),
    isExpectedClass: (mob) => mob instanceof InkMarauder,
    expected: [],
  },
  {
    name: "Miss Quill's summoned krasue",
    build: () => summonedKrasue(),
    isExpectedClass: (mob) => mob instanceof Krasue && mob.isSummon,
    expected: [],
  },
];

/** The spawner keys the shared "nothing below the minimum level" sweep must cover. */
const SWEPT_TYPES = ['rat', 'circus_lemur', 'krasue', 'sky_fowl', 'bugaboo'];

/** Every trait `mob` could ever roll: the top level, the hard profile, every roll a yes. */
function eligibilityOf(mob: Mob): readonly TacticsTrait[] {
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
  return mob.tactics.traits;
}

function checkEligibility(map: GameMap, harness: TacticsHarness): void {
  harness.section('Special cases: each creature learns exactly the traits its body suits');
  for (const eligibilityCase of ELIGIBILITY_CASES) {
    const mob = eligibilityCase.build(map);
    harness.check(
      eligibilityCase.isExpectedClass(mob),
      `${eligibilityCase.name}: built as the class under test`,
    );
    const traits = eligibilityOf(mob);
    harness.check(
      traits.join(',') === eligibilityCase.expected.join(','),
      `${eligibilityCase.name}: learns [${traits.join(', ')}] (expected [${eligibilityCase.expected.join(', ')}])`,
    );
    const early = eligibilityCase.build(map);
    early.applyMobLevel(HIGHEST_TRAITLESS_LEVEL);
    early.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
    harness.check(
      !early.tactics.hasAnyTrait,
      `${eligibilityCase.name}: nothing at level ${HIGHEST_TRAITLESS_LEVEL} (${early.tactics.traits.join(',') || 'none'})`,
    );
  }
  const registered = getRegisteredMobTypes();
  const unswept = SWEPT_TYPES.filter((type) => !registered.includes(type));
  harness.check(
    unswept.length === 0,
    `the shared early-level sweep reaches every registered special case ${unswept.join(', ')}`,
  );
}

// ── Arena ──────────────────────────────────────────────────────────────────

interface Arena {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly loop: MobUpdateLoop;
  readonly ctx: SystemContext;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
}

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

function makeArena(map: GameMap, humanTile: TilePoint, catTile: TilePoint): Arena {
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
 * A source that answers yes to exactly `wanted` among `eligible`, in the order
 * the roll asks — which skips riposte unless block came up.
 */
function rollOnly(eligible: readonly TacticsTrait[], wanted: readonly TacticsTrait[]): Rng {
  const draws: number[] = [];
  let blockRolled = false;
  for (const trait of TACTICS_TRAITS) {
    if (!eligible.includes(trait)) continue;
    if (trait === 'riposte' && !blockRolled) continue;
    const yes = wanted.includes(trait);
    if (trait === 'block') blockRolled = yes;
    draws.push(yes ? 0 : 1);
  }
  let index = 0;
  return () => draws[index++] ?? 1;
}

/** A top-level `type` with exactly `wanted`, added to the arena. */
function addCreature(
  arena: Arena,
  type: string,
  tile: TilePoint,
  wanted: readonly TacticsTrait[],
  harness: TacticsHarness,
): Mob {
  const eligible = eligibilityOf(createMob(type, tile.x, tile.y, arena.map));
  const mob = createMob(type, tile.x, tile.y, arena.map);
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(DIFFICULTY_PROFILES.normal.tacticsChanceScale, rollOnly(eligible, wanted));
  if (mob.tactics.traits.join(',') !== wanted.join(',')) {
    harness.check(
      false,
      `${type}: rolled [${mob.tactics.traits.join(', ')}], wanted [${wanted.join(', ')}]`,
    );
  }
  arena.roster.add(mob);
  return mob;
}

/** Small against any levelled mob's health, so the blow only marks it as in the fight. */
const PROBE_BLOW_DAMAGE = 1;

/**
 * Wound `mob` by `share` of its health with a blast — which no guard meets and
 * which provokes a calm fowl — from `crawler`, so it has shed the party's blood
 * and counts as in the fight.
 */
function bloody(mob: Mob, crawler: HumanPlayer, share: number): void {
  mob.takeDamageFrom(PROBE_BLOW_DAMAGE, crawler, 'explosion');
  mob.hp = Math.max(1, Math.round(mob.maxHp * (1 - share)));
}

function centreDistance(a: TilePoint, b: TilePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centreTile(body: TilePoint): TilePoint {
  return {
    x: Math.floor((body.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE / 2) / TILE_SIZE),
  };
}

/** Whether the mob's facing points at `target`, by vector or, for a mirrored sprite, by side. */
function facesToward(mob: Mob, target: TilePoint, mirroredOnly: boolean): boolean {
  const dx = target.x - mob.x;
  const dy = target.y - mob.y;
  if (mirroredOnly) return dx === 0 || Math.sign(mob.facingX) === Math.sign(dx);
  return mob.facingX * dx + mob.facingY * dy > 0;
}

/** Whether a mob attacked this frame — a blow, a bite or a throw — and clear it for the next. */
function takeAttackStarted(mob: Mob): boolean {
  const attacked = mob.attackSoundPending || mob.projectileSoundPending;
  mob.attackSoundPending = false;
  mob.projectileSoundPending = false;
  return attacked;
}

// ── Flank ──────────────────────────────────────────────────────────────────

interface FlankCase {
  readonly type: string;
  /** Tiles west of the player the pack starts, inside the range its chase holds a target at. */
  readonly startGapTiles: number;
  /**
   * Where a pack member's bearing is read: on arrival within reach for a
   * brawler, and where it has settled for a thrower, which stops at range.
   */
  readonly bearingAt: 'arrival' | 'settled';
  /** A sprite mirrored left and right only, whose facing is judged by side. */
  readonly mirroredOnly: boolean;
  /** For a thrower: the stand-off no flanker may settle inside, in tiles. */
  readonly minSettledTiles?: number;
}

/** A rat notices at three tiles and keeps a quarry to six; the flank's staging ring is past three. */
const RAT_FLANK_GAP_TILES = 5;
const RANGED_FLANK_GAP_TILES = 6;

const FLANK_CASES: readonly FlankCase[] = [
  { type: 'rat', startGapTiles: RAT_FLANK_GAP_TILES, bearingAt: 'arrival', mirroredOnly: false },
  {
    type: 'circus_lemur',
    startGapTiles: RANGED_FLANK_GAP_TILES,
    bearingAt: 'settled',
    mirroredOnly: true,
    minSettledTiles: CIRCUS_LEMUR_THROW_STANDOFF_TILES,
  },
  {
    type: 'krasue',
    startGapTiles: RANGED_FLANK_GAP_TILES,
    bearingAt: 'arrival',
    mirroredOnly: true,
  },
  {
    type: 'sky_fowl',
    startGapTiles: RANGED_FLANK_GAP_TILES,
    bearingAt: 'arrival',
    mirroredOnly: false,
  },
];

const FLANK_HUMAN_TILE = { x: 17, y: 12 };
const FAR_CORNER = { x: 1, y: 1 };
const FLANK_PACK_ROW_OFFSETS = [-1, 0, 1];
/**
 * A brawler's bearing is read as it crosses the flank's staging ring: where a
 * flanker has fanned out, and before a pack queued in single file starts
 * shuffling round the front body, which spreads a plain pack's bearings as
 * much as flanking does and would make the control run meaningless.
 */
const FLANK_ARRIVAL_TILES = FLANK_STAGING_TILES;
const FLANK_RUN_FRAMES = 600;
/** The arrival bearings of a pack that flanked must span at least this. */
const FLANK_DISTINCT_DEGREES = 40;
/**
 * And must span this much more than the same pack's without the trait. Judged
 * against the control rather than a fixed line alone, because a krasue's
 * wobble already spreads a plain pack a good way toward that line.
 */
const FLANK_SPREAD_GAIN_DEGREES = 25;
const DEGREES_PER_HALF_TURN = 180;
/** How many of the three must actually have walked a flank for the run to count. */
const FLANKERS_WANTED = 2;
/** A frame must cover this share of the mob's speed for its direction to be a walking direction. */
const WALKING_STEP_SHARE = 0.5;
/** Share of walking flank frames whose facing must agree with the step. */
const FACING_AGREEMENT_MIN = 0.9;

interface FlankTrace {
  readonly bearings: readonly number[];
  readonly flankers: number;
  readonly walkingFlankFrames: number;
  readonly facingAgreedFrames: number;
  readonly finalFacingTowardTarget: number;
  /** The nearest any pack member stands to the player at the end, in tiles. */
  readonly closestSettledTiles: number;
}

function flankRun(
  map: GameMap,
  flankCase: FlankCase,
  traits: readonly TacticsTrait[],
  harness: TacticsHarness,
): FlankTrace {
  const arena = makeArena(map, FLANK_HUMAN_TILE, FAR_CORNER);
  const pack = FLANK_PACK_ROW_OFFSETS.map((offset) =>
    addCreature(
      arena,
      flankCase.type,
      { x: FLANK_HUMAN_TILE.x - flankCase.startGapTiles, y: FLANK_HUMAN_TILE.y + offset },
      traits,
      harness,
    ),
  );
  for (const mob of pack) {
    // A fowl is calm until struck; everything else is simply told where the
    // fight is, as a packmate's shout would.
    if (mob instanceof SkyFowl) mob.takeDamageFrom(PROBE_BLOW_DAMAGE, arena.human, 'explosion');
    else mob.noticeTarget(arena.human);
  }
  const bearings = pack.map(() => Number.NaN);
  const flanked = pack.map(() => false);
  let walkingFlankFrames = 0;
  let facingAgreedFrames = 0;
  const arrivalPx = FLANK_ARRIVAL_TILES * TILE_SIZE;
  for (let frame = 0; frame < FLANK_RUN_FRAMES; frame++) {
    const before = pack.map((mob) => ({ x: mob.x, y: mob.y }));
    arena.loop.update(arena.ctx);
    pack.forEach((mob, index) => {
      const dx = mob.x - before[index].x;
      const dy = mob.y - before[index].y;
      if (mob.tactics.lastMove === 'flank') {
        flanked[index] = true;
        const step = Math.hypot(dx, dy);
        if (step >= mob.moveSpeed * WALKING_STEP_SHARE) {
          walkingFlankFrames++;
          const agrees = flankCase.mirroredOnly
            ? Math.sign(mob.facingX) === Math.sign(dx) || Math.abs(dx) < step * WALKING_STEP_SHARE
            : mob.facingX * dx + mob.facingY * dy > 0;
          if (agrees) facingAgreedFrames++;
        }
      }
      const arrived = centreDistance(mob, arena.human) <= arrivalPx;
      if (flankCase.bearingAt === 'arrival' && arrived && Number.isNaN(bearings[index])) {
        bearings[index] = Math.atan2(mob.y - arena.human.y, mob.x - arena.human.x);
      }
    });
  }
  if (flankCase.bearingAt === 'settled') {
    pack.forEach((mob, index) => {
      bearings[index] = Math.atan2(mob.y - arena.human.y, mob.x - arena.human.x);
    });
  }
  const closestSettledTiles = Math.min(
    ...pack.map((mob) => centreDistance(mob, arena.human) / TILE_SIZE),
  );
  const finalFacingTowardTarget = pack.filter((mob) =>
    facesToward(mob, arena.human, flankCase.mirroredOnly),
  ).length;
  arena.loop.dispose();
  return {
    bearings,
    flankers: flanked.filter(Boolean).length,
    walkingFlankFrames,
    facingAgreedFrames,
    finalFacingTowardTarget,
    closestSettledTiles,
  };
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

function checkFlank(map: GameMap, harness: TacticsHarness, flankCase: FlankCase): void {
  const { type } = flankCase;
  const withTrait = flankRun(map, flankCase, ['flank'], harness);
  const measured = withTrait.bearings.filter((bearing) => !Number.isNaN(bearing));
  const spread = widestBearingSpreadDegrees(measured);
  harness.check(
    measured.length === FLANK_PACK_ROW_OFFSETS.length,
    `${type}: ${measured.length}/${FLANK_PACK_ROW_OFFSETS.length} flankers reached the fight`,
  );
  harness.check(
    withTrait.flankers >= FLANKERS_WANTED,
    `${type}: ${withTrait.flankers} of the pack walked a flank (need ${FLANKERS_WANTED})`,
  );
  harness.check(
    spread >= FLANK_DISTINCT_DEGREES,
    `${type}: flankers come in across ${spread.toFixed(1)}° (need ${FLANK_DISTINCT_DEGREES}°)`,
  );
  const agreement = withTrait.facingAgreedFrames / Math.max(1, withTrait.walkingFlankFrames);
  harness.check(
    withTrait.walkingFlankFrames > 0 && agreement >= FACING_AGREEMENT_MIN,
    `${type}: faces the way it walks on ${agreement.toFixed(2)} of ${withTrait.walkingFlankFrames} flank frames (need ${FACING_AGREEMENT_MIN})`,
  );
  harness.check(
    withTrait.finalFacingTowardTarget === FLANK_PACK_ROW_OFFSETS.length,
    `${type}: ${withTrait.finalFacingTowardTarget}/${FLANK_PACK_ROW_OFFSETS.length} face the player once there`,
  );

  const standoff = flankCase.minSettledTiles;
  if (standoff !== undefined) {
    harness.check(
      withTrait.closestSettledTiles >= standoff,
      `${type}: fanned out, the nearest settles ${withTrait.closestSettledTiles.toFixed(2)} tiles off, outside its ${standoff}-tile throwing stand-off`,
    );
  }

  const plain = flankRun(map, flankCase, [], harness);
  const plainSpread = widestBearingSpreadDegrees(
    plain.bearings.filter((bearing) => !Number.isNaN(bearing)),
  );
  harness.check(
    plain.flankers === 0 && spread - plainSpread >= FLANK_SPREAD_GAIN_DEGREES,
    `${type} control: without flank none flanks, and the pack comes in across ${plainSpread.toFixed(1)}° — ${(spread - plainSpread).toFixed(1)}° narrower (need ${FLANK_SPREAD_GAIN_DEGREES}°)`,
  );
}

// ── Regroup ────────────────────────────────────────────────────────────────

interface RetreatCase {
  readonly type: string;
  readonly mirroredOnly: boolean;
  /**
   * Whether this creature's own levelled walk is faster than a retreat may go,
   * so the retreat cap is what holds it back and the speed check can fail.
   */
  readonly outrunsRetreatCap: boolean;
}

const REGROUP_CASES: readonly RetreatCase[] = [
  { type: 'circus_lemur', mirroredOnly: true, outrunsRetreatCap: true },
  { type: 'krasue', mirroredOnly: true, outrunsRetreatCap: true },
  { type: 'sky_fowl', mirroredOnly: false, outrunsRetreatCap: true },
];

const RETREAT_HUMAN_TILE = { x: 6, y: 12 };
const RETREAT_MOB_TILE = { x: 7, y: 12 };
const RETREAT_ALLY_TILE = { x: 11, y: 12 };
/** Beside the ally, so the ally fights the cat and holds its ground. */
const RETREAT_ALLY_CAT_TILE = { x: 12, y: 12 };
/** Wounded well below the regroup line. */
const REGROUP_WOUND_SHARE = 0.7;
const REGROUP_RUN_FRAMES = 400;
/** Rounding room on a per-frame step measured against a speed. */
const STEP_EPSILON_PX = 1e-6;
/**
 * The fastest a retreat step may measure. No slack for separation shoves: none
 * lands on a retreat frame in these layouts, and any slack at all would let a
 * creature only a little faster than the cap, like the krasue, hide inside it.
 */
const RETREAT_STEP_CAP_PX = TACTICAL_RETREAT_MAX_SPEED + STEP_EPSILON_PX;

interface RetreatTrace {
  readonly started: number;
  readonly longestFrames: number;
  readonly longestWalkPx: number;
  readonly fastestStepPx: number;
  readonly attacksWhileRetreating: number;
  readonly attacksAfter: number;
  readonly endReasons: readonly string[];
  /** Retreats that ended and were followed by the mob standing still. */
  readonly arrivalsChecked: number;
  /** Of those, the ones whose first still frame had the mob facing away from its quarry. */
  readonly arrivalsFacingAway: number;
  readonly widestChaseGapGrowthPx: number;
  /** Frames each finished retreat ran. */
  readonly retreatLengths: readonly number[];
}

interface RetreatRunOptions {
  readonly behaviour: 'kite' | 'regroup';
  readonly frames: number;
  readonly mirroredOnly: boolean;
  /** Walk the human straight at the mob at player speed while it retreats. */
  readonly chase?: boolean;
}

function traceRetreat(arena: Arena, mob: Mob, options: RetreatRunOptions): RetreatTrace {
  let started = 0;
  let run = 0;
  let walk = 0;
  let longestFrames = 0;
  let longestWalkPx = 0;
  let fastestStepPx = 0;
  let attacksWhileRetreating = 0;
  let attacksAfter = 0;
  let arrivalsChecked = 0;
  let arrivalsFacingAway = 0;
  let chaseStartGap = 0;
  let widestChaseGapGrowthPx = 0;
  const retreatLengths: number[] = [];
  let justEnded = false;
  const endReasons: string[] = [];
  let was = false;
  takeAttackStarted(mob);
  const humanHome = { x: arena.human.x, y: arena.human.y };
  const catHome = { x: arena.cat.x, y: arena.cat.y };
  for (let frame = 0; frame < options.frames; frame++) {
    // A blow knocks a crawler back, and a friend chasing a shoved cat across
    // the room is not a friend holding its ground: both crawlers stand where
    // they were put, unless the run is a chase.
    arena.cat.x = catHome.x;
    arena.cat.y = catHome.y;
    if (options.chase !== true) {
      arena.human.x = humanHome.x;
      arena.human.y = humanHome.y;
    }
    if (options.chase === true && was) {
      const dx = mob.x - arena.human.x;
      const dy = mob.y - arena.human.y;
      const gap = Math.hypot(dx, dy);
      if (gap > 0) {
        const step = Math.min(PLAYER_SPEED, gap);
        arena.human.x += (dx / gap) * step;
        arena.human.y += (dy / gap) * step;
      }
    }
    const beforeX = mob.x;
    const beforeY = mob.y;
    arena.loop.update(arena.ctx);
    const attacked = takeAttackStarted(mob);
    const retreating = mob.tactics.activeRetreat === options.behaviour;
    const stepPx = Math.hypot(mob.x - beforeX, mob.y - beforeY);
    if (justEnded && !mob.isMoving) {
      // Whoever it is fighting now: a friend's own quarry can be the nearer one
      // by the time it arrives.
      const quarry = mob.currentTarget ?? arena.human;
      arrivalsChecked++;
      if (!facesToward(mob, quarry, options.mirroredOnly)) arrivalsFacingAway++;
      justEnded = false;
    }
    if (retreating && !was) {
      started++;
      run = 0;
      walk = 0;
      chaseStartGap = centreDistance(mob, arena.human);
    }
    if (retreating) {
      run++;
      walk += stepPx;
      longestFrames = Math.max(longestFrames, run);
      longestWalkPx = Math.max(longestWalkPx, walk);
      fastestStepPx = Math.max(fastestStepPx, stepPx);
      if (attacked) attacksWhileRetreating++;
      if (options.chase === true) {
        widestChaseGapGrowthPx = Math.max(
          widestChaseGapGrowthPx,
          centreDistance(mob, arena.human) - chaseStartGap,
        );
      }
    } else if (attacked && endReasons.length > 0) {
      attacksAfter++;
    }
    if (was && !retreating) {
      endReasons.push(mob.tactics.lastRetreatEnd ?? 'unknown');
      retreatLengths.push(run);
      justEnded = true;
    }
    was = retreating;
  }
  arena.loop.dispose();
  return {
    started,
    longestFrames,
    longestWalkPx,
    fastestStepPx,
    attacksWhileRetreating,
    attacksAfter,
    endReasons,
    arrivalsChecked,
    arrivalsFacingAway,
    widestChaseGapGrowthPx,
    retreatLengths,
  };
}

/**
 * Who the friend is fighting. Beside a cat of its own, the friend holds its
 * ground, but the cat is the nearer quarry by the time the mob gets there, so
 * the retreat ends by switching target. Fighting the player, the friend comes
 * on, and the retreat ends by reaching it.
 */
type AllyQuarry = 'cat' | 'human';

/** A wounded mob beside the player with a fighting friend a few tiles off, or alone. */
function retreatLayout(
  map: GameMap,
  type: string,
  traits: readonly TacticsTrait[],
  withAlly: boolean,
  woundShare: number,
  harness: TacticsHarness,
  allyQuarry: AllyQuarry = 'cat',
): { arena: Arena; mob: Mob } {
  const catBesideAlly = withAlly && allyQuarry === 'cat';
  const arena = makeArena(
    map,
    RETREAT_HUMAN_TILE,
    catBesideAlly ? RETREAT_ALLY_CAT_TILE : FAR_CORNER,
  );
  const mob = addCreature(arena, type, RETREAT_MOB_TILE, traits, harness);
  bloody(mob, arena.human, woundShare);
  if (withAlly) {
    const ally = addCreature(arena, type, RETREAT_ALLY_TILE, [], harness);
    bloody(ally, arena.human, 0);
    // Already fighting on the first frame, so a retreat can start before the
    // mob's own first attack — the frame an attack left unguarded by the
    // retreat would show.
    ally.noticeTarget(allyQuarry === 'cat' ? arena.cat : arena.human);
  }
  return { arena, mob };
}

function checkRegroup(map: GameMap, harness: TacticsHarness, retreatCase: RetreatCase): void {
  const { type, mirroredOnly } = retreatCase;
  const layout = retreatLayout(map, type, ['regroup'], true, REGROUP_WOUND_SHARE, harness);
  harness.check(
    layout.mob.hp / layout.mob.maxHp <= REGROUP_HP_FRACTION,
    `${type}: the probe is wounded below the line (${layout.mob.hp}/${layout.mob.maxHp})`,
  );
  const trace = traceRetreat(layout.arena, layout.mob, {
    behaviour: 'regroup',
    frames: REGROUP_RUN_FRAMES,
    mirroredOnly,
  });
  harness.check(trace.started === 1, `${type}: ${trace.started} regroups in one life (need 1)`);
  harness.check(
    trace.longestFrames <= REGROUP_MAX_FRAMES,
    `${type}: longest regroup ${trace.longestFrames} frames (cap ${REGROUP_MAX_FRAMES})`,
  );
  harness.check(
    trace.attacksWhileRetreating === 0,
    `${type}: ${trace.attacksWhileRetreating} attacks started while regrouping`,
  );
  harness.check(
    trace.fastestStepPx <= RETREAT_STEP_CAP_PX,
    `${type}: regroups no faster than ${trace.fastestStepPx.toFixed(2)} px/frame (cap ${TACTICAL_RETREAT_MAX_SPEED}, own walk ${layout.mob.moveSpeed.toFixed(2)})`,
  );
  if (retreatCase.outrunsRetreatCap) {
    harness.check(
      layout.mob.moveSpeed > TACTICAL_RETREAT_MAX_SPEED,
      `${type}: its own walk (${layout.mob.moveSpeed.toFixed(2)}) is faster than the cap, so the cap is what the check above measures`,
    );
  }
  harness.check(
    trace.attacksAfter > 0,
    `${type}: fights again after regrouping (${trace.attacksAfter} attacks; ended ${trace.endReasons.join(', ') || 'never'})`,
  );
  harness.check(
    trace.arrivalsChecked > 0 && trace.arrivalsFacingAway === 0,
    `${type}: ${trace.arrivalsFacingAway} of ${trace.arrivalsChecked} regroups ended standing with its back to its quarry`,
  );

  const joining = retreatLayout(
    map,
    type,
    ['regroup'],
    true,
    REGROUP_WOUND_SHARE,
    harness,
    'human',
  );
  const joiningTrace = traceRetreat(joining.arena, joining.mob, {
    behaviour: 'regroup',
    frames: REGROUP_RUN_FRAMES,
    mirroredOnly,
  });
  harness.check(
    joiningTrace.endReasons.includes('arrived'),
    `${type}: with its friend coming on, the regroup reaches it (ended ${joiningTrace.endReasons.join(', ') || 'never'})`,
  );
  harness.check(
    joiningTrace.arrivalsChecked > 0 && joiningTrace.arrivalsFacingAway === 0,
    `${type}: having reached its friend, faces the player on ${joiningTrace.arrivalsChecked - joiningTrace.arrivalsFacingAway} of ${joiningTrace.arrivalsChecked} first still frames`,
  );

  const plain = retreatLayout(map, type, [], true, REGROUP_WOUND_SHARE, harness);
  const plainTrace = traceRetreat(plain.arena, plain.mob, {
    behaviour: 'regroup',
    frames: REGROUP_RUN_FRAMES,
    mirroredOnly,
  });
  harness.check(
    plainTrace.started === 0,
    `${type} control: without regroup, ${plainTrace.started} regroups`,
  );

  const lone = retreatLayout(map, type, ['regroup'], false, REGROUP_WOUND_SHARE, harness);
  const loneTrace = traceRetreat(lone.arena, lone.mob, {
    behaviour: 'regroup',
    frames: REGROUP_RUN_FRAMES,
    mirroredOnly,
  });
  harness.check(loneTrace.started === 0, `${type} alone: ${loneTrace.started} regroups`);
}

// ── Lemur kite ─────────────────────────────────────────────────────────────

const KITE_RUN_FRAMES = 900;
/**
 * How much the gap to a chasing player may open while a kiter retreats: the
 * separation shove that keeps the two apart can hand the kiter a few pixels on
 * a frame the player's own step does not cancel.
 */
const CHASE_GAP_SLACK_TILES = 0.25;

function checkLemurKite(map: GameMap, harness: TacticsHarness): void {
  const type = 'circus_lemur';
  harness.section('Circus lemur kite: slips behind a friend, briefly, and stays catchable');
  const layout = retreatLayout(map, type, ['kite'], true, 0, harness);
  const trace = traceRetreat(layout.arena, layout.mob, {
    behaviour: 'kite',
    frames: KITE_RUN_FRAMES,
    mirroredOnly: true,
  });
  harness.check(trace.started > 0, `with a friend: ${trace.started} kites started`);
  harness.check(
    trace.longestFrames <= KITE_MAX_FRAMES,
    `longest kite ${trace.longestFrames} frames (cap ${KITE_MAX_FRAMES})`,
  );
  const walkCap = KITE_MAX_DISTANCE_TILES * TILE_SIZE + TACTICAL_RETREAT_MAX_SPEED;
  harness.check(
    trace.longestWalkPx <= walkCap,
    `longest kite walk ${trace.longestWalkPx.toFixed(1)} px (cap ${walkCap.toFixed(1)})`,
  );
  harness.check(
    trace.fastestStepPx <= RETREAT_STEP_CAP_PX &&
      TACTICAL_RETREAT_MAX_SPEED < PLAYER_SPEED &&
      layout.mob.moveSpeed > PLAYER_SPEED,
    `a lemur walking ${layout.mob.moveSpeed.toFixed(2)} px/frame, faster than the player's ${PLAYER_SPEED}, kites at ${trace.fastestStepPx.toFixed(2)} at most (cap ${TACTICAL_RETREAT_MAX_SPEED})`,
  );
  harness.check(
    trace.attacksWhileRetreating === 0,
    `${trace.attacksWhileRetreating} knives or nips while kiting`,
  );
  harness.check(
    trace.arrivalsChecked > 0 && trace.arrivalsFacingAway === 0,
    `${trace.arrivalsFacingAway} of ${trace.arrivalsChecked} kites ended standing with its back to its quarry`,
  );

  const chase = retreatLayout(map, type, ['kite'], true, 0, harness);
  const chaseTrace = traceRetreat(chase.arena, chase.mob, {
    behaviour: 'kite',
    frames: KITE_RUN_FRAMES,
    mirroredOnly: true,
    chase: true,
  });
  const gapSlackPx = CHASE_GAP_SLACK_TILES * TILE_SIZE;
  const chasedRunOn = chasedKitesRunOn(chaseTrace.retreatLengths, trace.retreatLengths);
  harness.check(
    chasedRunOn,
    `a player following it does not end its kites — ${describeKiteLengths(chaseTrace.retreatLengths, trace.retreatLengths)}`,
  );
  harness.check(
    chasedRunOn && chaseTrace.widestChaseGapGrowthPx <= gapSlackPx,
    `chased at player speed, the gap opens by ${chaseTrace.widestChaseGapGrowthPx.toFixed(1)} px at most (slack ${gapSlackPx})`,
  );

  const lone = retreatLayout(map, type, ['kite'], false, 0, harness);
  const loneTrace = traceRetreat(lone.arena, lone.mob, {
    behaviour: 'kite',
    frames: KITE_RUN_FRAMES,
    mirroredOnly: true,
  });
  harness.check(loneTrace.started === 0, `alone: ${loneTrace.started} kites`);

  const plain = retreatLayout(map, type, [], true, 0, harness);
  const plainTrace = traceRetreat(plain.arena, plain.mob, {
    behaviour: 'kite',
    frames: KITE_RUN_FRAMES,
    mirroredOnly: true,
  });
  harness.check(plainTrace.started === 0, `control: without kite, ${plainTrace.started} kites`);
}

// ── Krasue guard and riposte ───────────────────────────────────────────────

/** Blows thrown at a krasue before a probe gives up waiting for a guard. */
const GUARD_WAIT_ATTEMPTS = 500;
/** Blows thrown at a krasue without `block` to show it never guards. */
const UNGUARDED_PROBE_BLOWS = 300;
/** Pixels of the shove the krasue may lose to rounding. */
const SHOVE_SLACK_PX = 2;
const SHOVE_SETTLE_FRAMES = 4;
/** Where the open-floor shove starts, and how far west its attacker stands. */
const SHOVE_TILE = { x: 12, y: 12 };
const SHOVE_ATTACKER_OFFSET_TILES = 3;
/** Floor tiles between the wall probe's krasue and the room's east wall. */
const WALL_PROBE_TILES_FROM_WALL = 2;
/** Slightly less than one cell, so a rectangle query covers exactly one cell. */
const CELL_QUERY_INSET_PX = 1e-6;

function isFiledUnderOwnCell(grid: SpatialGrid<Mob>, mob: Mob): boolean {
  const cellLeft = Math.floor(mob.x / MOB_GRID_CELL_SIZE) * MOB_GRID_CELL_SIZE;
  const cellTop = Math.floor(mob.y / MOB_GRID_CELL_SIZE) * MOB_GRID_CELL_SIZE;
  const span = MOB_GRID_CELL_SIZE - CELL_QUERY_INSET_PX;
  return grid.queryRect(cellLeft, cellTop, span, span).includes(mob);
}

function withSeededRandom<T>(seed: number, run: () => T): T {
  const savedRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return run();
  } finally {
    Math.random = savedRandom;
  }
}

/** Hit `mob` from `human` until it guards; whether one went up. */
function hitUntilGuarded(mob: Mob, human: HumanPlayer, attempts: number): boolean {
  for (let attempt = 0; attempt < attempts; attempt++) {
    mob.hp = mob.maxHp;
    mob.takeDamageFrom(PROBE_BLOW_DAMAGE, human, 'melee');
    if (mob.lastBlowWasGuarded) return true;
  }
  return false;
}

interface ShoveTrace {
  readonly guarded: boolean;
  readonly startDistance: number;
  readonly shoveEndDistance: number;
  readonly startX: number;
  readonly maxX: number;
  readonly framesInWall: number;
  readonly framesMisfiled: number;
}

function traceKrasueShove(map: GameMap, tile: TilePoint, harness: TacticsHarness): ShoveTrace {
  const arena = makeArena(map, { x: tile.x - SHOVE_ATTACKER_OFFSET_TILES, y: tile.y }, FAR_CORNER);
  const krasue = addCreature(arena, 'krasue', tile, ['block'], harness);
  krasue.noticeTarget(arena.human);
  const guarded = withSeededRandom(GUARD_SEED, () =>
    hitUntilGuarded(krasue, arena.human, GUARD_WAIT_ATTEMPTS),
  );
  const startX = krasue.x;
  const startDistance = centreDistance(krasue, arena.human);
  let shoveEndDistance = startDistance;
  let maxX = startX;
  let framesInWall = 0;
  let framesMisfiled = 0;
  for (let frame = 0; frame < GUARD_KNOCKBACK_FRAMES + SHOVE_SETTLE_FRAMES; frame++) {
    arena.loop.update(arena.ctx);
    maxX = Math.max(maxX, krasue.x);
    if (frame === GUARD_KNOCKBACK_FRAMES - 1)
      shoveEndDistance = centreDistance(krasue, arena.human);
    const standing = centreTile(krasue);
    if (!map.isWalkable(standing.x, standing.y)) framesInWall++;
    if (!isFiledUnderOwnCell(arena.roster.grid, krasue)) framesMisfiled++;
  }
  arena.loop.dispose();
  return { guarded, startDistance, shoveEndDistance, startX, maxX, framesInWall, framesMisfiled };
}

/** The column of the first wall east of `from` along its row. */
function firstWallEastOf(map: GameMap, from: TilePoint): number {
  let x = from.x;
  while (map.isWalkable(x, from.y)) x++;
  return x;
}

function checkKrasueGuard(map: GameMap, harness: TacticsHarness): void {
  harness.section('Krasue guard: a flier is shoved like a walker, its drift refused mid-shove');
  const shoveLengthPx = GUARD_KNOCKBACK_TILES * TILE_SIZE;
  const open = traceKrasueShove(map, SHOVE_TILE, harness);
  const gainPx = open.shoveEndDistance - open.startDistance;
  harness.check(open.guarded, 'open floor: a guard went up');
  harness.check(
    gainPx >= shoveLengthPx - SHOVE_SLACK_PX,
    `open floor: ends the shove ${gainPx.toFixed(1)} px further from the attacker (need ${(shoveLengthPx - SHOVE_SLACK_PX).toFixed(1)})`,
  );
  harness.check(open.framesInWall === 0, `open floor: ${open.framesInWall} frames in a wall`);
  harness.check(
    open.framesMisfiled === 0,
    `open floor: ${open.framesMisfiled} frames filed under a stale grid cell`,
  );

  const eastWallTile = firstWallEastOf(map, SHOVE_TILE);
  const wallTile = { x: eastWallTile - WALL_PROBE_TILES_FROM_WALL, y: SHOVE_TILE.y };
  const wall = traceKrasueShove(map, wallTile, harness);
  const wallApproachPx = wall.maxX - wall.startX;
  harness.check(wall.guarded, 'against a wall: a guard went up');
  harness.check(
    wall.framesInWall === 0 && wallApproachPx < shoveLengthPx - SHOVE_SLACK_PX,
    `against a wall: the wall cut the ${shoveLengthPx} px shove short at ${wallApproachPx.toFixed(1)} px, ${wall.framesInWall} frames in the wall`,
  );

  const plainArena = makeArena(map, { x: SHOVE_TILE.x - 1, y: SHOVE_TILE.y }, FAR_CORNER);
  const plain = addCreature(plainArena, 'krasue', SHOVE_TILE, [], harness);
  const plainGuarded = withSeededRandom(GUARD_SEED, () =>
    hitUntilGuarded(plain, plainArena.human, UNGUARDED_PROBE_BLOWS),
  );
  plainArena.loop.dispose();
  harness.check(
    !plainGuarded,
    `control: without block, no guard in ${UNGUARDED_PROBE_BLOWS} blows`,
  );
}

/**
 * The shortest a locked telegraph may be, restated from P2 of
 * `docs/difficulty-fairness-rules.md` rather than imported, so the game cannot
 * lower the bar this gate holds it to.
 */
const FAIRNESS_MIN_TELEGRAPH_FRAMES = 21;
const RIPOSTE_GUARDS_WANTED = 8;
const RIPOSTE_RUN_FRAMES = 20000;

/** Frames from each guard to the krasue's next strike landing, for a krasue with `traits`. */
function measureKrasueGuardToStrike(
  map: GameMap,
  traits: readonly TacticsTrait[],
  harness: TacticsHarness,
): number[] {
  const arena = makeArena(map, RETREAT_HUMAN_TILE, FAR_CORNER);
  const krasue = addCreature(arena, 'krasue', RETREAT_MOB_TILE, traits, harness);
  const intervals: number[] = [];
  let guardFrame: number | null = null;
  takeAttackStarted(krasue);
  withSeededRandom(GUARD_SEED, () => {
    for (let frame = 0; frame < RIPOSTE_RUN_FRAMES; frame++) {
      if (intervals.length >= RIPOSTE_GUARDS_WANTED) break;
      // The player presses in after the shove, so nothing but the krasue's own
      // timing stands between a guard and its answer.
      arena.human.x = krasue.x - TILE_SIZE;
      arena.human.y = krasue.y;
      arena.loop.update(arena.ctx);
      if (!takeAttackStarted(krasue)) continue;
      if (guardFrame !== null) {
        intervals.push(frame - guardFrame);
        guardFrame = null;
      }
      // Struck back the moment a strike lands, so the whole of the krasue's
      // cooldown lies between the guard and its next strike unless a riposte cuts it.
      krasue.hp = krasue.maxHp;
      krasue.takeDamageFrom(PROBE_BLOW_DAMAGE, arena.human, 'melee');
      if (krasue.lastBlowWasGuarded) guardFrame = frame;
    }
  });
  arena.loop.dispose();
  return intervals;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function checkKrasueRiposte(map: GameMap, harness: TacticsHarness): void {
  harness.section('Krasue riposte: answers a guard sooner, never inside the fairness floor');
  const riposte = measureKrasueGuardToStrike(map, ['block', 'riposte'], harness);
  const plain = measureKrasueGuardToStrike(map, ['block'], harness);
  harness.check(
    riposte.length >= RIPOSTE_GUARDS_WANTED && plain.length >= RIPOSTE_GUARDS_WANTED,
    `guards measured: ${riposte.length} riposting, ${plain.length} plain (need ${RIPOSTE_GUARDS_WANTED})`,
  );
  const soonest = Math.min(...riposte);
  harness.check(
    soonest >= FAIRNESS_MIN_TELEGRAPH_FRAMES && soonest >= RIPOSTE_READY_FRAMES,
    `a riposte strikes ${soonest} frames after the guard at the soonest (fairness floor ${FAIRNESS_MIN_TELEGRAPH_FRAMES}, ready ${RIPOSTE_READY_FRAMES})`,
  );
  harness.check(
    mean(riposte) < mean(plain),
    `a riposte answers sooner than a plain guard: mean ${mean(riposte).toFixed(1)} vs ${mean(plain).toFixed(1)} frames`,
  );
}

// ── Run ────────────────────────────────────────────────────────────────────

/**
 * Every special-case section, run against the room `verify-tactics.ts` builds.
 *
 * On a random stream of its own, handed back untouched afterwards, so adding or
 * retuning a check here cannot shift the draws every later section sees.
 */
export function checkSpecialCaseTactics(map: GameMap, harness: TacticsHarness): void {
  withSeededRandom(SECTION_SEED, () => runSpecialCaseSections(map, harness));
}

function runSpecialCaseSections(map: GameMap, harness: TacticsHarness): void {
  checkEligibility(map, harness);
  for (const flankCase of FLANK_CASES) {
    harness.section(`Flank: a ${flankCase.type} pack fans out, and faces where it goes`);
    checkFlank(map, harness, flankCase);
  }
  for (const retreatCase of REGROUP_CASES) {
    harness.section(`Regroup: a wounded ${retreatCase.type} falls back on a friend once`);
    checkRegroup(map, harness, retreatCase);
  }
  checkLemurKite(map, harness);
  checkKrasueGuard(map, harness);
  checkKrasueRiposte(map, harness);
}
