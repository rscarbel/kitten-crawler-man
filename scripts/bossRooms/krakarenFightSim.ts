/**
 * A headless Krakaren Clone fight: the real boss, the real `BossRoomSystem`
 * that seals her room and raises her guard tentacles, the real clone-lab
 * dressing, and a scripted crawler who walks in, fights and dodges.
 *
 * The crawler is deliberately a plain one: it walks straight at what it wants
 * to hit, cuts a guard tentacle down before swinging at her, and steps out of
 * any marked ground along the same escape vectors companions read. It is not
 * trying to play well — it is a fixed yardstick, so a change to the room that
 * makes the same walk-in cheaper or deadlier shows up as a number moving.
 *
 * Deterministic: `Math.random` is replaced by a seeded generator for the length
 * of a run, and the floor comes from a world seed.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { referenceStats } from '../../src/core/referenceCrawler.js';
import { KrakarenClone } from '../../src/creatures/KrakarenClone.js';
import { KrakarenTentacle } from '../../src/creatures/KrakarenTentacle.js';
import type { Mob } from '../../src/creatures/Mob.js';
import { applySpawnDifficulty } from '../../src/core/difficultyProfiles.js';
import type { DamageSource } from '../../src/Player.js';
import { KRAKAREN_WADE } from '../../src/map/tileTypes.js';
import { mulberry32 } from '../../src/sprites/person/rng.js';
import { BossRoomSystem } from '../../src/systems/BossRoomSystem.js';
import { resolveKills, type CombatContext } from '../../src/systems/CombatSystem.js';
import { AbilityManager } from '../../src/core/AbilityManager.js';
import { applyMovement } from '../../src/systems/GameLoopPhases.js';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop.js';
import { SpellSystem } from '../../src/systems/SpellSystem.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import { BossRoomDressings } from '../../src/systems/bossRooms/BossRoomDressings.js';
import type { DoorSide, TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';
import { MobRoster } from '../../src/systems/kits/SceneWorld.js';
import { buildEnvironment, findFloorWithRoom, gameGauntletDressings } from './harness.js';
import { krakarenRoom } from './krakaren.js';

/** The party level the scripted crawler is built at, and the level the boss is raised to. */
export const SIM_PARTY_LEVEL = 8;
/** Longest a fight may run before the sim calls it a stall, in frames (ten minutes). */
const SIM_FRAME_CEILING = 36000;
const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;

/** How far inside the doorway the crawler starts, so the room seals on the first frame. */
const START_DEPTH_TILES = 2;
/** The crawler closes to this share of its reach before swinging, so a swing never misses on the edge. */
const MELEE_APPROACH_SHARE = 0.8;
/** Distance under which a heading is treated as "already there". */
const ARRIVED_PX = 2;
/**
 * Headings tried, in turn, when the one the crawler wants runs it into a prop:
 * straight on, then fanning out either side.
 */
const DETOUR_STEP_RAD = 0.6;
const DETOUR_STEPS_EACH_WAY = 3;
const DETOUR_ANGLES_RAD: readonly number[] = [
  0,
  ...Array.from({ length: DETOUR_STEPS_EACH_WAY }, (_, i) => [
    (i + 1) * DETOUR_STEP_RAD,
    -(i + 1) * DETOUR_STEP_RAD,
  ]).flat(),
  Math.PI,
];
/** A step shorter than this counts as blocked and the next detour is tried. */
const MIN_PROGRESS_PX = 0.2;

const MINIMAP_EXPANDED_SIZE = 0;
const MINIMAP_NORMAL_SIZE = 0;

/** What one fight measured. */
export interface FightMetrics {
  readonly seed: number;
  readonly side: DoorSide;
  /** Seconds from the seal to her death, or the ceiling when she survived it. */
  readonly timeToKillSeconds: number;
  readonly killed: boolean;
  /** Lashes wound up plus slams started, per minute of fight. */
  readonly attacksPerMinute: number;
  /** Blows from her or her tentacles that landed on the crawler. */
  readonly hitsOnCrawler: number;
  /** Slams that would have killed the crawler (it is held alive to finish the fight). */
  readonly slamKills: number;
  /** Blows from the room itself — live wires, bursting vats. */
  readonly hazardHits: number;
  /** Frames the crawler spent standing in flood water. */
  readonly wadeFrames: number;
}

interface RunOptions {
  readonly seed: number;
  readonly side: DoorSide;
  /**
   * False fights her in the bare room, with no lab built over it: the plain
   * floor the "not easier" baseline is measured on.
   */
  readonly withLab?: boolean;
  /** Called once per frame after the room has updated, for gates that watch the fight. */
  readonly onFrame?: (frame: FightFrame) => void;
}

/** A frame of a running fight, for gates that watch one. */
export interface FightFrame {
  readonly frame: number;
  readonly boss: KrakarenClone;
  readonly dressings: BossRoomDressings;
  readonly ctx: SystemContext;
}

function readPrivateString(owner: object, key: string): string | null {
  const value: unknown = Reflect.get(owner, key);
  return typeof value === 'string' ? value : null;
}

function centreOf(body: { x: number; y: number }): TilePoint {
  return { x: body.x + TILE_SIZE / 2, y: body.y + TILE_SIZE / 2 };
}

/** One fight on the floor found from `seed` whose Krakaren room opens on `side`. */
export function runKrakarenFight(options: RunOptions): FightMetrics {
  const realRandom = Math.random;
  Math.random = mulberry32(options.seed);
  try {
    return runSeededFight(options);
  } finally {
    Math.random = realRandom;
  }
}

function runSeededFight(options: RunOptions): FightMetrics {
  const found = findFloorWithRoom(krakarenRoom, options.seed, options.side);
  if (found === null) throw new Error(`no krakaren room on side ${options.side}`);
  const env = buildEnvironment(found);
  const { gameMap, room } = env;
  const bossTypes = env.levelDef.bossRooms?.map((r) => r.type) ?? [];

  const parts =
    options.withLab === false
      ? { hoarder: null, juicer: null, krakaren: null }
      : gameGauntletDressings(env);
  const dressings = new BossRoomDressings(
    { ...parts, spiderLab: null, colosseum: null },
    bossTypes,
  );
  const bossRoom = new BossRoomSystem(
    gameMap,
    {
      revealBossNeighborhood: () => undefined,
      isExpanded: false,
      EXPANDED_SIZE: MINIMAP_EXPANDED_SIZE,
      NORMAL_SIZE: MINIMAP_NORMAL_SIZE,
    },
    bossTypes,
  );
  bossRoom.fightListener = dressings;

  const human = env.frame.human;
  const cat = env.frame.cat;
  human.isActive = true;
  cat.isActive = false;
  // One crawler: a dead cat is no target, no body and nobody to hit.
  cat.hp = 0;

  const doorway = room.doorways.find((d) => d.side === options.side) ?? room.doorways[0];
  const inward = inwardOf(doorway.side);
  human.x = (doorway.tile.x + inward.x * START_DEPTH_TILES) * TILE_SIZE;
  human.y = (doorway.tile.y + inward.y * START_DEPTH_TILES) * TILE_SIZE;

  const roster = new MobRoster(gameMap, new SpellSystem());
  const boss = new KrakarenClone(room.spawn.x, room.spawn.y, TILE_SIZE);
  boss.applyMobLevel(SIM_PARTY_LEVEL, env.levelDef.levelledCurve);
  applySpawnDifficulty(boss);
  roster.add(boss);

  const loop = new MobUpdateLoop();
  loop.registerHazardSource(bossRoom);
  loop.registerHazardSource(dressings);

  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
    bossRoom,
  };
  const combat: CombatContext = {
    human,
    cat,
    mobs: roster.mobs,
    mobGrid: roster.grid,
    gameMap,
    safeRoom: null,
    bus: env.bus,
    abilityManager: new AbilityManager(),
    spells: new SpellSystem(),
    hitLanded: false,
  };

  let hitsOnCrawler = 0;
  let slamKills = 0;
  let hazardHits = 0;
  const takeDamage = human.takeDamage.bind(human);
  human.takeDamage = (amount: number, source?: DamageSource): boolean => {
    const landed = takeDamage(amount, source);
    if (landed && source?.kind === 'mob') {
      hitsOnCrawler++;
      if (source.attackType === 'slam') slamKills++;
    }
    if (landed && source?.kind === 'environmental') hazardHits++;
    // Held alive so the fight runs to its end and every later blow is counted too.
    human.hp = human.maxHp;
    return landed;
  };

  const attack = referenceStats('human', 'balanced', SIM_PARTY_LEVEL).attackCycle[0];
  const reach = human.getMeleeRange();
  let swingCooldown = 0;
  let attacks = 0;
  let lastBossState: string | null = null;
  let hadSlam = false;
  let sealedAt: number | null = null;
  let wadeFrames = 0;

  let frame = 0;
  for (; frame < SIM_FRAME_CEILING && boss.isAlive; frame++) {
    const goal = chooseGoal(roster.mobs, boss, human);
    const move = crawlerMove(human, goal, reach, bossRoom, dressings, gameMap);
    const before = { x: human.x, y: human.y };
    applyMovement(human, { dx: move.x, dy: move.y, isMobile: true }, gameMap, 'sole');
    const moved = Math.hypot(human.x - before.x, human.y - before.y);
    if (moved < MIN_PROGRESS_PX && (move.x !== 0 || move.y !== 0)) {
      for (const angle of DETOUR_ANGLES_RAD) {
        const turned = rotate(move, angle);
        applyMovement(human, { dx: turned.x, dy: turned.y, isMobile: true }, gameMap, 'sole');
        if (Math.hypot(human.x - before.x, human.y - before.y) >= MIN_PROGRESS_PX) break;
      }
    }
    ctx.activeIsMoving = human.isMoving;

    bossRoom.update(ctx);
    dressings.update(ctx);
    loop.update(ctx);
    human.tickTimers();
    resolveKills(combat);
    options.onFrame?.({ frame, boss, dressings, ctx });

    if (sealedAt === null && bossRoom.anyLocked) sealedAt = frame;
    if (isWading(human, gameMap)) wadeFrames++;

    const state = readPrivateString(boss, 'state');
    if (state === 'melee_windup' && lastBossState !== 'melee_windup') attacks++;
    lastBossState = state;
    const slamNow = boss.slamShadow !== null;
    if (slamNow && !hadSlam) attacks++;
    hadSlam = slamNow;

    if (swingCooldown > 0) swingCooldown--;
    const target = goal.mob;
    if (swingCooldown === 0 && target?.isAlive === true) {
      const distance = Math.hypot(
        centreOf(target).x - centreOf(human).x,
        centreOf(target).y - centreOf(human).y,
      );
      if (distance <= reach) {
        target.takeDamageFrom(attack.damage, human, attack.damageType);
        swingCooldown = attack.frames;
      }
    }
  }

  const fightFrames = frame - (sealedAt ?? 0);
  const minutes = fightFrames / FRAMES_PER_SECOND / SECONDS_PER_MINUTE;
  return {
    seed: options.seed,
    side: options.side,
    timeToKillSeconds: fightFrames / FRAMES_PER_SECOND,
    killed: !boss.isAlive,
    attacksPerMinute: minutes > 0 ? attacks / minutes : 0,
    hitsOnCrawler,
    slamKills,
    hazardHits,
    wadeFrames,
  };
}

function isWading(body: { x: number; y: number }, gameMap: SystemContext['gameMap']): boolean {
  const c = centreOf(body);
  const tileX = Math.floor(c.x / TILE_SIZE);
  const tileY = Math.floor(c.y / TILE_SIZE);
  if (tileY < 0 || tileY >= gameMap.structure.length) return false;
  const row = gameMap.structure[tileY];
  return tileX >= 0 && tileX < row.length && row[tileX].type === KRAKAREN_WADE;
}

interface Goal {
  readonly mob: Mob | null;
}

/** A guard tentacle standing up first, since she takes a quarter of every blow while one does. */
function chooseGoal(mobs: readonly Mob[], boss: KrakarenClone, human: TilePoint): Goal {
  let best: Mob | null = null;
  let bestDistance = Infinity;
  for (const mob of mobs) {
    if (!(mob instanceof KrakarenTentacle) || !mob.isGuarding || mob.isUnderground) continue;
    const distance = Math.hypot(mob.x - human.x, mob.y - human.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mob;
    }
  }
  return { mob: best ?? boss };
}

interface HazardSource {
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null;
}

function crawlerMove(
  human: { x: number; y: number },
  goal: Goal,
  reach: number,
  bossRoom: HazardSource,
  dressings: HazardSource,
  gameMap: SystemContext['gameMap'],
): TilePoint {
  const escape =
    bossRoom.getHazardEscapeVector(human.x, human.y) ??
    dressings.getHazardEscapeVector(human.x, human.y);
  if (escape !== null) return { x: escape.dx, y: escape.dy };
  if (goal.mob === null) return { x: 0, y: 0 };
  const from = centreOf(human);
  const to = centreOf(goal.mob);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= reach * MELEE_APPROACH_SHARE || distance < ARRIVED_PX) return { x: 0, y: 0 };
  const heading = { x: dx / distance, y: dy / distance };
  // Never walk into marked ground on the way in: a step whose landing is a
  // hazard is swapped for the first detour that is not.
  for (const angle of DETOUR_ANGLES_RAD) {
    const turned = rotate(heading, angle);
    const probeX = human.x + turned.x * TILE_SIZE;
    const probeY = human.y + turned.y * TILE_SIZE;
    const marked =
      bossRoom.getHazardEscapeVector(probeX, probeY) !== null ||
      dressings.getHazardEscapeVector(probeX, probeY) !== null;
    const tileX = Math.floor((probeX + TILE_SIZE / 2) / TILE_SIZE);
    const tileY = Math.floor((probeY + TILE_SIZE / 2) / TILE_SIZE);
    if (!marked && gameMap.isWalkable(tileX, tileY)) return turned;
  }
  return heading;
}

function rotate(v: TilePoint, angle: number): TilePoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function inwardOf(side: DoorSide): TilePoint {
  switch (side) {
    case 'south':
      return { x: 0, y: -1 };
    case 'north':
      return { x: 0, y: 1 };
    case 'east':
      return { x: -1, y: 0 };
    case 'west':
      return { x: 1, y: 0 };
  }
}

/** The mean of each metric over a set of fights. */
export interface FightSummary {
  readonly fights: number;
  readonly killed: number;
  readonly timeToKillSeconds: number;
  readonly attacksPerMinute: number;
  readonly hitsOnCrawler: number;
  readonly slamKills: number;
  readonly hazardHits: number;
  readonly wadeShare: number;
}

export function summarise(runs: readonly FightMetrics[]): FightSummary {
  const mean = (pick: (m: FightMetrics) => number): number =>
    runs.reduce((sum, m) => sum + pick(m), 0) / Math.max(1, runs.length);
  const totalFrames = runs.reduce((sum, m) => sum + m.timeToKillSeconds * FRAMES_PER_SECOND, 0);
  const totalWade = runs.reduce((sum, m) => sum + m.wadeFrames, 0);
  return {
    fights: runs.length,
    killed: runs.filter((m) => m.killed).length,
    timeToKillSeconds: mean((m) => m.timeToKillSeconds),
    attacksPerMinute: mean((m) => m.attacksPerMinute),
    hitsOnCrawler: mean((m) => m.hitsOnCrawler),
    slamKills: mean((m) => m.slamKills),
    hazardHits: mean((m) => m.hazardHits),
    wadeShare: totalFrames > 0 ? totalWade / totalFrames : 0,
  };
}
