/**
 * A headless Ball of Swine fight in the real Iron Colosseum: the real ball, the
 * real `ArenaSystem` and the colosseum's real dressing, run in `DungeonScene`'s
 * update order against one scripted crawler.
 *
 * The crawler is a competent player, not a perfect one: it baits the ball from
 * near the wall, steps off the ball's committed line when it is coming, walks in
 * and punches while the ball wallows, and swats any Tuskling in reach. The cat
 * sits the fight out, so every number belongs to one body.
 *
 * What the room is judged on comes out of here: how long the kill takes, how
 * often the crawler is hit, how often the ball slams the wall, and how many
 * Tusklings it has to deal with. The room gates compare these against numbers
 * measured on the room as it stood before its dressing did anything.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants.js';
import { AbilityManager } from '../../src/core/AbilityManager.js';
import { DIFFICULTY_PROFILES, type Difficulty } from '../../src/core/difficultyProfiles.js';
import { EventBus } from '../../src/core/EventBus.js';
import { referenceStats } from '../../src/core/referenceCrawler.js';
import { settings } from '../../src/core/Settings.js';
import { BallOfSwine } from '../../src/creatures/BallOfSwine.js';
import { CatPlayer } from '../../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import type { Mob } from '../../src/creatures/Mob.js';
import { Tuskling } from '../../src/creatures/Tuskling.js';
import { level2 } from '../../src/levels/level2.js';
import { spawnExtraMobs } from '../../src/levels/spawner.js';
import { ARENA_INTERIOR_RADIUS_TILES } from '../../src/map/arenaGeometry.js';
import type { GameMap } from '../../src/map/GameMap.js';
import { ALL_STATS, type DamageSource } from '../../src/Player.js';
import { mulberry32 } from '../../src/sprites/person/rng.js';
import { BOS_BODY_RADIUS_TILES } from '../../src/sprites/ballOfSwineSheet.js';
import { ArenaSystem } from '../../src/systems/ArenaSystem.js';
import { BossRoomSystem, type BossRoomMiniMap } from '../../src/systems/BossRoomSystem.js';
import { buildColosseumDressing } from '../../src/systems/bossRooms/BossRoomDressings.js';
import type { ColosseumDressingSystem } from '../../src/systems/bossRooms/ColosseumDressingSystem.js';
import { resolveKills, type CombatContext } from '../../src/systems/CombatSystem.js';
import {
  applyKnockbackMotion,
  applyMovement,
  type MovementInput,
} from '../../src/systems/GameLoopPhases.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import { MobRoster } from '../../src/systems/kits/SceneWorld.js';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop.js';
import { SpellSystem } from '../../src/systems/SpellSystem.js';
import { generateFloor } from './harness.js';

/** The dungeon floor the colosseum is built on. */
const SWINE_FLOOR = 2;
/** The party level floor 2's reference crawler is priced at when it reaches the arena. */
export const SWINE_SIM_PARTY_LEVEL = 12;
/** The difficulty every fight is measured on. Hard adds a healer, which is its own gate's business. */
const SIM_DIFFICULTY: Difficulty = 'normal';
const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
/** Frames a kill is given before the run is called unfinished. */
const KILL_BUDGET_MINUTES = 20;
const KILL_BUDGET_FRAMES = KILL_BUDGET_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;
/** The slam rate is counted over five minutes of a crawler who never fights back. */
const SLAM_WINDOW_MINUTES = 5;
export const SLAM_WINDOW_FRAMES = SLAM_WINDOW_MINUTES * SECONDS_PER_MINUTE * FRAMES_PER_SECOND;

const HALF_TILE = TILE_SIZE / 2;
/** How far ahead along its heading the crawler treats the ball as coming for it. */
const THREAT_AHEAD_TILES = 9;
/** Clearance beyond the trample radius the crawler keeps from the ball's line. */
const DODGE_MARGIN_TILES = 0.9;
/** The share of its body radius the ball tramples at, as `BallOfSwine` measures it. */
const TRAMPLE_SHARE_OF_BODY = 0.9;
const TRAMPLE_REACH_TILES = BOS_BODY_RADIUS_TILES * TRAMPLE_SHARE_OF_BODY;
/** Where the crawler waits for the ball: near enough the wall that a charge ends in it. */
const BAIT_INSET_TILES = 3;
const BAIT_RADIUS_TILES = ARENA_INTERIOR_RADIUS_TILES - BAIT_INSET_TILES;
/** Distance the crawler's punches land from, centre to centre, on the ball's hide. */
const FIST_REACH_TILES = 0.9;
const BALL_STRIKE_REACH_TILES = BOS_BODY_RADIUS_TILES + FIST_REACH_TILES;
/** Distance the crawler's punches land from on a Tuskling. */
const TUSKLING_STRIKE_REACH_TILES = 1.2;
/** Momentum at or under which the next slam may put the ball down, so the crawler closes in. */
const SHADOW_MOMENTUM = 0.3;
/** How far beside the ball's line the crawler keeps pace with it. */
const SHADOW_STANDOFF_TILES = 3.5;
/** The furthest from the arena's middle the crawler chooses to walk. */
const STAY_INSIDE_INSET_TILES = 1.5;
const STAY_INSIDE_TILES = ARENA_INTERIOR_RADIUS_TILES - STAY_INSIDE_INSET_TILES;
/** A step direction shorter than this, once its outward part is dropped, is no step. */
const MIN_STEP_SHARE = 0.2;
/** A step shorter than this counts as the ball not moving. */
const STUCK_STEP_PX = 0.05;
/** Where the crawler starts: this many tiles in from the door. */
const START_DEPTH_TILES = 3;
/** The crawler is topped back up below this share of its health, so one run measures a whole fight. */
const TOP_UP_HP_SHARE = 0.35;

/** The minimap is never drawn here, so it has no size. */
const UNDRAWN_MINIMAP_SIZE = 0;
const undrawnMiniMap: BossRoomMiniMap = {
  revealBossNeighborhood: () => undefined,
  isExpanded: false,
  EXPANDED_SIZE: UNDRAWN_MINIMAP_SIZE,
  NORMAL_SIZE: UNDRAWN_MINIMAP_SIZE,
};

export interface SwineFightMetrics {
  /** Frames from the crawler stepping in to the ball's HP reaching zero; the budget when it never did. */
  readonly killFrames: number;
  readonly killed: boolean;
  /** Blows that landed on the crawler, from anything. */
  readonly hitsOnCrawler: number;
  /** Health the crawler lost, as a share of its maximum. */
  readonly damageShare: number;
  /** Flat wall impacts over the run. */
  readonly slams: number;
  /** Frames the ball spent rolling without moving. */
  readonly ballStuckFrames: number;
  /** Tusklings that entered the fight while the ball lived. */
  readonly tusklingsSpawned: number;
  /** The most Tusklings alive at once while the ball lived. */
  readonly mostTusklingsAlive: number;
  /** Frames the run lasted. */
  readonly frames: number;
}

export interface SwineFightOptions {
  readonly seed: number;
  /** When false the crawler never attacks: the slam-rate run. */
  readonly fightsBack: boolean;
  readonly budgetFrames?: number;
  /** Called once the arena is built, before the first frame, so a gate can reach inside. */
  readonly onBuilt?: (fight: SwineFight) => void;
  /** Called after every frame, so a gate can watch the room as the fight runs. */
  readonly onFrame?: (fight: SwineFight) => void;
}

/** The live pieces of one simulated fight. */
export interface SwineFight {
  readonly map: GameMap;
  readonly ball: BallOfSwine;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly roster: MobRoster;
  readonly arena: ArenaSystem;
  readonly dressing: ColosseumDressingSystem;
  readonly context: SystemContext;
}

interface Vec {
  x: number;
  y: number;
}

function centreOf(body: { x: number; y: number }): Vec {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

/** Runs `run` with `Math.random` and the difficulty pinned, putting both back after. */
function pinned<T>(seed: number, run: () => T): T {
  const unseeded = Math.random;
  const previousDifficulty = settings.difficulty;
  Math.random = mulberry32(seed);
  settings.setDifficulty(SIM_DIFFICULTY);
  try {
    return run();
  } finally {
    Math.random = unseeded;
    settings.setDifficulty(previousDifficulty);
  }
}

/** Counts every call of a private method on one object, leaving it working. */
function countCalls(target: object, method: string, onCall: () => void): void {
  const original: unknown = Reflect.get(target, method);
  if (typeof original !== 'function') throw new Error(`no ${method}() to count`);
  Reflect.set(target, method, (...args: unknown[]): unknown => {
    onCall();
    const result: unknown = Reflect.apply(original, target, args);
    return result;
  });
}

/** Builds the arena on floor 2 of `seed` with the ball, the arena systems and a crawler at the door. */
export function buildSwineFight(seed: number): SwineFight {
  const { gameMap: map } = generateFloor(SWINE_FLOOR, seed);
  if (map.arenaExteriors.length === 0) throw new Error(`seed ${seed} built no arena`);
  const arenaExterior = map.arenaExteriors[0];
  const profile = DIFFICULTY_PROFILES[SIM_DIFFICULTY];
  const roster = new MobRoster(map, new SpellSystem());
  for (const mob of spawnExtraMobs(level2, map, SWINE_SIM_PARTY_LEVEL, profile)) roster.add(mob);
  const ball = roster.mobs.find((mob): mob is BallOfSwine => mob instanceof BallOfSwine);
  if (ball === undefined) throw new Error(`seed ${seed} spawned no Ball of Swine`);

  const bus = new EventBus();
  const bossRoom = new BossRoomSystem(
    map,
    undrawnMiniMap,
    (level2.bossRooms ?? []).map((rule) => rule.type),
  );
  const arena = new ArenaSystem(
    map,
    bus,
    () => roster.mobs,
    (mob) => roster.add(mob),
    bossRoom,
  );
  const dressing = buildColosseumDressing(map);
  if (dressing === null) throw new Error(`seed ${seed} built no colosseum dressing`);
  arena.dressing = dressing;

  const { centre } = arenaExterior;
  const startY = centre.y + ARENA_INTERIOR_RADIUS_TILES - START_DEPTH_TILES;
  const human = new HumanPlayer(centre.x, startY, TILE_SIZE);
  const cat = new CatPlayer(centre.x, startY, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  human.level = SWINE_SIM_PARTY_LEVEL;
  cat.level = SWINE_SIM_PARTY_LEVEL;
  const reference = referenceStats('human', 'balanced', SWINE_SIM_PARTY_LEVEL);
  for (const stat of ALL_STATS) human.setBaseStat(stat, reference.stats[stat]);
  human.hp = human.maxHp;
  // Out of the fight entirely: a dead crawler is no target and no body to push.
  cat.hp = 0;

  const context: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
    bossRoom,
  };
  return { map, ball, human, cat, roster, arena, dressing, context };
}

/** The unit direction the crawler walks this frame, or null to stand. */
function crawlerIntent(fight: SwineFight, fightsBack: boolean): Vec | null {
  const { ball, human, map } = fight;
  const me = centreOf(human);
  const ballAt = centreOf(ball);
  const toBall = { x: ballAt.x - me.x, y: ballAt.y - me.y };
  const ballDistance = Math.hypot(toBall.x, toBall.y);

  if (ball.isStopped && fightsBack) {
    if (ballDistance <= BALL_STRIKE_REACH_TILES * TILE_SIZE) return null;
    return { x: toBall.x / ballDistance, y: toBall.y / ballDistance };
  }

  // Off its line when it is coming: the side the crawler is already on, or the
  // arena's middle when dead ahead, since the wall side has nowhere to go.
  const heading = { x: ball.facingX, y: ball.facingY };
  const fromBall = { x: -toBall.x, y: -toBall.y };
  const along = fromBall.x * heading.x + fromBall.y * heading.y;
  const across = fromBall.x * -heading.y + fromBall.y * heading.x;
  const clearance = (TRAMPLE_REACH_TILES + DODGE_MARGIN_TILES) * TILE_SIZE;
  const coming = along > -TILE_SIZE && along < THREAT_AHEAD_TILES * TILE_SIZE;
  if (coming && Math.abs(across) < clearance) {
    const arena = map.arenaExteriors[0];
    const arenaCentre = {
      x: arena.centre.x * TILE_SIZE + HALF_TILE,
      y: arena.centre.y * TILE_SIZE + HALF_TILE,
    };
    const toMiddle = { x: arenaCentre.x - me.x, y: arenaCentre.y - me.y };
    const middleSide = toMiddle.x * -heading.y + toMiddle.y * heading.x;
    const DEAD_AHEAD_PX = 4;
    const side = Math.abs(across) > DEAD_AHEAD_PX ? Math.sign(across) : Math.sign(middleSide) || 1;
    return { x: -heading.y * side, y: heading.x * side };
  }

  // One slam from collapsing: keep pace beside its line, so the wallow opens
  // within a few steps rather than across the arena.
  if (ball.momentumFraction <= SHADOW_MOMENTUM && fightsBack) {
    const side = Math.sign(across) || 1;
    const beside = {
      x: ballAt.x - heading.y * side * SHADOW_STANDOFF_TILES * TILE_SIZE,
      y: ballAt.y + heading.x * side * SHADOW_STANDOFF_TILES * TILE_SIZE,
    };
    const toBeside = { x: beside.x - me.x, y: beside.y - me.y };
    const besideDistance = Math.hypot(toBeside.x, toBeside.y);
    if (besideDistance < HALF_TILE) return null;
    return { x: toBeside.x / besideDistance, y: toBeside.y / besideDistance };
  }

  // Waiting: hold a spot near the wall on the crawler's own bearing, so the
  // ball's charge at the crawler runs on into the ironwork behind it.
  const arena = map.arenaExteriors[0];
  const middle = {
    x: arena.centre.x * TILE_SIZE + HALF_TILE,
    y: arena.centre.y * TILE_SIZE + HALF_TILE,
  };
  const ownBearing = Math.atan2(me.y - middle.y, me.x - middle.x);
  const spot = {
    x: middle.x + Math.cos(ownBearing) * BAIT_RADIUS_TILES * TILE_SIZE,
    y: middle.y + Math.sin(ownBearing) * BAIT_RADIUS_TILES * TILE_SIZE,
  };
  const toSpot = { x: spot.x - me.x, y: spot.y - me.y };
  const spotDistance = Math.hypot(toSpot.x, toSpot.y);
  if (spotDistance < TILE_SIZE) return null;
  return { x: toSpot.x / spotDistance, y: toSpot.y / spotDistance };
}

/**
 * Drops the outward part of a step once the crawler is near the wall.
 *
 * The fight is measured, not the rim: whatever the rim does to a crawler
 * pressed against it has its own gate, and a scripted crawler that wandered
 * into the ironwork would measure that instead of the fight.
 */
function keepOffTheWall(fight: SwineFight, intent: Vec | null): Vec | null {
  if (intent === null) return null;
  const arena = fight.map.arenaExteriors[0];
  const me = centreOf(fight.human);
  const outward = {
    x: me.x - (arena.centre.x * TILE_SIZE + HALF_TILE),
    y: me.y - (arena.centre.y * TILE_SIZE + HALF_TILE),
  };
  const radius = Math.hypot(outward.x, outward.y);
  if (radius < STAY_INSIDE_TILES * TILE_SIZE) return intent;
  const unitOut = { x: outward.x / radius, y: outward.y / radius };
  const outwardPart = intent.x * unitOut.x + intent.y * unitOut.y;
  if (outwardPart <= 0) return intent;
  const tangent = { x: intent.x - unitOut.x * outwardPart, y: intent.y - unitOut.y * outwardPart };
  const tangentLength = Math.hypot(tangent.x, tangent.y);
  if (tangentLength < MIN_STEP_SHARE) return null;
  return { x: tangent.x / tangentLength, y: tangent.y / tangentLength };
}

/** One tick in `DungeonScene`'s order: movement, the arena, mobs, the dressing, timers, kills. */
function step(
  fight: SwineFight,
  combat: CombatContext,
  loop: MobUpdateLoop,
  intent: Vec | null,
): void {
  const { human, cat, arena, dressing, context } = fight;
  const move: MovementInput =
    intent === null
      ? { dx: 0, dy: 0, isMobile: true }
      : { dx: intent.x, dy: intent.y, isMobile: true };
  applyMovement(human, move, fight.map, 'sole');
  applyKnockbackMotion(human, fight.map);
  context.activeIsMoving = human.isMoving;
  arena.update(context);
  loop.update(context);
  dressing.update(context);
  human.tickTimers();
  cat.tickTimers();
  combat.mobGrid = fight.roster.grid;
  resolveKills(combat);
}

/** Runs one fight from the crawler stepping in until the ball dies or the budget runs out. */
export function runSwineFight(options: SwineFightOptions): SwineFightMetrics {
  return pinned(options.seed, () => {
    const fight = buildSwineFight(options.seed);
    const { ball, human, roster } = fight;
    options.onBuilt?.(fight);

    let slams = 0;
    countCalls(ball, 'slamInto', () => {
      slams++;
    });

    let hitsOnCrawler = 0;
    let damageTaken = 0;
    const takeDamage = human.takeDamage.bind(human);
    human.takeDamage = (amount: number, source?: DamageSource): boolean => {
      const before = human.hp;
      const landed = takeDamage(amount, source);
      if (landed) {
        hitsOnCrawler++;
        damageTaken += before - human.hp;
      }
      return landed;
    };

    const combat: CombatContext = {
      human,
      cat: fight.cat,
      mobs: roster.mobs,
      mobGrid: roster.grid,
      gameMap: fight.map,
      safeRoom: null,
      bus: new EventBus(),
      abilityManager: new AbilityManager(),
      spells: new SpellSystem(),
      hitLanded: false,
    };
    const loop = new MobUpdateLoop();
    const attack = referenceStats('human', 'balanced', SWINE_SIM_PARTY_LEVEL).attackCycle;
    let attackIndex = 0;
    let attackCooldown = 0;

    const seenTusklings = new Set<Mob>();
    let mostTusklingsAlive = 0;
    let ballStuckFrames = 0;
    const budget = options.budgetFrames ?? KILL_BUDGET_FRAMES;
    let frame = 0;
    for (; frame < budget; frame++) {
      if (ball.hp <= 0) break;
      const intent = keepOffTheWall(fight, crawlerIntent(fight, options.fightsBack));
      const ballBefore = { x: ball.x, y: ball.y };
      const wasRolling = ball.isMoving;
      step(fight, combat, loop, intent);
      if (wasRolling && Math.hypot(ball.x - ballBefore.x, ball.y - ballBefore.y) < STUCK_STEP_PX) {
        ballStuckFrames++;
      }

      if (attackCooldown > 0) attackCooldown--;
      if (options.fightsBack && attackCooldown === 0 && human.isAlive) {
        const blow = attack[attackIndex % attack.length];
        const me = centreOf(human);
        const target = strikeTarget(fight, me);
        if (target !== null) {
          target.takeDamageFrom(blow.damage, human, blow.damageType);
          attackIndex++;
          attackCooldown = blow.frames;
        }
      }

      let alive = 0;
      for (const mob of roster.mobs) {
        if (!(mob instanceof Tuskling) || !mob.isAlive) continue;
        seenTusklings.add(mob);
        alive++;
      }
      mostTusklingsAlive = Math.max(mostTusklingsAlive, alive);

      if (human.hp < human.maxHp * TOP_UP_HP_SHARE) human.hp = human.maxHp;
      options.onFrame?.(fight);
    }

    return {
      killFrames: frame,
      killed: ball.hp <= 0,
      hitsOnCrawler,
      damageShare: damageTaken / human.maxHp,
      slams,
      ballStuckFrames,
      tusklingsSpawned: seenTusklings.size,
      mostTusklingsAlive,
      frames: frame,
    };
  });
}

/** What the crawler's next punch lands on: the ball when down and in reach, else the nearest Tuskling in reach. */
function strikeTarget(fight: SwineFight, me: Vec): Mob | null {
  const { ball, roster } = fight;
  const ballAt = centreOf(ball);
  if (
    ball.isStopped &&
    Math.hypot(ballAt.x - me.x, ballAt.y - me.y) <= BALL_STRIKE_REACH_TILES * TILE_SIZE
  ) {
    return ball;
  }
  let best: Mob | null = null;
  let bestDistance = TUSKLING_STRIKE_REACH_TILES * TILE_SIZE;
  for (const mob of roster.mobs) {
    if (!(mob instanceof Tuskling) || !mob.isAlive) continue;
    const at = centreOf(mob);
    const distance = Math.hypot(at.x - me.x, at.y - me.y);
    if (distance <= bestDistance) {
      best = mob;
      bestDistance = distance;
    }
  }
  return best;
}

/** The crawler's top speed, for gates that reason about escapes. */
export const CRAWLER_TOP_SPEED_PX = PLAYER_SPEED;
