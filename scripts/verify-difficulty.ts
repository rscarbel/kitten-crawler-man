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

import {
  CADENCE_SCALE_FLOOR,
  cooldownScaleForLevel,
  scaledCooldownFramesForLevel,
  Mob,
} from '../src/creatures/Mob';
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
  partyLevelOf,
  recommendedPartyLevelFor,
  regionLevelBand,
  resolveBossLevel,
  resolveSpawnLevel,
} from '../src/levels/spawner';
import {
  WAYFINDER_GRACE_FRAMES,
  WAYFINDER_PULSE_PERIOD_FRAMES,
  WAYFINDER_PULSE_VISIBLE_FRAMES,
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
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import {
  DIFFICULTY_PROFILES,
  NORMAL_AMBIENT_LEVEL_RATIO,
  NORMAL_BOSS_LEVEL_RATIO,
  type Difficulty,
} from '../src/core/difficultyProfiles';
import { bountyMinionLevel, MAX_BOUNTY_MOB_LEVEL } from '../src/systems/BountySystem';
import { generateDungeon } from '../src/map/DungeonGenerator';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level1 } from '../src/levels/level1';
import { level2 } from '../src/levels/level2';
import { level3 } from '../src/levels/level3';
import type { LevelDef, MobLevelRange } from '../src/levels/types';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';

/**
 * Levels probed past {@link MAX_MOB_LEVEL} for the shape checks. A curve that is
 * well behaved to 20 and blows up at 40 is a curve with a bug in it, not a
 * curve that happens to be used inside its safe range.
 */
const PROBE_LEVEL_LIMIT = 60;

/**
 * The fairness rule: an attack whose aim is frozen must stay frozen for at
 * least this many frames (350 ms) at every level, so avoiding it by movement
 * alone is always possible.
 */
const MIN_LOCKED_TELEGRAPH_FRAMES = 21;

/** Base cooldowns sampled for the floor check — the real ones plus the extremes. */
const SAMPLED_BASE_COOLDOWNS = [1, 2, 78, 90, 100, 120, 150, 600];

/** Constitutions sampled for the regen curve, from a fresh crawler to an absurd one. */
const MAX_PROBED_CONSTITUTION = 200;

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
    deepScale - CADENCE_SCALE_FLOOR < 0.02,
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
    TROGLODYTE_AIM_LOCK_FRAMES >= MIN_LOCKED_TELEGRAPH_FRAMES,
    `the troglodyte's aim stays locked for at least ${MIN_LOCKED_TELEGRAPH_FRAMES} frames`,
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
    if (shot.lockedFrames < MIN_LOCKED_TELEGRAPH_FRAMES) archerLockIsEnough = false;
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
  const earlyPointGain = humanRegenHpPerSecond(4) - humanRegenHpPerSecond(3);
  const latePointGain = humanRegenHpPerSecond(13) - humanRegenHpPerSecond(12);
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
}

// ── Level bands ──────────────────────────────────────────────────────────────

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
      const rolled = resolveSpawnLevel(band, partyLevel, DIFFICULTY_PROFILES.normal);
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

  check(partyLevelOf(3, 9) === 9, 'party level is the stronger crawler’s');
}

// ── Re-levelling ─────────────────────────────────────────────────────────────

section('re-levelling');
{
  const mob = new Goblin(0, 0, TILE_SIZE, 'sword');
  mob.applyMobLevel(5);
  const levelledMaxHp = mob.maxHp;
  console.log('  (the warning below is the check working, not a failure)');
  mob.applyMobLevel(5);
  check(mob.maxHp === levelledMaxHp, 'a second applyMobLevel is refused rather than compounded');
  check(mob.mobLevel === 5, 'the refused call leaves the original level in place');

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
      normal.bountyLevelRatio === 1,
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
        const rolled = resolveSpawnLevel(band, partyLevel, profile);
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
    WAYFINDER_GRACE_FRAMES > 0 &&
      WAYFINDER_PULSE_PERIOD_FRAMES > 0 &&
      WAYFINDER_PULSE_VISIBLE_FRAMES > 0,
    'every Wayfinder timing is a positive number of frames',
  );
  // A pulse at least as long as its own period is not a pulse: the arrow would
  // never go away, turning the bounded fail-safe into the always-on GPS the
  // design rules out.
  check(
    WAYFINDER_PULSE_VISIBLE_FRAMES < WAYFINDER_PULSE_PERIOD_FRAMES,
    'the Wayfinder arrow is off for more of each period than it is on',
  );
  // The grace is the "you have genuinely hunted" evidence the pulse waits for.
  // Shorter than a single pulse period it would fire almost immediately.
  check(
    WAYFINDER_GRACE_FRAMES > WAYFINDER_PULSE_PERIOD_FRAMES,
    'the hunt gets longer than one pulse period before the fail-safe starts',
  );
}

console.log(failures === 0 ? '\nAll difficulty checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
