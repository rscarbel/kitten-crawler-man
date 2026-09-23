/**
 * `verify:tactics` sections for the melee brawlers — the troglodyte, the ruins
 * ghoul, the two clowns, the rock golem, the skeleton warrior, the mantis crony
 * and the mold lion — plus the city elf cultist, a caster whose kite and
 * regroup share this group's wiring, and the creatures of the same families
 * that must learn nothing.
 *
 * Each check drives the real creature through the real mob loop on the room
 * `verify-tactics.ts` hands in, and measures a bearing, a distance, a speed or
 * a frame gap rather than counting hits. Every behaviour is run twice, once
 * with the trait and once without, so a behaviour that shows up either way is
 * not mistaken for the trait's doing.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants';
import type { GameMap } from '../../src/map/GameMap';
import type { DamageSource } from '../../src/Player';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { TACTICAL_RETREAT_MAX_SPEED, type Mob } from '../../src/creatures/Mob';
import { SkeletonLord } from '../../src/creatures/SkeletonLord';
import { SkeletonWarrior } from '../../src/creatures/SkeletonWarrior';
import {
  CITY_ELF_CULTIST_CAST_COOLDOWN_FRAMES,
  CityElfCultist,
} from '../../src/creatures/CityElfCultist';
import { Troglodyte } from '../../src/creatures/Troglodyte';
import { RuinsGhoul } from '../../src/creatures/RuinsGhoul';
import { StiltClown } from '../../src/creatures/StiltClown';
import { FatClown } from '../../src/creatures/FatClown';
import { RockGolem } from '../../src/creatures/RockGolem';
import { RockGolemBoss } from '../../src/creatures/RockGolemBoss';
import { MANTIS_SLASH_TOTAL_FRAMES, MantisCrony } from '../../src/creatures/MantisCrony';
import { MoldLion } from '../../src/creatures/MoldLion';
import { SWORD_SLASH_FRAMES } from '../../src/sprites/skeletonTiming';
import { createMob, MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles';
import type { Rng } from '../../src/sprites/person/rng';
import { mulberry32 } from '../../src/sprites/person/rng';
import {
  TACTICS_TRAITS,
  TRAIT_RAMPS,
  type TacticsTrait,
} from '../../src/creatures/tactics/tacticsTraits';
import { RIPOSTE_READY_FRAMES } from '../../src/creatures/tactics/riposte';
import {
  KITE_COOLDOWN_FRAMES,
  KITE_MAX_FRAMES,
  REGROUP_HP_FRACTION,
  REGROUP_MAX_FRAMES,
} from '../../src/creatures/tactics/retreat';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { chasedKitesRunOn, describeKiteLengths } from './chasedKites';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { SkeletonSummonSystem } from '../../src/systems/SkeletonSummonSystem';
import type { SystemContext } from '../../src/systems/GameSystem';

/** The pass/fail reporting `verify-tactics.ts` owns, so its failure count covers these too. */
export interface TacticsHarness {
  readonly check: (ok: boolean, message: string) => void;
  readonly section: (name: string) => void;
}

// ── The creatures ──────────────────────────────────────────────────────────

interface MeleeCase {
  /** Spawner key of the creature under test. */
  readonly type: string;
  /** Exactly the traits it must be able to learn. */
  readonly eligibility: readonly TacticsTrait[];
  /** How far its blow reaches, in tiles: a flanker inside this has arrived. */
  readonly reachTiles: number;
  /** Spawner key of the pack mate a regroup or kite falls back on. */
  readonly helperType: string;
  /**
   * A caster keeps facing its quarry while it falls back, so it can keep
   * casting; everything else turns to face where it walks.
   */
  readonly facesQuarryWhileRetreating?: boolean;
  /** Built through the spawner, so a mistyped key that falls back to a goblin is caught. */
  readonly isExpectedClass: (mob: Mob) => boolean;
  /**
   * One whole swing, windup through recovery, in frames: the least that can
   * separate two of its blows however its cooldown is cut. Absent where the
   * windup scales with level, so there is no one number to hold it to.
   */
  readonly swingFrames?: number;
}

const BRAWLER: readonly TacticsTrait[] = ['flank', 'block', 'regroup', 'riposte'];
const SKIRMISHER: readonly TacticsTrait[] = ['flank', 'block', 'kite', 'regroup', 'riposte'];
const CASTER: readonly TacticsTrait[] = ['kite', 'regroup'];

/** Reaches restated from each creature, so a retune of one shows up here as a slow arrival. */
const TROGLODYTE_REACH_TILES = 3;
const GHOUL_REACH_TILES = 1.2;
const STILT_CLOWN_REACH_TILES = 2.2;
const FAT_CLOWN_REACH_TILES = 1.2;
const ROCK_GOLEM_REACH_TILES = 1.5;
const SKELETON_WARRIOR_REACH_TILES = 1.15;
const MANTIS_REACH_TILES = 1.15;
const MOLD_LION_REACH_TILES = 1.3;
const CULTIST_CROWDING_TILES = 3;

/** Whole swings restated from each creature, so a riposte that shortens one shows up here. */
const GHOUL_SWING_FRAMES = 26;
const STILT_CLOWN_WINDUP_FRAMES = 32;
const STILT_CLOWN_LUNGE_FRAMES = 18;
const FAT_CLOWN_SWING_FRAMES = 30;
const MOLD_LION_SWING_FRAMES = 22;

const MELEE_CASES: readonly MeleeCase[] = [
  {
    type: 'troglodyte',
    isExpectedClass: (mob) => mob instanceof Troglodyte,
    eligibility: BRAWLER,
    reachTiles: TROGLODYTE_REACH_TILES,
    helperType: 'troglodyte',
  },
  {
    type: 'ruins_ghoul',
    isExpectedClass: (mob) => mob instanceof RuinsGhoul,
    swingFrames: GHOUL_SWING_FRAMES,
    eligibility: BRAWLER,
    reachTiles: GHOUL_REACH_TILES,
    helperType: 'ruins_ghoul',
  },
  {
    type: 'stilt_clown',
    isExpectedClass: (mob) => mob instanceof StiltClown,
    swingFrames: STILT_CLOWN_WINDUP_FRAMES + STILT_CLOWN_LUNGE_FRAMES,
    eligibility: BRAWLER,
    reachTiles: STILT_CLOWN_REACH_TILES,
    helperType: 'fat_clown',
  },
  // Falls back on a stilt clown: the troupe is one pack across both classes.
  {
    type: 'fat_clown',
    isExpectedClass: (mob) => mob instanceof FatClown,
    swingFrames: FAT_CLOWN_SWING_FRAMES,
    eligibility: BRAWLER,
    reachTiles: FAT_CLOWN_REACH_TILES,
    helperType: 'stilt_clown',
  },
  {
    type: 'rock_golem',
    isExpectedClass: (mob) => mob instanceof RockGolem && !(mob instanceof RockGolemBoss),
    eligibility: BRAWLER,
    reachTiles: ROCK_GOLEM_REACH_TILES,
    helperType: 'rock_golem',
  },
  {
    type: 'skeleton_sword',
    isExpectedClass: (mob) => mob instanceof SkeletonWarrior,
    swingFrames: SWORD_SLASH_FRAMES,
    eligibility: BRAWLER,
    reachTiles: SKELETON_WARRIOR_REACH_TILES,
    helperType: 'skeleton_sword',
  },
  {
    type: 'mantis',
    isExpectedClass: (mob) => mob instanceof MantisCrony,
    swingFrames: MANTIS_SLASH_TOTAL_FRAMES,
    eligibility: SKIRMISHER,
    reachTiles: MANTIS_REACH_TILES,
    helperType: 'mantis',
  },
  {
    type: 'mold_lion',
    isExpectedClass: (mob) => mob instanceof MoldLion,
    swingFrames: MOLD_LION_SWING_FRAMES,
    eligibility: BRAWLER,
    reachTiles: MOLD_LION_REACH_TILES,
    helperType: 'mold_lion',
  },
  {
    type: 'city_elf_cultist',
    isExpectedClass: (mob) => mob instanceof CityElfCultist,
    eligibility: CASTER,
    reachTiles: CULTIST_CROWDING_TILES,
    helperType: 'city_elf_cultist',
    facesQuarryWhileRetreating: true,
  },
];

/** Relatives of the brawlers above that are bosses or unique, and must learn nothing. */
const MUST_LEARN_NOTHING: readonly string[] = ['rock_golem_boss', 'terror_the_clown'];

/** A source that says yes to every roll, so "no trait" can only mean "not eligible". */
const ALWAYS_YES: Rng = () => 0;

/**
 * A source that answers yes to exactly `wanted`, draw by draw, in the order a
 * mob eligible for `eligibility` asks — which skips riposte unless block came up.
 */
function rollOnly(eligibility: readonly TacticsTrait[], wanted: readonly TacticsTrait[]): Rng {
  const draws: number[] = [];
  const rolled: TacticsTrait[] = [];
  for (const trait of TACTICS_TRAITS) {
    if (!eligibility.includes(trait)) continue;
    const prerequisite = TRAIT_RAMPS[trait].requires;
    if (prerequisite !== undefined && !rolled.includes(prerequisite)) continue;
    const yes = wanted.includes(trait);
    if (yes) rolled.push(trait);
    draws.push(yes ? 0 : 1);
  }
  let index = 0;
  return () => draws[index++] ?? 1;
}

/** The mob level a helper is spawned at: below every trait, so it only ever fights. */
const HELPER_LEVEL = 1;

// ── Arena ──────────────────────────────────────────────────────────────────

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

interface Arena {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly loop: MobUpdateLoop;
  readonly ctx: SystemContext;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** Frames on which a mob's own blow reached the human — landed, dodged or absorbed. */
  readonly blowFrames: number[];
  frame: number;
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
  const arena: Arena = {
    map,
    roster,
    loop: new MobUpdateLoop(),
    ctx,
    human,
    cat,
    blowFrames: [],
    frame: 0,
  };
  // Every mob blow in the game, touch or tongue or bolt, resolves through the
  // victim's `takeDamage` with a mob source, so this sees the moment of impact
  // itself rather than a sound cue some creatures raise at the windup.
  const takeDamage = human.takeDamage.bind(human);
  human.takeDamage = (amount: number, source?: DamageSource): boolean => {
    if (source?.kind === 'mob') arena.blowFrames.push(arena.frame);
    return takeDamage(amount, source);
  };
  return arena;
}

function step(arena: Arena): void {
  arena.loop.update(arena.ctx);
  arena.frame++;
}

/** Small against any levelled mob's health, so the blow only marks it as in the fight. */
const PROBE_BLOW_DAMAGE = 1;

/** Wound `mob` by `share` of its health from `crawler`, so it counts as in the fight. */
function bloody(mob: Mob, crawler: HumanPlayer, share: number): void {
  mob.takeDamageFrom(PROBE_BLOW_DAMAGE, crawler, 'explosion');
  mob.hp = Math.max(1, Math.round(mob.maxHp * (1 - share)));
}

/** A top-level `type` with exactly `wanted` of what its kind may learn, added to the arena. */
function addTrained(
  arena: Arena,
  meleeCase: MeleeCase,
  tile: TilePoint,
  wanted: readonly TacticsTrait[],
): Mob {
  const mob = createMob(meleeCase.type, tile.x, tile.y, arena.map);
  mob.applyMobLevel(MAX_MOB_LEVEL);
  mob.rollTactics(
    DIFFICULTY_PROFILES.normal.tacticsChanceScale,
    rollOnly(meleeCase.eligibility, wanted),
  );
  arena.roster.add(mob);
  return mob;
}

/**
 * A friend already in the fight when the first frame runs. Otherwise the
 * probe's first look for a friend comes before the friend's own first look at
 * the player, and the fall-back waits out a retry with the probe's first blow
 * already swung — so a probe that swings when it should fall back would never
 * be caught doing it.
 */
function addHelper(arena: Arena, type: string, tile: TilePoint): Mob {
  const helper = createMob(type, tile.x, tile.y, arena.map);
  helper.applyMobLevel(HELPER_LEVEL);
  arena.roster.add(helper);
  bloody(helper, arena.human, 0);
  helper.currentTarget = arena.human;
  return helper;
}

/** Put `mob` back where it was, re-filing it in the mob grid as a teleport must be. */
function pinInPlace(arena: Arena, mob: Mob, x: number, y: number): void {
  if (mob.x === x && mob.y === y) return;
  const movedX = mob.x;
  const movedY = mob.y;
  mob.x = x;
  mob.y = y;
  arena.roster.grid.move(mob, movedX, movedY);
}

function centreDistance(a: TilePoint, b: TilePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Agreement, −1 to 1, between where `mob` faces and the direction (dirX, dirY). */
function facingDot(mob: Mob, dirX: number, dirY: number): number {
  const facingLength = Math.hypot(mob.facingX, mob.facingY);
  const dirLength = Math.hypot(dirX, dirY);
  if (facingLength === 0 || dirLength === 0) return 1;
  return (mob.facingX * dirX + mob.facingY * dirY) / (facingLength * dirLength);
}

/**
 * Agreement between where `mob` faces and the way to `target`. For a caster,
 * whose art only turns left and right, just the horizontal half is compared.
 */
function facingTowardDot(mob: Mob, target: TilePoint, horizontalOnly: boolean): number {
  const dx = target.x - mob.x;
  const dy = horizontalOnly ? 0 : target.y - mob.y;
  if (horizontalOnly) return dx === 0 ? 1 : Math.sign(dx) * Math.sign(mob.facingX);
  return facingDot(mob, dx, dy);
}

// ── Roll: who may learn what ───────────────────────────────────────────────

/** The highest mob level that must behave exactly as the untuned early game. */
const EARLY_GAME_TOP_MOB_LEVEL = 4;

function checkEligibility(map: GameMap, harness: TacticsHarness): void {
  const { check } = harness;
  harness.section('Melee roll: each brawler learns exactly its set, and only from level 5');
  for (const meleeCase of MELEE_CASES) {
    const top = createMob(meleeCase.type, 1, 1, map);
    check(
      meleeCase.isExpectedClass(top),
      `${meleeCase.type} builds the creature it names (got ${top.constructor.name})`,
    );
    top.applyMobLevel(MAX_MOB_LEVEL);
    top.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
    const expected = TACTICS_TRAITS.filter((trait) => meleeCase.eligibility.includes(trait));
    check(
      top.tactics.traits.join() === expected.join(),
      `${meleeCase.type} at the top level learns ${top.tactics.traits.join(',') || 'nothing'} (want ${expected.join(',')})`,
    );
    const early = createMob(meleeCase.type, 1, 1, map);
    early.applyMobLevel(EARLY_GAME_TOP_MOB_LEVEL);
    early.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
    check(
      !early.tactics.hasAnyTrait,
      `${meleeCase.type} at level ${EARLY_GAME_TOP_MOB_LEVEL} learns ${early.tactics.traits.join(',') || 'nothing'}`,
    );
  }
  for (const type of MUST_LEARN_NOTHING) {
    const mob = createMob(type, 1, 1, map);
    mob.applyMobLevel(MAX_MOB_LEVEL);
    mob.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
    check(
      !mob.tactics.hasAnyTrait,
      `${type} at the top level learns ${mob.tactics.traits.join(',') || 'nothing'}`,
    );
  }
}

// ── Summons learn nothing ──────────────────────────────────────────────────

/** Where the lord and the player stand for the summon probe, in tiles. */
const SUMMON_LORD_TILE = { x: 12, y: 12 };
const SUMMON_HUMAN_TILE = { x: 16, y: 12 };
const SUMMON_CAT_TILE = { x: 1, y: 1 };
/** Long enough for the lord's opening summon cooldown and its cast to play out. */
const SUMMON_RUN_FRAMES = 1500;

/**
 * Drives a real Skeleton Lord through the real summon system, with every roll
 * answering yes while the system places his summons: a summoned warrior that
 * learned anything would learn everything.
 */
function checkSummonsLearnNothing(map: GameMap, harness: TacticsHarness): void {
  const { check } = harness;
  harness.section('Melee roll: a skeleton warrior raised mid-fight learns nothing');
  const arena = makeArena(map, SUMMON_HUMAN_TILE, SUMMON_CAT_TILE);
  const lord = new SkeletonLord(SUMMON_LORD_TILE.x, SUMMON_LORD_TILE.y, TILE_SIZE);
  lord.applyMobLevel(MAX_MOB_LEVEL);
  arena.roster.add(lord);
  const summons = new SkeletonSummonSystem(map, (mob) => arena.roster.add(mob));
  const savedRandom = Math.random;
  for (let frame = 0; frame < SUMMON_RUN_FRAMES; frame++) {
    step(arena);
    Math.random = ALWAYS_YES;
    try {
      summons.update(arena.ctx);
    } finally {
      Math.random = savedRandom;
    }
    if (arena.roster.mobs.some((mob) => mob instanceof SkeletonWarrior)) break;
  }
  arena.loop.dispose();
  const raised = arena.roster.mobs.filter((mob) => mob instanceof SkeletonWarrior);
  check(raised.length > 0, `the lord raised ${raised.length} warriors`);
  check(
    raised.every((mob) => mob.mobLevel === MAX_MOB_LEVEL),
    `the raised warriors are at the lord's level (${raised.map((mob) => mob.mobLevel).join(',')})`,
  );
  const learned = raised.filter((mob) => mob.tactics.hasAnyTrait);
  check(
    learned.length === 0,
    `no raised warrior learned a trait (${learned.map((mob) => mob.tactics.traits.join(',')).join('; ') || 'none did'})`,
  );
}

// ── Flank ──────────────────────────────────────────────────────────────────

const ROW = 12;
const FLANK_HUMAN_TILE = { x: 14, y: ROW };
/** Tiles west of the player the pack starts: inside every brawler's notice range. */
const FLANK_PACK_GAP_TILES = 5;
const FLANK_PACK_ROW_OFFSETS = [-1, 0, 1];
const FAR_CORNER = { x: 1, y: 1 };
/** Long enough for the slowest brawler, a golem stopping to throw, to close in. */
const FLANK_RUN_FRAMES = 900;
/** Beyond its reach by this much, a brawler has not yet arrived. */
const FLANK_ARRIVAL_SLACK_TILES = 0.25;
/** Arrival bearings at least this far apart mean the pack came from more than one side. */
const FLANK_DISTINCT_DEGREES = 40;
/** How much wider a flanking pack's arrival must fan than the same pack's without the trait. */
const FLANK_SPREAD_MARGIN_DEGREES = 20;
const DEGREES_PER_HALF_TURN = 180;
/** Pixels a frame must move for its direction to count as a walking direction. */
const WALKING_STEP_PX = 0.25;
/**
 * The least a walking mob's facing may agree with its step: within 45°. Not
 * tighter, because a packmate's separation shove adds a sideways nudge to some
 * steps; a mob still facing the way it walked a turn ago reads well below it.
 */
const WALK_FACING_MIN_DOT = Math.SQRT1_2;
/** The least a mob standing in reach may agree with the way to its quarry: within 60°. */
const QUARRY_FACING_MIN_DOT = 0.5;

interface FlankTrace {
  /** Bearing from the target to each mob as it first arrives, in radians; NaN if never. */
  readonly arrivalBearings: readonly number[];
  /** Frames any pack member walked while a flank steered it. */
  readonly flankFrames: number;
  readonly worstFlankWalkFacingDot: number;
  /** How each mob faces its quarry at the end of the run, standing in reach. */
  readonly worstEndFacingDot: number;
}

function traceFlank(arena: Arena, pack: readonly Mob[], arrivalPx: number): FlankTrace {
  const arrivalBearings = pack.map(() => Number.NaN);
  let flankFrames = 0;
  let worstFlankWalkFacingDot = 1;
  for (let frame = 0; frame < FLANK_RUN_FRAMES; frame++) {
    const before = pack.map((mob) => ({ x: mob.x, y: mob.y }));
    step(arena);
    pack.forEach((mob, index) => {
      const stepX = mob.x - before[index].x;
      const stepY = mob.y - before[index].y;
      if (mob.tactics.lastMove === 'flank' && Math.hypot(stepX, stepY) >= WALKING_STEP_PX) {
        flankFrames++;
        worstFlankWalkFacingDot = Math.min(worstFlankWalkFacingDot, facingDot(mob, stepX, stepY));
      }
      if (!Number.isNaN(arrivalBearings[index])) return;
      if (centreDistance(mob, arena.human) <= arrivalPx) {
        arrivalBearings[index] = Math.atan2(mob.y - arena.human.y, mob.x - arena.human.x);
      }
    });
  }
  arena.loop.dispose();
  const worstEndFacingDot = Math.min(
    ...pack.map((mob) => facingTowardDot(mob, arena.human, false)),
  );
  return { arrivalBearings, flankFrames, worstFlankWalkFacingDot, worstEndFacingDot };
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

function runFlankPack(
  map: GameMap,
  meleeCase: MeleeCase,
  wanted: readonly TacticsTrait[],
): FlankTrace {
  const arena = makeArena(map, FLANK_HUMAN_TILE, FAR_CORNER);
  const pack = FLANK_PACK_ROW_OFFSETS.map((offset) =>
    addTrained(
      arena,
      meleeCase,
      { x: FLANK_HUMAN_TILE.x - FLANK_PACK_GAP_TILES, y: ROW + offset },
      wanted,
    ),
  );
  const arrivalPx = (meleeCase.reachTiles + FLANK_ARRIVAL_SLACK_TILES) * TILE_SIZE;
  return traceFlank(arena, pack, arrivalPx);
}

function checkFlank(map: GameMap, harness: TacticsHarness, meleeCase: MeleeCase): void {
  const { check } = harness;
  const flanking = runFlankPack(map, meleeCase, ['flank']);
  const arrived = flanking.arrivalBearings.filter((bearing) => !Number.isNaN(bearing));
  const spread = widestBearingSpreadDegrees(arrived);
  check(
    arrived.length === FLANK_PACK_ROW_OFFSETS.length,
    `${meleeCase.type} flank: ${arrived.length}/${FLANK_PACK_ROW_OFFSETS.length} arrived`,
  );
  check(
    spread >= FLANK_DISTINCT_DEGREES,
    `${meleeCase.type} flank: arrival bearings span ${spread.toFixed(1)}° (need ${FLANK_DISTINCT_DEGREES}°)`,
  );
  check(
    flanking.flankFrames > 0 && flanking.worstFlankWalkFacingDot >= WALK_FACING_MIN_DOT,
    `${meleeCase.type} flank: faces its walk on all ${flanking.flankFrames} flank frames (worst ${flanking.worstFlankWalkFacingDot.toFixed(2)})`,
  );
  check(
    flanking.worstEndFacingDot >= QUARRY_FACING_MIN_DOT,
    `${meleeCase.type} flank: arrived, every one faces the player (worst ${flanking.worstEndFacingDot.toFixed(2)})`,
  );

  const plain = runFlankPack(map, meleeCase, []);
  const plainSpread = widestBearingSpreadDegrees(
    plain.arrivalBearings.filter((bearing) => !Number.isNaN(bearing)),
  );
  check(
    plain.flankFrames === 0 && spread >= plainSpread + FLANK_SPREAD_MARGIN_DEGREES,
    `${meleeCase.type} control: without flank, ${plain.flankFrames} flank frames and arrivals within ${plainSpread.toFixed(1)}° — ${(spread - plainSpread).toFixed(1)}° narrower (need ${FLANK_SPREAD_MARGIN_DEGREES}°)`,
  );
}

// ── Regroup and kite: the fall-backs ───────────────────────────────────────

/** Share of its health a regroup probe is wounded by, below the regroup line. */
const REGROUP_PROBE_WOUND_SHARE = 0.7;
const RETREAT_RUN_FRAMES = 900;
/** Pixels a regroup may bring a caster nearer the player: a separation nudge, no more. */
const REGROUP_APPROACH_SLACK_PX = 2;
/** Frames after a retreat ends in which the mob must have turned back to its quarry. */
const FACING_SETTLE_FRAMES = 2;
/** Rounding room on a per-frame step measured against a speed. */
const STEP_EPSILON_PX = 1e-6;

const RETREAT_HUMAN_TILE = { x: 6, y: ROW };
/** The probe, one tile east of the player: in reach of all of them. */
const RETREAT_PROBE_TILE = { x: 7, y: ROW };
/**
 * The friend, straight north of the probe and off the player's line, so the
 * walk to it never passes the player — a friend on the player's far side is
 * one no regroup may walk to — and four tiles off, beyond every friend's
 * reach, so any blow that lands on the player is the probe's own.
 */
const REGROUP_HELPER_ROWS_NORTH = 4;
const REGROUP_HELPER_TILE = { x: RETREAT_PROBE_TILE.x, y: ROW - REGROUP_HELPER_ROWS_NORTH };

interface RetreatTrace {
  readonly starts: number;
  readonly longestFrames: number;
  readonly shortestGapBetween: number;
  readonly endReasons: readonly string[];
  /** The quickest any one retreat covered ground: its walked pixels over its frames. */
  readonly fastestAverageSpeed: number;
  readonly walkFrames: number;
  /** Blows from the probe that reached the player while it was falling back. */
  readonly blowsWhileRetreating: number;
  readonly worstWalkFacingDot: number;
  readonly worstSettledFacingDot: number;
  readonly hpRose: boolean;
  /** Blows that reached the player from the probe after its first retreat ended. */
  readonly blowsAfterRetreat: number;
  readonly blows: number;
  /** Change in the probe's distance to its friend across each retreat, in pixels. */
  readonly helperGapChangesPx: readonly number[];
  /** The most any retreat brought the probe nearer the player than it started, in pixels. */
  readonly deepestPlayerApproachPx: number;
  /** Frames each finished retreat ran. */
  readonly retreatLengths: readonly number[];
  readonly widestChaseGapGrowthPx: number;
  /** The longest the probe kept walking away from the player, a retreat and whatever followed it. */
  readonly longestFleeFrames: number;
  /** Projectiles the probe released, and the longest stretch it went without one. */
  readonly shots: number;
  readonly shotsAfterRetreat: number;
  readonly shotsWhileRetreating: number;
  readonly longestShotGapFrames: number;
}

interface RetreatOptions {
  readonly behaviour: 'kite' | 'regroup';
  readonly helper: Mob | null;
  /** Hold the friend where it stands, so the walk toward it is the probe's own. */
  readonly pinHelper: boolean;
  /** Walk the player straight at the probe, at player speed, while it retreats. */
  readonly chase: boolean;
  readonly horizontalFacing: boolean;
  /**
   * Frames after each retreat ends before the probe is put back where it
   * started. A caster's kite leaves it at range, where no second kite is ever
   * wanted; put back in the player's face, it must still wait out its cooldown.
   */
  readonly returnAfterFrames?: number;
}

/** Whether `mob` let a projectile go since the last call, clearing it for the next. */
function takeShotReleased(mob: Mob): boolean {
  const released = mob.projectileSoundPending;
  mob.projectileSoundPending = false;
  return released;
}

function traceRetreat(arena: Arena, probe: Mob, options: RetreatOptions): RetreatTrace {
  const { behaviour, helper } = options;
  const helperX = helper?.x ?? 0;
  const helperY = helper?.y ?? 0;
  let starts = 0;
  let run = 0;
  let longestFrames = 0;
  let lastEnd = Number.NEGATIVE_INFINITY;
  let shortestGapBetween = Number.POSITIVE_INFINITY;
  const endReasons: string[] = [];
  let fastestAverageSpeed = 0;
  let walkedThisRun = 0;
  let walkFrames = 0;
  let worstWalkFacingDot = 1;
  let worstSettledFacingDot = 1;
  let blowsWhileRetreating = 0;
  let settleCountdown = 0;
  let settledThisEnd = false;
  let hpRose = false;
  let previousHp = probe.hp;
  let helperGapAtStart = 0;
  const helperGapChangesPx: number[] = [];
  let chaseStartGap = 0;
  let widestChaseGapGrowthPx = 0;
  let deepestPlayerApproachPx = 0;
  const retreatLengths: number[] = [];
  let firstEndFrame: number | null = null;
  const blowsBefore = arena.blowFrames.length;
  const humanX = arena.human.x;
  const humanY = arena.human.y;
  let shots = 0;
  let shotsAfterRetreat = 0;
  let shotsWhileRetreating = 0;
  let lastShotFrame: number | null = null;
  let longestShotGapFrames = 0;
  takeShotReleased(probe);
  let fleeRun = 0;
  let longestFleeFrames = 0;
  let was = false;
  const probeStartX = probe.x;
  const probeStartY = probe.y;
  for (let frame = 0; frame < RETREAT_RUN_FRAMES; frame++) {
    const returnAfter = options.returnAfterFrames;
    if (returnAfter !== undefined && frame === lastEnd + returnAfter) {
      pinInPlace(arena, probe, probeStartX, probeStartY);
    }
    if (options.chase && fleeRun > 0) {
      const dx = probe.x - arena.human.x;
      const dy = probe.y - arena.human.y;
      const gap = Math.hypot(dx, dy);
      if (gap > 0) {
        const chaseStep = Math.min(PLAYER_SPEED, gap);
        arena.human.x += (dx / gap) * chaseStep;
        arena.human.y += (dy / gap) * chaseStep;
      }
    }
    // Held where it stands unless it is chasing: a probe walking round it
    // would otherwise shove it into a friend's reach.
    if (!options.chase) {
      arena.human.x = humanX;
      arena.human.y = humanY;
    }
    const beforeX = probe.x;
    const beforeY = probe.y;
    const blowsBeforeFrame = arena.blowFrames.length;
    step(arena);
    const blowsThisFrame = arena.blowFrames.length - blowsBeforeFrame;
    if (helper !== null && options.pinHelper) pinInPlace(arena, helper, helperX, helperY);
    const stepX = probe.x - beforeX;
    const stepY = probe.y - beforeY;
    const stepPx = Math.hypot(stepX, stepY);
    const retreating = probe.tactics.activeRetreat === behaviour;
    // A fall-back runs on for as long as the probe keeps walking away from the
    // player after it — whatever is walking it, the tactic or its own AI.
    const awayX = probe.x - arena.human.x;
    const awayY = probe.y - arena.human.y;
    const walkedAway = stepPx >= WALKING_STEP_PX && stepX * awayX + stepY * awayY > 0;
    fleeRun = retreating || (fleeRun > 0 && walkedAway) ? fleeRun + 1 : 0;
    longestFleeFrames = Math.max(longestFleeFrames, fleeRun);
    if (takeShotReleased(probe)) {
      shots++;
      if (firstEndFrame !== null) shotsAfterRetreat++;
      if (retreating) shotsWhileRetreating++;
      if (lastShotFrame !== null) {
        longestShotGapFrames = Math.max(longestShotGapFrames, frame - lastShotFrame);
      }
      lastShotFrame = frame;
    }
    if (probe.hp > previousHp) hpRose = true;
    previousHp = probe.hp;

    if (retreating && !was) {
      starts++;
      run = 0;
      walkedThisRun = 0;
      if (Number.isFinite(lastEnd))
        shortestGapBetween = Math.min(shortestGapBetween, frame - lastEnd);
      if (helper !== null) helperGapAtStart = centreDistance(probe, helper);
      chaseStartGap = centreDistance(probe, arena.human);
    }
    if (retreating) {
      run++;
      longestFrames = Math.max(longestFrames, run);
      walkedThisRun += stepPx;
      fastestAverageSpeed = Math.max(fastestAverageSpeed, walkedThisRun / run);
      if (stepPx >= WALKING_STEP_PX) {
        walkFrames++;
        const dot = options.horizontalFacing
          ? facingTowardDot(probe, arena.human, true)
          : facingDot(probe, stepX, stepY);
        worstWalkFacingDot = Math.min(worstWalkFacingDot, dot);
      }
      blowsWhileRetreating += blowsThisFrame;
    }
    if (retreating && !options.chase) {
      const approach = chaseStartGap - centreDistance(probe, arena.human);
      deepestPlayerApproachPx = Math.max(deepestPlayerApproachPx, approach);
    }
    if (options.chase && fleeRun > 0) {
      const growth = centreDistance(probe, arena.human) - chaseStartGap;
      widestChaseGapGrowthPx = Math.max(widestChaseGapGrowthPx, growth);
    }
    if (was && !retreating) {
      lastEnd = frame;
      firstEndFrame ??= frame;
      endReasons.push(probe.tactics.lastRetreatEnd ?? 'unknown');
      retreatLengths.push(run);
      if (helper !== null)
        helperGapChangesPx.push(centreDistance(probe, helper) - helperGapAtStart);
      settleCountdown = FACING_SETTLE_FRAMES;
      settledThisEnd = false;
    }
    if (settleCountdown > 0 && !retreating) {
      settleCountdown--;
      const dot = facingTowardDot(probe, arena.human, options.horizontalFacing);
      if (dot >= QUARRY_FACING_MIN_DOT) settledThisEnd = true;
      if (settleCountdown === 0 && !settledThisEnd) {
        worstSettledFacingDot = Math.min(worstSettledFacingDot, dot);
      }
    }
    was = retreating;
  }
  arena.loop.dispose();
  const probeBlows = arena.blowFrames.slice(blowsBefore);
  const endedAt = firstEndFrame;
  const blowsAfterRetreat =
    endedAt === null ? 0 : probeBlows.filter((frame) => frame > endedAt).length;
  return {
    starts,
    longestFrames,
    shortestGapBetween,
    endReasons,
    fastestAverageSpeed,
    walkFrames,
    worstWalkFacingDot,
    worstSettledFacingDot,
    blowsWhileRetreating,
    hpRose,
    blowsAfterRetreat,
    blows: probeBlows.length,
    helperGapChangesPx,
    deepestPlayerApproachPx,
    retreatLengths,
    widestChaseGapGrowthPx,
    longestFleeFrames,
    shots,
    shotsAfterRetreat,
    shotsWhileRetreating,
    longestShotGapFrames,
  };
}

/**
 * A brawler falling back swings at nobody: the point of breaking off is that
 * it is not fighting. A caster falls back casting, which its own check covers.
 */
function checkHoldsFire(
  harness: TacticsHarness,
  meleeCase: MeleeCase,
  behaviour: 'kite' | 'regroup',
  trace: RetreatTrace,
): void {
  if (meleeCase.facesQuarryWhileRetreating === true) return;
  harness.check(
    trace.blowsWhileRetreating === 0,
    `${meleeCase.type} ${behaviour}: strikes ${trace.blowsWhileRetreating} blows while falling back`,
  );
}

function regroupArena(
  map: GameMap,
  meleeCase: MeleeCase,
  wanted: readonly TacticsTrait[],
  withHelper: boolean,
): { arena: Arena; probe: Mob; helper: Mob | null } {
  // The cat waits in a corner: anywhere near the friend, it would be the
  // nearer quarry the moment the probe arrived there.
  const arena = makeArena(map, RETREAT_HUMAN_TILE, FAR_CORNER);
  const probe = addTrained(arena, meleeCase, RETREAT_PROBE_TILE, wanted);
  bloody(probe, arena.human, REGROUP_PROBE_WOUND_SHARE);
  const helper = withHelper ? addHelper(arena, meleeCase.helperType, REGROUP_HELPER_TILE) : null;
  return { arena, probe, helper };
}

function checkRegroup(map: GameMap, harness: TacticsHarness, meleeCase: MeleeCase): void {
  const { check } = harness;
  const horizontalFacing = meleeCase.facesQuarryWhileRetreating === true;
  const trained = regroupArena(map, meleeCase, ['regroup'], true);
  check(
    trained.probe.hp / trained.probe.maxHp <= REGROUP_HP_FRACTION,
    `${meleeCase.type} regroup: the probe is wounded below the line (${trained.probe.hp}/${trained.probe.maxHp})`,
  );
  const trace = traceRetreat(trained.arena, trained.probe, {
    behaviour: 'regroup',
    helper: trained.helper,
    pinHelper: true,
    chase: false,
    horizontalFacing,
  });
  check(trace.starts === 1, `${meleeCase.type} regroup: ${trace.starts} regroups in one life`);
  check(
    trace.longestFrames <= REGROUP_MAX_FRAMES,
    `${meleeCase.type} regroup: longest ${trace.longestFrames} frames (cap ${REGROUP_MAX_FRAMES})`,
  );
  if (horizontalFacing) {
    // A caster regroups behind its friend rather than up to it, so what it
    // must not do is close on the player.
    check(
      trace.starts > 0 && trace.deepestPlayerApproachPx <= REGROUP_APPROACH_SLACK_PX,
      `${meleeCase.type} regroup: ends no nearer the player — came ${trace.deepestPlayerApproachPx.toFixed(1)} px nearer at worst (slack ${REGROUP_APPROACH_SLACK_PX}; ended ${trace.endReasons.join(',') || 'never'})`,
    );
  } else {
    const closedOn = trace.helperGapChangesPx.every((change) => change < 0);
    check(
      closedOn && trace.helperGapChangesPx.length > 0,
      `${meleeCase.type} regroup: walks to its friend (gap change ${trace.helperGapChangesPx.map((change) => change.toFixed(0)).join(',') || 'none'} px; ended ${trace.endReasons.join(',') || 'never'})`,
    );
  }
  check(!trace.hpRose, `${meleeCase.type} regroup: never heals`);
  check(
    trace.walkFrames > 0 && trace.worstWalkFacingDot >= WALK_FACING_MIN_DOT,
    `${meleeCase.type} regroup: faces ${horizontalFacing ? 'its quarry' : 'its walk'} on all ${trace.walkFrames} walking frames (worst ${trace.worstWalkFacingDot.toFixed(2)})`,
  );
  checkHoldsFire(harness, meleeCase, 'regroup', trace);
  check(
    trace.worstSettledFacingDot >= QUARRY_FACING_MIN_DOT,
    `${meleeCase.type} regroup: turns back to the player within ${FACING_SETTLE_FRAMES} frames of ending (worst ${trace.worstSettledFacingDot.toFixed(2)})`,
  );
  // A caster's friend casts at the player too, so its own bolts are counted
  // as they leave its hand rather than as they land.
  const actsAfterRegroup = horizontalFacing ? trace.shotsAfterRetreat : trace.blowsAfterRetreat;
  check(
    actsAfterRegroup > 0,
    `${meleeCase.type} regroup: fights again afterwards (${actsAfterRegroup} ${horizontalFacing ? 'bolts cast' : 'blows reached the player'})`,
  );

  const untrained = regroupArena(map, meleeCase, [], true);
  const untrainedTrace = traceRetreat(untrained.arena, untrained.probe, {
    behaviour: 'regroup',
    helper: untrained.helper,
    pinHelper: true,
    chase: false,
    horizontalFacing,
  });
  check(
    untrainedTrace.starts === 0,
    `${meleeCase.type} control: without regroup, ${untrainedTrace.starts} regroups`,
  );

  const lone = regroupArena(map, meleeCase, ['regroup'], false);
  const loneTrace = traceRetreat(lone.arena, lone.probe, {
    behaviour: 'regroup',
    helper: null,
    pinHelper: false,
    chase: false,
    horizontalFacing,
  });
  check(
    loneTrace.starts === 0 && (horizontalFacing ? loneTrace.shots : loneTrace.blows) > 0,
    `${meleeCase.type} alone: ${loneTrace.starts} regroups, fights on (${horizontalFacing ? `${loneTrace.shots} bolts` : `${loneTrace.blows} blows`})`,
  );
}

/**
 * The melee kite layout: the friend further east, held where it stands, so
 * the kiter backs away from the player and toward the friend along one row.
 * The cat waits in a corner: anywhere near the kite's path, it would be the
 * nearer quarry the moment the kiter backed toward it.
 */
const MELEE_KITE_HELPER_TILE = { x: 12, y: ROW };
/**
 * The caster's layout: crowded two tiles from the player, with the friend
 * straight south of it rather than behind it — so a kite, which falls back
 * behind the friend, closes on it, where the old straight backpedal would open
 * the gap, and never has to step toward the player to get there.
 */
const CASTER_KITE_PROBE_TILE = { x: 8, y: ROW };
const CASTER_KITE_HELPER_ROWS_SOUTH = 4;
const CASTER_KITE_HELPER_TILE = {
  x: CASTER_KITE_PROBE_TILE.x,
  y: ROW + CASTER_KITE_HELPER_ROWS_SOUTH,
};
/**
 * Frames after a caster's kite before it is put back in the player's face:
 * well inside the cooldown, so a restart there would be one the cooldown
 * should have refused.
 */
const CASTER_RETURN_AFTER_FRAMES = 60;
/** A kite that fell back behind the friend closed on it by at least this much. */
const CASTER_KITE_MIN_CLOSING_TILES = 1;
/**
 * How much the gap to a chasing player may open while a kiter retreats: the
 * separation shove that keeps the two a tile apart can hand the kiter a few
 * pixels on a frame the player's own step does not cancel.
 */
const CHASE_GAP_SLACK_TILES = 0.25;
/**
 * Frames a kiter may keep walking away once its kite has ended: the frame the
 * end is noticed on, and one of momentum.
 */
const FLEE_CHAIN_SLACK_FRAMES = 2;
/** Kites started over one run can be no more than one per cooldown, plus the first. */
const MAX_KITES_PER_RUN = Math.floor(RETREAT_RUN_FRAMES / KITE_COOLDOWN_FRAMES) + 1;

function kiteArena(
  map: GameMap,
  meleeCase: MeleeCase,
  wanted: readonly TacticsTrait[],
  withHelper: boolean,
): { arena: Arena; probe: Mob; helper: Mob | null } {
  const isCaster = meleeCase.facesQuarryWhileRetreating === true;
  const probeTile = isCaster ? CASTER_KITE_PROBE_TILE : RETREAT_PROBE_TILE;
  const helperTile = isCaster ? CASTER_KITE_HELPER_TILE : MELEE_KITE_HELPER_TILE;
  const arena = makeArena(map, RETREAT_HUMAN_TILE, FAR_CORNER);
  const probe = addTrained(arena, meleeCase, probeTile, wanted);
  bloody(probe, arena.human, 0);
  const helper = withHelper ? addHelper(arena, meleeCase.helperType, helperTile) : null;
  return { arena, probe, helper };
}

function checkKite(map: GameMap, harness: TacticsHarness, meleeCase: MeleeCase): void {
  const { check } = harness;
  const isCaster = meleeCase.facesQuarryWhileRetreating === true;
  // A caster's friend holds its ground on its own, casting from its band; held
  // in place by the test instead, it could not give way to the kiter falling
  // back behind it, and the shove it handed back would read as the kiter's pace.
  const options = (helper: Mob | null, chase: boolean): RetreatOptions => ({
    behaviour: 'kite',
    helper,
    pinHelper: !isCaster,
    chase,
    horizontalFacing: isCaster,
  });

  const trained = kiteArena(map, meleeCase, ['kite'], true);
  const trace = traceRetreat(trained.arena, trained.probe, {
    ...options(trained.helper, false),
    returnAfterFrames: isCaster ? CASTER_RETURN_AFTER_FRAMES : undefined,
  });
  check(
    trace.starts > 0 && trace.starts <= MAX_KITES_PER_RUN,
    `${meleeCase.type} kite: ${trace.starts} kites with a friend (1-${MAX_KITES_PER_RUN})`,
  );
  check(
    trace.longestFrames <= KITE_MAX_FRAMES,
    `${meleeCase.type} kite: longest ${trace.longestFrames} frames (cap ${KITE_MAX_FRAMES})`,
  );
  check(
    trace.starts >= 2 && trace.shortestGapBetween >= KITE_COOLDOWN_FRAMES,
    `${meleeCase.type} kite: never restarts inside its cooldown (shortest gap ${trace.shortestGapBetween}, cooldown ${KITE_COOLDOWN_FRAMES})`,
  );
  // Averaged over each kite rather than read per frame: a friend's separation
  // shove can add a pixel to one step, but only the kiter's own pace sustains.
  check(
    trace.fastestAverageSpeed <= TACTICAL_RETREAT_MAX_SPEED + STEP_EPSILON_PX,
    `${meleeCase.type} kite: fastest kite averaged ${trace.fastestAverageSpeed.toFixed(2)} px/frame (retreat cap ${TACTICAL_RETREAT_MAX_SPEED.toFixed(2)}; its own walk ${trained.probe.moveSpeed.toFixed(2)})`,
  );
  check(
    trace.walkFrames > 0 && trace.worstWalkFacingDot >= WALK_FACING_MIN_DOT,
    `${meleeCase.type} kite: faces ${isCaster ? 'its quarry' : 'its walk'} on all ${trace.walkFrames} walking frames (worst ${trace.worstWalkFacingDot.toFixed(2)})`,
  );
  checkHoldsFire(harness, meleeCase, 'kite', trace);
  check(
    trace.worstSettledFacingDot >= QUARRY_FACING_MIN_DOT,
    `${meleeCase.type} kite: turns back to the player within ${FACING_SETTLE_FRAMES} frames of ending (worst ${trace.worstSettledFacingDot.toFixed(2)})`,
  );
  if (isCaster) {
    const closing = Math.min(...trace.helperGapChangesPx);
    check(
      trace.helperGapChangesPx.length > 0 && closing <= -CASTER_KITE_MIN_CLOSING_TILES * TILE_SIZE,
      `${meleeCase.type} kite: falls back behind its friend, not straight away (closed ${(-closing / TILE_SIZE).toFixed(2)} tiles, need ${CASTER_KITE_MIN_CLOSING_TILES})`,
    );
    check(
      trace.shotsWhileRetreating > 0 &&
        trace.longestShotGapFrames <= CITY_ELF_CULTIST_CAST_COOLDOWN_FRAMES,
      `${meleeCase.type} kite: keeps casting through it — ${trace.shotsWhileRetreating} of ${trace.shots} bolts cast mid-kite, longest silence ${trace.longestShotGapFrames} frames (its cadence ${CITY_ELF_CULTIST_CAST_COOLDOWN_FRAMES})`,
    );
  }

  const chased = kiteArena(map, meleeCase, ['kite'], true);
  const chaseTrace = traceRetreat(chased.arena, chased.probe, options(chased.helper, true));
  checkHoldsFire(harness, meleeCase, 'kite', chaseTrace);
  const chasedRunOn = chasedKitesRunOn(chaseTrace.retreatLengths, trace.retreatLengths);
  check(
    chasedRunOn,
    `${meleeCase.type} kite: a player following it does not end it — ${describeKiteLengths(chaseTrace.retreatLengths, trace.retreatLengths)}`,
  );
  check(
    chasedRunOn && chaseTrace.longestFleeFrames <= KITE_MAX_FRAMES + FLEE_CHAIN_SLACK_FRAMES,
    `${meleeCase.type} kite: a chased kite ends the falling back — longest run of walking away ${chaseTrace.longestFleeFrames} frames (kite cap ${KITE_MAX_FRAMES} + ${FLEE_CHAIN_SLACK_FRAMES})`,
  );
  const chaseSlackPx = CHASE_GAP_SLACK_TILES * TILE_SIZE;
  check(
    chasedRunOn && chaseTrace.widestChaseGapGrowthPx <= chaseSlackPx,
    `${meleeCase.type} kite: catchable — the gap to a chasing player opened ${chaseTrace.widestChaseGapGrowthPx.toFixed(1)} px over ${chaseTrace.starts} kites (slack ${chaseSlackPx})`,
  );

  const untrained = kiteArena(map, meleeCase, [], true);
  const untrainedTrace = traceRetreat(
    untrained.arena,
    untrained.probe,
    options(untrained.helper, false),
  );
  check(
    untrainedTrace.starts === 0,
    `${meleeCase.type} control: without kite, ${untrainedTrace.starts} kites`,
  );
  const lone = kiteArena(map, meleeCase, ['kite'], false);
  const loneTrace = traceRetreat(lone.arena, lone.probe, options(null, false));
  check(loneTrace.starts === 0, `${meleeCase.type} alone: ${loneTrace.starts} kites`);
}

// ── Riposte ────────────────────────────────────────────────────────────────

/**
 * The shortest a locked telegraph may be, restated from P2 of
 * `docs/difficulty-fairness-rules.md` rather than imported, so the game cannot
 * lower the bar this gate holds it to.
 */
const FAIRNESS_MIN_TELEGRAPH_FRAMES = 21;
const RIPOSTE_GUARDS_WANTED = 8;
const RIPOSTE_RUN_FRAMES = 40000;
/** Long enough for dozens of swings, and so for guards at every point in one. */
const PRESSURE_RUN_FRAMES = 3000;
const GUARD_SEED = 0x6a4d;

/**
 * Frames from each guard to the next blow reaching the player, for a `type`
 * with `traits`, with the player pressed up against it the whole time.
 */
/** Put `mob` back on `tile`, re-filing it in the mob grid as a teleport must be. */
function recentre(arena: Arena, mob: Mob, tile: TilePoint): void {
  pinInPlace(arena, mob, tile.x * TILE_SIZE, tile.y * TILE_SIZE);
}

/**
 * Frames from each guard to the next blow reaching the player, for a creature
 * with `traits`, with the player pressed up against it the whole time.
 *
 * The creature is put back on its tile after every blow: over thousands of
 * frames the guards' shoves would otherwise walk it into a corner, where the
 * player cannot be pressed against it and the cat becomes the nearer quarry.
 */
function measureGuardToImpact(
  map: GameMap,
  meleeCase: MeleeCase,
  traits: readonly TacticsTrait[],
): number[] {
  const arena = makeArena(map, RETREAT_HUMAN_TILE, FAR_CORNER);
  const mob = addTrained(arena, meleeCase, RETREAT_PROBE_TILE, traits);
  const intervals: number[] = [];
  let guardFrame: number | null = null;
  let seenBlows = 0;
  const savedRandom = Math.random;
  Math.random = mulberry32(GUARD_SEED);
  try {
    for (let frame = 0; frame < RIPOSTE_RUN_FRAMES; frame++) {
      if (intervals.length >= RIPOSTE_GUARDS_WANTED) break;
      // The player presses in after the shove, the way a real one would, so
      // nothing but the creature's own timing stands between a guard and its
      // answer.
      arena.human.x = mob.x - TILE_SIZE;
      arena.human.y = mob.y;
      step(arena);
      if (arena.blowFrames.length === seenBlows) continue;
      seenBlows = arena.blowFrames.length;
      if (guardFrame !== null) {
        intervals.push(arena.frame - guardFrame);
        guardFrame = null;
      }
      recentre(arena, mob, RETREAT_PROBE_TILE);
      // Struck back the moment a blow lands: whatever lands next belongs to a
      // fresh attack.
      mob.hp = mob.maxHp;
      mob.takeDamageFrom(PROBE_BLOW_DAMAGE, arena.human, 'melee');
      if (mob.lastBlowWasGuarded) guardFrame = arena.frame;
    }
  } finally {
    Math.random = savedRandom;
    arena.loop.dispose();
  }
  return intervals;
}

/**
 * Gaps between consecutive blows reaching the player, with the creature
 * struck on every frame — so its guards land at every point of its swing,
 * windups included — and how many of those strikes it guarded.
 */
function measureBlowGapsUnderPressure(
  map: GameMap,
  meleeCase: MeleeCase,
): { readonly gaps: readonly number[]; readonly guards: number } {
  const arena = makeArena(map, RETREAT_HUMAN_TILE, FAR_CORNER);
  const mob = addTrained(arena, meleeCase, RETREAT_PROBE_TILE, ['block', 'riposte']);
  const gaps: number[] = [];
  let guards = 0;
  let seenBlows = 0;
  const savedRandom = Math.random;
  Math.random = mulberry32(GUARD_SEED);
  try {
    for (let frame = 0; frame < PRESSURE_RUN_FRAMES; frame++) {
      arena.human.x = mob.x - TILE_SIZE;
      arena.human.y = mob.y;
      step(arena);
      const blows = arena.blowFrames.length;
      if (blows !== seenBlows) {
        if (blows >= 2) gaps.push(arena.blowFrames[blows - 1] - arena.blowFrames[blows - 2]);
        seenBlows = blows;
        recentre(arena, mob, RETREAT_PROBE_TILE);
      }
      mob.hp = mob.maxHp;
      mob.takeDamageFrom(PROBE_BLOW_DAMAGE, arena.human, 'melee');
      if (mob.lastBlowWasGuarded) guards++;
    }
  } finally {
    Math.random = savedRandom;
    arena.loop.dispose();
  }
  return { gaps, guards };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function checkRiposte(map: GameMap, harness: TacticsHarness, meleeCase: MeleeCase): void {
  const { check } = harness;
  const riposte = measureGuardToImpact(map, meleeCase, ['block', 'riposte']);
  const plain = measureGuardToImpact(map, meleeCase, ['block']);
  check(
    riposte.length >= RIPOSTE_GUARDS_WANTED && plain.length >= RIPOSTE_GUARDS_WANTED,
    `${meleeCase.type} riposte: guards measured, ${riposte.length} riposting and ${plain.length} plain (need ${RIPOSTE_GUARDS_WANTED}) — it keeps fighting through every shove`,
  );
  const soonest = Math.min(...riposte);
  check(
    soonest >= FAIRNESS_MIN_TELEGRAPH_FRAMES && soonest >= RIPOSTE_READY_FRAMES,
    `${meleeCase.type} riposte: lands ${soonest} frames after the guard at the soonest (fairness floor ${FAIRNESS_MIN_TELEGRAPH_FRAMES}, ready ${RIPOSTE_READY_FRAMES})`,
  );
  // Medians and the soonest answer, not means: one stray long gap can carry
  // a mean either way.
  check(
    median(riposte) < median(plain) && soonest < Math.min(...plain),
    `${meleeCase.type} riposte: answers a guard sooner — median ${median(riposte)} vs ${median(plain)}, soonest ${soonest} vs ${Math.min(...plain)} frames without`,
  );

  const swingFrames = meleeCase.swingFrames;
  if (swingFrames === undefined) return;
  const pressure = measureBlowGapsUnderPressure(map, meleeCase);
  const closest = Math.min(...pressure.gaps);
  check(
    pressure.guards >= RIPOSTE_GUARDS_WANTED && pressure.gaps.length >= RIPOSTE_GUARDS_WANTED,
    `${meleeCase.type} riposte under pressure: ${pressure.guards} guards across ${pressure.gaps.length} blow gaps (need ${RIPOSTE_GUARDS_WANTED} of each)`,
  );
  check(
    closest >= swingFrames,
    `${meleeCase.type} riposte under pressure: blows never closer than one whole swing — closest ${closest} frames (swing ${swingFrames})`,
  );
}

// ── Run ────────────────────────────────────────────────────────────────────

/** Every melee-group section, run against the room `verify-tactics.ts` builds. */
export function checkMeleeTactics(map: GameMap, harness: TacticsHarness): void {
  checkEligibility(map, harness);
  checkSummonsLearnNothing(map, harness);
  for (const meleeCase of MELEE_CASES) {
    harness.section(`Melee tactics: ${meleeCase.type}`);
    if (meleeCase.eligibility.includes('flank')) checkFlank(map, harness, meleeCase);
    if (meleeCase.eligibility.includes('regroup')) checkRegroup(map, harness, meleeCase);
    if (meleeCase.eligibility.includes('kite')) checkKite(map, harness, meleeCase);
    if (meleeCase.eligibility.includes('riposte')) checkRiposte(map, harness, meleeCase);
  }
}
