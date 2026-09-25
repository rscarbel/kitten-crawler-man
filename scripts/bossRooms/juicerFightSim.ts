/**
 * A headless Juicer fight on a real generated floor: the real boss, the real
 * gym dressing, the real boss-room seal and the real mob update loop, against a
 * scripted crawler.
 *
 * The crawler plays the fight a careful melee player would: it walks in, stands
 * at arm's reach and punches on the reference crawler's swing clock, steps off
 * a ground-punch disc the moment one is drawn, and sidesteps a dumbbell that is
 * going to pass through it. It never touches the room's own interactables, so
 * the numbers measure what the room does to the boss, not what a player does
 * with the room.
 *
 * Deterministic: `Math.random` is replaced by a seeded stream for the length of
 * one run, so a run is reproducible from its seed and door side.
 */

import { EventBus } from '../../src/core/EventBus.js';
import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants.js';
import { referenceStats } from '../../src/core/referenceCrawler.js';
import { CatPlayer } from '../../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import { Juicer, type JuicerState } from '../../src/creatures/Juicer.js';
import type { GameMap } from '../../src/map/GameMap.js';
import { mulberry32 } from '../../src/sprites/person/rng.js';
import { BossRoomSystem, type BossRoomMiniMap } from '../../src/systems/BossRoomSystem.js';
import {
  BossRoomDressings,
  buildGauntletRoomDressings,
} from '../../src/systems/bossRooms/BossRoomDressings.js';
import type { DoorSide, TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';
import { applyKnockbackMotion, applyMovement } from '../../src/systems/GameLoopPhases.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import type { JuicerRoomSystem } from '../../src/systems/JuicerRoomSystem.js';
import { MobRoster } from '../../src/systems/kits/SceneWorld.js';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop.js';
import { SpellSystem } from '../../src/systems/SpellSystem.js';
import { findFloorWithRoom, type FoundRoom } from './harness.js';
import { juicerRoom } from './juicer.js';

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
/** A fight that has not ended by then is reported as a stalemate, not run forever. */
const MAX_FIGHT_SECONDS = 360;
const MAX_FIGHT_FRAMES = MAX_FIGHT_SECONDS * FRAMES_PER_SECOND;

/** His level on the floor's own spawn rule's floor, the weakest Juicer a crawler meets. */
export const SIM_JUICER_LEVEL = 3;
/** The party level a crawler is expected to reach him at. */
export const SIM_PARTY_LEVEL = 4;

const HALF_TILE = TILE_SIZE / 2;
const HALF_TILE_SHARE = 0.5;
/** How far outside a punch disc the crawler steps before it feels safe. */
const PUNCH_DODGE_MARGIN_TILES = 0.6;
const PUNCH_DODGE_MARGIN_PX = TILE_SIZE * PUNCH_DODGE_MARGIN_TILES;
/** A dumbbell passing nearer than this to the crawler's centre is treated as incoming. */
const DUMBBELL_DODGE_CLEARANCE_PX = TILE_SIZE * 2;
/** How many frames ahead a dumbbell's flight is judged for a sidestep. */
const DUMBBELL_LOOKAHEAD_FRAMES = 40;
/** The crawler closes to this share of its melee reach before it stops walking in. */
const MELEE_HOLD_SHARE = 0.8;
/** How often the crawler re-plans its route to him. */
const REPATH_FRAMES = 15;

/** A window this long in which he moves less than {@link STUCK_TRAVEL_PX} is a stuck second. */
const STUCK_WINDOW_FRAMES = FRAMES_PER_SECOND;
const STUCK_TRAVEL_TILES = 0.5;
const STUCK_TRAVEL_PX = TILE_SIZE * STUCK_TRAVEL_TILES;
const TRAVEL_STATES: ReadonlySet<JuicerState> = new Set(['seeking_dumbbell', 'pursuing']);

export interface JuicerFightMetrics {
  readonly seed: number;
  readonly side: DoorSide;
  /** Seconds from the seal to his death; {@link MAX_FIGHT_SECONDS} for a stalemate. */
  readonly timeToKillSeconds: number;
  readonly killed: boolean;
  readonly throwsPerMinute: number;
  /** Throws, punches and plate rolls started, per minute of fight. */
  readonly attacksPerMinute: number;
  /** Blows that took HP off the scripted crawler. */
  readonly hitsOnCrawler: number;
  readonly hitsPerMinute: number;
  /** Seconds he wanted to travel and did not get half a tile anywhere. */
  readonly stuckSeconds: number;
  /** Mean seconds from starting after a dumbbell to holding one. */
  readonly meanReloadSeconds: number;
  /** The longest single reload. */
  readonly maxReloadSeconds: number;
  /** Hits from the room itself rather than from his hands. */
  readonly roomHazardHits: number;
  /** Plates he bowled; zero in a room with no squat racks. */
  readonly plateRolls: number;
}

/** What a fault flag can switch off in the room to prove a gate reads it. */
export interface JuicerFightSimOptions {
  /** Called once the room is built, before the fight, to break something on purpose. */
  readonly tamper?: (room: JuicerRoomSystem, gameMap: GameMap, juicer: Juicer) => void;
  /** Scales the crawler's blows, for a fault that makes the fight easier on purpose. */
  readonly crawlerDamageMultiplier?: number;
  /** Seeds the fight's randomness; the floor's own seed when omitted. */
  readonly rngSeed?: number;
  /**
   * Frames the crawler takes to notice a telegraph or a throw. Zero is a
   * perfect player; a suite spreads it so some blows land and a room that
   * changes how often they land shows up in the count.
   */
  readonly reactionFrames?: number;
}

const HEADLESS_MINIMAP: BossRoomMiniMap = {
  revealBossNeighborhood: () => undefined,
  isExpanded: false,
  EXPANDED_SIZE: 0,
  NORMAL_SIZE: 0,
};

function centreOf(body: { x: number; y: number }): TilePoint {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

function tileOf(point: TilePoint): TilePoint {
  return { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
}

/** Breadth-first route over walkable tiles; the first step toward `goal`, or null. */
function firstStepToward(gameMap: GameMap, from: TilePoint, goal: TilePoint): TilePoint | null {
  const key = (t: TilePoint): number => t.y * gameMap.structure.length + t.x;
  const cameFrom = new Map<number, TilePoint | null>([[key(from), null]]);
  const queue: TilePoint[] = [from];
  const steps = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ] as const;
  // A for-of over a queue that grows as it is walked: the iterator sees the pushes.
  for (const at of queue) {
    if (at.x === goal.x && at.y === goal.y) {
      let step: TilePoint = at;
      for (let prev = cameFrom.get(key(step)) ?? null; prev !== null;) {
        if (prev.x === from.x && prev.y === from.y) return step;
        step = prev;
        prev = cameFrom.get(key(step)) ?? null;
      }
      return step;
    }
    for (const { dx, dy } of steps) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (cameFrom.has(key(next))) continue;
      const isGoal = next.x === goal.x && next.y === goal.y;
      if (!isGoal && !gameMap.isWalkable(next.x, next.y)) continue;
      cameFrom.set(key(next), at);
      queue.push(next);
    }
  }
  return null;
}

/** The unit vector from `a` to `b`, or zero when they coincide. */
function unitToward(a: TilePoint, b: TilePoint): { dx: number; dy: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { dx: 0, dy: 0 } : { dx: dx / length, dy: dy / length };
}

/**
 * A step sideways off an incoming dumbbell's line, or null when it will miss.
 * The side is whichever the crawler already stands on, so the dodge widens the
 * miss rather than crossing the weight's path.
 */
function dumbbellDodge(
  crawler: TilePoint,
  dumbbell: { x: number; y: number; vx: number; vy: number },
): { dx: number; dy: number } | null {
  const speed = Math.hypot(dumbbell.vx, dumbbell.vy);
  if (speed === 0) return null;
  const ux = dumbbell.vx / speed;
  const uy = dumbbell.vy / speed;
  const relX = crawler.x - dumbbell.x;
  const relY = crawler.y - dumbbell.y;
  const along = relX * ux + relY * uy;
  if (along < 0 || along > speed * DUMBBELL_LOOKAHEAD_FRAMES) return null;
  const across = relX * -uy + relY * ux;
  if (Math.abs(across) > DUMBBELL_DODGE_CLEARANCE_PX) return null;
  const side = across >= 0 ? 1 : -1;
  return { dx: -uy * side, dy: ux * side };
}

/** The first floor with the gym's doorway on `side`, from `seed` on. */
export function findJuicerFloor(seed: number, side: DoorSide): FoundRoom {
  const found = findFloorWithRoom(juicerRoom, seed, side);
  if (found === null) throw new Error(`no floor from seed ${seed} puts the gym door ${side}`);
  return found;
}

/** Runs one fight to a kill (or the time cap) and measures it. */
export function runJuicerFight(
  found: FoundRoom,
  options: JuicerFightSimOptions = {},
): JuicerFightMetrics {
  const realRandom = Math.random;
  Math.random = mulberry32(options.rngSeed ?? found.seed);
  try {
    return fight(found, options);
  } finally {
    Math.random = realRandom;
  }
}

function fight(found: FoundRoom, options: JuicerFightSimOptions): JuicerFightMetrics {
  const { gameMap, levelDef, room } = found;
  const bossTypes = levelDef.bossRooms?.map((entry) => entry.type) ?? [];
  const parts = buildGauntletRoomDressings(gameMap, bossTypes);
  const dressings = new BossRoomDressings(
    { ...parts, spiderLab: null, colosseum: null },
    bossTypes,
  );
  const bossRoom = new BossRoomSystem(gameMap, HEADLESS_MINIMAP, new EventBus(), bossTypes);
  bossRoom.fightListener = dressings;

  const doorway = room.doorways[0]?.tile ?? room.spawn;
  const human = new HumanPlayer(doorway.x, doorway.y, TILE_SIZE);
  // Parked on the far side of the map from the gym, so he never has a second
  // target and the fight is the one crawler's alone.
  const cat = new CatPlayer(gameMap.startTile.x, gameMap.startTile.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  human.hp = human.maxHp;

  const roster = new MobRoster(gameMap, new SpellSystem());
  const juicer = new Juicer(room.spawn.x, room.spawn.y, TILE_SIZE);
  juicer.setMap(gameMap);
  juicer.applyMobLevel(SIM_JUICER_LEVEL);
  roster.add(juicer);
  const mobLoop = new MobUpdateLoop();
  mobLoop.registerHazardSource(dressings);

  options.tamper?.(parts.juicer, gameMap, juicer);

  const frame: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
    bossRoom,
  };

  const reference = referenceStats('human', 'balanced', SIM_PARTY_LEVEL);
  const swing = reference.attackCycle[0];
  let swingCooldown = 0;

  let throws = 0;
  let plateRolls = 0;
  let attacks = 0;
  let hits = 0;
  let roomHazardHits = 0;
  let stuckFrames = 0;
  let fightFrames = 0;
  let sealed = false;
  let stepGoal: TilePoint | null = null;
  let telegraphSeenFrames = 0;
  let laneSeenFrames = 0;
  let previousState = juicer.behaviour;
  const reactionFrames = options.reactionFrames ?? 0;
  let repathTimer = 0;

  let windowStart = { x: juicer.x, y: juicer.y };
  let windowTravelFrames = 0;
  let windowFrames = 0;

  const reloads: number[] = [];
  let reloadStartedAt: number | null = null;
  let wasHolding = juicer.heldDumbbell;
  let hadDumbbellInFlight = false;

  for (let frameIndex = 0; frameIndex < MAX_FIGHT_FRAMES + FRAMES_PER_SECOND; frameIndex++) {
    const crawler = centreOf(human);
    const boss = centreOf(juicer);
    let move = { dx: 0, dy: 0 };

    const telegraph = juicer.punchTelegraph;
    if (telegraph === null) telegraphSeenFrames = 0;
    else telegraphSeenFrames++;
    const noticesPunch = telegraphSeenFrames > reactionFrames;
    const dumbbell = juicer.thrownDumbbell;
    const dodge =
      dumbbell === null || dumbbell.age <= reactionFrames ? null : dumbbellDodge(crawler, dumbbell);
    if (juicer.plateRollLane === null) laneSeenFrames = 0;
    else laneSeenFrames++;
    const laneEscape =
      laneSeenFrames > reactionFrames
        ? dressings.getHazardEscapeVector(crawler.x, crawler.y)
        : null;
    const insidePunch =
      noticesPunch &&
      telegraph !== null &&
      Math.hypot(crawler.x - telegraph.x, crawler.y - telegraph.y) <
        telegraph.radiusPx + PUNCH_DODGE_MARGIN_PX;
    if (insidePunch) {
      move = unitToward(telegraph, crawler);
      if (move.dx === 0 && move.dy === 0) move = unitToward(boss, crawler);
    } else if (laneEscape !== null && juicer.plateRollLane !== null) {
      move = laneEscape;
    } else if (dodge !== null) {
      move = dodge;
    } else if (
      Math.hypot(boss.x - crawler.x, boss.y - crawler.y) >
      human.getMeleeRange() * MELEE_HOLD_SHARE
    ) {
      if (repathTimer <= 0 || stepGoal === null) {
        stepGoal = firstStepToward(gameMap, tileOf(crawler), tileOf(boss));
        repathTimer = REPATH_FRAMES;
      }
      repathTimer--;
      const goalPx =
        stepGoal === null
          ? boss
          : {
              x: (stepGoal.x + HALF_TILE_SHARE) * TILE_SIZE,
              y: (stepGoal.y + HALF_TILE_SHARE) * TILE_SIZE,
            };
      if (
        stepGoal !== null &&
        Math.hypot(goalPx.x - crawler.x, goalPx.y - crawler.y) < PLAYER_SPEED
      ) {
        repathTimer = 0;
      }
      move = unitToward(crawler, goalPx);
    }
    applyMovement(human, { ...move, isMobile: true }, gameMap, 'sole');
    applyKnockbackMotion(human, gameMap);

    const hpBefore = human.hp;
    bossRoom.update(frame);
    if (!sealed && bossRoom.isAnyPlayerInBossRoom(juicer, [human])) sealed = true;
    dressings.update(frame);
    mobLoop.update(frame);
    if (human.hp < hpBefore) {
      hits++;
      if (human.lastDamageSource?.kind === 'environmental') roomHazardHits++;
      human.hp = human.maxHp;
    }
    human.tickTimers();

    if (juicer.specialSoundPending) {
      juicer.specialSoundPending = false;
    }
    const inFlight = juicer.thrownDumbbell !== null;
    if (inFlight && !hadDumbbellInFlight) {
      throws++;
      attacks++;
    }
    hadDumbbellInFlight = inFlight;
    if (juicer.punchWindupSoundPending) {
      juicer.punchWindupSoundPending = false;
      attacks++;
    }
    juicer.punchImpactSoundPending = false;

    if (sealed) fightFrames++;

    const state = juicer.behaviour;
    if (state === 'plate_windup' && previousState !== 'plate_windup') {
      attacks++;
      plateRolls++;
    }
    previousState = state;
    if (state === 'seeking_dumbbell' && !juicer.heldDumbbell && reloadStartedAt === null) {
      reloadStartedAt = frameIndex;
    }
    if (juicer.heldDumbbell && !wasHolding && reloadStartedAt !== null) {
      reloads.push((frameIndex - reloadStartedAt) / FRAMES_PER_SECOND);
      reloadStartedAt = null;
    }
    wasHolding = juicer.heldDumbbell;

    windowFrames++;
    if (TRAVEL_STATES.has(state) && juicer.isMoving) windowTravelFrames++;
    if (windowFrames >= STUCK_WINDOW_FRAMES) {
      const travelled = Math.hypot(juicer.x - windowStart.x, juicer.y - windowStart.y);
      const wantedToTravel = windowTravelFrames * 2 >= windowFrames;
      if (wantedToTravel && travelled < STUCK_TRAVEL_PX) stuckFrames += windowFrames;
      windowStart = { x: juicer.x, y: juicer.y };
      windowFrames = 0;
      windowTravelFrames = 0;
    }

    if (swingCooldown > 0) swingCooldown--;
    const reach = Math.hypot(boss.x - crawler.x, boss.y - crawler.y);
    if (sealed && swingCooldown <= 0 && reach <= human.getMeleeRange() && juicer.isAlive) {
      juicer.takeDamageFrom(
        swing.damage * (options.crawlerDamageMultiplier ?? 1),
        human,
        swing.damageType,
      );
      swingCooldown = swing.frames;
    }

    if (!juicer.isAlive || fightFrames >= MAX_FIGHT_FRAMES) break;
  }

  const minutes = Math.max(fightFrames, 1) / FRAMES_PER_SECOND / SECONDS_PER_MINUTE;
  const meanReload = reloads.length === 0 ? 0 : reloads.reduce((a, b) => a + b, 0) / reloads.length;
  return {
    seed: found.seed,
    side: room.doorSide,
    timeToKillSeconds: fightFrames / FRAMES_PER_SECOND,
    killed: !juicer.isAlive,
    throwsPerMinute: throws / minutes,
    attacksPerMinute: attacks / minutes,
    hitsOnCrawler: hits,
    hitsPerMinute: hits / minutes,
    stuckSeconds: stuckFrames / FRAMES_PER_SECOND,
    meanReloadSeconds: meanReload,
    maxReloadSeconds: reloads.length === 0 ? 0 : Math.max(...reloads),
    roomHazardHits,
    plateRolls,
  };
}

/** Every door side's fights, pooled: rates are totals over total fight time. */
export interface JuicerFightSuite {
  readonly fights: readonly JuicerFightMetrics[];
  readonly meanTimeToKillSeconds: number;
  readonly killRate: number;
  readonly throwsPerMinute: number;
  readonly attacksPerMinute: number;
  readonly hitsPerMinute: number;
  /** Stuck seconds per minute of fight. */
  readonly stuckSecondsPerMinute: number;
  readonly meanReloadSeconds: number;
  readonly maxReloadSeconds: number;
  readonly roomHazardHits: number;
  readonly plateRolls: number;
}

/** Fights per door side: enough that one lucky dodge does not move a rate by ten per cent. */
export const SUITE_FIGHTS_PER_SIDE = 6;
/**
 * Each fight on a side reacts this many frames slower than the one before, from
 * a perfect player to one who reads a telegraph most of the way through it.
 */
const SUITE_REACTION_STEP_FRAMES = 7;
/** Where each side's floor search starts. */
const SUITE_FLOOR_SEED = 1;
/** Spreads the per-fight randomness seeds apart so neighbouring runs share no stream. */
const SUITE_RNG_STRIDE = 7919;

/** The fixed-seed fights on all four door sides, pooled. */
export function runJuicerFightSuite(
  sides: readonly DoorSide[],
  options: Omit<JuicerFightSimOptions, 'rngSeed'> = {},
  fightsPerSide = SUITE_FIGHTS_PER_SIDE,
): JuicerFightSuite {
  const fights: JuicerFightMetrics[] = [];
  for (const side of sides) {
    for (let run = 0; run < fightsPerSide; run++) {
      const found = findJuicerFloor(SUITE_FLOOR_SEED, side);
      fights.push(
        runJuicerFight(found, {
          ...options,
          rngSeed: found.seed + run * SUITE_RNG_STRIDE,
          reactionFrames: run * SUITE_REACTION_STEP_FRAMES,
        }),
      );
    }
  }
  const totalMinutes = fights.reduce((sum, f) => sum + f.timeToKillSeconds, 0) / SECONDS_PER_MINUTE;
  const perMinute = (pick: (f: JuicerFightMetrics) => number): number =>
    fights.reduce((sum, f) => sum + pick(f) * (f.timeToKillSeconds / SECONDS_PER_MINUTE), 0) /
    Math.max(totalMinutes, Number.EPSILON);
  const count = Math.max(fights.length, 1);
  return {
    fights,
    meanTimeToKillSeconds: fights.reduce((sum, f) => sum + f.timeToKillSeconds, 0) / count,
    killRate: fights.filter((f) => f.killed).length / count,
    throwsPerMinute: perMinute((f) => f.throwsPerMinute),
    attacksPerMinute: perMinute((f) => f.attacksPerMinute),
    hitsPerMinute: perMinute((f) => f.hitsPerMinute),
    stuckSecondsPerMinute:
      fights.reduce((sum, f) => sum + f.stuckSeconds, 0) / Math.max(totalMinutes, Number.EPSILON),
    meanReloadSeconds: fights.reduce((sum, f) => sum + f.meanReloadSeconds, 0) / count,
    maxReloadSeconds: Math.max(0, ...fights.map((f) => f.maxReloadSeconds)),
    roomHazardHits: fights.reduce((sum, f) => sum + f.roomHazardHits, 0),
    plateRolls: fights.reduce((sum, f) => sum + f.plateRolls, 0),
  };
}
