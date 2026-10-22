#!/usr/bin/env tsx
/**
 * Headless gate on the fairness rules behind the game's difficulty tuning.
 *
 * The thing worth guarding here is that later tuning cannot quietly break the
 * invariants that make a harder game a fair one. Every tuning number is a
 * starting point meant to be moved; none of the *rules* around them are. A
 * cadence curve retuned past its floor, a telegraph shortened below what a
 * player can react to, a projectile nudged past the speed you can outrun — all
 * three are one-character edits, none of them fails a typecheck, and each turns
 * pressure into unfairness with nothing on screen to say so.
 *
 * Everything here is arithmetic over the game's own exported functions, never a
 * copy of them, so a formula that moves is either still inside its bounds or
 * fails this. How the result *feels* is still a `[HUMAN]` gate — run the game
 * with `?difficulty` for the target-feel counters this gate checks against.
 *
 * Run: npx tsx scripts/verify-difficulty.ts
 */

import { Mob } from '../src/creatures/Mob';
import {
  CADENCE_SCALE_FLOOR,
  cooldownScaleForLevel,
  LOCKED_TELEGRAPH_MIN_FRAMES,
  scaledCooldownFramesForLevel,
} from '../src/creatures/mobLevelScaling';
import {
  TROGLODYTE_AIM_LOCK_FRAMES,
  TROGLODYTE_WINDUP_FLOOR_FRAMES,
  troglodyteWindupFrames,
} from '../src/creatures/Troglodyte';
import { BOLT_SPEED_CAP, lavaBoltSpeedForLevel } from '../src/systems/LavaBallSystem';
import { GOBLIN_BOW_SHOTS, goblinArrowReleaseFrame } from '../src/sprites/goblinSprite';
import {
  humanRegenHpPerSecond,
  REGEN_HP_PER_SECOND_ASYMPTOTE,
} from '../src/systems/PlayerTickSystem';
import {
  MAX_MOB_LEVEL,
  MAX_ROOM_SPAWN_COUNT,
  earnedLevelFloor,
  overLevelReinforcementBodies,
  partyTrackedBand,
  resolveAmbientLevel,
  progressionRegions,
  regionLevelBonusFor,
  rollRoomPopulation,
  partyLevelOf,
  recommendedPartyLevelFor,
  regionLevelBand,
  resolveBossLevel,
  resolveSpawnLevel,
  roomSpawnBounds,
  spawnExtraMobs,
  spawnForLevel,
  spawnTreasureRoomMobs,
} from '../src/levels/spawner';
import { mulberry32 } from '../src/sprites/person/rng';
import {
  WAYFINDER_GRACE_FRAMES,
  WAYFINDER_PULSE_PERIOD_FRAMES,
  WAYFINDER_PULSE_VISIBLE_FRAMES,
  WAYFINDER_MOTE_MAX_ALIVE,
  WAYFINDER_MOTE_SPAWN_INTERVAL_FRAMES,
  WAYFINDER_MOTE_RELEASE_COST_FRAMES,
  WAYFINDER_MOTE_SPEED,
  WAYFINDER_MOTE_LIFE_FRAMES,
} from '../src/systems/StairwellSystem';
import { Goblin, GOBLIN_MAX_SPEED } from '../src/creatures/Goblin';
import { BallOfSwine } from '../src/creatures/BallOfSwine';
import { makeSepsis } from '../src/core/StatusEffect';
import { Juicer } from '../src/creatures/Juicer';
import {
  GoblinArcher,
  ARCHER_MAX_SPEED as GOBLIN_ARCHER_MAX_SPEED,
} from '../src/creatures/GoblinArcher';
import { CircusLemur, LEMUR_MAX_SPEED } from '../src/creatures/CircusLemur';
import {
  SkeletonArcher,
  ARCHER_MAX_SPEED as SKELETON_ARCHER_MAX_SPEED,
} from '../src/creatures/SkeletonArcher';
import { SkeletonWarrior, SKELETON_MAX_SPEED } from '../src/creatures/SkeletonWarrior';
import { StiltClown, CLOWN_MAX_SPEED as STILT_CLOWN_MAX_SPEED } from '../src/creatures/StiltClown';
import { FatClown, CLOWN_MAX_SPEED as FAT_CLOWN_MAX_SPEED } from '../src/creatures/FatClown';
import { Mantid, MANTID_MAX_SPEED } from '../src/creatures/Mantid';
import { MantisCrony, MANTIS_MAX_SPEED } from '../src/creatures/MantisCrony';
import { SKYFOWL_TOUGH_FAMILY, SkyFowl } from '../src/creatures/SkyFowl';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { TheLich, HANDS_WINDUP_FRAMES, LICH_MAX_SPEED } from '../src/creatures/TheLich';
import {
  applySpawnDifficulty,
  DIFFICULTY_PROFILES,
  NORMAL_AMBIENT_LEVEL_RATIO,
  NORMAL_BOSS_LEVEL_RATIO,
  type Difficulty,
} from '../src/core/difficultyProfiles';
import {
  bountyBossLevel,
  bountyMinionLevel,
  MAX_BOUNTY_MOB_LEVEL,
} from '../src/systems/BountySystem';
import { generateDungeon } from '../src/map/DungeonGenerator';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level1 } from '../src/levels/level1';
import { withWorldSeed } from '../src/core/WorldRandom';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { level2 } from '../src/levels/level2';
import { level3 } from '../src/levels/level3';
import type { LevelDef, MobLevelRange } from '../src/levels/types';
import type { StandaloneMobKind } from '../src/levels/mobKinds';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { DifficultyStats, type RoomFightDetails } from '../src/core/DifficultyStats';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { liveSpawnContext, spawnMob } from '../src/levels/spawnFunnel';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { GoblinBombSystem, applyGoblinBlastToBodies } from '../src/systems/GoblinBombSystem';
import {
  BLACK_POWDER_WALK_OUT_FRAMES,
  BOMBER_TUNING,
  type BombPoint,
  GOBLIN_BOMB_DODGE_REACTION_FRAMES,
  GOBLIN_DYNAMITE_WALK_OUT_FRAMES,
  activeBomberTuning,
  blackPowderDodgeMarginFrames,
  goblinBombBlastRadiusPx,
  goblinDynamiteDodgeMarginFrames,
} from '../src/systems/goblinBombConstants';
import { GoblinBomber } from '../src/creatures/GoblinBomber';
import { settings } from '../src/core/Settings';
import { goblinBombReleaseFrame } from '../src/sprites/goblinBomberSprite';
import { Mercenary } from '../src/creatures/Mercenary';
import { getMercenaryTemplate, type MercenaryTemplateId } from '../src/core/mercenaryTemplates';
import {
  floorReferencePartyLevel,
  setFloorReferencePartyLevel,
} from '../src/core/floorReferenceLevel';
import {
  DynamiteSystem,
  dynamiteCrawlerDamage,
  dynamiteDamageToMob,
  dynamiteMobDamage,
} from '../src/systems/DynamiteSystem';
import { HeatherTheBear } from '../src/creatures/HeatherTheBear';
import { MissQuill } from '../src/creatures/MissQuill';
import { Remex } from '../src/creatures/Remex';
import { DarkKnight } from '../src/creatures/DarkKnight';

/**
 * Levels probed past {@link MAX_MOB_LEVEL} for the shape checks. A curve that is
 * well behaved to 20 and blows up at 40 is a curve with a bug in it, not a
 * curve that happens to be used inside its safe range.
 */
const PROBE_LEVEL_LIMIT = 60;

/** The shortest and longest base cooldowns sampled for the floor check, around the real ones. */
const SHORTEST_SAMPLED_COOLDOWN = 1;
const TWO_FRAME_COOLDOWN = 2;
const LONGEST_SAMPLED_COOLDOWN = 600;
/** The span of base cooldowns creatures actually author, swept one frame at a time. */
const SHORTEST_AUTHORED_COOLDOWN = 60;
const LONGEST_AUTHORED_COOLDOWN = 180;
const AUTHORED_COOLDOWNS_SAMPLED = Array.from(
  { length: LONGEST_AUTHORED_COOLDOWN - SHORTEST_AUTHORED_COOLDOWN + 1 },
  (_, offset) => SHORTEST_AUTHORED_COOLDOWN + offset,
);
/** Base cooldowns sampled for the floor check — the real ones plus the extremes. */
const SAMPLED_BASE_COOLDOWNS = [
  SHORTEST_SAMPLED_COOLDOWN,
  TWO_FRAME_COOLDOWN,
  ...AUTHORED_COOLDOWNS_SAMPLED,
  LONGEST_SAMPLED_COOLDOWN,
];
/**
 * How close to its floor the cadence curve must come at an absurd level, as a
 * fraction of level 1's cadence — close enough that the floor is a bound the
 * curve actually reaches toward rather than a number it never nears.
 */
const CADENCE_FLOOR_APPROACH_SLACK = 0.02;
/** Constitutions whose regen gains are compared: an early point and a late one. */
const EARLY_CONSTITUTION = 3;
const LATE_CONSTITUTION = 12;
/** A levelled mob used for the re-level refusal check. */
const RELEVEL_TEST_LEVEL = 5;
/** Two crawler levels for the "party level is the stronger one" check. */
const WEAKER_CRAWLER_LEVEL = 3;
const STRONGER_CRAWLER_LEVEL = 9;

/** Comparisons over authored constants, which the linter would otherwise read as literal types. */
function isAtLeast(value: number, minimum: number): boolean {
  return value >= minimum;
}
function isBelow(value: number, limit: number): boolean {
  return value < limit;
}

/** Constitutions sampled for the regen curve, from a fresh crawler to an absurd one. */
const MAX_PROBED_CONSTITUTION = 200;

/** Seed for the reinforced-room rolls, so the cap check reads the same rooms every run. */
const REINFORCEMENT_ROLL_SEED = 0x2e1_f0cc;
/** Party levels sampled for the level-band checks. */
const MAX_PROBED_PARTY_LEVEL = 40;

/** Tiles the test target stands from the archer — inside its firing band. */
const ARCHER_TEST_TARGET_TILE = 5;
/** Frames the archer is driven for; comfortably longer than one whole draw. */
const ARCHER_TEST_FRAMES = 240;
/** Frames after the draw begins before the target starts walking off the line. */
const ARCHER_TEST_LOCK_MARGIN_FRAMES = 12;
/** How far the target moves per frame once it starts dodging, in world pixels. */
const ARCHER_TEST_DODGE_STEP_PX = 6;

/** Mid-band level the boss re-levelling checks are run at. */
/** Frames allowed for a permanent status tick to grind a levelled boss to zero. */
const SEPSIS_SETTLE_FRAMES = 400000;
/** Enough over max HP to kill through the damage reduction a rolling ball carries. */
const KILLING_BLOW_MULTIPLE = 20;
/** Frames given to the burst to play out and settle, comfortably past its length. */
const BURST_SETTLE_FRAMES = 400;
const BOSS_TEST_LEVEL = 7;

/** Floating-point slack for comparisons between two computed reals. */
const EPSILON = 1e-9;

const LEVEL_DEFS: readonly LevelDef[] = [level1, level2, level3];

/**
 * The bands every band-shaped sweep is run over: an unauthored one, a tight one,
 * a wide one, one starting well above level 1, and one with a floor but no
 * ceiling. Shared so a sweep added later cannot quietly probe a gentler set than
 * the ones already here.
 */
const BAND_SAMPLES: readonly MobLevelRange[] = [
  {},
  { minLevel: 1, maxLevel: 2 },
  { minLevel: 3, maxLevel: 7 },
  { minLevel: 6, maxLevel: 10 },
  { minLevel: 5 },
];

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

// ── The cadence curve ────────────────────────────────────────────────────────

section('cadence curve');
{
  check(cooldownScaleForLevel(1) === 1, 'level 1 is unscaled');

  let strictlyDecreasing = true;
  for (let level = 1; level < PROBE_LEVEL_LIMIT; level++) {
    if (cooldownScaleForLevel(level + 1) >= cooldownScaleForLevel(level))
      strictlyDecreasing = false;
  }
  check(strictlyDecreasing, 'it decreases at every level');

  let staysAboveFloor = true;
  for (let level = 1; level <= PROBE_LEVEL_LIMIT; level++) {
    if (cooldownScaleForLevel(level) <= CADENCE_SCALE_FLOOR) staysAboveFloor = false;
  }
  check(staysAboveFloor, 'it never reaches its own floor');

  // Asymptotic, not merely bounded: a curve that levelled off well above the
  // floor would make the floor a number that describes nothing.
  const deepScale = cooldownScaleForLevel(PROBE_LEVEL_LIMIT * PROBE_LEVEL_LIMIT);
  check(
    deepScale - CADENCE_SCALE_FLOOR < CADENCE_FLOOR_APPROACH_SLACK,
    'it approaches the floor rather than levelling off short of it',
  );

  let respectsFloorInFrames = true;
  for (const base of SAMPLED_BASE_COOLDOWNS) {
    for (let level = 1; level <= PROBE_LEVEL_LIMIT; level++) {
      const frames = scaledCooldownFramesForLevel(base, level);
      if (frames < 1) respectsFloorInFrames = false;
      if (frames < Math.round(base * CADENCE_SCALE_FLOOR)) respectsFloorInFrames = false;
      if (frames > base) respectsFloorInFrames = false;
    }
  }
  check(respectsFloorInFrames, 'every scaled cooldown lands between its floor and its base');
}

// ── Telegraphs ───────────────────────────────────────────────────────────────

section('telegraphs');
{
  check(
    isAtLeast(TROGLODYTE_AIM_LOCK_FRAMES, LOCKED_TELEGRAPH_MIN_FRAMES),
    `the troglodyte's aim stays locked for at least ${LOCKED_TELEGRAPH_MIN_FRAMES} frames`,
  );

  let windupRespectsFloor = true;
  let trackingSurvives = true;
  let windupNeverGrows = true;
  for (let level = 1; level <= PROBE_LEVEL_LIMIT; level++) {
    const windup = troglodyteWindupFrames(level);
    if (windup < TROGLODYTE_WINDUP_FLOOR_FRAMES) windupRespectsFloor = false;
    // Tracking is what compresses; the locked stretch is what must not. A windup
    // shortened to the lock length is an attack that commits before it aims.
    if (windup <= TROGLODYTE_AIM_LOCK_FRAMES) trackingSurvives = false;
    if (level > 1 && windup > troglodyteWindupFrames(level - 1)) windupNeverGrows = false;
  }
  check(windupRespectsFloor, "the troglodyte's windup never goes below its floor");
  check(trackingSurvives, 'the windup always leaves some aim-tracking ahead of the lock');
  check(windupNeverGrows, 'the windup only ever shortens with level');

  // The archer's telegraph is a fixed number of game frames rather than a
  // level-scaled one, so what has to be checked is that both of its shots — the
  // aimed one and the hurried one — buy their speed out of the *tracking* half
  // and never out of the locked half.
  let archerLockIsEnough = true;
  let archerTracksFirst = true;
  for (const kind of ['light', 'heavy'] as const) {
    const shot = GOBLIN_BOW_SHOTS[kind];
    if (shot.lockedFrames < LOCKED_TELEGRAPH_MIN_FRAMES) archerLockIsEnough = false;
    if (shot.releaseFrame < 0 || shot.releaseFrame >= shot.spriteFrames) archerTracksFirst = false;
    // Frames of aim tracking before the lock, in game frames. The extra frame
    // comes off because `tickDraw` decrements before it compares, so a draw that
    // computed one tracking frame here would in fact write the aim point on
    // none of them — and every shot for that archer's whole life would then fire
    // along no aim at all.
    const tracking = goblinArrowReleaseFrame(kind) - shot.lockedFrames - 1;
    if (tracking <= 0) archerTracksFirst = false;
  }
  check(archerLockIsEnough, "both of the goblin archer's shots lock their aim for long enough");
  check(archerTracksFirst, 'each archer shot tracks its target before it commits');

  check(
    isAtLeast(HANDS_WINDUP_FRAMES, LOCKED_TELEGRAPH_MIN_FRAMES),
    "the Lich's grasping-hands windup stays locked for at least " +
      `${LOCKED_TELEGRAPH_MIN_FRAMES} frames`,
  );

  // The release has to land *inside* the animation. If a retune ever pushed it
  // to or past the last frame the timer would run to zero without matching, and
  // the archer would play a full draw and silently never fire — no error, no
  // warning, just an enemy that stopped working.
  let releaseLandsInsideTheDraw = true;
  for (const kind of ['light', 'heavy'] as const) {
    if (GOBLIN_BOW_SHOTS[kind].animFrames - goblinArrowReleaseFrame(kind) <= 0) {
      releaseLandsInsideTheDraw = false;
    }
  }
  check(releaseLandsInsideTheDraw, 'every archer shot releases before its animation ends');

  // The rule the constants above cannot prove: that the *aim* is what freezes,
  // not merely the sprite's facing. An archer that re-resolved its shot vector
  // on the release frame would hit a player who reacted to the draw exactly as
  // reliably as one who ignored it — a telegraph that looks right, satisfies a
  // constant, and does nothing.
  check(archerHonoursItsLock(), "the archer's arrow follows the aim it locked, not its target");
}

/**
 * Drives a real archer through one whole draw, walking the target sideways the
 * moment the aim locks, and asks where the arrow actually went.
 */
function archerHonoursItsLock(): boolean {
  const archer = new GoblinArcher(0, 0, TILE_SIZE);
  const target = new HumanPlayer(ARCHER_TEST_TARGET_TILE, 0, TILE_SIZE);
  const aimedAtY = target.y;

  let lockedAt: number | null = null;
  for (let frame = 0; frame < ARCHER_TEST_FRAMES; frame++) {
    archer.updateAI([target]);
    archer.tickTimers();
    // Once the draw is past its tracking half, walk the target well off the
    // line. A locked archer must miss; an unlocked one tracks it perfectly.
    if (lockedAt === null && archer.isDrawing) lockedAt = frame;
    if (lockedAt !== null && frame > lockedAt + ARCHER_TEST_LOCK_MARGIN_FRAMES) {
      target.y += ARCHER_TEST_DODGE_STEP_PX;
    }
    const shots = archer.takePendingShots();
    if (shots.length === 0) continue;
    const shot = shots[0];
    // The arrow left along the old line if its heading still points at where the
    // target was, rather than at the several tiles of ground it has since
    // crossed.
    const aimedDy = aimedAtY - shot.y;
    const chasedDy = target.y - shot.y;
    return Math.abs(shot.dirY - aimedDy) < Math.abs(shot.dirY - chasedDy);
  }
  return false;
}

// ── Projectiles ──────────────────────────────────────────────────────────────

section('projectiles');
{
  check(BOLT_SPEED_CAP < PLAYER_SPEED, 'a lava bolt at its cap is still outrunnable');

  let respectsCap = true;
  let neverSlows = true;
  for (let level = 1; level <= PROBE_LEVEL_LIMIT; level++) {
    const speed = lavaBoltSpeedForLevel(level);
    if (speed > BOLT_SPEED_CAP + EPSILON) respectsCap = false;
    if (level > 1 && speed < lavaBoltSpeedForLevel(level - 1)) neverSlows = false;
  }
  check(respectsCap, 'no levelled bolt exceeds the cap');
  check(neverSlows, 'bolt speed only ever rises with level');
}

// ── The regen curve ──────────────────────────────────────────────────────────

section('regen curve');
{
  let monotone = true;
  let bounded = true;
  for (let constitution = 1; constitution <= MAX_PROBED_CONSTITUTION; constitution++) {
    const rate = humanRegenHpPerSecond(constitution);
    if (constitution > 1 && rate <= humanRegenHpPerSecond(constitution - 1)) monotone = false;
    if (rate >= REGEN_HP_PER_SECOND_ASYMPTOTE) bounded = false;
  }
  check(monotone, 'more constitution always heals faster');
  check(bounded, 'no constitution reaches the asymptote');

  // The whole point of decoupling regen from max HP: constitution must buy far
  // less regen than it used to, or the curve has been retuned back into the
  // out-heal-everything regime it was written to end.
  const earlyPointGain =
    humanRegenHpPerSecond(EARLY_CONSTITUTION + 1) - humanRegenHpPerSecond(EARLY_CONSTITUTION);
  const latePointGain =
    humanRegenHpPerSecond(LATE_CONSTITUTION + 1) - humanRegenHpPerSecond(LATE_CONSTITUTION);
  check(latePointGain < earlyPointGain, 'each point of constitution buys less regen than the last');
}

// ── Spawn counts ─────────────────────────────────────────────────────────────

section('spawn counts');
{
  let bonusesMatchRegions = true;
  let authoredCountsFitTheCap = true;
  for (const def of LEVEL_DEFS) {
    const bonuses = def.progression?.regionSpawnBonus;
    if (bonuses !== undefined) {
      const gauntlets = def.progression?.gauntlets.length ?? 0;
      // One entry per gauntlet plus one for the free-roam region past the last
      // of them. A short array silently gives the deepest region no bonus.
      if (bonuses.length !== gauntlets + 1) bonusesMatchRegions = false;
      if (bonuses.some((bonus) => bonus < 0)) bonusesMatchRegions = false;
    }
    for (const rule of def.roomMobs) {
      // Escorts included: they are reserved out of the same allowance, so a rule
      // whose own floor plus its escorts exceeds the cap can only be honoured by
      // dropping one or the other, and which one it drops is not something a
      // level author should have to discover by counting bodies in a room.
      const escortFloor = (rule.escorts ?? []).reduce(
        (total, escort) => total + (escort.maxCount ?? 1),
        0,
      );
      if ((rule.minCount ?? 1) + escortFloor > MAX_ROOM_SPAWN_COUNT) {
        authoredCountsFitTheCap = false;
      }
    }
  }
  check(bonusesMatchRegions, 'every region bonus array covers exactly its floor’s regions');
  check(
    authoredCountsFitTheCap,
    'no rule asks for more mobs than the per-room cap would ever allow',
  );

  check(
    level1.overLevelReinforcement === undefined,
    'the learning floor keeps its authored room counts at every party level',
  );
  const reinforcedFloors = LEVEL_DEFS.filter((def) => def.overLevelReinforcement !== undefined);
  check(
    reinforcedFloors.length > 0,
    'at least one floor reinforces its rooms for a party ahead of it',
  );
  let onScheduleUnreinforced = true;
  let reinforcementBounded = true;
  let reinforcementMonotone = true;
  let roomsFitTheCap = true;
  const profile = DIFFICULTY_PROFILES.normal;
  const openBand: MobLevelRange = { minLevel: 1, maxLevel: MAX_MOB_LEVEL };
  for (const def of reinforcedFloors) {
    const maxBodies = def.overLevelReinforcement?.maxBodies ?? 0;
    const regions = progressionRegions(def);
    for (const rule of def.roomMobs) {
      for (const region of regions) {
        const band = regionLevelBand(rule, regionLevelBonusFor(def, region));
        let previous = 0;
        for (let partyLevel = 1; partyLevel <= MAX_PROBED_PARTY_LEVEL; partyLevel++) {
          const bodies = overLevelReinforcementBodies(def, band, partyLevel, profile);
          const bandTop = band.maxLevel ?? band.minLevel ?? 1;
          const partyIsInsideBand = earnedLevelFloor(openBand, partyLevel, profile) <= bandTop;
          if (partyIsInsideBand && bodies > 0) onScheduleUnreinforced = false;
          if (bodies < 0 || bodies > maxBodies) reinforcementBounded = false;
          if (bodies < previous) reinforcementMonotone = false;
          previous = bodies;
          const population = withWorldSeed(REINFORCEMENT_ROLL_SEED + partyLevel, () =>
            rollRoomPopulation(def, rule, region, partyLevel, profile, Math.random),
          );
          if (population.hostCount + population.escorts.length > MAX_ROOM_SPAWN_COUNT) {
            roomsFitTheCap = false;
          }
        }
      }
    }
  }
  check(onScheduleUnreinforced, 'a party still inside a room’s band meets its authored count');
  check(reinforcementBounded, 'over-level reinforcement never adds more than its floor’s maximum');
  check(reinforcementMonotone, 'a party further ahead never meets fewer reinforcements');
  check(roomsFitTheCap, 'a reinforced room still never exceeds the per-room cap');
}

// ── Level bands ──────────────────────────────────────────────────────────────

// ── Party tracking ───────────────────────────────────────────────────────────

section('party tracking');
{
  check(
    level1.ambientTracking === undefined,
    'the learning floor’s bands stay hard ceilings at every party level',
  );
  let trackedFloors = 0;
  let insideBandUnchanged = true;
  let underCeiling = true;
  let earnedFloorBelowParty = true;
  let neverFalls = true;
  for (const def of LEVEL_DEFS) {
    const ceiling = def.ambientTracking?.maxLevel;
    if (ceiling === undefined) continue;
    trackedFloors++;
    const bands: MobLevelRange[] = [
      ...def.roomMobs,
      ...def.hallwayMobs,
      ...Object.values(def.campSpawns ?? {}).flat(),
      ...(def.extraSpawns ?? []),
    ];
    for (const band of bands) {
      const authoredTop = band.maxLevel ?? band.minLevel ?? 1;
      let previousTop = 0;
      for (let partyLevel = 1; partyLevel <= MAX_PROBED_PARTY_LEVEL; partyLevel++) {
        const profile = DIFFICULTY_PROFILES.normal;
        const tracked = partyTrackedBand(band, def, partyLevel, profile);
        const trackedTop = tracked.maxLevel ?? tracked.minLevel ?? 1;
        const partyInsideBand = earnedLevelFloor(band, partyLevel, profile) < authoredTop;
        if (partyInsideBand && tracked !== band) insideBandUnchanged = false;
        if (trackedTop > Math.max(authoredTop, Math.min(ceiling, MAX_MOB_LEVEL))) {
          underCeiling = false;
        }
        if (trackedTop < previousTop) neverFalls = false;
        previousTop = trackedTop;
        const isTracked = tracked !== band;
        if (
          isTracked &&
          resolveAmbientLevel(band, def, partyLevel, profile, Math.random) >= partyLevel
        ) {
          earnedFloorBelowParty = false;
        }
      }
    }
  }
  check(trackedFloors > 0, `${trackedFloors} floors let their mobs follow an over-levelled party`);
  check(insideBandUnchanged, 'a party still inside a band meets it exactly as authored');
  check(underCeiling, 'a tracked band never passes its floor’s ceiling or the level cap');
  check(neverFalls, 'a party further ahead never meets a lower tracked band');
  check(earnedFloorBelowParty, 'a tracked mob still sits below the party’s own level');
}

// ── XP curve ─────────────────────────────────────────────────────────────────

/** An award several levels' worth on floor 2, earned just under its first tier. */
const LARGE_XP_AWARD = 2000;
/** The same award, dripped in pieces the size of one ordinary kill. */
const DRIP_XP_AWARD = 10;
/** A crawler just under floor 2's first tier, which is where banked XP used to escape it. */
const XP_TEST_START_LEVEL = 17;
/** The game's source tree, found from this script rather than from wherever it was run. */
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const AWARD_XP_FILE = join(SOURCE_ROOT, 'core', 'awardXp.ts');
const DIRECT_XP_CALL = '.gainXp(';

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** How far one large award and the same XP dripped in may differ, from rounding each drip. */
const XP_PATH_LEVEL_SLACK = 1;

section('xp curve');
{
  const curve = level2.xpDiminishingTiers;
  const atStart = (): HumanPlayer => {
    const crawler = new HumanPlayer(0, 0, TILE_SIZE);
    while (crawler.level < XP_TEST_START_LEVEL) crawler.advanceLevel();
    crawler.xpCurve = curve;
    return crawler;
  };
  const lump = atStart();
  lump.gainXp(LARGE_XP_AWARD);
  const dripped = atStart();
  for (let given = 0; given < LARGE_XP_AWARD; given += DRIP_XP_AWARD) dripped.gainXp(DRIP_XP_AWARD);
  check(
    curve !== undefined && Math.abs(lump.level - dripped.level) <= XP_PATH_LEVEL_SLACK,
    `one large award buys what the same XP bought kill by kill (${lump.level} vs ${dripped.level}), so a boss or quest reward cannot carry a crawler past the floor’s tiers`,
  );
  const uncurved = atStart();
  uncurved.xpCurve = undefined;
  uncurved.gainXp(LARGE_XP_AWARD);
  check(
    uncurved.level > lump.level,
    `the curve is what holds it back (${uncurved.level} with none, ${lump.level} under floor 2’s)`,
  );
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const dexterityBefore = cat.dexterity;
  cat.gainXp(LARGE_XP_AWARD);
  check(
    cat.level > 1 && cat.dexterity - dexterityBefore === cat.level - 1,
    `the cat gains her dexterity on every level one award buys (${cat.level - 1} levels)`,
  );

  // `awardXp` is the one place a level-up is announced; a direct `gainXp` call
  // levels a crawler silently — no sound, no achievement log, no AI event.
  const sourceFiles = sourceFilesUnder(SOURCE_ROOT);
  check(
    sourceFiles.length > 0 && sourceFiles.includes(AWARD_XP_FILE),
    `the XP-award scan reads the source tree (${sourceFiles.length} files, awardXp.ts among them)`,
  );
  const directCallers = sourceFiles.filter(
    (file) => file !== AWARD_XP_FILE && readFileSync(file, 'utf8').includes(DIRECT_XP_CALL),
  );
  check(
    directCallers.length === 0,
    `every XP award goes through awardXp${directCallers.length > 0 ? ` (direct: ${directCallers.join(', ')})` : ''}`,
  );
}

section('level bands');
{
  let staysInBand = true;
  let bossStaysInBand = true;
  let growsWithParty = true;
  for (const band of BAND_SAMPLES) {
    const min = band.minLevel ?? 1;
    const max = band.maxLevel ?? min;
    let previousBossLevel = 0;
    for (let partyLevel = 1; partyLevel <= MAX_PROBED_PARTY_LEVEL; partyLevel++) {
      const rolled = resolveSpawnLevel(band, partyLevel, DIFFICULTY_PROFILES.normal, Math.random);
      if (rolled < min || rolled > max) staysInBand = false;
      const bossLevel = resolveBossLevel(band, partyLevel, DIFFICULTY_PROFILES.normal);
      if (bossLevel < min || bossLevel > max) bossStaysInBand = false;
      if (bossLevel < previousBossLevel) growsWithParty = false;
      previousBossLevel = bossLevel;
    }
  }
  check(staysInBand, 'a party-relative roll never leaves its rule’s band');
  check(bossStaysInBand, 'a boss level never leaves its band');
  check(growsWithParty, 'a boss never gets weaker as the party gets stronger');

  // The reward for levelling. Only the *floor* of the roll is party-relative —
  // the band's own ceiling is what caps the rest, and that is what stops a
  // revisited floor 1 turning into floor 2.
  const wideBand: MobLevelRange = { minLevel: 1, maxLevel: MAX_MOB_LEVEL };
  let partyStaysAhead = true;
  for (let partyLevel = 2; partyLevel <= MAX_PROBED_PARTY_LEVEL; partyLevel++) {
    if (earnedLevelFloor(wideBand, partyLevel, DIFFICULTY_PROFILES.normal) >= partyLevel) {
      partyStaysAhead = false;
    }
  }
  check(partyStaysAhead, 'an open band’s earned floor always sits below the party’s own level');

  check(
    partyLevelOf(WEAKER_CRAWLER_LEVEL, STRONGER_CRAWLER_LEVEL) === STRONGER_CRAWLER_LEVEL,
    'party level is the stronger crawler’s',
  );
}

// ── Re-levelling ─────────────────────────────────────────────────────────────

section('re-levelling');
{
  const mob = new Goblin(0, 0, TILE_SIZE, 'sword');
  mob.applyMobLevel(RELEVEL_TEST_LEVEL);
  const levelledMaxHp = mob.maxHp;
  console.log('  (the warning below is the check working, not a failure)');
  mob.applyMobLevel(RELEVEL_TEST_LEVEL);
  check(mob.maxHp === levelledMaxHp, 'a second applyMobLevel is refused rather than compounded');
  check(mob.mobLevel === RELEVEL_TEST_LEVEL, 'the refused call leaves the original level in place');

  // The other half of the same problem, and the one that actually shipped: a
  // level cannot be re-applied, so anything that re-authors speed or max HP from
  // a flat constant throws the scaling away for good. A checkpoint restore calls
  // `resetToSpawn` on every surviving hostile, which is where a levelled boss
  // used to come back at level-1 speed with its levelled HP intact — a boss
  // that eats hits like a level-1 mob but has a levelled boss's max HP, which
  // this gate exists to forbid.
  const boss = new Juicer(0, 0, TILE_SIZE);
  boss.applyMobLevel(BOSS_TEST_LEVEL);
  const levelledSpeed = boss.moveSpeed;
  const bossMaxHp = boss.maxHp;
  boss.resetToSpawn();
  check(boss.moveSpeed === levelledSpeed, 'a checkpoint reset keeps a levelled boss’s speed');
  check(boss.maxHp === bossMaxHp, 'a checkpoint reset keeps a levelled boss’s max HP');

  // The same hazard one step further along: a boss killed after the checkpoint
  // is now resurrected rather than left as a corpse, and the revive path runs
  // `resetToSpawn` too. A revived boss that came back at level-1 speed would be
  // the sponge again, only harder to spot — it takes a death to see it.
  boss.hp = 0;
  boss.reviveForCheckpoint();
  check(boss.isAlive, 'a boss killed after the checkpoint is alive again after a revive');
  check(boss.hp === bossMaxHp, 'a revived boss comes back at its levelled max HP');
  check(boss.moveSpeed === levelledSpeed, 'a revive keeps a levelled boss’s speed');

  // The Ball of Swine gets its own pass at all of the above, because it is the one
  // boss that overrides `isAlive` — it reports itself alive through its death burst
  // so the fight cannot end mid-animation. Every check above is written against a
  // boss whose `isAlive` is just `hp > 0`, so none of them can see the failure that
  // override makes possible: a burst with nowhere to finish leaves the creature
  // permanently "alive", re-latching `justDied` every frame. That re-resolves the
  // kill sixty times a second — re-awarding the whole XP split, re-emitting
  // `bossDefeated` into another eight Tusklings — and it makes the revive above
  // unreachable, because `rewindMobsToCheckpoint` only revives what reads as dead.
  const ball = new BallOfSwine(0, 0, TILE_SIZE);
  ball.setArena(0, 0);
  ball.applyMobLevel(BOSS_TEST_LEVEL);
  // The ball is inert until ArenaSystem opens the fight; this harness has no arena.
  ball.fightStarted = true;
  const ballMaxHp = ball.maxHp;
  // Multiplied up past the reduction a rolling ball applies to everything that hits
  // it, so this is a killing blow rather than a scratch — at double its max HP it
  // survived, which is the reduction doing its job.
  ball.takeDamageFrom(ballMaxHp * KILLING_BLOW_MULTIPLE, null, 'melee');
  check(ball.isAlive, 'the ball reports itself alive while its death burst plays');

  let latches = 0;
  for (let frame = 0; frame < BURST_SETTLE_FRAMES; frame++) {
    ball.updateAI([]);
    if (ball.justDied) {
      latches++;
      ball.justDied = false;
    }
  }
  check(latches === 1, `the ball's death resolves exactly once (saw ${latches})`);
  check(!ball.isAlive, 'the ball reads as dead once its burst has finished');

  ball.reviveForCheckpoint();
  check(ball.isAlive, 'a ball killed after the checkpoint is alive again after a revive');
  check(ball.hp === ballMaxHp, 'a revived ball comes back at its levelled max HP');

  // The other way a mob can reach zero: a status tick, which lands in
  // `Player.takeDamage` and does none of a mob's death bookkeeping. Left alone, a ball
  // finished off by the Sepsis Crown's permanent tick — which the cat can be wearing,
  // and the `swine` playtest preset is — drops to zero without `justDied`, so
  // `resolveKills` skips it: no loot, no XP, no `bossDefeated`, and therefore no
  // phase-2 Tusklings and no stairwell out.
  const septic = new BallOfSwine(0, 0, TILE_SIZE);
  septic.setArena(0, 0);
  septic.applyMobLevel(BOSS_TEST_LEVEL);
  septic.fightStarted = true;
  septic.applyStatus(makeSepsis());
  let septicTicks = 0;
  while (septic.hp > 0 && septicTicks < SEPSIS_SETTLE_FRAMES) {
    septic.tickTimers();
    septicTicks++;
  }
  check(septic.hp === 0, `sepsis alone can finish the ball off (took ${septicTicks} frames)`);
  check(septic.isAlive, 'a ball killed by a status effect still bursts rather than just stopping');

  let septicLatches = 0;
  for (let frame = 0; frame < BURST_SETTLE_FRAMES; frame++) {
    septic.updateAI([]);
    if (septic.justDied) {
      septicLatches++;
      septic.justDied = false;
    }
  }
  check(septicLatches === 1, `a status death resolves exactly once (saw ${septicLatches})`);
  check(septic.droppedLoot !== null, 'a status death still drops the boss loot');
}

// ── Speed caps ───────────────────────────────────────────────────────────────

/**
 * The one sanctioned advantage over player speed — the Mantid's stalk, at
 * 1.08. Anything else claiming a cap above player speed is the goblin
 * runaway again.
 */
const MAX_LEVELLED_WALK_ADVANTAGE = 1.1;
/** Level every registry entry is levelled to before its cap is checked. */
const SPEED_CAP_TEST_LEVEL = 20;

const SPEED_CAPPED_MOBS: ReadonlyArray<{ name: string; make: () => Mob; cap: number }> = [
  {
    name: 'Goblin (sword)',
    make: () => new Goblin(0, 0, TILE_SIZE, 'sword'),
    cap: GOBLIN_MAX_SPEED,
  },
  {
    name: 'GoblinArcher',
    make: () => new GoblinArcher(0, 0, TILE_SIZE),
    cap: GOBLIN_ARCHER_MAX_SPEED,
  },
  { name: 'CircusLemur', make: () => new CircusLemur(0, 0, TILE_SIZE), cap: LEMUR_MAX_SPEED },
  {
    name: 'SkeletonArcher',
    make: () => new SkeletonArcher(0, 0, TILE_SIZE),
    cap: SKELETON_ARCHER_MAX_SPEED,
  },
  {
    name: 'SkeletonWarrior',
    make: () => new SkeletonWarrior(0, 0, TILE_SIZE),
    cap: SKELETON_MAX_SPEED,
  },
  { name: 'StiltClown', make: () => new StiltClown(0, 0, TILE_SIZE), cap: STILT_CLOWN_MAX_SPEED },
  { name: 'FatClown', make: () => new FatClown(0, 0, TILE_SIZE), cap: FAT_CLOWN_MAX_SPEED },
  { name: 'Mantid', make: () => new Mantid(0, 0, TILE_SIZE), cap: MANTID_MAX_SPEED },
  { name: 'MantisCrony', make: () => new MantisCrony(0, 0, TILE_SIZE), cap: MANTIS_MAX_SPEED },
  { name: 'TheLich', make: () => new TheLich(0, 0, TILE_SIZE), cap: LICH_MAX_SPEED },
];

/** Base speed for {@link SpeedCapTestMob} — high enough that level 20 clearly exceeds its cap. */
const SPEED_CAP_TEST_MOB_BASE_SPEED = 2.0;
/** The cap {@link SpeedCapTestMob} declares — below what level 20 would otherwise reach. */
const SPEED_CAP_TEST_MOB_CAP = 3.0;

/**
 * A minimal capped mob whose only job is to prove `setBaseSpeed` itself
 * clamps — no registry creature exercises that path today, since none of the
 * game's `setBaseSpeed` callers (the Hoarder, BrindleGrub, SkyFowl, Juicer)
 * declare a `levelledSpeedCap`.
 */
class SpeedCapTestMob extends Mob {
  readonly xpValue = 0;
  protected override get eyePlacement(): null {
    return null;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, 1, SPEED_CAP_TEST_MOB_BASE_SPEED);
  }

  protected override get levelledSpeedCap(): number {
    return SPEED_CAP_TEST_MOB_CAP;
  }

  updateAI(): void {
    // No AI: this mob exists only to drive `applyMobLevel`/`setBaseSpeed` directly.
  }

  protected override drawSelf(): void {
    // Never rendered: this script runs headless under Node with no canvas.
  }

  /** Exposes the protected re-author path a real creature's enrage/evolution would use. */
  reauthorSpeed(baseSpeed: number): void {
    this.setBaseSpeed(baseSpeed);
  }
}

section('speed caps');
{
  // A registry that silently lost every entry would report all-green while
  // checking nothing — the exact failure mode a gate exists to catch, not
  // fall into itself.
  check(SPEED_CAPPED_MOBS.length > 0, 'the speed-cap registry actually has entries');

  let everyCapIsSane = true;
  for (const { name, cap } of SPEED_CAPPED_MOBS) {
    if (cap > PLAYER_SPEED * MAX_LEVELLED_WALK_ADVANTAGE + EPSILON) {
      console.log(`  (${name}'s cap of ${cap} exceeds the sanctioned advantage)`);
      everyCapIsSane = false;
    }
  }
  check(
    everyCapIsSane,
    `every declared cap stays within ${MAX_LEVELLED_WALK_ADVANTAGE}x player speed`,
  );

  let everyCapHolds = true;
  for (const { name, make, cap } of SPEED_CAPPED_MOBS) {
    const mob = make();
    mob.applyMobLevel(SPEED_CAP_TEST_LEVEL);
    if (mob.moveSpeed > cap + EPSILON) {
      console.log(`  (${name} walks at ${mob.moveSpeed} against a cap of ${cap})`);
      everyCapHolds = false;
    }
  }
  check(everyCapHolds, `no levelled mob exceeds its declared cap at level ${SPEED_CAP_TEST_LEVEL}`);

  // No registry creature today re-authors its speed via `setBaseSpeed` after
  // levelling (the four `setBaseSpeed` callers in the game — the Hoarder,
  // BrindleGrub, SkyFowl, Juicer — declare no cap), so a checkpoint reset on
  // any of them would pass this check whether or not `setBaseSpeed` clamps at
  // all — the gate-that-cannot-find-its-row trap. Exercised directly instead,
  // against a minimal capped mob built for exactly this: levelled past its
  // cap, then re-authored from its base the way an enrage or evolution would.
  const capped = new SpeedCapTestMob(0, 0, TILE_SIZE);
  capped.applyMobLevel(SPEED_CAP_TEST_LEVEL);
  check(
    capped.moveSpeed <= SPEED_CAP_TEST_MOB_CAP + EPSILON,
    'the test mob itself is capped by applyMobLevel',
  );
  capped.reauthorSpeed(SPEED_CAP_TEST_MOB_BASE_SPEED);
  check(
    capped.moveSpeed <= SPEED_CAP_TEST_MOB_CAP + EPSILON,
    'setBaseSpeed clamps a re-authored speed to the same cap applyMobLevel enforces',
  );
}

// ── Levelled chase speed ─────────────────────────────────────────────────────

/** Side of the open room the fowl chase is measured in, walls included. */
const CHASE_ROOM_TILES = 24;
const CHASE_FOWL_TILE = 3;
/** Far enough that the fowl is still closing on the target when the run ends. */
const CHASE_TARGET_TILE = 20;
/** Frames the chase is measured over, after the first one that plans its route. */
const CHASE_MEASURED_FRAMES = 60;
/** Levels a provoked fowl's chase is compared across: authored, and the top. */
const CHASE_LOW_LEVEL = 1;
const CHASE_HIGH_LEVEL = MAX_MOB_LEVEL;
/** Rounding room on a mean step measured against a speed, in pixels per frame. */
const CHASE_STEP_EPSILON_PX = 1e-6;
/** Decimal places a chase speed is printed to. */
const CHASE_PRINT_DIGITS = 3;

function openChaseRoom(): GameMap {
  const lastTile = CHASE_ROOM_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: CHASE_ROOM_TILES }, (_, y) =>
    Array.from({ length: CHASE_ROOM_TILES }, (_, x) => ({
      tileId: `${x}#${y}`,
      type:
        x === 0 || y === 0 || x === lastTile || y === lastTile
          ? FloorTypeValue.wall
          : FloorTypeValue.tile_floor,
    })),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** The mean pixels per frame a provoked fowl of `level` covers chasing a far target. */
function provokedFowlChase(level: number): { stepPx: number; moveSpeed: number } {
  const map = openChaseRoom();
  const fowl = new SkyFowl(
    CHASE_FOWL_TILE,
    CHASE_FOWL_TILE,
    TILE_SIZE,
    SKYFOWL_TOUGH_FAMILY.canonical,
  );
  fowl.setMap(map);
  fowl.applyMobLevel(level);
  const target = new HumanPlayer(CHASE_TARGET_TILE, CHASE_FOWL_TILE, TILE_SIZE);
  target.godMode = true;
  fowl.takeDamageFrom(1, target, 'explosion');
  fowl.updateAI([target]);
  const startX = fowl.x;
  const startY = fowl.y;
  for (let frame = 0; frame < CHASE_MEASURED_FRAMES; frame++) fowl.updateAI([target]);
  const walkedPx = Math.hypot(fowl.x - startX, fowl.y - startY);
  return { stepPx: walkedPx / CHASE_MEASURED_FRAMES, moveSpeed: fowl.moveSpeed };
}

section('levelled chase speed');
{
  // A fowl breaks into its chase long after spawn, by re-authoring its speed —
  // the moment a flat constant would silently throw its level away.
  const low = provokedFowlChase(CHASE_LOW_LEVEL);
  const high = provokedFowlChase(CHASE_HIGH_LEVEL);
  check(
    low.stepPx > 0 && Math.abs(high.stepPx - high.moveSpeed) <= CHASE_STEP_EPSILON_PX,
    `a provoked level-${CHASE_HIGH_LEVEL} sky fowl chases at its levelled speed (${high.stepPx.toFixed(CHASE_PRINT_DIGITS)} px/frame, speed ${high.moveSpeed.toFixed(CHASE_PRINT_DIGITS)})`,
  );
  check(
    high.stepPx > low.stepPx + CHASE_STEP_EPSILON_PX,
    `levelling speeds up a sky fowl's chase (${low.stepPx.toFixed(CHASE_PRINT_DIGITS)} at level ${CHASE_LOW_LEVEL}, ${high.stepPx.toFixed(CHASE_PRINT_DIGITS)} at level ${CHASE_HIGH_LEVEL})`,
  );
}

// ── Difficulty profiles ──────────────────────────────────────────────────────

/** Party level the bounty-relief check is run at — comfortably into the Dark Knight's range. */
const DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL = 15;
/** Party levels sampled for the band-safety sweep across every profile. */
const MAX_PROFILE_PROBED_PARTY_LEVEL = 30;

const ALL_DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

section('difficulty profiles');
{
  const normal = DIFFICULTY_PROFILES.normal;
  check(
    normal.incomingMobDamageScale === 1 &&
      normal.rewardXpScale === 1 &&
      normal.rewardCoinScale === 1 &&
      normal.bountyPayoutScale === 1 &&
      normal.bountyLevelRatio === 1 &&
      normal.tacticsChanceScale === 1,
    "Normal's scales are all exactly 1 — today's game, untouched",
  );
  check(
    normal.ambientLevelRatio === NORMAL_AMBIENT_LEVEL_RATIO &&
      normal.bossLevelRatio === NORMAL_BOSS_LEVEL_RATIO,
    'Normal’s level ratios match the shipped 0.7 ambient / 0.8 boss curve',
  );

  const easy = DIFFICULTY_PROFILES.easy;
  const hard = DIFFICULTY_PROFILES.hard;
  check(
    easy.incomingMobDamageScale <= normal.incomingMobDamageScale &&
      normal.incomingMobDamageScale <= hard.incomingMobDamageScale,
    'incoming mob damage only ever rises from Kitten to Nightmare',
  );
  check(
    easy.tacticsChanceScale < normal.tacticsChanceScale &&
      normal.tacticsChanceScale < hard.tacticsChanceScale,
    'tactics trait chances are lower on Kitten and higher on Nightmare',
  );
  check(
    easy.ambientLevelRatio <= normal.ambientLevelRatio &&
      normal.ambientLevelRatio <= hard.ambientLevelRatio &&
      easy.bossLevelRatio <= normal.bossLevelRatio &&
      normal.bossLevelRatio <= hard.bossLevelRatio &&
      easy.bountyLevelRatio <= normal.bountyLevelRatio &&
      normal.bountyLevelRatio <= hard.bountyLevelRatio,
    'every level ratio only ever rises from Kitten to Nightmare',
  );
  check(
    easy.rewardXpScale === 1 && easy.rewardCoinScale === 1,
    'Kitten’s reward drop is intrinsic — its explicit reward scales stay at 1',
  );
  check(
    hard.rewardXpScale >= 1 && hard.rewardCoinScale >= 1 && hard.bountyPayoutScale >= 1,
    'Nightmare’s explicit reward scales never fall below 1',
  );
  let everyScaleIsPositive = true;
  for (const difficulty of ALL_DIFFICULTIES) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    for (const value of Object.values(profile)) {
      if (value <= 0) everyScaleIsPositive = false;
    }
  }
  check(everyScaleIsPositive, 'every axis of every profile is strictly positive');

  // Band safety: no profile may let a party of any level roll outside a rule's
  // own band — the invariant that keeps a floor's identity whatever the
  // difficulty toggle says.
  let everyProfileStaysInBand = true;
  for (const difficulty of ALL_DIFFICULTIES) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    for (const band of BAND_SAMPLES) {
      const min = band.minLevel ?? 1;
      const max = band.maxLevel ?? min;
      for (let partyLevel = 1; partyLevel <= MAX_PROFILE_PROBED_PARTY_LEVEL; partyLevel++) {
        const rolled = resolveSpawnLevel(band, partyLevel, profile, Math.random);
        const bossLevel = resolveBossLevel(band, partyLevel, profile);
        if (rolled < min || rolled > max) everyProfileStaysInBand = false;
        if (bossLevel < min || bossLevel > max) everyProfileStaysInBand = false;
      }
    }
  }
  check(everyProfileStaysInBand, 'every profile keeps every roll inside its rule’s band');

  // Bounty levels: every profile stays inside the hard cap, and Kitten is the
  // actual relief being promised — a lower escort level at the same party level.
  let everyProfileStaysInBountyCap = true;
  for (const difficulty of ALL_DIFFICULTIES) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    for (let partyLevel = 1; partyLevel <= MAX_PROFILE_PROBED_PARTY_LEVEL; partyLevel++) {
      const level = bountyMinionLevel(partyLevel, partyLevel, profile);
      if (level < 1 || level > MAX_BOUNTY_MOB_LEVEL) everyProfileStaysInBountyCap = false;
    }
  }
  check(everyProfileStaysInBountyCap, 'every profile keeps a bounty escort within 1..cap');
  check(
    bountyMinionLevel(
      DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL,
      DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL,
      easy,
    ) <
      bountyMinionLevel(
        DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL,
        DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL,
        normal,
      ),
    `Kitten spawns a lower-level bounty escort than Crawler at a level-${DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL} party`,
  );

  // Composes with the "Speed caps" section above: difficulty must never
  // re-open the goblin runaway. `applyMobLevel` itself never reads a profile,
  // so levelling every registry entry straight to 20 (as that section does)
  // would run byte-for-byte the same check three times regardless of profile
  // — the actual seam a profile can affect is the *level a bounty escort
  // spawns at*, so that's what this drives, through `bountyMinionLevel`, the
  // real function that decides a bounty escort's level in production.
  let capsHoldUnderEveryProfile = true;
  for (const difficulty of ALL_DIFFICULTIES) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    const level = bountyMinionLevel(
      DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL,
      DIFFICULTY_BOUNTY_TEST_PARTY_LEVEL,
      profile,
    );
    for (const { name, make, cap } of SPEED_CAPPED_MOBS) {
      const mob = make();
      mob.applyMobLevel(level);
      if (mob.moveSpeed > cap + EPSILON) {
        console.log(
          `  (${name} at level ${level} on ${difficulty} walks at ${mob.moveSpeed} against a cap of ${cap})`,
        );
        capsHoldUnderEveryProfile = false;
      }
    }
  }
  check(
    capsHoldUnderEveryProfile,
    'every speed cap holds at the bounty escort level each profile actually derives',
  );

  // Speed caps are level-driven, not profile-driven — `mob.applyMobLevel` never
  // reads a `DifficultyProfile` — so the sweep above is a fixed point rather
  // than three different worlds. What actually varies by profile is reward
  // scaling, checked below.
  const rewardMob = new Goblin(0, 0, TILE_SIZE, 'sword');
  const baseXp = rewardMob.scaledXpValue;
  rewardMob.applyDifficultyRewards(hard.rewardXpScale, hard.rewardCoinScale);
  check(
    rewardMob.scaledXpValue > baseXp,
    'applyDifficultyRewards actually raises scaledXpValue on Nightmare',
  );
  const xpAfterFirstApply = rewardMob.scaledXpValue;
  console.log('  (the warning below is the check working, not a failure)');
  rewardMob.applyDifficultyRewards(hard.rewardXpScale, hard.rewardCoinScale);
  check(
    rewardMob.scaledXpValue === xpAfterFirstApply,
    'a second applyDifficultyRewards is refused rather than compounded',
  );
}

// ── Progression regions ──────────────────────────────────────────────────────

section('progression regions');
{
  const def = level1;
  const gauntlets = def.progression?.gauntlets.length ?? 0;
  const data = generateDungeon({ ...dungeonOptionsForLevel(def), size: def.mapSize });
  const regions = new Set(data.mobSpawnPoints.map((point) => point.region));

  check(
    [...regions].every((region) => region >= 0 && region <= gauntlets),
    'every room is tagged with a region its floor actually has',
  );
  check(
    regions.size === gauntlets + 1,
    `floor 1 populates all ${gauntlets + 1} of its regions (saw ${regions.size})`,
  );

  // A room's tag has to agree with where it physically is, or the escalation is
  // attached to the wrong half of the floor and nothing on screen would say so.
  const bounds = data.progressionLayout?.gauntletRoomBounds ?? [];
  let tagsMatchGeometry = true;
  for (const point of data.mobSpawnPoints) {
    const owning = bounds.findIndex((rects) =>
      rects.some(
        (rect) =>
          point.x >= rect.x &&
          point.x < rect.x + rect.w &&
          point.y >= rect.y &&
          point.y < rect.y + rect.h,
      ),
    );
    const expected = owning === -1 ? gauntlets : owning;
    if (point.region !== expected) tagsMatchGeometry = false;
  }
  check(tagsMatchGeometry, 'each room’s region matches the gauntlet whose bounds contain it');
}

// ── Floor 1's bombers wait behind the Juicer ─────────────────────────────────

/** Floor-1 maps generated and populated for the bomber check. */
const BOMBER_MAP_SEEDS = 6;
/** Rooms rolled per region for the bomber check, on top of the real maps. */
const BOMBER_ROOM_ROLLS = 4000;
const BOMBER_SEED_BASE = 0xb0b;
/** A mid-floor party, inside every band the floor authors. */
const BOMBER_CHECK_PARTY_LEVEL = 5;

/** Whether a mob is one of the goblins that lob explosives. */
function isBomber(mob: Mob): boolean {
  return mob.bombThrower !== null;
}

const bomberProbeMap = openChaseRoom();

/** Whether a spawn rule's type is a bomber's, read off the creature it builds. */
function isBomberType(type: StandaloneMobKind): boolean {
  return isBomber(spawnMob(type, { x: 0, y: 0 }, bomberProbeMap, liveSpawnContext('dev:spawn')));
}

section("floor 1's bombers wait behind the Juicer");
{
  const def = level1;
  const profile = DIFFICULTY_PROFILES.normal;
  const juicerGauntlet = def.progression?.gauntlets.findIndex(
    (gauntlet) => gauntlet.bossType === 'juicer',
  );
  check(juicerGauntlet !== undefined && juicerGauntlet >= 0, 'floor 1 still has a Juicer gauntlet');
  const postJuicerRegion = (juicerGauntlet ?? 0) + 1;

  // Every rule that is not a room's own escort has no region to gate on, so
  // none may name a bomber at all.
  const ungatedTypes = [
    ...def.hallwayMobs.flatMap((rule) => [rule.type, ...(rule.escorts ?? []).map((e) => e.type)]),
    ...def.roomMobs.map((rule) => rule.type),
    ...(def.extraSpawns ?? []).map((rule) => rule.type),
  ];
  check(
    !ungatedTypes.some(isBomberType),
    'no floor-1 hallway, extra spawn or room host rule fields a bomber',
  );

  const random = Math.random;
  let earlyRolled = 0;
  let lateRolled = 0;
  Math.random = mulberry32(BOMBER_SEED_BASE);
  for (const region of progressionRegions(def)) {
    for (const rule of def.roomMobs) {
      for (let roll = 0; roll < BOMBER_ROOM_ROLLS; roll++) {
        const { escorts } = rollRoomPopulation(
          def,
          rule,
          region,
          BOMBER_CHECK_PARTY_LEVEL,
          profile,
          Math.random,
        );
        const bombers = escorts.filter((escort) => isBomberType(escort.type)).length;
        if (region < postJuicerRegion) earlyRolled += bombers;
        else lateRolled += bombers;
      }
    }
  }

  let earlySpawned = 0;
  let lateSpawned = 0;
  let unplaced = 0;
  for (let seed = 0; seed < BOMBER_MAP_SEEDS; seed++) {
    Math.random = mulberry32(BOMBER_SEED_BASE + seed);
    const map = new GameMap({
      mapSize: def.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'dungeon',
      dungeon: dungeonOptionsForLevel(def),
    });
    const mobs = [
      ...spawnForLevel(def, map, BOMBER_CHECK_PARTY_LEVEL, profile, new Set(), Math.random),
      ...spawnExtraMobs(def, map, BOMBER_CHECK_PARTY_LEVEL, profile, Math.random),
      ...spawnTreasureRoomMobs(
        map.treasureRooms,
        def,
        map,
        BOMBER_CHECK_PARTY_LEVEL,
        profile,
        Math.random,
      ),
    ];
    for (const mob of mobs.filter(isBomber)) {
      const tileX = Math.floor(mob.x / TILE_SIZE);
      const tileY = Math.floor(mob.y / TILE_SIZE);
      const room = map.mobSpawnPoints.find((point) => {
        const bounds = roomSpawnBounds(point);
        return (
          tileX >= bounds.minTX &&
          tileX <= bounds.maxTX &&
          tileY >= bounds.minTY &&
          tileY <= bounds.maxTY
        );
      });
      if (room === undefined) unplaced++;
      else if (room.region < postJuicerRegion) earlySpawned++;
      else lateSpawned++;
    }
  }
  Math.random = random;

  check(
    earlyRolled === 0 && earlySpawned === 0 && unplaced === 0,
    `no bomber spawns before the Juicer (${earlyRolled} rolled, ${earlySpawned} on ${BOMBER_MAP_SEEDS} maps, ${unplaced} outside a room)`,
  );
  check(
    lateRolled > 0 && lateSpawned > 0,
    `bombers do spawn past the Juicer (${lateRolled} rolled, ${lateSpawned} on ${BOMBER_MAP_SEEDS} maps)`,
  );
}

// ── Bomber goblins: a throw the target can walk out of ───────────────────────

/** Where the bomber and its target start, in tiles of the open chase room. */
const BOMBER_THROW_BOMBER_TILE_X = 11;
const BOMBER_THROW_TARGET_TILE_X = 6;
const BOMBER_THROW_ROW = 12;
/** A corner of the room, out of every blast, where the dodger waits for a landing. */
const BOMBER_THROW_DODGER_PARK_TILE = 2;
/** Long enough for a light, a lock, a throw, a flight and a whole fuse. */
const BOMBER_THROW_MAX_FRAMES = 900;
/**
 * The target circles its start tile until the throw is committed: a circle
 * rather than a back-and-forth strafe, so every stretch of a lock sees it
 * travel the same chord and no lock can straddle a turn and sit still. Slower
 * than a walk, and small enough to keep it inside the bomber's band.
 */
const BOMBER_TARGET_CIRCLE_RADIUS_PX = TILE_SIZE;
const BOMBER_TARGET_CIRCLE_PERIOD_FRAMES = 240;
/**
 * How far the target must have moved between the first lock frame and the
 * release for the lock check to mean anything: a landing re-aimed at the
 * release would sit at least this far from the locked one.
 */
const BOMBER_MIN_LOCK_DRIFT_PX = TILE_SIZE / 4;
/** The furthest ahead of a target's feet a bombardier's locked landing may sit, on the difficulty being played. */
function maxAimLeadPx(): number {
  return TILE_SIZE * activeBomberTuning().maxAimLeadTiles;
}
/**
 * Frames a close-range probe watches a bomber with a crawler in its face: past
 * a drop's release and a hop's lock, but short of the backing off that would
 * carry it far enough for an ordinary lob.
 */
const BOMBER_CLOSE_PROBE_FRAMES = 30;
/**
 * Frames the measured release-to-blast may fall short of flight plus fuse:
 * the release is seen on the frame the system launches it, and the landing
 * and the blast each tick on the frame they happen.
 */
const BOMBER_TIMING_SLACK_FRAMES = 2;
/** How far from the bomber the close-range probe's crawler stands, in tiles. */
const BOMBER_CLOSE_PROBE_OFFSET_TILES = 1;
/** Room for floating-point error when two landings are compared, in pixels. */
const LANDING_MATCH_EPSILON_PX = 1e-6;
/** Bomber levels a throw is compared across: authored, and the top. */
const BOMBER_LOW_LEVEL = 1;
const BOMBER_HIGH_LEVEL = MAX_MOB_LEVEL;
/** A late floor's reference party level, for the blast-size comparison. */
const BOMBER_LATE_FLOOR_PARTY_LEVEL = 26;
/** Floors whose blast size is compared across bomber levels: the first, and a late one. */
const BOMBER_DAMAGE_FLOOR_PARTY_LEVELS = [1, BOMBER_LATE_FLOOR_PARTY_LEVEL] as const;

const BOMBER_TYPES = ['goblin_dynamiter', 'goblin_bombardier'] as const;
/** Any hireling serves as the control on the landing; a sturdy one outlives the blast. */
const BOMBER_CONTROL_HIRELING = 'sledge' as const satisfies MercenaryTemplateId;
type BomberType = (typeof BOMBER_TYPES)[number];

/** What one real throw at a moving target did, frame by frame. */
interface BomberThrowRun {
  crawlerHpShare: number;
  /** Frames a black powder landing was locked before the bomb left the hand. */
  lockFrames: number;
  /**
   * Whether the first locked landing sat ahead of the target's feet along its
   * motion, as that frame's AI saw them, and no further than the aim's lead cap.
   */
  lockedLeadingTarget: boolean;
  /** How far the first locked landing sat from the target's feet, in pixels. */
  lockLeadPx: number;
  /** Whether the locked landing never moved for the rest of the lock. */
  lockHeld: boolean;
  /** Whether the bomb in the air flew to the first locked landing. */
  flewToLock: boolean;
  /** How far the target's feet travelled between the first lock frame and the release. */
  targetDriftDuringLockPx: number;
  /** Frames from the release to the stick touching the floor (dynamite only). */
  releaseToLandingFrames: number | null;
  /** Frames from the release to the blast. */
  releaseToBlastFrames: number | null;
  /** How far the dodger's centre was from the blast when it went off. */
  dodgerDistanceAtBlastPx: number | null;
  dodgerHpLost: number;
  /** Blows the dodger's own dodge roll turned aside: a blast that reached it all the same. */
  dodgerDodges: number;
  /**
   * Health lost by a hireling left standing on the landing, the control for
   * the dodge. A mob rather than a crawler because mobs never roll a dodge, so
   * the control cannot pass or fail on the dice.
   */
  standerHpLost: number;
  blastRadiusPx: number;
}

function sameGroundPoint(a: BombPoint, b: BombPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= LANDING_MATCH_EPSILON_PX;
}

function feetOfCrawler(crawler: { readonly x: number; readonly y: number }): BombPoint {
  return { x: crawler.x + TILE_SIZE / 2, y: crawler.y + TILE_SIZE / 2 };
}

function standOn(crawler: { x: number; y: number }, point: BombPoint): void {
  crawler.x = point.x - TILE_SIZE / 2;
  crawler.y = point.y - TILE_SIZE / 2;
}

/**
 * Drives a real bomber of `type` at `mobLevel`, levelled and stamped as a spawn
 * is, through its first throw at a moving target, in the real
 * `GoblinBombSystem`.
 *
 * The moment the landing is known — the stick touching the floor, or the black
 * powder lock beginning — a dodger is dropped on it; once the throw has left
 * the hand the target stops moving, and it and a hireling stand on the landing
 * as the control. The dodger stands still for
 * `GOBLIN_BOMB_DODGE_REACTION_FRAMES`, then walks straight away from the
 * bomber at `PLAYER_SPEED`: the way a stick rolls, so the worst case for it.
 */
function runBomberThrow(type: BomberType, mobLevel: number): BomberThrowRun {
  const map = openChaseRoom();
  const roster = new MobRoster(map, new SpellSystem());
  const target = new HumanPlayer(BOMBER_THROW_TARGET_TILE_X, BOMBER_THROW_ROW, TILE_SIZE);
  const dodger = new CatPlayer(
    BOMBER_THROW_DODGER_PARK_TILE,
    BOMBER_THROW_DODGER_PARK_TILE,
    TILE_SIZE,
  );
  const bomber = spawnMob(
    type,
    { x: BOMBER_THROW_BOMBER_TILE_X, y: BOMBER_THROW_ROW },
    map,
    liveSpawnContext('dev:spawn'),
  );
  bomber.applyMobLevel(mobLevel);
  applySpawnDifficulty(bomber);
  roster.add(bomber);
  const thrower = bomber.bombThrower;
  const system = new GoblinBombSystem({
    gameMap: map,
    bus: null,
    destructibles: null,
    trees: () => null,
    siegeStructures: () => null,
  });
  const stander = new Mercenary(
    BOMBER_THROW_DODGER_PARK_TILE,
    BOMBER_THROW_DODGER_PARK_TILE,
    TILE_SIZE,
    target,
    BOMBER_CONTROL_HIRELING,
    getMercenaryTemplate(BOMBER_CONTROL_HIRELING).name,
  );
  stander.setMap(map);
  const ctx: SystemContext = {
    human: target,
    cat: dodger,
    active: target,
    inactive: dodger,
    activeIsMoving: false,
    roster,
    gameMap: map,
    extraTargets: [stander],
  };
  const run: BomberThrowRun = {
    crawlerHpShare: bomber instanceof GoblinBomber ? bomber.crawlerHpShare : 0,
    lockFrames: 0,
    lockedLeadingTarget: false,
    lockLeadPx: 0,
    lockHeld: true,
    flewToLock: false,
    targetDriftDuringLockPx: 0,
    releaseToLandingFrames: null,
    releaseToBlastFrames: null,
    dodgerDistanceAtBlastPx: null,
    dodgerHpLost: 0,
    dodgerDodges: 0,
    standerHpLost: 0,
    blastRadiusPx: goblinBombBlastRadiusPx(
      type === 'goblin_dynamiter' ? 'dynamite' : 'black_powder',
    ),
  };
  if (thrower === null) return run;

  let firstLock: BombPoint | null = null;
  let targetFeetAtLock: BombPoint | null = null;
  let releasedAt: number | null = null;
  let landing: BombPoint | null = null;
  let landingKnownAt = 0;
  let fleeX = 0;
  let fleeY = 0;
  let standerHpBefore = 0;
  let dodgerHpBefore = 0;
  let dodgesBefore = 0;

  let standerParked = false;
  const targetStartX = target.x;
  const targetStartY = target.y;

  const dropDodgerOnLanding = (point: BombPoint, frame: number): void => {
    landing = point;
    landingKnownAt = frame;
    standOn(dodger, point);
    const bomberFeet = feetOfCrawler(bomber);
    const away = Math.hypot(point.x - bomberFeet.x, point.y - bomberFeet.y);
    fleeX = (point.x - bomberFeet.x) / away;
    fleeY = (point.y - bomberFeet.y) / away;
    dodgerHpBefore = dodger.hp;
    dodgesBefore = dodger.pendingDodges;
  };

  let previousTargetFeet = feetOfCrawler(target);
  for (let frame = 0; frame < BOMBER_THROW_MAX_FRAMES; frame++) {
    const targetFeet = feetOfCrawler(target);
    const targetStep = {
      x: targetFeet.x - previousTargetFeet.x,
      y: targetFeet.y - previousTargetFeet.y,
    };
    previousTargetFeet = targetFeet;
    bomber.updateAI([target]);
    bomber.tickTimers();

    const locked = thrower.lockedBombLanding;
    if (locked !== null && releasedAt === null) {
      run.lockFrames++;
      if (firstLock === null) {
        firstLock = { x: locked.x, y: locked.y };
        targetFeetAtLock = targetFeet;
        const leadX = locked.x - targetFeet.x;
        const leadY = locked.y - targetFeet.y;
        run.lockLeadPx = Math.hypot(leadX, leadY);
        const leadsAlongMotion = leadX * targetStep.x + leadY * targetStep.y > 0;
        const withinLeadCap = run.lockLeadPx <= maxAimLeadPx() + LANDING_MATCH_EPSILON_PX;
        run.lockedLeadingTarget = leadsAlongMotion && withinLeadCap;
      } else if (!sameGroundPoint(locked, firstLock)) {
        run.lockHeld = false;
      }
    }

    const flightsBefore = system.liveFlights.length;
    system.update(ctx);
    if (releasedAt === null && system.liveFlights.length > flightsBefore) {
      releasedAt = frame;
      const flight = system.liveFlights[system.liveFlights.length - 1];
      if (firstLock !== null)
        run.flewToLock = sameGroundPoint({ x: flight.toX, y: flight.toY }, firstLock);
      if (targetFeetAtLock !== null) {
        const releasedFeet = feetOfCrawler(target);
        run.targetDriftDuringLockPx = Math.hypot(
          releasedFeet.x - targetFeetAtLock.x,
          releasedFeet.y - targetFeetAtLock.y,
        );
      }
    }
    // The lock is the black powder's only warning, so its dodge clock starts
    // on the first lock frame; a stick's starts when it touches the floor.
    if (landing === null && firstLock !== null) dropDodgerOnLanding(firstLock, frame);

    let blasted: BombPoint | null = null;
    for (const cue of system.takeCues()) {
      if (cue.cue === 'stickLanded') {
        if (run.releaseToLandingFrames === null && releasedAt !== null) {
          run.releaseToLandingFrames = frame - releasedAt;
          if (landing === null) dropDodgerOnLanding({ x: cue.x, y: cue.y }, frame);
        }
      } else if (blasted === null) {
        blasted = { x: cue.x, y: cue.y };
      }
    }
    // The target keeps moving until the throw is committed to the ground,
    // so the lock is tested against a moving target, then stands on the
    // landing as the control the dodge is measured against.
    if (!standerParked && releasedAt !== null && landing !== null) {
      standerParked = true;
      standOn(target, landing);
      standOn(stander, landing);
      standerHpBefore = stander.hp;
    }
    if (blasted !== null) {
      if (releasedAt !== null) run.releaseToBlastFrames = frame - releasedAt;
      const dodgerFeet = feetOfCrawler(dodger);
      run.dodgerDistanceAtBlastPx = Math.hypot(dodgerFeet.x - blasted.x, dodgerFeet.y - blasted.y);
      run.dodgerHpLost = dodgerHpBefore - dodger.hp;
      run.dodgerDodges = dodger.pendingDodges - dodgesBefore;
      run.standerHpLost = standerHpBefore - stander.hp;
      return run;
    }

    if (!standerParked) {
      const angle = (2 * Math.PI * (frame + 1)) / BOMBER_TARGET_CIRCLE_PERIOD_FRAMES;
      target.x = targetStartX + BOMBER_TARGET_CIRCLE_RADIUS_PX * (Math.cos(angle) - 1);
      target.y = targetStartY + BOMBER_TARGET_CIRCLE_RADIUS_PX * Math.sin(angle);
    }
    if (landing !== null && frame - landingKnownAt >= GOBLIN_BOMB_DODGE_REACTION_FRAMES) {
      dodger.x += fleeX * PLAYER_SPEED;
      dodger.y += fleeY * PLAYER_SPEED;
    }
  }
  return run;
}

section('bomber goblins throw at the ground, and the ground can be left');
{
  for (const difficulty of ALL_DIFFICULTIES) {
    const tuning = BOMBER_TUNING[difficulty];
    check(
      isAtLeast(tuning.bombardierLockFrames, LOCKED_TELEGRAPH_MIN_FRAMES),
      `${difficulty}: the Black Powder Goblin's lock is at least ${LOCKED_TELEGRAPH_MIN_FRAMES} frames (${tuning.bombardierLockFrames})`,
    );
    check(
      goblinDynamiteDodgeMarginFrames(tuning) > 0 &&
        isBelow(
          GOBLIN_BOMB_DODGE_REACTION_FRAMES + GOBLIN_DYNAMITE_WALK_OUT_FRAMES,
          tuning.fuse.frames,
        ),
      `${difficulty}: a stick's fuse outlasts a reaction and a walk out: ${GOBLIN_BOMB_DODGE_REACTION_FRAMES} + ${GOBLIN_DYNAMITE_WALK_OUT_FRAMES} < ${tuning.fuse.frames}`,
    );
    check(
      blackPowderDodgeMarginFrames(tuning) > 0 &&
        isBelow(
          GOBLIN_BOMB_DODGE_REACTION_FRAMES + BLACK_POWDER_WALK_OUT_FRAMES,
          tuning.bombardierLockFrames + tuning.blackPowderFlightFrames,
        ),
      `${difficulty}: a black powder lock and flight outlast a reaction and a walk out: ${GOBLIN_BOMB_DODGE_REACTION_FRAMES} + ${BLACK_POWDER_WALK_OUT_FRAMES} < ${tuning.bombardierLockFrames} + ${tuning.blackPowderFlightFrames}`,
    );
  }

  const savedFloorLevel = floorReferencePartyLevel();
  for (const floorPartyLevel of BOMBER_DAMAGE_FLOOR_PARTY_LEVELS) {
    setFloorReferencePartyLevel(floorPartyLevel);
    for (const type of BOMBER_TYPES) {
      // Through the real blast and a real crawler's own bar, with the source
      // each bomber stamps, so anything level-scaled on the way would show.
      const blastAt = (level: number): { crawlerLost: number; structureBase: number } => {
        const bomber = spawnMob(
          type,
          { x: 0, y: 0 },
          bomberProbeMap,
          liveSpawnContext('dev:spawn'),
        );
        bomber.applyMobLevel(level);
        applySpawnDifficulty(bomber);
        if (!(bomber instanceof GoblinBomber)) return { crawlerLost: 0, structureBase: 0 };
        const crawler = new HumanPlayer(0, 0, TILE_SIZE);
        const feet = feetOfCrawler(crawler);
        const hpBefore = crawler.hp;
        applyGoblinBlastToBodies(
          {
            x: feet.x,
            y: feet.y,
            radiusPx: goblinBombBlastRadiusPx(bomber.archetype),
            crawlerHpShare: bomber.crawlerHpShare,
            thrower: bomber,
            source: bomber.stampHarmLimits({
              kind: 'mob',
              mobType: bomber.mobType,
              undodgeable: true,
            }),
          },
          [crawler],
          [],
        );
        return { crawlerLost: hpBefore - crawler.hp, structureBase: bomber.referenceBlastDamage };
      };
      const low = blastAt(BOMBER_LOW_LEVEL);
      const high = blastAt(BOMBER_HIGH_LEVEL);
      check(
        low.crawlerLost > 0 && low.crawlerLost === high.crawlerLost,
        `${type} on a party-level-${floorPartyLevel} floor: a crawler caught in the blast loses the same at bomber level ${BOMBER_LOW_LEVEL} and ${BOMBER_HIGH_LEVEL} (${low.crawlerLost} vs ${high.crawlerLost} hp)`,
      );
      check(
        low.structureBase > 0 && low.structureBase === high.structureBase,
        `${type} on a party-level-${floorPartyLevel} floor: the blast a siege wall's damage is built on is the same at bomber level ${BOMBER_LOW_LEVEL} and ${BOMBER_HIGH_LEVEL} (${low.structureBase} vs ${high.structureBase})`,
      );
    }
  }

  setFloorReferencePartyLevel(BOMBER_LATE_FLOOR_PARTY_LEVEL);
  const random = Math.random;
  for (const type of BOMBER_TYPES) {
    Math.random = mulberry32(BOMBER_SEED_BASE);
    const low = runBomberThrow(type, BOMBER_LOW_LEVEL);
    Math.random = mulberry32(BOMBER_SEED_BASE);
    const high = runBomberThrow(type, BOMBER_HIGH_LEVEL);

    for (const [label, run] of [
      [`level ${BOMBER_LOW_LEVEL}`, low],
      [`level ${BOMBER_HIGH_LEVEL}`, high],
    ] as const) {
      const name = `${type} at ${label}`;
      check(
        run.releaseToBlastFrames !== null,
        `${name} throws at a moving target and the blast goes off`,
      );
      check(
        run.standerHpLost > 0,
        `${name}: a hireling left standing on the landing is hurt (${run.standerHpLost})`,
      );
      const distance = run.dodgerDistanceAtBlastPx ?? 0;
      check(
        distance > run.blastRadiusPx && run.dodgerHpLost === 0 && run.dodgerDodges === 0,
        `${name}: a crawler who walks off the landing a reaction late is clear when it blows (${distance.toFixed(1)} px from a ${run.blastRadiusPx} px blast, ${run.dodgerHpLost} hp lost, ${run.dodgerDodges} dodged)`,
      );
      if (type !== 'goblin_bombardier') continue;
      check(
        isAtLeast(run.lockFrames, LOCKED_TELEGRAPH_MIN_FRAMES),
        `${name}: the landing is locked for ${run.lockFrames} frames before the throw (min ${LOCKED_TELEGRAPH_MIN_FRAMES})`,
      );
      check(
        run.lockedLeadingTarget &&
          run.lockHeld &&
          run.flewToLock &&
          run.targetDriftDuringLockPx >= BOMBER_MIN_LOCK_DRIFT_PX,
        `${name}: the bomb lands where the first lock frame put it, ${run.lockLeadPx.toFixed(1)} px ahead of the moving target (max ${maxAimLeadPx()}), though the target moved ${run.targetDriftDuringLockPx.toFixed(1)} px before the throw`,
      );
    }

    check(
      low.releaseToLandingFrames === high.releaseToLandingFrames &&
        low.releaseToBlastFrames === high.releaseToBlastFrames &&
        low.lockFrames === high.lockFrames,
      `${type}: flight, fuse and lock take as long at bomber level ${BOMBER_HIGH_LEVEL} as at ${BOMBER_LOW_LEVEL} (${high.releaseToBlastFrames} vs ${low.releaseToBlastFrames} frames from release to blast)`,
    );
    check(
      low.crawlerHpShare === high.crawlerHpShare && low.standerHpLost === high.standerHpLost,
      `${type}: a hireling on the landing loses as much to a level-${BOMBER_HIGH_LEVEL} bomber as to a level-${BOMBER_LOW_LEVEL} one (${high.standerHpLost} vs ${low.standerHpLost})`,
    );
  }
  Math.random = random;
  setFloorReferencePartyLevel(savedFloorLevel);
}

/**
 * Whether a bomber of `type` with a crawler standing in its face answers with
 * its close-range move — a stick let go or a landing locked while a lob from
 * there could not land clear of it — within {@link BOMBER_CLOSE_PROBE_FRAMES}.
 */
function closeMoveFires(type: BomberType): boolean {
  const map = openChaseRoom();
  const bomber = spawnMob(
    type,
    { x: BOMBER_THROW_BOMBER_TILE_X, y: BOMBER_THROW_ROW },
    map,
    liveSpawnContext('dev:spawn'),
  );
  const crawler = new HumanPlayer(
    BOMBER_THROW_BOMBER_TILE_X - BOMBER_CLOSE_PROBE_OFFSET_TILES,
    BOMBER_THROW_ROW,
    TILE_SIZE,
  );
  const thrower = bomber.bombThrower;
  if (thrower === null) return false;
  for (let frame = 0; frame < BOMBER_CLOSE_PROBE_FRAMES; frame++) {
    bomber.updateAI([crawler]);
    bomber.tickTimers();
    if (thrower.takePendingBombs().length > 0 || thrower.lockedBombLanding !== null) return true;
  }
  return false;
}

/**
 * Shots a bomber of `type` lets go in its first throw, and whether a locked
 * landing is left behind once the throw ends, when the difficulty flips from
 * `from` to `to` on the `flipAtThrowFrame`th frame of its throw row.
 */
function throwAcrossFlip(
  type: BomberType,
  from: Difficulty,
  to: Difficulty,
  flipAtThrowFrame: number,
): { shots: number; lockLeftBehind: boolean } {
  settings.setDifficultyForSession(from);
  const map = openChaseRoom();
  const bomber = spawnMob(
    type,
    { x: BOMBER_THROW_BOMBER_TILE_X, y: BOMBER_THROW_ROW },
    map,
    liveSpawnContext('dev:spawn'),
  );
  const crawler = new HumanPlayer(BOMBER_THROW_TARGET_TILE_X, BOMBER_THROW_ROW, TILE_SIZE);
  const thrower = bomber.bombThrower;
  if (thrower === null || !(bomber instanceof GoblinBomber)) {
    return { shots: 0, lockLeftBehind: false };
  }
  let shots = 0;
  let throwFrame = -1;
  let flipped = false;
  for (let frame = 0; frame < BOMBER_THROW_MAX_FRAMES; frame++) {
    bomber.updateAI([crawler]);
    bomber.tickTimers();
    shots += thrower.takePendingBombs().length;
    if (bomber.currentAction === 'throw') {
      throwFrame++;
      if (!flipped && throwFrame === flipAtThrowFrame) {
        settings.setDifficultyForSession(to);
        flipped = true;
      }
    } else if (flipped) {
      return { shots, lockLeftBehind: thrower.lockedBombLanding !== null };
    } else {
      shots = 0;
      throwFrame = -1;
    }
  }
  return { shots, lockLeftBehind: thrower.lockedBombLanding !== null };
}

section('a difficulty flipped mid-throw throws exactly once');
{
  const savedDifficulty = settings.difficulty;
  const flips: readonly (readonly [Difficulty, Difficulty])[] = [
    ['normal', 'easy'],
    ['easy', 'normal'],
  ];
  for (const type of BOMBER_TYPES) {
    const archetype = type === 'goblin_dynamiter' ? 'dynamite' : 'black_powder';
    for (const [from, to] of flips) {
      const throwFrames = BOMBER_TUNING[from].actionFrames[archetype].throw;
      const failures: string[] = [];
      for (let flipAt = 0; flipAt < throwFrames; flipAt++) {
        const result = throwAcrossFlip(type, from, to, flipAt);
        if (result.shots !== 1 || result.lockLeftBehind) {
          failures.push(`@${flipAt}: ${result.shots} shots, lock left ${result.lockLeftBehind}`);
        }
      }
      check(
        failures.length === 0,
        `${type}, ${from} → ${to} on every frame of the throw: one shot and no lock left behind${failures.length === 0 ? '' : ` (${failures.join('; ')})`}`,
      );
    }
  }
  settings.setDifficultyForSession(savedDifficulty);
}

section('Kitten bombers keep the gentler mechanics');
{
  const kitten = BOMBER_TUNING.easy;
  const crawler = BOMBER_TUNING.normal;
  check(
    kitten.fuse.frames > crawler.fuse.frames &&
      kitten.bombardierLockFrames > crawler.bombardierLockFrames &&
      kitten.dynamiteFlightFrames > crawler.dynamiteFlightFrames &&
      kitten.blackPowderFlightFrames > crawler.blackPowderFlightFrames,
    `Kitten's fuse, lock and flights are slower than Crawler's (fuse ${kitten.fuse.frames} vs ${crawler.fuse.frames}, lock ${kitten.bombardierLockFrames} vs ${crawler.bombardierLockFrames})`,
  );

  const savedDifficulty = settings.difficulty;
  const savedFloorLevel = floorReferencePartyLevel();
  setFloorReferencePartyLevel(BOMBER_LATE_FLOOR_PARTY_LEVEL);
  const random = Math.random;
  for (const type of BOMBER_TYPES) {
    settings.setDifficultyForSession('normal');
    check(closeMoveFires(type), `${type} on Crawler answers a crawler in its face (the control)`);
    settings.setDifficultyForSession('easy');
    check(!closeMoveFires(type), `${type} on Kitten has no close-range drop or hop`);

    Math.random = mulberry32(BOMBER_SEED_BASE);
    const run = runBomberThrow(type, BOMBER_LOW_LEVEL);
    if (type === 'goblin_bombardier') {
      check(
        run.lockLeadPx <= LANDING_MATCH_EPSILON_PX,
        `${type} on Kitten locks onto the moving target's feet, not ahead of them (${run.lockLeadPx.toFixed(1)} px)`,
      );
      // The circle stays up from the first lock frame to the release.
      const lockToRelease =
        kitten.bombardierLockFrames +
        goblinBombReleaseFrame('black_powder', kitten.actionFrames.black_powder.throw);
      check(
        run.lockFrames === lockToRelease,
        `${type} on Kitten holds its landing ${lockToRelease} frames before the throw (${run.lockFrames})`,
      );
    } else {
      const flightAndFuse =
        kitten.dynamiteFlightFrames + kitten.fuse.frames - BOMBER_TIMING_SLACK_FRAMES;
      check(
        run.releaseToBlastFrames !== null && run.releaseToBlastFrames >= flightAndFuse,
        `${type} on Kitten takes its flight and full fuse from release to blast (${run.releaseToBlastFrames} frames, min ${flightAndFuse})`,
      );
    }

    // Read live: a bomber spawned on Crawler walks at Kitten's pace once the toggle flips.
    settings.setDifficultyForSession('normal');
    const bomber = spawnMob(type, { x: 0, y: 0 }, bomberProbeMap, liveSpawnContext('dev:spawn'));
    settings.setDifficultyForSession('easy');
    bomber.updateAI([]);
    check(
      bomber.moveSpeed === kitten.walkSpeed,
      `${type} spawned on Crawler walks at Kitten's ${kitten.walkSpeed} once switched (${bomber.moveSpeed})`,
    );
  }
  Math.random = random;
  settings.setDifficultyForSession(savedDifficulty);
  setFloorReferencePartyLevel(savedFloorLevel);
}

// ── Region level bonuses ─────────────────────────────────────────────────────

/** A shipped band as a region actually spawns it, with the floor and region it came from. */
interface BonusedBand {
  label: string;
  authored: MobLevelRange;
  bonus: number;
  effective: MobLevelRange;
}

/**
 * Every band a shipped floor really shifts, one entry per region that shifts it.
 *
 * Read off `roomMobs` and their escorts because those are what `spawnForLevel`
 * puts through `regionLevelBand`; hallway rules carry no region and are left
 * alone by design, so including them would invent bonuses the game never
 * applies.
 */
function shippedBonusedBands(): BonusedBand[] {
  const bands: BonusedBand[] = [];
  for (const def of LEVEL_DEFS) {
    const bonuses = def.progression?.regionLevelBonus;
    if (bonuses === undefined) continue;
    for (const [region, bonus] of bonuses.entries()) {
      for (const rule of def.roomMobs) {
        for (const band of [rule, ...(rule.escorts ?? [])]) {
          bands.push({
            label: `${def.id} region ${region} ${band.type}`,
            authored: band,
            bonus,
            effective: regionLevelBand(band, bonus),
          });
        }
      }
    }
  }
  return bands;
}

section('region level bonuses');
{
  let bonusArraysCoverTheirRegions = true;
  let bonusArraysAreNonNegative = true;
  for (const def of LEVEL_DEFS) {
    const bonuses = def.progression?.regionLevelBonus;
    if (bonuses === undefined) continue;
    const gauntlets = def.progression?.gauntlets.length ?? 0;
    // One entry per gauntlet plus one for the free-roam region past the last of
    // them, exactly as the spawn-count bonuses are shaped. A short array
    // silently leaves the deepest region — the stretch this axis exists for —
    // at its authored band.
    if (bonuses.length !== gauntlets + 1) bonusArraysCoverTheirRegions = false;
    if (bonuses.some((bonus) => bonus < 0)) bonusArraysAreNonNegative = false;
  }
  check(bonusArraysCoverTheirRegions, 'every region level bonus array covers exactly its regions');
  check(bonusArraysAreNonNegative, 'every region level bonus is non-negative');

  const bonusedBands = shippedBonusedBands();
  // Without this the three checks below would all pass on a floor set that had
  // lost its bonuses entirely, reporting green while measuring nothing.
  check(bonusedBands.length > 0, 'some shipped floor actually carries a region level bonus');
  check(
    bonusedBands.some((entry) => entry.bonus > 0),
    'at least one of those regions shifts its bands by more than zero',
  );

  let staysUnderTheCap = true;
  let neverWeakensABand = true;
  let keepsItsWidth = true;
  for (const { authored, bonus, effective } of bonusedBands) {
    const authoredMin = authored.minLevel ?? 1;
    const authoredMax = authored.maxLevel ?? authoredMin;
    const effectiveMin = effective.minLevel ?? 1;
    const effectiveMax = effective.maxLevel ?? effectiveMin;
    if (effectiveMin > MAX_MOB_LEVEL || effectiveMax > MAX_MOB_LEVEL) staysUnderTheCap = false;
    if (effectiveMin < authoredMin || effectiveMax < authoredMax) neverWeakensABand = false;
    // A bonus says "this stretch is a level harder", not "this stretch can
    // contain anything" — the spread only ever narrows, and only where the cap
    // eats the top of it.
    const authoredWidth = authoredMax - authoredMin;
    const effectiveWidth = effectiveMax - effectiveMin;
    const capClippedTheTop = authoredMax + bonus > MAX_MOB_LEVEL;
    if (capClippedTheTop ? effectiveWidth > authoredWidth : effectiveWidth !== authoredWidth) {
      keepsItsWidth = false;
    }
    if (capClippedTheTop && effectiveMax !== MAX_MOB_LEVEL) staysUnderTheCap = false;
  }
  check(staysUnderTheCap, 'no region bonus pushes a shipped band past the mob level cap');
  check(neverWeakensABand, 'a region bonus only ever moves a band upward');
  check(keepsItsWidth, 'a region bonus shifts a band rather than widening it');

  // The cap again, driven well past anything shipped: the arithmetic has to hold
  // for a bonus a future floor might author, not only for the small ones today's
  // floors use.
  const PROBED_BONUS_LIMIT = MAX_MOB_LEVEL * 2;
  let capHoldsForAnyBonus = true;
  for (const band of BAND_SAMPLES) {
    for (let bonus = 0; bonus <= PROBED_BONUS_LIMIT; bonus++) {
      const shifted = regionLevelBand(band, bonus);
      const min = shifted.minLevel ?? 1;
      const max = shifted.maxLevel ?? min;
      if (min > MAX_MOB_LEVEL || max > MAX_MOB_LEVEL) capHoldsForAnyBonus = false;
      if (max < min) capHoldsForAnyBonus = false;
    }
  }
  check(capHoldsForAnyBonus, `no bonus up to ${PROBED_BONUS_LIMIT} escapes the mob level cap`);

  // The guarantee the whole level axis rests on, restated for a shifted band:
  // raising the band must not raise what the party has *earned* past the party
  // itself. Checked on Crawler, the profile the ratio is calibrated on and the
  // same one the open-band version of this check above uses.
  let bonusedFloorStaysUnderTheParty = true;
  let sawAProbedLevel = false;
  for (const { effective } of bonusedBands) {
    const min = effective.minLevel ?? 1;
    for (let partyLevel = min + 1; partyLevel <= MAX_PROBED_PARTY_LEVEL; partyLevel++) {
      sawAProbedLevel = true;
      if (earnedLevelFloor(effective, partyLevel, DIFFICULTY_PROFILES.normal) >= partyLevel) {
        bonusedFloorStaysUnderTheParty = false;
      }
    }
  }
  check(sawAProbedLevel, 'the bonused-band sweep actually had party levels to probe');
  check(
    bonusedFloorStaysUnderTheParty,
    'a bonused band’s earned floor still sits below the party’s own level',
  );
}

// ── The recommended party level ──────────────────────────────────────────────

/** Ambient band ceiling floor 2 is authored at, and the advice it must produce. */
const FLOOR_2_RECOMMENDED_PARTY_LEVEL = 10;

/** A floor whose only ambient spawn is one band, used to drive the advice curve. */
function floorWithAmbientCeiling(ceiling: number): LevelDef {
  return {
    ...level2,
    roomMobs: [{ type: 'goblin', chance: 1, minLevel: 1, maxLevel: ceiling }],
    hallwayMobs: [],
    campSpawns: {},
  };
}

section('recommended party level');
{
  const normal = DIFFICULTY_PROFILES.normal;
  check(
    recommendedPartyLevelFor(level2, normal) === FLOOR_2_RECOMMENDED_PARTY_LEVEL,
    `floor 2 is advertised as a level-${FLOOR_2_RECOMMENDED_PARTY_LEVEL} floor on Crawler`,
  );

  let monotone = true;
  let everRises = false;
  let alwaysMinimal = true;
  let previous = 0;
  for (let ceiling = 1; ceiling <= MAX_MOB_LEVEL; ceiling++) {
    const recommended = recommendedPartyLevelFor(floorWithAmbientCeiling(ceiling), normal);
    if (recommended < previous) monotone = false;
    if (recommended > previous) everRises = true;
    // The advice is defined as the *smallest* qualifying level, so the level
    // below it must not qualify — otherwise a rounding change could quietly
    // start recommending a level or two of grinding nobody needs.
    const reaches = Math.round(recommended * normal.ambientLevelRatio) >= ceiling;
    const oneBelowReaches = Math.round((recommended - 1) * normal.ambientLevelRatio) >= ceiling;
    if (!reaches || (recommended > 1 && oneBelowReaches)) alwaysMinimal = false;
    previous = recommended;
  }
  check(monotone, 'a higher band ceiling never lowers the recommended level');
  check(everRises, 'the recommendation actually responds to the ceiling at all');
  check(alwaysMinimal, 'the recommendation is the lowest level that reaches the ceiling');

  // Advice that ignored the difficulty toggle would send a Nightmare crawler
  // down on Crawler's numbers against mobs rolled from a steeper ratio.
  check(
    recommendedPartyLevelFor(level2, DIFFICULTY_PROFILES.hard) <
      recommendedPartyLevelFor(level2, normal) &&
      recommendedPartyLevelFor(level2, normal) <
        recommendedPartyLevelFor(level2, DIFFICULTY_PROFILES.easy),
    'a gentler ambient ratio asks for a higher party level before descending',
  );

  // Floor 3's advice is an authored `recommendedLevelOverride` rather than a
  // read of its ambient bands, so it must ignore the difficulty toggle
  // entirely instead of sliding with it like floor 2's does.
  check(
    recommendedPartyLevelFor(level3, DIFFICULTY_PROFILES.easy) ===
      level3.recommendedLevelOverride &&
      recommendedPartyLevelFor(level3, normal) === level3.recommendedLevelOverride &&
      recommendedPartyLevelFor(level3, DIFFICULTY_PROFILES.hard) ===
        level3.recommendedLevelOverride,
    `floor 3's recommended level (${level3.recommendedLevelOverride}) is fixed regardless of difficulty`,
  );
}

// ── The Wayfinder fail-safe ──────────────────────────────────────────────────

section('wayfinder');
{
  check(
    [
      WAYFINDER_GRACE_FRAMES,
      WAYFINDER_PULSE_PERIOD_FRAMES,
      WAYFINDER_PULSE_VISIBLE_FRAMES,
      WAYFINDER_MOTE_SPAWN_INTERVAL_FRAMES,
      WAYFINDER_MOTE_LIFE_FRAMES,
    ].every((frames) => frames > 0),
    'every Wayfinder timing is a positive number of frames',
  );
  // A pulse at least as long as its own period is not a pulse: the hint would
  // never go away, turning the bounded fail-safe into the always-on GPS the
  // design rules out.
  check(
    isBelow(WAYFINDER_PULSE_VISIBLE_FRAMES, WAYFINDER_PULSE_PERIOD_FRAMES),
    'the Wayfinder hint is off for more of each period than it is on',
  );
  // A hint made of two grains of dust is only readable as a direction if the
  // second one arrives while the first is still drifting.
  check(
    isBelow(WAYFINDER_MOTE_SPAWN_INTERVAL_FRAMES, WAYFINDER_MOTE_LIFE_FRAMES),
    'a Wayfinder mote is still adrift when the next one is released',
  );
  // One mote per pulse is a coincidence a player never reads as a bearing, so
  // the window has to have room for a second release — and the cap has to allow
  // it, or the cooldown would come round to a spawn that is refused.
  const releasesPerPulse =
    Math.floor((WAYFINDER_PULSE_VISIBLE_FRAMES - 1) / WAYFINDER_MOTE_RELEASE_COST_FRAMES) + 1;
  check(releasesPerPulse > 1, 'one pulse releases more than a single mote');
  // Measured against the unclamped release count, so a cap set below what the
  // window pays for is caught here rather than quietly throttling every pulse.
  check(
    releasesPerPulse <= WAYFINDER_MOTE_MAX_ALIVE,
    'the concurrent mote cap never throttles a pulse it was not meant to',
  );
  /** A hint of two grains, not a plume: more marks the player rather than the direction. */
  const HINT_MAX_MOTES_PER_PULSE = 2;
  check(releasesPerPulse <= HINT_MAX_MOTES_PER_PULSE, 'a pulse stays a hint rather than a stream');
  /** Past this multiple of a walk the mote stops reading as something the air is doing. */
  const MAX_MOTE_WALK_ADVANTAGE = 2;
  // Dust that outruns a sprinting crawler stops reading as dust; dust slower
  // than a walking one drifts backwards across their screen and points the
  // wrong way. See WAYFINDER_MOTE_SPEED.
  check(
    WAYFINDER_MOTE_SPEED > PLAYER_SPEED &&
      WAYFINDER_MOTE_SPEED < PLAYER_SPEED * MAX_MOTE_WALK_ADVANTAGE,
    'a fail-safe mote outpaces a walking crawler without outrunning one',
  );
  // Motes that outlive the gap between pulses would accumulate into the steady
  // stream that marks a stairwell, rather than the passing hint this is.
  check(
    WAYFINDER_MOTE_LIFE_FRAMES < WAYFINDER_PULSE_PERIOD_FRAMES - WAYFINDER_PULSE_VISIBLE_FRAMES,
    'the fail-safe goes fully quiet between pulses',
  );
  // The grace is the "you have genuinely hunted" evidence the pulse waits for.
  // Shorter than a single pulse period it would fire almost immediately.
  check(
    isBelow(WAYFINDER_PULSE_PERIOD_FRAMES, WAYFINDER_GRACE_FRAMES),
    'the hunt gets longer than one pulse period before the fail-safe starts',
  );
}

section('difficulty telemetry: trait/no-trait HP split');
{
  /** Fixture numbers for the two room fights recorded below. */
  const TRAIT_FIGHT_HP_FRACTION = 0.5;
  const NO_TRAIT_FIGHT_HP_FRACTION = 0.8;
  const TRAIT_FIGHT_SECONDS = 12;
  const NO_TRAIT_FIGHT_SECONDS = 6;
  const TRAIT_FIGHT_BLOCKS = 2;
  const TRAIT_FIGHT_KITE_STARTS = 1;
  const TRAIT_FIGHT_KITE_ENDS = 1;
  const TRAIT_FIGHT_KITE_FRAMES = 30;

  const emptyFightDetails: RoomFightDetails = {
    hpRemainingFraction: 0,
    seconds: 0,
    blocks: 0,
    kiteStarts: 0,
    kiteEnds: 0,
    kiteFramesSum: 0,
    hadTraitMob: false,
  };

  const stats = new DifficultyStats();
  stats.beginRun();
  stats.setFloor(1);
  stats.recordRoomFight({
    ...emptyFightDetails,
    hpRemainingFraction: TRAIT_FIGHT_HP_FRACTION,
    seconds: TRAIT_FIGHT_SECONDS,
    blocks: TRAIT_FIGHT_BLOCKS,
    kiteStarts: TRAIT_FIGHT_KITE_STARTS,
    kiteEnds: TRAIT_FIGHT_KITE_ENDS,
    kiteFramesSum: TRAIT_FIGHT_KITE_FRAMES,
    hadTraitMob: true,
  });
  stats.recordRoomFight({
    ...emptyFightDetails,
    hpRemainingFraction: NO_TRAIT_FIGHT_HP_FRACTION,
    seconds: NO_TRAIT_FIGHT_SECONDS,
  });

  const tally = stats.tallyFor('floor1-pre-hoarder');
  check(tally !== null, 'a segment with recorded fights has a tally');
  if (tally !== null) {
    check(tally.roomFights === 2, `roomFights counts both fights (got ${tally.roomFights})`);
    check(
      tally.blocksSum === TRAIT_FIGHT_BLOCKS,
      `blocksSum carries only the trait fight's blocks (got ${tally.blocksSum})`,
    );
    check(tally.kiteStarts === TRAIT_FIGHT_KITE_STARTS, `kiteStarts (got ${tally.kiteStarts})`);
    check(tally.kiteEnds === TRAIT_FIGHT_KITE_ENDS, `kiteEnds (got ${tally.kiteEnds})`);
    check(
      tally.kiteFramesSum === TRAIT_FIGHT_KITE_FRAMES,
      `kiteFramesSum (got ${tally.kiteFramesSum})`,
    );
    check(
      tally.traitFights === 1,
      `exactly the trait fight lands in the trait bucket (got ${tally.traitFights})`,
    );
    check(
      tally.traitFightsHpRemainingSum === TRAIT_FIGHT_HP_FRACTION,
      `the trait bucket's HP sum is just that fight's fraction (got ${tally.traitFightsHpRemainingSum})`,
    );
    check(
      tally.noTraitFights === 1,
      `exactly the plain fight lands in the no-trait bucket (got ${tally.noTraitFights})`,
    );
    check(
      tally.noTraitFightsHpRemainingSum === NO_TRAIT_FIGHT_HP_FRACTION,
      `the no-trait bucket's HP sum is just that fight's fraction (got ${tally.noTraitFightsHpRemainingSum})`,
    );
  }

  // A gate that cannot find what it measures must fail, not pass vacuously —
  // an untouched segment must report no tally at all rather than one full of
  // zeroes that would satisfy every check above by accident.
  check(
    new DifficultyStats().tallyFor('floor1-pre-hoarder') === null,
    'an untouched segment has no tally',
  );
}

// ── Explosives handling ──────────────────────────────────────────────────────
//
// A stick of dynamite is a consumable bought and dropped at a flat price, thrown
// at mobs whose health grows with every level. The rules: an untrained stick stays
// worth a real share of a same-floor mob at every party level; every point of
// Explosives Handling makes it hit enemies harder; and no boss, bounty mark or
// escort can be deleted by a bag of sticks. Measured through a live
// `DynamiteSystem` blast where the resolution path matters, so a blast that stops
// using the formula fails here too.

const MID_GAME_PARTY_LEVEL = 14;
const LATE_GAME_PARTY_LEVEL = 26;
const EXPLOSIVE_PROBE_PARTY_LEVELS = [MID_GAME_PARTY_LEVEL, LATE_GAME_PARTY_LEVEL];
/**
 * Party levels the boss sweeps run over: from floor 2 to past the mob level cap.
 * Floor 1 is left out because an on-curve thrower there has no points to spend.
 */
const FLOOR_TWO_PARTY_LEVEL = 10;
const UPPER_MID_PARTY_LEVEL = 20;
const PAST_BOSS_CAP_PARTY_LEVEL = 30;
const BOSS_PROBE_PARTY_LEVELS = [
  FLOOR_TWO_PARTY_LEVEL,
  MID_GAME_PARTY_LEVEL,
  UPPER_MID_PARTY_LEVEL,
  LATE_GAME_PARTY_LEVEL,
  PAST_BOSS_CAP_PARTY_LEVEL,
];
/** Scales a share to the percentage printed beside it. */
const PERCENT = 100;
/** A floor-3 regular, levelled to what the party has earned. */
const EXPLOSIVE_TARGET_MOB = 'ruins_ghoul';
/** The least share of that mob's health one untrained stick must take. */
const UNTRAINED_BLAST_MIN_HP_SHARE = 0.35;
/** The least share one stick must take at the on-curve Explosives Handling level. */
const ON_CURVE_BLAST_MIN_HP_SHARE = 0.9;
/** The most one on-curve stick may deal to that mob, as a multiple of its health. */
const ON_CURVE_BLAST_MAX_OVERKILL = 5;
/**
 * The balanced human spreads his points over four cards, one of which is
 * Explosives Handling, so a quarter of them is the on-curve investment.
 */
const SPEND_CARDS = 4;
/** Explosives Handling levels swept for the "every point helps" check. */
const MAX_PROBED_HANDLING_LEVEL = 12;
/** An on-curve stick must hurt enemies at least this many times harder than it hurts the crawlers. */
const ENEMY_TO_CRAWLER_MIN_RATIO = 2;
/** Fewest separate blasts any boss or bounty mark may take to kill, at on-curve Explosives Handling. */
const BOSS_MIN_STICKS_ON_CURVE = 4;
/**
 * Fewest when every level-up point went into Explosives Handling. Below 2 this
 * stops meaning anything: `sticksToKill` can never return less than 1.
 */
const BOSS_MIN_STICKS_ALL_IN = 2;
/** Explosives Handling at which a bounty escort's stick is checked for overkill. */
const ESCORT_CHECK_HANDLING_LEVEL = 1;
/**
 * Ceiling on how much of a bounty escort's max HP one untrained stick may deal,
 * as a multiple of that max HP. A stick finishing off a lighter escort in one
 * throw is fine; one that guts a tougher escort several times over means the
 * blast has stopped scaling with what it's thrown at.
 */
const ESCORT_MAX_HP_SHARE_PER_STICK = 2;
/** Party level far past every cap, to show the stick has stopped growing. */
const FAR_PAST_CAP_PARTY_LEVEL = 200;
/** Frames the dropped stick is ticked for, comfortably past its five-second fuse. */
const DYNAMITE_SETTLE_FRAMES = 360;
const EXPLOSIVE_MAP_SIZE = 40;
/** Tiles east of the thrower the target stands, well inside the three-tile blast. */
const EXPLOSIVE_TARGET_OFFSET_TILES = 1;
/** Sticks dropped together on a boss for the volley check. */
const VOLLEY_STICKS = 4;
/** Tile the bosses are built on for the arithmetic sweeps; they never move. */
const BOSS_PROBE_TILE = 2;

function onCurveHandlingLevel(partyLevel: number): number {
  const pointsEarned = partyLevel - 1;
  return 1 + Math.floor(pointsEarned / SPEND_CARDS);
}

function allInHandlingLevel(partyLevel: number): number {
  return partyLevel;
}

const explosiveMap = new GameMap({ mapSize: EXPLOSIVE_MAP_SIZE, tileHeight: TILE_SIZE });

/**
 * Drops `sticks` sticks at once at the human's feet beside a levelled mob and
 * reports what the blasts took.
 */
function blastAgainstLevelledMob(
  makeTarget: (tileX: number, tileY: number) => Mob,
  throwerLevel: number,
  handlingLevel: number,
  mobLevel: number,
  sticks = 1,
): { hpLost: number; maxHp: number } {
  const start = explosiveMap.startTile;
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x, start.y, TILE_SIZE);
  human.level = throwerLevel;
  human.explosivesHandling = handlingLevel;
  human.inventory.addItem('goblin_dynamite', sticks);
  const roster = new MobRoster(explosiveMap, new SpellSystem());
  const mob = makeTarget(start.x + EXPLOSIVE_TARGET_OFFSET_TILES, start.y);
  mob.applyMobLevel(mobLevel);
  roster.add(mob);
  const dynamite = new DynamiteSystem(explosiveMap);
  const context = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: explosiveMap,
  };
  for (let stick = 0; stick < sticks; stick++) {
    dynamite.beginCharge(0, human, 'goblin_dynamite');
    dynamite.release(human);
  }
  for (let frame = 0; frame < DYNAMITE_SETTLE_FRAMES; frame++) dynamite.update(context);
  return { hpLost: mob.maxHp - mob.hp, maxHp: mob.maxHp };
}

function makeGhoul(tileX: number, tileY: number): Mob {
  return spawnMob(
    EXPLOSIVE_TARGET_MOB,
    { x: tileX, y: tileY },
    explosiveMap,
    liveSpawnContext('dev:spawn'),
  );
}

/** Separate blasts needed to kill a mob of this level, before any guard or phase of its own. */
function sticksToKill(
  makeTarget: () => Mob,
  mobLevel: number,
  throwerLevel: number,
  handlingLevel: number,
): number {
  const mob = makeTarget();
  mob.applyMobLevel(mobLevel);
  const perStick = dynamiteDamageToMob(
    mob,
    dynamiteMobDamage(throwerLevel, handlingLevel),
    dynamiteCrawlerDamage(handlingLevel),
  );
  return Math.ceil(mob.maxHp / perStick);
}

/** Share of a mob's max HP a single blast deals, before any guard or phase of its own. */
function stickHpShare(
  makeTarget: () => Mob,
  mobLevel: number,
  throwerLevel: number,
  handlingLevel: number,
): number {
  const mob = makeTarget();
  mob.applyMobLevel(mobLevel);
  const perStick = dynamiteDamageToMob(
    mob,
    dynamiteMobDamage(throwerLevel, handlingLevel),
    dynamiteCrawlerDamage(handlingLevel),
  );
  return perStick / mob.maxHp;
}

/** Where a probed boss's summons go; none of them is ever ticked. */
const probeSpawns: Mob[] = [];
function collectProbeSpawn(mob: Mob): void {
  probeSpawns.push(mob);
}

function registeredMob(id: StandaloneMobKind): () => Mob {
  return () =>
    spawnMob(
      id,
      { x: BOSS_PROBE_TILE, y: BOSS_PROBE_TILE },
      explosiveMap,
      liveSpawnContext('dev:spawn'),
    );
}

/**
 * Every boss the player fights, by the level rule that sets it. Bosses built
 * outside the kind registry (`MOB_KINDS`) are constructed directly, exactly as their own
 * systems build them.
 */
const ARENA_BOSSES: readonly (readonly [string, () => Mob])[] = [
  ['the_hoarder', registeredMob('the_hoarder')],
  ['juicer', registeredMob('juicer')],
  ['krakaren_clone', registeredMob('krakaren_clone')],
  ['ball_of_swine', registeredMob('ball_of_swine')],
  ['grotesque_spider', registeredMob('grotesque_spider')],
  ['the_lich', registeredMob('the_lich')],
  ['heather', () => new HeatherTheBear(BOSS_PROBE_TILE, BOSS_PROBE_TILE, TILE_SIZE)],
  [
    'miss_quill',
    () => new MissQuill(BOSS_PROBE_TILE, BOSS_PROBE_TILE, TILE_SIZE, collectProbeSpawn),
  ],
  ['remex', () => new Remex(BOSS_PROBE_TILE, BOSS_PROBE_TILE, TILE_SIZE)],
  ['terror_the_clown', registeredMob('terror_the_clown')],
];
const BOUNTY_MARKS: readonly (readonly [string, () => Mob])[] = [
  ['evil_clown', registeredMob('evil_clown')],
  ['mantid', registeredMob('mantid')],
  ['skeleton_lord', registeredMob('skeleton_lord')],
  ['dark_knight', () => new DarkKnight(BOSS_PROBE_TILE, BOSS_PROBE_TILE, TILE_SIZE)],
  ['rock_golem_boss', registeredMob('rock_golem_boss')],
];
/**
 * Bounty escorts authored to be tougher than the goblins, lemurs and the like
 * that are built to fold to a single blast on any floor. An untrained stick may
 * still finish one of these off, but it must not gut it several times over —
 * the rule is that dynamite never turns a tougher escort into throwaway fodder.
 */
const BOUNTY_ESCORTS = [
  'stilt_clown',
  'fat_clown',
  'mantis',
  'skeleton_sword',
  'skeleton_archer',
  'rock_golem',
] as const;

section('explosives handling');
{
  const normalProfile = DIFFICULTY_PROFILES.normal;
  const openBand: MobLevelRange = { minLevel: 1, maxLevel: MAX_MOB_LEVEL };
  for (const partyLevel of EXPLOSIVE_PROBE_PARTY_LEVELS) {
    const mobLevel = earnedLevelFloor(openBand, partyLevel, normalProfile);

    const untrained = blastAgainstLevelledMob(makeGhoul, partyLevel, 1, mobLevel);
    const untrainedShare = untrained.hpLost / untrained.maxHp;
    check(
      untrained.hpLost === Math.min(untrained.maxHp, dynamiteMobDamage(partyLevel, 1)),
      `party level ${partyLevel}: the live blast deals what dynamiteMobDamage prices (${untrained.hpLost})`,
    );
    check(
      untrainedShare >= UNTRAINED_BLAST_MIN_HP_SHARE,
      `party level ${partyLevel}: an untrained stick takes ${(untrainedShare * PERCENT).toFixed(0)}% of a level-${mobLevel} ${EXPLOSIVE_TARGET_MOB} (min ${UNTRAINED_BLAST_MIN_HP_SHARE * PERCENT}%)`,
    );

    const onCurveHandling = onCurveHandlingLevel(partyLevel);
    const onCurve = blastAgainstLevelledMob(makeGhoul, partyLevel, onCurveHandling, mobLevel);
    const onCurveShare = onCurve.hpLost / onCurve.maxHp;
    check(
      onCurveShare >= ON_CURVE_BLAST_MIN_HP_SHARE,
      `party level ${partyLevel}: at on-curve Explosives Handling ${onCurveHandling} a stick takes ${(onCurveShare * PERCENT).toFixed(0)}% (min ${ON_CURVE_BLAST_MIN_HP_SHARE * PERCENT}%)`,
    );
    const onCurveOverkill = dynamiteMobDamage(partyLevel, onCurveHandling) / onCurve.maxHp;
    check(
      onCurveOverkill <= ON_CURVE_BLAST_MAX_OVERKILL,
      `party level ${partyLevel}: that stick deals ${onCurveOverkill.toFixed(2)}x the mob's health (max ${ON_CURVE_BLAST_MAX_OVERKILL}x)`,
    );

    let everyPointHelps = true;
    for (let handling = 2; handling <= MAX_PROBED_HANDLING_LEVEL; handling++) {
      if (dynamiteMobDamage(partyLevel, handling) <= dynamiteMobDamage(partyLevel, handling - 1)) {
        everyPointHelps = false;
      }
    }
    check(
      everyPointHelps,
      `party level ${partyLevel}: every Explosives Handling point raises blast damage to enemies`,
    );

    const enemyDamage = dynamiteMobDamage(partyLevel, onCurveHandling);
    const crawlerDamage = dynamiteCrawlerDamage(onCurveHandling);
    check(
      enemyDamage >= crawlerDamage * ENEMY_TO_CRAWLER_MIN_RATIO,
      `party level ${partyLevel}: an on-curve stick does ${enemyDamage} to enemies and ${crawlerDamage} to the crawlers (min ${ENEMY_TO_CRAWLER_MIN_RATIO}x)`,
    );
  }

  const cappedStick = dynamiteMobDamage(MAX_MOB_LEVEL / normalProfile.ambientLevelRatio, 1);
  check(
    dynamiteMobDamage(FAR_PAST_CAP_PARTY_LEVEL, 1) === cappedStick,
    `the thrower-level term stops growing once mob health does (${cappedStick} at the cap)`,
  );

  const ally = { isHostile: false, blastDamageScale: 1 };
  const lateCrawlerDamage = dynamiteCrawlerDamage(MAX_PROBED_HANDLING_LEVEL);
  check(
    dynamiteDamageToMob(
      ally,
      dynamiteMobDamage(LATE_GAME_PARTY_LEVEL, MAX_PROBED_HANDLING_LEVEL),
      lateCrawlerDamage,
    ) === lateCrawlerDamage,
    'an ally caught in a blast takes the crawlers’ share, not the enemies’',
  );

  const bossRows = [
    ...ARENA_BOSSES.map(
      ([name, make]) =>
        [name, make, (pl: number) => resolveBossLevel(openBand, pl, normalProfile)] as const,
    ),
    ...BOUNTY_MARKS.map(
      ([name, make]) =>
        [name, make, (pl: number) => bountyBossLevel(pl, pl, normalProfile)] as const,
    ),
  ];
  for (const [name, make, levelFor] of bossRows) {
    const onCurveSticks = BOSS_PROBE_PARTY_LEVELS.map((pl) =>
      sticksToKill(make, levelFor(pl), pl, onCurveHandlingLevel(pl)),
    );
    const allInSticks = BOSS_PROBE_PARTY_LEVELS.map((pl) =>
      sticksToKill(make, levelFor(pl), pl, allInHandlingLevel(pl)),
    );
    check(
      Math.min(...onCurveSticks) >= BOSS_MIN_STICKS_ON_CURVE &&
        Math.min(...allInSticks) >= BOSS_MIN_STICKS_ALL_IN,
      `${name}: ${onCurveSticks.join('/')} sticks on-curve, ${allInSticks.join('/')} all-in (min ${BOSS_MIN_STICKS_ON_CURVE} / ${BOSS_MIN_STICKS_ALL_IN})`,
    );

    const boss = make();
    let weakestMargin = Infinity;
    for (let throwerLevel = 1; throwerLevel <= PAST_BOSS_CAP_PARTY_LEVEL; throwerLevel++) {
      for (let handling = 1; handling <= MAX_PROBED_HANDLING_LEVEL; handling++) {
        const crawlerShare = dynamiteCrawlerDamage(handling);
        const perStick = dynamiteDamageToMob(
          boss,
          dynamiteMobDamage(throwerLevel, handling),
          crawlerShare,
        );
        weakestMargin = Math.min(weakestMargin, perStick - crawlerShare);
      }
    }
    check(
      weakestMargin >= 0,
      `${name}: a stick never does less to it than to a crawler (weakest margin ${weakestMargin})`,
    );
  }

  for (const name of BOUNTY_ESCORTS) {
    const escortShares = BOSS_PROBE_PARTY_LEVELS.map((pl) =>
      stickHpShare(
        registeredMob(name),
        bountyMinionLevel(pl, pl, normalProfile),
        pl,
        ESCORT_CHECK_HANDLING_LEVEL,
      ),
    );
    check(
      Math.max(...escortShares) <= ESCORT_MAX_HP_SHARE_PER_STICK,
      `escort ${name}: a stick deals ${escortShares.map((share) => share.toFixed(2)).join('/')}x its health at Explosives Handling ${ESCORT_CHECK_HANDLING_LEVEL} (max ${ESCORT_MAX_HP_SHARE_PER_STICK}x)`,
    );
  }

  const makeLord = (tileX: number, tileY: number): Mob =>
    spawnMob('skeleton_lord', { x: tileX, y: tileY }, explosiveMap, liveSpawnContext('dev:spawn'));
  const lordLevel = bountyBossLevel(LATE_GAME_PARTY_LEVEL, LATE_GAME_PARTY_LEVEL, normalProfile);
  const lateHandling = onCurveHandlingLevel(LATE_GAME_PARTY_LEVEL);
  const singleBlast = blastAgainstLevelledMob(
    makeLord,
    LATE_GAME_PARTY_LEVEL,
    lateHandling,
    lordLevel,
  );
  const volleyOfSticks = VOLLEY_STICKS;
  const volley = blastAgainstLevelledMob(
    makeLord,
    LATE_GAME_PARTY_LEVEL,
    lateHandling,
    lordLevel,
    volleyOfSticks,
  );
  check(
    singleBlast.hpLost > 0 && volley.hpLost === singleBlast.hpLost,
    `a boss hit by ${volleyOfSticks} sticks at once loses what one stick takes (${volley.hpLost} vs ${singleBlast.hpLost})`,
  );
}

console.log(failures === 0 ? '\nAll difficulty checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
