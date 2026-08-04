#!/usr/bin/env tsx
/**
 * Headless gate on the fairness rules behind `docs/difficulty-plan.md`.
 *
 * The thing worth guarding here is that later tuning cannot quietly break the
 * invariants that make a harder game a fair one. Every number in that plan is a
 * starting point meant to be moved; none of the *rules* around them are. A
 * cadence curve retuned past its floor, a telegraph shortened below what a
 * player can react to, a projectile nudged past the speed you can outrun — all
 * three are one-character edits, none of them fails a typecheck, and each turns
 * pressure into unfairness with nothing on screen to say so.
 *
 * Everything here is arithmetic over the game's own exported functions, never a
 * copy of them, so a formula that moves is either still inside its bounds or
 * fails this. How the result *feels* is still a `[HUMAN]` gate — run the game
 * with `?difficulty` for the counters the plan's target-feel table is written
 * against.
 *
 * Run: npx tsx scripts/verify-difficulty.ts
 */

import {
  CADENCE_SCALE_FLOOR,
  cooldownScaleForLevel,
  scaledCooldownFramesForLevel,
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
  MAX_ROOM_SPAWN_COUNT,
  earnedLevelFloor,
  partyLevelOf,
  resolveBossLevel,
  resolveSpawnLevel,
} from '../src/levels/spawner';
import { Goblin } from '../src/creatures/Goblin';
import { Juicer } from '../src/creatures/Juicer';
import { GoblinArcher } from '../src/creatures/GoblinArcher';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { generateDungeon } from '../src/map/DungeonGenerator';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level1 } from '../src/levels/level1';
import { level2 } from '../src/levels/level2';
import { level3 } from '../src/levels/level3';
import type { LevelDef, MobLevelRange } from '../src/levels/types';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';

/** Deepest level anything in the game can be spawned at; see `MAX_MOB_LEVEL`. */
const MAX_LEVEL = 20;
/**
 * Levels probed past {@link MAX_LEVEL} for the shape checks. A curve that is
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
const BOSS_TEST_LEVEL = 7;

/** Floating-point slack for comparisons between two computed reals. */
const EPSILON = 1e-9;

const LEVEL_DEFS: readonly LevelDef[] = [level1, level2, level3];

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
    if (cooldownScaleForLevel(level + 1) >= cooldownScaleForLevel(level)) strictlyDecreasing = false;
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
  const BANDS: readonly MobLevelRange[] = [
    {},
    { minLevel: 1, maxLevel: 2 },
    { minLevel: 3, maxLevel: 7 },
    { minLevel: 6, maxLevel: 10 },
    { minLevel: 5 },
  ];

  let staysInBand = true;
  let bossStaysInBand = true;
  let growsWithParty = true;
  for (const band of BANDS) {
    const min = band.minLevel ?? 1;
    const max = band.maxLevel ?? min;
    let previousBossLevel = 0;
    for (let partyLevel = 1; partyLevel <= MAX_PROBED_PARTY_LEVEL; partyLevel++) {
      const rolled = resolveSpawnLevel(band, partyLevel);
      if (rolled < min || rolled > max) staysInBand = false;
      const bossLevel = resolveBossLevel(band, partyLevel);
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
  const wideBand: MobLevelRange = { minLevel: 1, maxLevel: MAX_LEVEL };
  let partyStaysAhead = true;
  for (let partyLevel = 2; partyLevel <= MAX_PROBED_PARTY_LEVEL; partyLevel++) {
    if (earnedLevelFloor(wideBand, partyLevel) >= partyLevel) partyStaysAhead = false;
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
  // used to come back at level-1 speed with its levelled HP intact — the sponge
  // the plan's P1 exists to forbid.
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

console.log(failures === 0 ? '\nAll difficulty checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
