/**
 * `verify:tactics` sections for the ranged creatures — the goblin archer, the
 * skeleton archer and the lava llama — whose kite is "keep a friend between
 * me and the player while shooting", plus their regroup.
 *
 * Each check drives the real creature through the real mob loop on the room
 * `verify-tactics.ts` hands in, and measures an angle, a distance or a frame
 * gap rather than counting hits.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants';
import type { GameMap } from '../../src/map/GameMap';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { createMob, MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles';
import { mulberry32, type Rng } from '../../src/sprites/person/rng';
import type { TacticsTrait } from '../../src/creatures/tactics/tacticsTraits';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { chasedKitesRunOn, describeKiteLengths } from './chasedKites';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import type { GroundHazardSource } from '../../src/systems/GroundHazardSource';
import { LavaBallSystem } from '../../src/systems/LavaBallSystem';
import { TACTICAL_RETREAT_MAX_SPEED, type Mob } from '../../src/creatures/Mob';
import { SkeletonArcher } from '../../src/creatures/SkeletonArcher';
import {
  KITE_COOLDOWN_FRAMES,
  KITE_MAX_DISTANCE_TILES,
  KITE_MAX_FRAMES,
  REGROUP_HP_FRACTION,
  REGROUP_MAX_FRAMES,
} from '../../src/creatures/tactics/retreat';

/** The pass/fail reporting `verify-tactics.ts` owns, so its failure count covers these too. */
export interface TacticsHarness {
  check(ok: boolean, message: string): void;
  section(name: string): void;
}

// ── The creatures ──────────────────────────────────────────────────────────

interface RangedCase {
  /** Spawner key of the ranged creature under test. */
  readonly type: string;
  /** Spawner key of the pack mate it falls back on. */
  readonly helperType: string;
}

const RANGED_CASES: readonly RangedCase[] = [
  { type: 'goblin_archer', helperType: 'goblin' },
  { type: 'skeleton_archer', helperType: 'skeleton_sword' },
  { type: 'llama', helperType: 'llama' },
];

/** The ranged creatures' eligibility, in roll order: a draw is asked for each. */
const RANGED_ELIGIBILITY: readonly TacticsTrait[] = ['kite', 'regroup'];

/** A source that answers yes to exactly `wanted` among the ranged creatures' eligible traits. */
function rollOnly(wanted: readonly TacticsTrait[]): Rng {
  const draws = RANGED_ELIGIBILITY.map((trait) => (wanted.includes(trait) ? 0 : 1));
  let index = 0;
  return () => draws[index++] ?? 1;
}

/**
 * The ranged sections draw on their own random stream, restarted for every
 * probe, so a section added or changed elsewhere in the run cannot shift
 * what these creatures roll.
 */
const SECTION_SEED = 0x7a4bed;

/** The mob level a helper is spawned at: below every trait, so it only ever fights. */
const HELPER_LEVEL = 1;

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

/** Small against any levelled mob's health, so the blow only marks it as in the fight. */
const PROBE_BLOW_DAMAGE = 1;

/** Wound `mob` by `share` of its health from `crawler`, so it counts as in the fight. */
function bloody(mob: Mob, crawler: HumanPlayer, share: number): void {
  mob.takeDamageFrom(PROBE_BLOW_DAMAGE, crawler, 'explosion');
  mob.hp = Math.max(1, Math.round(mob.maxHp * (1 - share)));
}

function centreDistance(a: TilePoint, b: TilePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The layout every ranged probe shares: the human a couple of tiles west of
 * the shooter, well inside its crowding distance, the friend a little further
 * on and off the line, and the cat out of everyone's way in a corner.
 *
 * The friend fights the human but is held on its tile (see
 * {@link pinInPlace}), so every kite in a run is planned against the same
 * layout and the screen it ends behind is measured against a fixed body.
 */
const ROW = 12;
const HUMAN_TILE = { x: 6, y: ROW };
const SHOOTER_TILE = { x: 8, y: ROW };
const HELPER_TILE = { x: 9, y: ROW + 2 };
const FAR_CORNER = { x: 1, y: 1 };

interface RangedLayout {
  readonly arena: Arena;
  readonly shooter: Mob;
  readonly helper: Mob | null;
}

function rangedLayout(
  map: GameMap,
  rangedCase: RangedCase,
  traits: readonly TacticsTrait[],
  withHelper: boolean,
  shooterWoundShare = 0,
  helperTile: TilePoint = HELPER_TILE,
): RangedLayout {
  // Every probe starts the stream afresh, so one probe's draws — or a change
  // to another creature's code — cannot shift what the next one measures.
  Math.random = mulberry32(SECTION_SEED);
  const arena = makeArena(map, HUMAN_TILE, FAR_CORNER);
  const shooter = createMob(rangedCase.type, SHOOTER_TILE.x, SHOOTER_TILE.y, map);
  shooter.applyMobLevel(MAX_MOB_LEVEL);
  shooter.rollTactics(DIFFICULTY_PROFILES.normal.tacticsChanceScale, rollOnly(traits));
  arena.roster.add(shooter);
  bloody(shooter, arena.human, shooterWoundShare);
  let helper: Mob | null = null;
  if (withHelper) {
    helper = createMob(rangedCase.helperType, helperTile.x, helperTile.y, map);
    helper.applyMobLevel(HELPER_LEVEL);
    arena.roster.add(helper);
    bloody(helper, arena.human, 0);
  }
  return { arena, shooter, helper };
}

// ── Trace ──────────────────────────────────────────────────────────────────

/** How close a chasing player gets before it stops walking: one body's width. */
const CHASER_STANDOFF_PX = TILE_SIZE;

/** Pixels a frame must move for its direction to count as a walking direction. */
const WALKING_STEP_PX = 0.25;

interface RangedTrace {
  readonly kitesStarted: number;
  readonly longestKiteFrames: number;
  readonly longestKiteWalkPx: number;
  readonly fastestKiteStepPx: number;
  /** The quickest any one kite covered ground, walked pixels over its frames. */
  readonly fastestKiteAverageSpeed: number;
  readonly shortestCooldownGap: number;
  readonly endReasons: readonly string[];
  /** Frames each finished kite ran. */
  readonly kiteLengths: readonly number[];
  /** At each kite's end: angle, in degrees, at the shooter between the player and the friend. */
  readonly screenAnglesDegrees: readonly number[];
  /**
   * At each kite's end: how far, in tiles, the friend's centre sits off the
   * straight line from the shooter to the player, or infinity when the friend
   * is not between the two along that line at all.
   */
  readonly screenOffsetsTiles: readonly number[];
  /** Worst agreement between facing and the step walked, over every walking kite frame. */
  readonly worstWalkFacingDot: number;
  /** Worst agreement between facing and the player on the first still frame after each kite. */
  readonly worstArrivalFacingDot: number;
  readonly farthestFromHomeWhileKitingPx: number;
  readonly framesOnHazardWhileKiting: number;
  readonly widestChaseGapGrowthPx: number;
  readonly shots: number;
  /** Shots released while a kite was steering the shooter. */
  readonly shotsWhileKiting: number;
  readonly longestShotGapFrames: number;
  /** Frames from each kite's end to the next shot released; infinite when none followed. */
  readonly longestKiteEndToShotFrames: number;
  readonly regroupsStarted: number;
  readonly longestRegroupFrames: number;
  /** The most any regroup brought the shooter nearer the player than it started, in pixels. */
  readonly deepestRegroupApproachPx: number;
  /** Frames from a regroup's end to the next kite's start; infinite when none followed. */
  readonly shortestRegroupToKiteFrames: number;
}

interface RangedRunOptions {
  readonly frames: number;
  /**
   * Walk the player straight at the shooter at player speed the whole run,
   * stopping a body's width short. The chaser is a point the human is put
   * back on each frame, so a shove from the friend standing in its way —
   * which is the whole point of the screen — is not mistaken for the kiter
   * outrunning it.
   */
  readonly chase?: boolean;
  readonly hazard?: GroundHazardSource;
  /** Systems that run after the mob loop each frame, such as the llama's own lava. */
  readonly systems?: ReadonlyArray<{ update(ctx: SystemContext): void }>;
  /**
   * Leave the friend free to walk. Pinned by default so every kite is planned
   * against one layout; freed where the friend must follow a moving fight.
   */
  readonly freeHelper?: boolean;
}

/**
 * Whether `mob` let a shot go since the last call, clearing the flag. Every
 * ranged creature raises it on its release frame, for the scene's sound.
 */
function takeShotReleased(mob: Mob): boolean {
  const released = mob.projectileSoundPending;
  mob.projectileSoundPending = false;
  return released;
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

function facingDot(mob: Mob, dirX: number, dirY: number): number {
  const facingLength = Math.hypot(mob.facingX, mob.facingY);
  const dirLength = Math.hypot(dirX, dirY);
  if (facingLength === 0 || dirLength === 0) return 1;
  return (mob.facingX * dirX + mob.facingY * dirY) / (facingLength * dirLength);
}

const DEGREES_PER_HALF_TURN = 180;
const RADIANS_TO_DEGREES = DEGREES_PER_HALF_TURN / Math.PI;

/** Angle, in degrees, at `apex` between the directions to `a` and to `b`. */
function angleAtDegrees(apex: TilePoint, a: TilePoint, b: TilePoint): number {
  const ax = a.x - apex.x;
  const ay = a.y - apex.y;
  const bx = b.x - apex.x;
  const by = b.y - apex.y;
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (lengths === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / lengths));
  return Math.acos(cosine) * RADIANS_TO_DEGREES;
}

/**
 * How far `body` sits off the segment from `from` to `to`, in tiles, or
 * infinity when it does not lie between the two ends along it.
 */
function offsetFromLineTiles(from: TilePoint, to: TilePoint, body: TilePoint): number {
  const lineX = to.x - from.x;
  const lineY = to.y - from.y;
  const lineLengthSquared = lineX * lineX + lineY * lineY;
  if (lineLengthSquared === 0) return Number.POSITIVE_INFINITY;
  const bodyX = body.x - from.x;
  const bodyY = body.y - from.y;
  const along = (bodyX * lineX + bodyY * lineY) / lineLengthSquared;
  if (along <= 0 || along >= 1) return Number.POSITIVE_INFINITY;
  const across = Math.abs(bodyX * lineY - bodyY * lineX) / Math.sqrt(lineLengthSquared);
  return across / TILE_SIZE;
}

function traceRanged(layout: RangedLayout, options: RangedRunOptions): RangedTrace {
  const { arena, shooter, helper } = layout;
  let kitesStarted = 0;
  let currentRun = 0;
  let currentWalk = 0;
  let longestKiteFrames = 0;
  let longestKiteWalkPx = 0;
  let fastestKiteStepPx = 0;
  let fastestKiteAverageSpeed = 0;
  let lastKiteEnd = Number.NEGATIVE_INFINITY;
  let shortestCooldownGap = Number.POSITIVE_INFINITY;
  const endReasons: string[] = [];
  const kiteLengths: number[] = [];
  const screenAnglesDegrees: number[] = [];
  const screenOffsetsTiles: number[] = [];
  let worstWalkFacingDot = 1;
  let worstArrivalFacingDot = 1;
  let awaitingArrivalFacing = false;
  let farthestFromHomeWhileKitingPx = 0;
  let framesOnHazardWhileKiting = 0;
  let chaseStartGap = 0;
  let widestChaseGapGrowthPx = 0;
  let shots = 0;
  let shotsWhileKiting = 0;
  let lastShotFrame: number | null = null;
  let longestShotGapFrames = 0;
  let pendingKiteEndFrame: number | null = null;
  let longestKiteEndToShotFrames = 0;
  let regroupsStarted = 0;
  let regroupRun = 0;
  let longestRegroupFrames = 0;
  let regroupStartGap = 0;
  let deepestRegroupApproachPx = 0;
  let lastRegroupEnd: number | null = null;
  let shortestRegroupToKiteFrames = Number.POSITIVE_INFINITY;
  let wasRegrouping = false;
  let wasKiting = false;
  takeShotReleased(shooter);
  const helperX = helper?.x ?? 0;
  const helperY = helper?.y ?? 0;
  const chaser = { x: arena.human.x, y: arena.human.y };

  for (let frame = 0; frame < options.frames; frame++) {
    if (options.chase === true) {
      const dx = shooter.x - chaser.x;
      const dy = shooter.y - chaser.y;
      const gap = Math.hypot(dx, dy);
      const step = Math.min(PLAYER_SPEED, gap - CHASER_STANDOFF_PX);
      if (step > 0) {
        chaser.x += (dx / gap) * step;
        chaser.y += (dy / gap) * step;
      }
      arena.human.x = chaser.x;
      arena.human.y = chaser.y;
    }
    const beforeX = shooter.x;
    const beforeY = shooter.y;
    arena.loop.update(arena.ctx);
    for (const system of options.systems ?? []) system.update(arena.ctx);
    if (helper !== null && options.freeHelper !== true) {
      pinInPlace(arena, helper, helperX, helperY);
    }
    const stepX = shooter.x - beforeX;
    const stepY = shooter.y - beforeY;
    const stepPx = Math.hypot(stepX, stepY);
    const kiting = shooter.tactics.activeRetreat === 'kite';
    const regrouping = shooter.tactics.activeRetreat === 'regroup';

    if (takeShotReleased(shooter)) {
      shots++;
      if (kiting) shotsWhileKiting++;
      if (lastShotFrame !== null) {
        longestShotGapFrames = Math.max(longestShotGapFrames, frame - lastShotFrame);
      }
      lastShotFrame = frame;
      if (pendingKiteEndFrame !== null) {
        longestKiteEndToShotFrames = Math.max(
          longestKiteEndToShotFrames,
          frame - pendingKiteEndFrame,
        );
        pendingKiteEndFrame = null;
      }
    }

    if (kiting && !wasKiting) {
      if (lastRegroupEnd !== null) {
        shortestRegroupToKiteFrames = Math.min(shortestRegroupToKiteFrames, frame - lastRegroupEnd);
      }
      kitesStarted++;
      currentRun = 0;
      currentWalk = 0;
      chaseStartGap = centreDistance(shooter, chaser);
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
      fastestKiteAverageSpeed = Math.max(fastestKiteAverageSpeed, currentWalk / currentRun);
      if (stepPx >= WALKING_STEP_PX) {
        worstWalkFacingDot = Math.min(worstWalkFacingDot, facingDot(shooter, stepX, stepY));
      }
      const escape = options.hazard?.getHazardEscapeVector(shooter.x, shooter.y) ?? null;
      if (escape !== null) {
        framesOnHazardWhileKiting++;
      }
      const home = shooter.homePoint;
      if (home !== undefined) {
        farthestFromHomeWhileKitingPx = Math.max(
          farthestFromHomeWhileKitingPx,
          centreDistance(shooter, home),
        );
      }
      if (options.chase === true) {
        const growth = centreDistance(shooter, chaser) - chaseStartGap;
        widestChaseGapGrowthPx = Math.max(widestChaseGapGrowthPx, growth);
      }
    }
    if (!kiting && wasKiting) {
      lastKiteEnd = frame;
      pendingKiteEndFrame = frame;
      awaitingArrivalFacing = true;
      endReasons.push(shooter.tactics.lastRetreatEnd ?? 'unknown');
      kiteLengths.push(currentRun);
      if (helper !== null) {
        screenAnglesDegrees.push(angleAtDegrees(shooter, arena.human, helper));
        screenOffsetsTiles.push(offsetFromLineTiles(shooter, arena.human, helper));
      }
    }
    if (awaitingArrivalFacing && !kiting && stepPx < WALKING_STEP_PX) {
      awaitingArrivalFacing = false;
      worstArrivalFacingDot = Math.min(
        worstArrivalFacingDot,
        facingDot(shooter, arena.human.x - shooter.x, arena.human.y - shooter.y),
      );
    }

    if (regrouping && !wasRegrouping) {
      regroupsStarted++;
      regroupRun = 0;
      regroupStartGap = centreDistance({ x: beforeX, y: beforeY }, arena.human);
    }
    if (regrouping) {
      regroupRun++;
      longestRegroupFrames = Math.max(longestRegroupFrames, regroupRun);
      const approach = regroupStartGap - centreDistance(shooter, arena.human);
      deepestRegroupApproachPx = Math.max(deepestRegroupApproachPx, approach);
    }
    if (!regrouping && wasRegrouping) lastRegroupEnd = frame;
    wasRegrouping = regrouping;
    wasKiting = kiting;
  }
  if (pendingKiteEndFrame !== null) longestKiteEndToShotFrames = Number.POSITIVE_INFINITY;
  arena.loop.dispose();
  return {
    kitesStarted,
    longestKiteFrames,
    longestKiteWalkPx,
    fastestKiteStepPx,
    fastestKiteAverageSpeed,
    shortestCooldownGap,
    endReasons,
    kiteLengths,
    screenAnglesDegrees,
    screenOffsetsTiles,
    worstWalkFacingDot,
    worstArrivalFacingDot,
    farthestFromHomeWhileKitingPx,
    framesOnHazardWhileKiting,
    widestChaseGapGrowthPx,
    shots,
    shotsWhileKiting,
    longestShotGapFrames,
    longestKiteEndToShotFrames,
    regroupsStarted,
    longestRegroupFrames,
    deepestRegroupApproachPx,
    shortestRegroupToKiteFrames,
  };
}

// ── Thresholds ─────────────────────────────────────────────────────────────

/** Frames each ranged scenario runs: several kites, cooldowns and shot cycles. */
const RANGED_RUN_FRAMES = 1200;
/**
 * How far off the shooter-to-player line, in tiles, the friend's centre may be
 * and still stand in the way: half a body, so the friend's own tile always
 * straddles the line. A melee kiter's aim, which backs toward the friend
 * without going round it, ends well outside this on the same layout.
 */
const SCREEN_MAX_OFFSET_TILES = 0.5;
/** The least a walking kiter's facing may agree with its step: it faces where it walks. */
const MIN_WALK_FACING_DOT = 0.7;
/** The least a kiter's facing may agree with the player once it stops: it turns back to fight. */
const MIN_ARRIVAL_FACING_DOT = 0.9;
/** Rounding room on a per-frame step measured against a speed. */
const STEP_EPSILON_PX = 1e-6;
/**
 * Kites a chased shooter must start over a run: a player who keeps closing
 * keeps triggering them, so a second one is what shows the cooldown both
 * holds and lets go.
 */
const MIN_CHASED_KITES = 2;
/** Separation from its friend can hand a kiter a few pixels on a frame. */
const CHASE_GAP_SLACK_TILES = 0.25;
const CHASE_GAP_SLACK_PX = CHASE_GAP_SLACK_TILES * TILE_SIZE;
/**
 * Frames of slack on a shot gap beyond the kite that caused it: the draw or
 * wind-up that follows arrival before its release frame.
 */
const SHOT_GAP_SLACK_FRAMES = 60;
/** The leash a kiter is given in the leash probes, in tiles. */
const KITE_LEASH_TILES = 6;
/**
 * How far behind the shooter, toward the player, the edge probe puts home, in
 * tiles: far enough that a full kite plus the planner's slack would overrun.
 */
const LEASH_EDGE_OFFSET_TILES = 3;
/**
 * Where the into-the-melee regroup probes pin the friend, touching the
 * player: on the shooter's side, where a regroup behind it is a walk away
 * from the player, and straight beside the player, where reaching its far
 * side would mean walking round the player.
 */
const HELPER_BESIDE_PLAYER_NEAR_TILE = { x: HUMAN_TILE.x + 1, y: ROW + 1 };
const HELPER_BESIDE_PLAYER_TILE = { x: HUMAN_TILE.x, y: ROW + 1 };
/** Pixels a regroup may drift nearer the player — separation's nudge, no more. */
const REGROUP_APPROACH_SLACK_PX = 2;
/** A wound past the regroup threshold. */
const REGROUP_PROBE_WOUND_SHARE = 1 - REGROUP_HP_FRACTION / 2;

/** A rectangle of damaging ground, in tiles. */
class HazardRect implements GroundHazardSource {
  constructor(
    private readonly left: number,
    private readonly top: number,
    private readonly right: number,
    private readonly bottom: number,
  ) {}

  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const tileX = Math.floor((x + TILE_SIZE / 2) / TILE_SIZE);
    const tileY = Math.floor((y + TILE_SIZE / 2) / TILE_SIZE);
    const inside =
      tileX >= this.left && tileX <= this.right && tileY >= this.top && tileY <= this.bottom;
    return inside ? { dx: -1, dy: 0 } : null;
  }
}

/** Decimal places a measured offset or angle is printed to. */
const MEASURE_PRINT_DIGITS = 2;

function formatNumbers(values: readonly number[]): string {
  return values.map((value) => value.toFixed(MEASURE_PRINT_DIGITS)).join(', ') || 'none';
}

// ── Sections ───────────────────────────────────────────────────────────────

function checkRangedKite(map: GameMap, harness: TacticsHarness, rangedCase: RangedCase): void {
  const check = (ok: boolean, message: string): void => harness.check(ok, message);
  const label = rangedCase.type;

  const lone = rangedLayout(map, rangedCase, ['kite'], false);
  check(lone.shooter.tactics.traits.join() === 'kite', `${label}: the probe rolled only kite`);
  const loneTrace = traceRanged(lone, { frames: RANGED_RUN_FRAMES });
  check(loneTrace.kitesStarted === 0, `${label}: alone, ${loneTrace.kitesStarted} kites started`);
  check(loneTrace.shots > 0, `${label}: alone, it still shoots (${loneTrace.shots} shots)`);

  const untrained = rangedLayout(map, rangedCase, [], true);
  const untrainedTrace = traceRanged(untrained, { frames: RANGED_RUN_FRAMES });
  check(
    !untrained.shooter.tactics.hasAnyTrait && untrainedTrace.kitesStarted === 0,
    `${label}: without the trait, beside a friend, ${untrainedTrace.kitesStarted} kites started`,
  );

  const paired = rangedLayout(map, rangedCase, ['kite'], true);
  const trace = traceRanged(paired, { frames: RANGED_RUN_FRAMES });
  check(
    trace.kitesStarted > 0,
    `${label}: beside a fighting friend, ${trace.kitesStarted} kites started (ended: ${trace.endReasons.join(', ')})`,
  );
  const everyEndScreened =
    trace.screenOffsetsTiles.length > 0 &&
    trace.screenOffsetsTiles.every((offset) => offset <= SCREEN_MAX_OFFSET_TILES);
  check(
    everyEndScreened,
    `${label}: every kite ends with the friend between it and the player — friend ${formatNumbers(trace.screenOffsetsTiles)} tiles off the line (max ${SCREEN_MAX_OFFSET_TILES}); angles ${formatNumbers(trace.screenAnglesDegrees)} deg`,
  );
  check(
    trace.longestKiteFrames > 0 && trace.longestKiteFrames <= KITE_MAX_FRAMES,
    `${label}: longest kite ${trace.longestKiteFrames} frames (cap ${KITE_MAX_FRAMES})`,
  );
  const kiteMaxWalkPx = KITE_MAX_DISTANCE_TILES * TILE_SIZE;
  check(
    trace.longestKiteWalkPx <= kiteMaxWalkPx + paired.shooter.moveSpeed,
    `${label}: longest kite walked ${trace.longestKiteWalkPx.toFixed(1)} px (cap ${kiteMaxWalkPx} + one step)`,
  );
  const kitePaceCap = Math.min(paired.shooter.moveSpeed, TACTICAL_RETREAT_MAX_SPEED);
  check(
    trace.fastestKiteAverageSpeed <= kitePaceCap + STEP_EPSILON_PX &&
      trace.fastestKiteStepPx < PLAYER_SPEED,
    `${label}: kites no faster than its own pace or the retreat cap — fastest kite averaged ${trace.fastestKiteAverageSpeed.toFixed(2)} px/frame (cap ${kitePaceCap.toFixed(2)}), fastest step ${trace.fastestKiteStepPx.toFixed(2)} under the player's ${PLAYER_SPEED}`,
  );
  check(
    trace.worstWalkFacingDot >= MIN_WALK_FACING_DOT,
    `${label}: faces the way it kites (worst agreement ${trace.worstWalkFacingDot.toFixed(2)}, need ${MIN_WALK_FACING_DOT})`,
  );
  check(
    trace.worstArrivalFacingDot >= MIN_ARRIVAL_FACING_DOT,
    `${label}: turns back to the player once a kite ends (worst agreement ${trace.worstArrivalFacingDot.toFixed(2)}, need ${MIN_ARRIVAL_FACING_DOT})`,
  );

  // Shooting pauses for the walk and resumes on arrival: the longest silence
  // may exceed the untrained shooter's by at most one kite and the draw after.
  const allowedGap = untrainedTrace.longestShotGapFrames + KITE_MAX_FRAMES + SHOT_GAP_SLACK_FRAMES;
  check(
    trace.shotsWhileKiting === 0,
    `${label}: no shot is loosed mid-kite (${trace.shotsWhileKiting})`,
  );
  check(
    untrainedTrace.shots > 0 &&
      trace.shots > 0 &&
      trace.longestShotGapFrames <= allowedGap &&
      trace.longestKiteEndToShotFrames <= allowedGap,
    `${label}: keeps shooting — ${trace.shots} shots, longest silence ${trace.longestShotGapFrames} frames, kite end to next shot ${trace.longestKiteEndToShotFrames} (untrained ${untrainedTrace.shots} shots, longest ${untrainedTrace.longestShotGapFrames}; allowed ${allowedGap})`,
  );

  // Slowed to well under a third of its pace, the walk cap is out of reach
  // within the frame cap, so only the frame cap can end these kites.
  const slowed = rangedLayout(map, rangedCase, ['kite'], true);
  slowed.shooter.slowedByBarrier = true;
  const slowTrace = traceRanged(slowed, { frames: RANGED_RUN_FRAMES });
  check(
    slowTrace.endReasons.includes('frame-cap') && slowTrace.longestKiteFrames <= KITE_MAX_FRAMES,
    `${label}: slowed, its kites end on the frame cap (${slowTrace.endReasons.join(', ') || 'no kites'}), longest ${slowTrace.longestKiteFrames} frames (cap ${KITE_MAX_FRAMES})`,
  );

  const chased = rangedLayout(map, rangedCase, ['kite'], true);
  // The friend is left free here so it follows the fight, as a real one does,
  // and is still near enough to kite toward once the cooldown runs out.
  const chaseTrace = traceRanged(chased, {
    frames: RANGED_RUN_FRAMES,
    chase: true,
    freeHelper: true,
  });
  check(
    chaseTrace.kitesStarted >= MIN_CHASED_KITES &&
      chaseTrace.shortestCooldownGap >= KITE_COOLDOWN_FRAMES,
    `${label}: chased, ${chaseTrace.kitesStarted} kites, closest ${chaseTrace.shortestCooldownGap} frames apart (cooldown ${KITE_COOLDOWN_FRAMES})`,
  );
  const chasedRunOn = chasedKitesRunOn(chaseTrace.kiteLengths, trace.kiteLengths);
  check(
    chasedRunOn,
    `${label}: a player following it does not end its kites — ${describeKiteLengths(chaseTrace.kiteLengths, trace.kiteLengths)}`,
  );
  check(
    chasedRunOn && chaseTrace.widestChaseGapGrowthPx <= CHASE_GAP_SLACK_PX,
    `${label}: a player chasing at player speed never loses ground — gap opened ${chaseTrace.widestChaseGapGrowthPx.toFixed(1)} px (slack ${CHASE_GAP_SLACK_PX}) over ${chaseTrace.kitesStarted} kites`,
  );
}

function checkRangedKiteLeash(map: GameMap, harness: TacticsHarness, rangedCase: RangedCase): void {
  const check = (ok: boolean, message: string): void => harness.check(ok, message);
  const label = rangedCase.type;
  const leashPx = KITE_LEASH_TILES * TILE_SIZE;

  const roomy = rangedLayout(map, rangedCase, ['kite'], true);
  roomy.shooter.homePoint = { x: roomy.shooter.x, y: roomy.shooter.y };
  roomy.shooter.leashRadiusTiles = KITE_LEASH_TILES;
  const roomyTrace = traceRanged(roomy, { frames: RANGED_RUN_FRAMES });
  check(
    roomyTrace.kitesStarted > 0 && roomyTrace.farthestFromHomeWhileKitingPx <= leashPx,
    `${label}: leashed at home, ${roomyTrace.kitesStarted} kites, farthest ${roomyTrace.farthestFromHomeWhileKitingPx.toFixed(1)} px from home while kiting (leash ${leashPx})`,
  );

  // Home sits toward the player: a kite toward the friend would leave the leash.
  const edge = rangedLayout(map, rangedCase, ['kite'], true);
  edge.shooter.homePoint = {
    x: edge.shooter.x - LEASH_EDGE_OFFSET_TILES * TILE_SIZE,
    y: edge.shooter.y,
  };
  edge.shooter.leashRadiusTiles = KITE_LEASH_TILES;
  const edgeTrace = traceRanged(edge, { frames: RANGED_RUN_FRAMES });
  check(
    edgeTrace.kitesStarted === 0,
    `${label}: near its leash's edge no kite starts (${edgeTrace.kitesStarted})`,
  );
}

function checkRangedRegroup(map: GameMap, harness: TacticsHarness, rangedCase: RangedCase): void {
  const check = (ok: boolean, message: string): void => harness.check(ok, message);
  const label = rangedCase.type;

  const trained = rangedLayout(map, rangedCase, ['regroup'], true, REGROUP_PROBE_WOUND_SHARE);
  check(
    trained.shooter.tactics.traits.join() === 'regroup',
    `${label}: the regroup probe rolled only regroup`,
  );
  const trace = traceRanged(trained, { frames: RANGED_RUN_FRAMES });
  check(
    trace.regroupsStarted === 1 &&
      trace.longestRegroupFrames > 0 &&
      trace.longestRegroupFrames <= REGROUP_MAX_FRAMES,
    `${label}: wounded beside a friend, ${trace.regroupsStarted} regroup lasting ${trace.longestRegroupFrames} frames (one per life, cap ${REGROUP_MAX_FRAMES})`,
  );

  const untrained = rangedLayout(map, rangedCase, [], true, REGROUP_PROBE_WOUND_SHARE);
  const untrainedTrace = traceRanged(untrained, { frames: RANGED_RUN_FRAMES });
  check(
    untrainedTrace.regroupsStarted === 0,
    `${label}: without the trait, ${untrainedTrace.regroupsStarted} regroups`,
  );

  // The friend is the one trading blows with the player: regrouping up to it
  // would walk the shooter into the melee.
  const nearSide = rangedLayout(
    map,
    rangedCase,
    ['regroup'],
    true,
    REGROUP_PROBE_WOUND_SHARE,
    HELPER_BESIDE_PLAYER_NEAR_TILE,
  );
  const nearSideTrace = traceRanged(nearSide, { frames: RANGED_RUN_FRAMES });
  check(
    nearSideTrace.regroupsStarted === 1 &&
      nearSideTrace.deepestRegroupApproachPx <= REGROUP_APPROACH_SLACK_PX,
    `${label}: with its friend beside the player on its side, ${nearSideTrace.regroupsStarted} regroup brought it ${nearSideTrace.deepestRegroupApproachPx.toFixed(1)} px nearer the player (max ${REGROUP_APPROACH_SLACK_PX})`,
  );
  const intoMelee = rangedLayout(
    map,
    rangedCase,
    ['regroup'],
    true,
    REGROUP_PROBE_WOUND_SHARE,
    HELPER_BESIDE_PLAYER_TILE,
  );
  const meleeTrace = traceRanged(intoMelee, { frames: RANGED_RUN_FRAMES });
  check(
    meleeTrace.deepestRegroupApproachPx <= REGROUP_APPROACH_SLACK_PX && meleeTrace.shots > 0,
    `${label}: with its friend straight beside the player, ${meleeTrace.regroupsStarted} regroups brought it ${meleeTrace.deepestRegroupApproachPx.toFixed(1)} px nearer the player (max ${REGROUP_APPROACH_SLACK_PX}); ${meleeTrace.shots} shots`,
  );

  // A regroup and a kite back to back would be one long stretch of silence.
  const chainUntrained = rangedLayout(map, rangedCase, [], true, REGROUP_PROBE_WOUND_SHARE);
  const chainBaseline = traceRanged(chainUntrained, {
    frames: RANGED_RUN_FRAMES,
    chase: true,
    freeHelper: true,
  });
  const chained = rangedLayout(
    map,
    rangedCase,
    ['kite', 'regroup'],
    true,
    REGROUP_PROBE_WOUND_SHARE,
  );
  const chainTrace = traceRanged(chained, {
    frames: RANGED_RUN_FRAMES,
    chase: true,
    freeHelper: true,
  });
  const allowedChainGap =
    chainBaseline.longestShotGapFrames + REGROUP_MAX_FRAMES + SHOT_GAP_SLACK_FRAMES;
  check(
    chainTrace.regroupsStarted === 1 &&
      chainTrace.kitesStarted > 0 &&
      Number.isFinite(chainTrace.shortestRegroupToKiteFrames) &&
      chainTrace.shortestRegroupToKiteFrames >= KITE_COOLDOWN_FRAMES,
    `${label}: chased after a regroup, its first kite waits ${chainTrace.shortestRegroupToKiteFrames} frames (cooldown ${KITE_COOLDOWN_FRAMES}; ${chainTrace.regroupsStarted} regroup, ${chainTrace.kitesStarted} kites)`,
  );
  check(
    chainTrace.longestShotGapFrames <= allowedChainGap,
    `${label}: across a regroup and a kite the longest silence is ${chainTrace.longestShotGapFrames} frames (untrained ${chainBaseline.longestShotGapFrames}; allowed ${allowedChainGap})`,
  );
}

/**
 * A llama's own spits lay the fire its tactics treat as marked ground. With the
 * real lava system live, and with fire laid across its way and under its own
 * feet, it must never kite through fire and must never stop spitting.
 */
function checkLlamaOwnFire(map: GameMap, harness: TacticsHarness): void {
  const check = (ok: boolean, message: string): void => harness.check(ok, message);
  const llamaCase = RANGED_CASES.find((entry) => entry.type === 'llama');
  if (llamaCase === undefined) {
    check(false, 'the llama is in the ranged case list');
    return;
  }

  const untrained = rangedLayout(map, llamaCase, [], true);
  const untrainedTrace = traceRanged(untrained, {
    frames: RANGED_RUN_FRAMES,
    systems: [new LavaBallSystem(map)],
  });
  const allowedGap = untrainedTrace.longestShotGapFrames + KITE_MAX_FRAMES + SHOT_GAP_SLACK_FRAMES;

  const live = rangedLayout(map, llamaCase, ['kite'], true);
  const lava = new LavaBallSystem(map);
  live.arena.loop.registerHazardSource(lava);
  const liveTrace = traceRanged(live, {
    frames: RANGED_RUN_FRAMES,
    hazard: lava,
    systems: [lava],
  });
  check(
    liveTrace.kitesStarted > 0 && liveTrace.framesOnHazardWhileKiting === 0,
    `llama, own lava live: ${liveTrace.kitesStarted} kites, ${liveTrace.framesOnHazardWhileKiting} kite frames on fire`,
  );
  check(
    liveTrace.shots > 0 && liveTrace.longestShotGapFrames <= allowedGap,
    `llama, own lava live: ${liveTrace.shots} spits, longest silence ${liveTrace.longestShotGapFrames} frames (allowed ${allowedGap})`,
  );

  // Fire across the whole way to its friend: the kite is refused, not walked.
  const blocked = rangedLayout(map, llamaCase, ['kite'], true);
  const acrossTheWay = new HazardRect(
    SHOOTER_TILE.x + 1,
    ROW - KITE_MAX_DISTANCE_TILES,
    SHOOTER_TILE.x + 1,
    ROW + KITE_MAX_DISTANCE_TILES,
  );
  blocked.arena.loop.registerHazardSource(acrossTheWay);
  const blockedTrace = traceRanged(blocked, { frames: RANGED_RUN_FRAMES, hazard: acrossTheWay });
  check(
    blockedTrace.framesOnHazardWhileKiting === 0,
    `llama, fire across the way: ${blockedTrace.framesOnHazardWhileKiting} kite frames on fire (${blockedTrace.kitesStarted} kites)`,
  );
  check(
    blockedTrace.shots > 0 && blockedTrace.longestShotGapFrames <= allowedGap,
    `llama, fire across the way: still spits — ${blockedTrace.shots} spits, longest silence ${blockedTrace.longestShotGapFrames} frames (allowed ${allowedGap})`,
  );

  // Fire under its own feet, where a fresh patch of its own would put it.
  const standing = rangedLayout(map, llamaCase, ['kite'], true);
  const underFoot = new HazardRect(SHOOTER_TILE.x, ROW, SHOOTER_TILE.x, ROW);
  standing.arena.loop.registerHazardSource(underFoot);
  const standingTrace = traceRanged(standing, { frames: RANGED_RUN_FRAMES, hazard: underFoot });
  check(
    standingTrace.framesOnHazardWhileKiting === 0 &&
      standingTrace.shots > 0 &&
      standingTrace.longestShotGapFrames <= allowedGap,
    `llama, fire underfoot: ${standingTrace.framesOnHazardWhileKiting} kite frames on fire over ${standingTrace.kitesStarted} kites, ${standingTrace.shots} spits, longest silence ${standingTrace.longestShotGapFrames} frames (allowed ${allowedGap})`,
  );
}

/** A source that says yes to every roll, so a missing trait can only mean "not eligible". */
const ALWAYS_YES: Rng = () => 0;

/**
 * A ranged creature learns exactly `kite` and `regroup` — never a guard, a
 * riposte or a flank, whatever class it shares a base with — and a skeleton
 * archer raised mid-fight by a caster learns nothing.
 */
function checkRangedEligibility(map: GameMap, harness: TacticsHarness): void {
  const check = (ok: boolean, message: string): void => harness.check(ok, message);
  const expected = RANGED_ELIGIBILITY.join(',');
  for (const rangedCase of RANGED_CASES) {
    const top = createMob(rangedCase.type, SHOOTER_TILE.x, SHOOTER_TILE.y, map);
    top.applyMobLevel(MAX_MOB_LEVEL);
    top.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
    const rolled = top.tactics.traits.join(',');
    check(
      rolled === expected,
      `${rangedCase.type}: at the top level it learns ${rolled || 'nothing'} (want ${expected})`,
    );
  }
  const summoned = new SkeletonArcher(SHOOTER_TILE.x, SHOOTER_TILE.y, TILE_SIZE);
  summoned.setMap(map);
  summoned.beginRising();
  summoned.applyMobLevel(MAX_MOB_LEVEL);
  summoned.rollTactics(DIFFICULTY_PROFILES.hard.tacticsChanceScale, ALWAYS_YES);
  check(
    !summoned.tactics.hasAnyTrait,
    `a summoned skeleton_archer learns nothing (${summoned.tactics.traits.join(',') || 'nothing'})`,
  );
}

/** Every ranged-creature section, run against the room `verify-tactics.ts` builds. */
export function checkRangedTactics(map: GameMap, harness: TacticsHarness): void {
  const savedRandom = Math.random;
  Math.random = mulberry32(SECTION_SEED);
  try {
    runRangedSections(map, harness);
  } finally {
    Math.random = savedRandom;
  }
}

function runRangedSections(map: GameMap, harness: TacticsHarness): void {
  harness.section('Ranged eligibility: kite and regroup, never a guard');
  checkRangedEligibility(map, harness);
  for (const rangedCase of RANGED_CASES) {
    harness.section(`Ranged kite: ${rangedCase.type} keeps a friend between it and the player`);
    checkRangedKite(map, harness, rangedCase);
    checkRangedKiteLeash(map, harness, rangedCase);
    checkRangedRegroup(map, harness, rangedCase);
  }
  harness.section(
    'Ranged kite: a llama never kites through its own fire, and never stops spitting',
  );
  checkLlamaOwnFire(map, harness);
}
