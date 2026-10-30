/**
 * A headless Current Goblin fight: the real boss, the real `BossRoomSystem`
 * that seals his room, the real power-lab dressing, and a scripted crawler who
 * walks in, fights and steps out of whatever he is about to land.
 *
 * The crawler is deliberately a plain one: it walks straight at him, swings
 * when in reach, and steps out of marked ground along the same escape vectors
 * companions read. It is not trying to play well; it is a fixed yardstick that
 * shows whether every attack of his comes round and whether a body that reads
 * his telegraphs can get clear of them.
 *
 * Deterministic: `Math.random` is replaced by a seeded generator for the length
 * of a run, and the floor comes from a world seed.
 */

import { EventBus } from '../../src/core/EventBus.js';
import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../../src/core/constants.js';
import { referenceStats } from '../../src/core/party/referenceCrawler.js';
import {
  CHARGED_PUDDLE_ATTACK_TYPE,
  ElectricGoblin,
  ROD_SWIPE_ATTACK_TYPE,
  SHOCK_GRENADE_ATTACK_TYPE,
  SLAM_WAVE_ATTACK_TYPE,
} from '../../src/creatures/ElectricGoblin.js';
import { applySpawnDifficulty } from '../../src/core/difficulty/difficultyProfiles.js';
import type { DamageSource } from '../../src/Player.js';
import { mulberry32 } from '../../src/sprites/person/rng.js';
import { BossRoomSystem } from '../../src/systems/BossRoomSystem.js';
import { resolveKills, type CombatContext } from '../../src/systems/CombatSystem.js';
import { AbilityManager } from '../../src/core/skills/AbilityManager.js';
import { applyMovement } from '../../src/systems/GameLoopPhases.js';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop.js';
import { SpellSystem } from '../../src/systems/SpellSystem.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import { BossRoomDressings } from '../../src/systems/bossRooms/BossRoomDressings.js';
import type { DoorSide, TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';
import { MobRoster } from '../../src/systems/kits/SceneWorld.js';
import { buildEnvironment, findFloorWithRoom, gameGauntletDressings } from './harness.js';
import { powerLabRoom } from './powerLab.js';
import { harnessHit } from '../crawlerHitHarness';
import { cameraAt, UNZOOMED } from '../../src/core/rendering/camera.js';

/** The party level the scripted crawler is built at, and the level the boss is raised to. */
export const SIM_PARTY_LEVEL = 8;
/** Longest a fight may run before the sim calls it a stall, in frames (ten minutes). */
const SIM_FRAME_CEILING = 36000;

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

/** Every attack of his the sim counts, by the attack type his blows carry. */
export const ELECTRIC_GOBLIN_ATTACKS = [
  SHOCK_GRENADE_ATTACK_TYPE,
  CHARGED_PUDDLE_ATTACK_TYPE,
  ROD_SWIPE_ATTACK_TYPE,
  SLAM_WAVE_ATTACK_TYPE,
] as const;
export type ElectricGoblinAttack = (typeof ELECTRIC_GOBLIN_ATTACKS)[number];

/** What one fight measured. */
export interface FightMetrics {
  readonly seed: number;
  readonly side: DoorSide;
  /** Seconds from the seal to his death, or the ceiling when he survived it. */
  readonly timeToKillSeconds: number;
  readonly killed: boolean;
  /** Each telegraphed attack he started: grenade volleys, slams and puddle tells. */
  readonly started: Readonly<Record<'grenade' | 'slam' | 'puddle', number>>;
  /** Blows of each kind that landed on the crawler. */
  readonly hits: Readonly<Record<ElectricGoblinAttack, number>>;
}

interface RunOptions {
  readonly seed: number;
  readonly side: DoorSide;
  /** Called once per frame after the room has updated, for gates that watch the fight. */
  readonly onFrame?: (frame: FightFrame) => void;
}

/** A frame of a running fight, for gates that watch one. */
export interface FightFrame {
  readonly frame: number;
  readonly boss: ElectricGoblin;
  readonly dressings: BossRoomDressings;
  readonly ctx: SystemContext;
}

function centreOf(body: { x: number; y: number }): TilePoint {
  return { x: body.x + TILE_SIZE / 2, y: body.y + TILE_SIZE / 2 };
}

function isGoblinAttack(attackType: string | undefined): attackType is ElectricGoblinAttack {
  return ELECTRIC_GOBLIN_ATTACKS.some((attack) => attack === attackType);
}

/** One fight on the floor found from `seed` whose power lab opens on `side`. */
export function runElectricGoblinFight(options: RunOptions): FightMetrics {
  const realRandom = Math.random;
  Math.random = mulberry32(options.seed);
  try {
    return runSeededFight(options);
  } finally {
    Math.random = realRandom;
  }
}

function runSeededFight(options: RunOptions): FightMetrics {
  const found = findFloorWithRoom(powerLabRoom, options.seed, options.side);
  if (found === null) throw new Error(`no power lab on side ${options.side}`);
  const env = buildEnvironment(found);
  const { gameMap, room } = env;
  const bossTypes = env.levelDef.bossRooms?.map((r) => r.type) ?? [];

  const dressings = new BossRoomDressings(
    { ...gameGauntletDressings(env), spiderLab: null },
    bossTypes,
  );
  const bossRoom = new BossRoomSystem(
    gameMap,
    {
      revealBossNeighborhood: () => undefined,
    },
    new EventBus(),
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
  const boss = new ElectricGoblin(room.spawn.x, room.spawn.y, TILE_SIZE);
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
    partner: cat,
    activeIsMoving: false,
    roster,
    gameMap,
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
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

  const hits: Record<ElectricGoblinAttack, number> = {
    shock_grenade: 0,
    charged_puddle: 0,
    rod_swipe: 0,
    slam_wave: 0,
  };
  const takeDamage = human.takeDamage.bind(human);
  human.takeDamage = (amount: number, source?: DamageSource): boolean => {
    const landed = takeDamage(amount, source);
    if (landed && source?.kind === 'mob' && isGoblinAttack(source.attackType)) {
      hits[source.attackType]++;
    }
    // Held alive so the fight runs to its end and every later blow is counted too.
    human.hp = human.maxHp;
    return landed;
  };

  const attack = referenceStats('human', SIM_PARTY_LEVEL).attackCycle[0];
  const reach = human.getMeleeRange();
  let swingCooldown = 0;
  let sealedAt: number | null = null;
  const started = { grenade: 0, slam: 0, puddle: 0 };
  let grenadesBefore = 0;
  let hadLane = false;
  let hadTell = false;

  let frame = 0;
  for (; frame < SIM_FRAME_CEILING && boss.isAlive; frame++) {
    const move = crawlerMove(human, boss, reach, bossRoom, dressings, gameMap);
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
    const grenades = boss.shockGrenades.length;
    if (grenades > grenadesBefore) started.grenade++;
    grenadesBefore = grenades;
    const lane = boss.slamLanes.length > 0;
    if (lane && !hadLane) started.slam++;
    hadLane = lane;
    const tell = boss.puddleCharge.kind === 'tell';
    if (tell && !hadTell) started.puddle++;
    hadTell = tell;

    if (swingCooldown > 0) swingCooldown--;
    if (swingCooldown === 0) {
      const distance = Math.hypot(
        centreOf(boss).x - centreOf(human).x,
        centreOf(boss).y - centreOf(human).y,
      );
      if (distance <= reach) {
        boss.takeHit(harnessHit(human, attack.damage, attack.damageType));
        swingCooldown = attack.frames;
      }
    }
  }

  const fightFrames = frame - (sealedAt ?? 0);
  return {
    seed: options.seed,
    side: options.side,
    timeToKillSeconds: fightFrames / WORLD_TICKS_PER_SECOND,
    killed: !boss.isAlive,
    started,
    hits,
  };
}

interface HazardSource {
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null;
}

function crawlerMove(
  human: { x: number; y: number },
  boss: ElectricGoblin,
  reach: number,
  bossRoom: HazardSource,
  dressings: HazardSource,
  gameMap: SystemContext['gameMap'],
): TilePoint {
  const escape =
    bossRoom.getHazardEscapeVector(human.x, human.y) ??
    dressings.getHazardEscapeVector(human.x, human.y);
  if (escape !== null) return { x: escape.dx, y: escape.dy };
  if (!boss.isAlive) return { x: 0, y: 0 };
  const from = centreOf(human);
  const to = centreOf(boss);
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
    if (!marked && gameMap.isWalkable(tileX, tileY, 'walker')) return turned;
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
