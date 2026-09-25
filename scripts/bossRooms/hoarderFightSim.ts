/**
 * A headless Hoarder fight on a real generated floor: the real boss, the real
 * `BossRoomSystem` and the lair's real dressing, against a scripted crawler.
 *
 * The crawler walks in through the doorway, chases her down (straight when the
 * line is walkable, by A* when junk is in the way), punches whatever is in
 * reach — her first, then her roaches — and steps out of any marked ground the
 * way a companion does, through the same `GroundHazardSource` answers. It takes
 * every blow as the game would (dodge rolls included) but is healed straight
 * back, so a fight always runs to her death or the time cap and the numbers
 * count how often she landed, not how soon the crawler would have fallen.
 *
 * Everything random is seeded, so a run is repeatable to the frame.
 */

import { TILE_SIZE } from '../../src/core/constants.js';
import { DIFFICULTY_PROFILES, applySpawnDifficulty } from '../../src/core/difficultyProfiles.js';
import { CatPlayer } from '../../src/creatures/CatPlayer.js';
import { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import type { Mob } from '../../src/creatures/Mob.js';
import { Cockroach } from '../../src/creatures/Cockroach.js';
import { TheHoarder } from '../../src/creatures/TheHoarder.js';
import { createMob, resolveBossLevel } from '../../src/levels/spawner.js';
import { MIN_STAT_VALUE, type DamageSource } from '../../src/Player.js';
import { bareFistDamage } from '../../src/core/crawlerFormulas.js';
import { mulberry32 } from '../../src/sprites/person/rng.js';
import { BossRoomSystem, type BossRoomMiniMap } from '../../src/systems/BossRoomSystem.js';
import {
  BossRoomDressings,
  HOARDER_BOSS_TYPE,
  buildGauntletRoomDressings,
} from '../../src/systems/bossRooms/BossRoomDressings.js';
import type { DoorSide, TilePoint } from '../../src/systems/bossRooms/bossRoomLayout.js';
import { applyMovement } from '../../src/systems/GameLoopPhases.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import {
  hazardEscapeAmong,
  stepAlongEscape,
  type GroundHazardSource,
} from '../../src/systems/GroundHazardSource.js';
import { MobRoster } from '../../src/systems/kits/SceneWorld.js';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop.js';
import { SpellSystem } from '../../src/systems/SpellSystem.js';
import {
  DOOR_SEARCH_MAX_SEEDS,
  gauntletBossRoom,
  generateFloor,
  type LocatedRoom,
} from './harness.js';

// ── The scripted crawler ─────────────────────────────────────────────────────

const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const FRAMES_PER_MINUTE = FRAMES_PER_SECOND * SECONDS_PER_MINUTE;

/** The party level the floor's boss is levelled against: mid floor one. */
const SIM_PARTY_LEVEL = 3;
/**
 * A fresh crawler's bare-fist punch, the weakest blow on the floor: the longest
 * fight, and so the one that gives her the most attacks to measure.
 */
const SIM_PUNCH_DAMAGE = bareFistDamage(MIN_STAT_VALUE);
/** One punch per swing, at the human's own swing length. */
const SIM_SWING_FRAMES = 18;
/** The human's fist reach, `HumanPlayer.MELEE_RANGE_MULTIPLIER` tiles. */
const SIM_MELEE_RANGE_TILES = 1.95;
const SIM_MELEE_RANGE_PX = SIM_MELEE_RANGE_TILES * TILE_SIZE;
/** How often the chase path is re-planned; she moves slowly enough that a quarter second is fresh. */
const REPATH_INTERVAL_FRAMES = 15;
/** How far the A* is allowed to look: the room plus its doorway. */
const SIM_PATH_MAX_TILES = 40;

/** The longest a fight is run before it is called unfinished. */
const FIGHT_CAP_SECONDS = 180;
export const FIGHT_CAP_FRAMES = FIGHT_CAP_SECONDS * FRAMES_PER_SECOND;
/** The chase that measures her flight: two minutes of being run down. */
const CHASE_SECONDS = 120;
export const CHASE_FRAMES = CHASE_SECONDS * FRAMES_PER_SECOND;

/** She is pinned when she moves less than this in a window while fleeing. */
const PINNED_WINDOW_FRAMES = 60;
const PINNED_MAX_TRAVEL_TILES = 0.5;
const PINNED_MAX_TRAVEL_PX = PINNED_MAX_TRAVEL_TILES * TILE_SIZE;
/** Her own flee radius, `FLEE_RANGE_TILE_MULTIPLIER` in `TheHoarder`. */
export const HOARDER_FLEE_RANGE_TILES = 8;
const HOARDER_FLEE_RANGE_PX = HOARDER_FLEE_RANGE_TILES * TILE_SIZE;

const HALF = 0.5;
const UNDRAWN_MINIMAP_SIZE = 0;

const undrawnMiniMap: BossRoomMiniMap = {
  revealBossNeighborhood: () => undefined,
  isExpanded: false,
  EXPANDED_SIZE: UNDRAWN_MINIMAP_SIZE,
  NORMAL_SIZE: UNDRAWN_MINIMAP_SIZE,
};

/** A crawler who counts every blow that lands, then shrugs it off. */
class ScriptedCrawler extends HumanPlayer {
  hits = 0;
  roomHazardHits = 0;
  /** Landed blows by what dealt them, for reading a change in `hits`. */
  readonly hitsBySource = new Map<string, number>();

  override takeDamage(amount: number, source?: DamageSource): boolean {
    const connected = super.takeDamage(amount, source);
    if (connected) {
      this.hits++;
      if (source?.kind === 'environmental') this.roomHazardHits++;
      const label = describeSource(source);
      this.hitsBySource.set(label, (this.hitsBySource.get(label) ?? 0) + 1);
    }
    this.hp = this.maxHp;
    return connected;
  }
}

function describeSource(source: DamageSource | undefined): string {
  if (source === undefined) return 'unknown';
  switch (source.kind) {
    case 'mob':
      return `${source.mobType}${source.undodgeable === true ? ' (standing in it)' : ''}`;
    case 'environmental':
      return source.hazard ?? 'environmental';
    case 'status':
    case 'dynamite':
    case 'doomsday':
    case 'siege':
      return source.kind;
  }
}

/**
 * Stages the bare room — no junk, no nest,
 * nothing to run round, her swarm capped at five enraged or not — when
 * `HOARDER_SIM_BARE=1`. That is the room `hoarderBaseline.ts` measures, so the
 * baseline can be re-measured with more random streams.
 */
const BARE_ROOM = process.env.HOARDER_SIM_BARE === '1';
const BARE_ROOM_COCKROACH_CAP = 5;

// ── Staging ──────────────────────────────────────────────────────────────────

/** The fixed seed the sims start their doorway search from. */
export const SIM_FIRST_SEED = 1;

/** A floor with the lair's doorway on `side`, and the room on it. */
export function findHoarderFloor(side: DoorSide, startSeed = SIM_FIRST_SEED) {
  for (let offset = 0; offset < DOOR_SEARCH_MAX_SEEDS; offset++) {
    const seed = startSeed + offset;
    const { gameMap, levelDef } = generateFloor(1, seed);
    const room = gauntletBossRoom(gameMap, levelDef, HOARDER_BOSS_TYPE);
    if (room?.doorSide !== side) continue;
    return { seed, gameMap, levelDef, room };
  }
  return null;
}

/** One staged fight: everything a frame advances, and the parts the metrics read. */
export interface StagedHoarderFight {
  readonly room: LocatedRoom;
  /** Where the crawler walked in: top-left of the tile just inside the doorway. */
  readonly entry: { x: number; y: number };
  readonly hoarder: TheHoarder;
  readonly crawler: ScriptedCrawler;
  readonly cat: CatPlayer;
  readonly roster: MobRoster;
  readonly bossRoom: BossRoomSystem;
  readonly dressings: BossRoomDressings;
  readonly frame: SystemContext;
  readonly hazards: readonly GroundHazardSource[];
  step(): void;
}

/**
 * Builds the floor with its lair on `side`, the real boss levelled as the
 * spawner levels her, the room systems as the scene wires them, and the party
 * standing just inside the doorway.
 */
export function stageHoarderFight(side: DoorSide): StagedHoarderFight {
  const found = findHoarderFloor(side);
  if (found === null) throw new Error(`no floor gives the hoarder a ${side} doorway`);
  const { gameMap, levelDef, room } = found;
  const bossTypes = levelDef.bossRooms?.map((entry) => entry.type) ?? [];
  const band = levelDef.bossRooms?.find((entry) => entry.type === HOARDER_BOSS_TYPE);
  if (band === undefined) throw new Error('floor one lists no hoarder');

  const profile = DIFFICULTY_PROFILES.normal;
  const boss = createMob(HOARDER_BOSS_TYPE, room.spawn.x, room.spawn.y, gameMap);
  if (!(boss instanceof TheHoarder)) throw new Error('the hoarder spawn key built something else');
  boss.applyMobLevel(resolveBossLevel(band, SIM_PARTY_LEVEL, profile), levelDef.levelledCurve);
  applySpawnDifficulty(boss, profile);
  if (BARE_ROOM) {
    // The bare room caps her swarm at five roaches, enraged or not.
    Object.defineProperty(boss, 'cockroachCap', { get: () => BARE_ROOM_COCKROACH_CAP });
  }

  const doorway = room.doorways[0]?.tile ?? room.spawn;
  const entry = stepInward(doorway, room.doorSide);
  const crawler = new ScriptedCrawler(entry.x, entry.y, TILE_SIZE);
  const cat = new CatPlayer(entry.x, entry.y, TILE_SIZE);
  crawler.isActive = true;
  cat.isActive = false;

  const roster = new MobRoster(gameMap, new SpellSystem());
  roster.add(boss);
  const bossRoom = new BossRoomSystem(gameMap, undrawnMiniMap, bossTypes);
  const built = BARE_ROOM ? null : buildGauntletRoomDressings(gameMap, bossTypes);
  const parts = built ?? { hoarder: null, juicer: null, krakaren: null };
  const dressings = new BossRoomDressings(
    { ...parts, spiderLab: null, colosseum: null },
    bossTypes,
  );
  bossRoom.fightListener = dressings;
  const mobLoop = new MobUpdateLoop();
  mobLoop.registerHazardSource(bossRoom);
  mobLoop.registerHazardSource(dressings);

  const frame: SystemContext = {
    human: crawler,
    cat,
    active: crawler,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
    extraTargets: [],
    bossRoom,
  };
  return {
    room,
    entry: { x: entry.x * TILE_SIZE, y: entry.y * TILE_SIZE },
    hoarder: boss,
    crawler,
    cat,
    roster,
    bossRoom,
    dressings,
    frame,
    hazards: [bossRoom, dressings],
    step: () => {
      // The cat rides on the crawler's heels: the fight is about one body, and a
      // second one left at the door would be dragged in by the seal anyway.
      cat.x = crawler.x;
      cat.y = crawler.y;
      bossRoom.update(frame);
      dressings.update(frame);
      mobLoop.update(frame);
    },
  };
}

function stepInward(tile: TilePoint, side: DoorSide): TilePoint {
  switch (side) {
    case 'south':
      return { x: tile.x, y: tile.y - 1 };
    case 'north':
      return { x: tile.x, y: tile.y + 1 };
    case 'east':
      return { x: tile.x - 1, y: tile.y };
    case 'west':
      return { x: tile.x + 1, y: tile.y };
  }
}

// ── Movement ─────────────────────────────────────────────────────────────────

function centreOf(body: { x: number; y: number }): { x: number; y: number } {
  return { x: body.x + TILE_SIZE * HALF, y: body.y + TILE_SIZE * HALF };
}

function tileOf(body: { x: number; y: number }): TilePoint {
  const centre = centreOf(body);
  return { x: Math.floor(centre.x / TILE_SIZE), y: Math.floor(centre.y / TILE_SIZE) };
}

/** Walks the crawler toward a body: straight when it can, along an A* path when junk is in the way. */
class Chaser {
  private path: TilePoint[] = [];
  private pathAge = REPATH_INTERVAL_FRAMES;

  constructor(private readonly fight: StagedHoarderFight) {}

  stepToward(quarry: { x: number; y: number }): void {
    const { crawler, frame } = this.fight;
    const map = frame.gameMap;
    const from = centreOf(crawler);
    const to = centreOf(quarry);
    let goal = to;
    if (!map.hasWalkableLine(from.x, from.y, to.x, to.y)) {
      this.pathAge++;
      if (this.pathAge >= REPATH_INTERVAL_FRAMES) {
        const start = tileOf(crawler);
        const end = tileOf(quarry);
        this.path = map.findPath(start.x, start.y, end.x, end.y, SIM_PATH_MAX_TILES);
        this.pathAge = 0;
      }
      const here = tileOf(crawler);
      while (this.path.length > 1 && this.path[0].x === here.x && this.path[0].y === here.y) {
        this.path.shift();
      }
      if (this.path.length > 0) {
        const next = this.path[0];
        goal = { x: (next.x + HALF) * TILE_SIZE, y: (next.y + HALF) * TILE_SIZE };
      }
    } else {
      this.pathAge = REPATH_INTERVAL_FRAMES;
    }
    const dx = goal.x - from.x;
    const dy = goal.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    applyMovement(crawler, { dx: dx / length, dy: dy / length, isMobile: true }, map);
  }
}

/** Steps the crawler out of marked ground; true when it had to. */
function dodge(fight: StagedHoarderFight): boolean {
  const { crawler, frame, hazards } = fight;
  const escape = hazardEscapeAmong(hazards, crawler.x, crawler.y);
  if (escape === null) return false;
  stepAlongEscape(crawler, escape, 1, (dx, dy) =>
    applyMovement(crawler, { dx, dy, isMobile: true }, frame.gameMap),
  );
  return true;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const ca = centreOf(a);
  const cb = centreOf(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

// ── Measuring ────────────────────────────────────────────────────────────────

/** Watches her attacks and her flight, frame by frame. */
class HoarderWatch {
  attacks = 0;
  pinnedFrames = 0;
  private wasWindingUp = false;
  private readonly trail: Array<{ x: number; y: number; fleeing: boolean }> = [];

  afterStep(fight: StagedHoarderFight, purgeQueuedThisFrame: boolean): void {
    const { hoarder, crawler } = fight;
    const windingUp = hoarder.vomitProgress !== null;
    if (windingUp && !this.wasWindingUp) this.attacks++;
    this.wasWindingUp = windingUp;
    if (purgeQueuedThisFrame) this.attacks++;

    const fleeing =
      hoarder.isAlive && !windingUp && distance(hoarder, crawler) < HOARDER_FLEE_RANGE_PX;
    this.trail.push({ x: hoarder.x, y: hoarder.y, fleeing });
    if (this.trail.length > PINNED_WINDOW_FRAMES) {
      const then = this.trail.shift();
      if (then !== undefined && then.fleeing && fleeing) {
        const travel = Math.hypot(hoarder.x - then.x, hoarder.y - then.y);
        if (travel < PINNED_MAX_TRAVEL_PX) this.pinnedFrames++;
      }
    }
  }
}

/**
 * Runs one frame and reports whether she began a purge in it. Read off her
 * own tally, not the roach count: one purge's roaches arrive over several
 * frames and from several places, and a bag burst adds roaches with no purge.
 */
function stepWatchingPurges(fight: StagedHoarderFight): boolean {
  const before = fight.hoarder.purgesBegun;
  fight.step();
  return fight.hoarder.purgesBegun > before;
}

/** What one fight measured. */
export interface HoarderFightMetrics {
  /** Seconds from the door to her death; the cap when she outlived it. */
  readonly timeToKillSeconds: number;
  readonly killed: boolean;
  /** Spits and purges she started, per minute of fight. */
  readonly attacksPerMinute: number;
  /** Blows of any kind that landed on the crawler. */
  readonly hitsOnCrawler: number;
  /** Of those, blows from the room itself rather than from her or her roaches. */
  readonly roomHazardHits: number;
  /** Seconds she spent fleeing without getting anywhere. */
  readonly pinnedSeconds: number;
  /** Landed blows by what dealt them. */
  readonly hitsBySource: ReadonlyMap<string, number>;
  /** Towers down by the end of the fight. */
  readonly towersToppled: number;
}

export function withSeededRandom<T>(seed: number, run: () => T): T {
  const unseeded = Math.random;
  Math.random = mulberry32(seed);
  try {
    return run();
  } finally {
    Math.random = unseeded;
  }
}

/**
 * The random streams each side is run on. A dozen, because one fight is a
 * handful of spits and bites, and one lucky dodge moves its hit count by a
 * tenth: with four, the same room measured two hits apart on two streams.
 */
const STREAM_A = 0x40a2d;
const STREAM_B = 0x1b7e3;
const STREAM_C = 0x5c0f1;
const STREAM_D = 0x2d9a7;
/** Streams past the first four, spread from the first by a fixed odd multiplier. */
const EXTRA_STREAMS = 8;
const STREAM_SPREAD = 0x9e3779b1;
export const SIM_RANDOM_SEEDS: readonly number[] = [
  STREAM_A,
  STREAM_B,
  STREAM_C,
  STREAM_D,
  ...Array.from(
    { length: EXTRA_STREAMS },
    (_, i) => (STREAM_A ^ Math.imul(i + 1, STREAM_SPREAD)) >>> 0,
  ),
];

/** A whole fight, door to kill, with the doorway on `side`. */
export function simulateHoarderFight(side: DoorSide, randomSeed: number): HoarderFightMetrics {
  return withSeededRandom(randomSeed, () => {
    const fight = stageHoarderFight(side);
    const chaser = new Chaser(fight);
    const watch = new HoarderWatch();
    let swingCooldown = 0;
    let frames = 0;
    for (; frames < FIGHT_CAP_FRAMES && fight.hoarder.isAlive; frames++) {
      if (!dodge(fight)) chaser.stepToward(fight.hoarder);
      if (swingCooldown > 0) swingCooldown--;
      if (swingCooldown === 0) {
        const struck = punchTarget(fight);
        if (struck !== null) {
          struck.takeDamageFrom(SIM_PUNCH_DAMAGE, fight.crawler, 'melee');
          swingCooldown = SIM_SWING_FRAMES;
        }
      }
      const purged = stepWatchingPurges(fight);
      watch.afterStep(fight, purged);
    }
    const minutes = frames / FRAMES_PER_MINUTE;
    return {
      timeToKillSeconds: frames / FRAMES_PER_SECOND,
      killed: !fight.hoarder.isAlive,
      attacksPerMinute: minutes > 0 ? watch.attacks / minutes : 0,
      hitsOnCrawler: fight.crawler.hits,
      roomHazardHits: fight.crawler.roomHazardHits,
      pinnedSeconds: watch.pinnedFrames / FRAMES_PER_SECOND,
      hitsBySource: fight.crawler.hitsBySource,
      towersToppled: towersDown(fight),
    };
  });
}

function towersDown(fight: StagedHoarderFight): number {
  const lair = fight.dressings.parts.hoarder;
  if (lair === null) return 0;
  return lair.towers.filter((_, index) => !lair.isTowerStanding(index)).length;
}

/**
 * The nearest roach in reach, else her if she is, else nothing. Adds first, as
 * a player clears what is biting them: that is what makes the time to kill
 * answer to how many roaches the room lets her field.
 */
function punchTarget(fight: StagedHoarderFight): Mob | null {
  const { hoarder, crawler, roster } = fight;
  const herInReach = hoarder.isAlive && distance(hoarder, crawler) <= SIM_MELEE_RANGE_PX;
  let nearest: Mob | null = null;
  let nearestDistance = SIM_MELEE_RANGE_PX;
  for (const mob of roster.mobs) {
    if (!(mob instanceof Cockroach) || !mob.isAlive) continue;
    const gap = distance(mob, crawler);
    if (gap <= nearestDistance) {
      nearest = mob;
      nearestDistance = gap;
    }
  }
  return nearest ?? (herInReach ? hoarder : null);
}

/** What one chase measured. */
export interface HoarderChaseMetrics {
  /** Seconds she spent fleeing without getting anywhere. */
  readonly pinnedSeconds: number;
  /**
   * Mean seconds to run her down again after breaking off: every chase but
   * the first, which is only the walk in from the door before she has moved.
   * A chase still running when the time is up counts for as long as it ran.
   */
  readonly reengageSeconds: number;
}

/** How long the crawler backs off toward the door between chases. */
const BREAK_OFF_FRAMES = 240;

/**
 * Two minutes of a crawler running her down without ever swinging, breaking
 * off each time it catches her, walking back toward the door, and coming for
 * her again: how well the room lets her flee and how far she gets. She is
 * immortal for it, since a kill ends the measurement.
 */
export function simulateHoarderChase(side: DoorSide, randomSeed: number): HoarderChaseMetrics {
  return withSeededRandom(randomSeed, () => {
    const fight = stageHoarderFight(side);
    const chaser = new Chaser(fight);
    const watch = new HoarderWatch();
    const chaseLengths: number[] = [];
    let chaseStart = 0;
    let breakOffLeft = 0;
    for (let frame = 0; frame < CHASE_FRAMES; frame++) {
      const chasing = breakOffLeft === 0;
      if (!dodge(fight)) chaser.stepToward(chasing ? fight.hoarder : fight.entry);
      const purged = stepWatchingPurges(fight);
      watch.afterStep(fight, purged);
      if (!chasing) {
        breakOffLeft--;
        if (breakOffLeft === 0) chaseStart = frame;
        continue;
      }
      if (distance(fight.hoarder, fight.crawler) <= SIM_MELEE_RANGE_PX) {
        chaseLengths.push(frame - chaseStart);
        breakOffLeft = BREAK_OFF_FRAMES;
      }
    }
    if (breakOffLeft === 0) chaseLengths.push(CHASE_FRAMES - chaseStart);
    const reengagements = chaseLengths.slice(1);
    return {
      pinnedSeconds: watch.pinnedFrames / FRAMES_PER_SECOND,
      reengageSeconds: mean(reengagements) / FRAMES_PER_SECOND,
    };
  });
}

/** A side's fight and chase numbers, each the mean over every random stream. */
export interface HoarderSideMetrics {
  readonly fight: HoarderFightMetrics;
  readonly chase: HoarderChaseMetrics;
  /** Fights, of all the streams, that ran to the cap with her still alive. */
  readonly unfinishedFights: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanBySource(runs: ReadonlyArray<ReadonlyMap<string, number>>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const run of runs) {
    for (const [label, count] of run) totals.set(label, (totals.get(label) ?? 0) + count);
  }
  for (const [label, total] of totals) totals.set(label, total / Math.max(1, runs.length));
  return totals;
}

/** Every stream's fight and chase with the doorway on `side`, averaged. */
export function measureHoarderSide(side: DoorSide): HoarderSideMetrics {
  const fights = SIM_RANDOM_SEEDS.map((seed) => simulateHoarderFight(side, seed));
  const chases = SIM_RANDOM_SEEDS.map((seed) => simulateHoarderChase(side, seed));
  return {
    fight: {
      timeToKillSeconds: mean(fights.map((f) => f.timeToKillSeconds)),
      killed: fights.every((f) => f.killed),
      attacksPerMinute: mean(fights.map((f) => f.attacksPerMinute)),
      hitsOnCrawler: mean(fights.map((f) => f.hitsOnCrawler)),
      roomHazardHits: mean(fights.map((f) => f.roomHazardHits)),
      pinnedSeconds: mean(fights.map((f) => f.pinnedSeconds)),
      hitsBySource: meanBySource(fights.map((f) => f.hitsBySource)),
      towersToppled: mean(fights.map((f) => f.towersToppled)),
    },
    chase: {
      pinnedSeconds: mean(chases.map((c) => c.pinnedSeconds)),
      reengageSeconds: mean(chases.map((c) => c.reengageSeconds)),
    },
    unfinishedFights: fights.filter((f) => !f.killed).length,
  };
}
