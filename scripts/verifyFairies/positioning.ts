/**
 * Where a fairy keeps itself, driven through the real `MobUpdateLoop` on
 * hand-built floors:
 *
 * - HP: a fairy is authored at `FAIRY_BASE_HP_FRACTION` of its floor's host,
 *   level for level, and that share is more than the whole host.
 * - A crawler charging a fairy sees it back away within a few frames.
 * - Left alone with a crawler beside an ally, it settles with the ally between
 *   them.
 * - With every ally dead it runs for another room, never the one past the
 *   party, and settles there once it arrives among allies. When the only room
 *   left lies past the party it stays and keeps its distance instead, and a
 *   room reached only by a detour that first leads away is still reached.
 * - A boss's healer keeps its distance on the circus grounds, the ground every
 *   other fairy is kept off.
 * - It never flies faster than `SHIELD_MAX_SPEED`, so a crawler who keeps
 *   chasing it at `PLAYER_SPEED` catches it.
 *
 * Every rule is paired with a broken fairy it must catch.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../src/core/constants';
import { PlayerManager } from '../../src/core/PlayerManager';
import { Goblin } from '../../src/creatures/Goblin';
import type { Mob } from '../../src/creatures/Mob';
import { setPackAlertGrid } from '../../src/creatures/packAlert';
import { Fairy } from '../../src/creatures/fairies/Fairy';
import { ShieldFairy } from '../../src/creatures/fairies/ShieldFairy';
import { HealingFairy } from '../../src/creatures/fairies/HealingFairy';
import { bindHealerToBoss } from '../../src/creatures/fairies/bossHealerBond';
import {
  chooseFairyRefuge,
  isFairyGroundForbidden,
  isTileInRect,
  type FairyRefuge,
  type FairyRefugeQuery,
} from '../../src/creatures/fairies/fairyRefuge';
import {
  FAIRY_BASE_HP_FRACTION,
  FAIRY_BOUND_HEALER_LEASH_TILES,
  FAIRY_COVER_LINE_TOLERANCE_TILES,
  FAIRY_GOAL_ARRIVAL_TILES,
  FAIRY_RETREAT_LEASH_STRETCH,
  FAIRY_SPAWN_LEASH_TILES,
  FAIRY_TYPICAL_HOST_HP_BY_FLOOR,
  SHIELD_MAX_SPEED,
  SHIELD_PREFERRED_RANGE_TILES,
} from '../../src/creatures/fairies/fairyTuning';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import type { MobSpawnPoint } from '../../src/map/DungeonGenerator';
import type { Player } from '../../src/Player';
import { createMob } from '../../src/levels/spawner';
import { FAIRY_SPAWN_KEYS } from '../../src/levels/fairySpawner';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import type { SystemContext } from '../../src/systems/GameSystem';
import type { FairyGateReport } from './report';

const GOBLIN_WEAPON = 'sword';
/** The lowest level the HP share is checked at. */
const HP_CHECK_LEVEL_LOW = 1;
/** A mid-curve level the HP share is checked at. */
const HP_CHECK_LEVEL_MID = 5;
/** A level deep into the curve the HP share is checked at. */
const HP_CHECK_LEVEL_DEEP = 12;
/** Levels the HP share is checked at, from the bottom of the curve to deep into it. */
const HP_CHECK_LEVELS: readonly number[] = [
  HP_CHECK_LEVEL_LOW,
  HP_CHECK_LEVEL_MID,
  HP_CHECK_LEVEL_DEEP,
];
/** Half the authored share, for the broken probe. */
const HALVED_HP_FRACTION = FAIRY_BASE_HP_FRACTION / 2;
/** Side of the scratch map a spawned fairy is created on. */
const HP_MAP_SIZE = 8;
/** Rounding slack on an HP compared against a share of the host's. */
const HP_ROUNDING_SLACK = 1;
/** Movement under this many pixels in a frame is rounding, not a step. */
const STEP_EPSILON_PX = 0.01;
/** Decimal places a reported speed in pixels is rounded to. */
const SPEED_DISPLAY_DECIMALS = 3;

/** A goblin that stands where it was put and does nothing: a body to hide behind. */
class RootedGoblin extends Goblin {
  constructor(tileX: number, tileY: number) {
    super(tileX, tileY, TILE_SIZE, GOBLIN_WEAPON);
    this.setBaseSpeed(0);
  }
  override updateAI(_targets: Player[]): void {
    this.isMoving = false;
  }
}

/** A shield fairy that never notices the party: the defect "does not keep its distance". */
class ObliviousFairy extends ShieldFairy {
  override updateAI(_targets: Player[]): void {
    super.updateAI([]);
  }
}

/** A shield fairy that thinks only one frame in `SLOW_THINK_FRAMES`: the defect "reacts too late". */
const SLOW_THINK_FRAMES = 30;
class SlowThinkingFairy extends ShieldFairy {
  private tick = 0;
  override updateAI(targets: Player[]): void {
    this.tick++;
    if (this.tick % SLOW_THINK_FRAMES === 0) super.updateAI(targets);
  }
}

/** A shield fairy whose every step goes twice as far: the defect "outruns the crawler". */
class DoubledStepFairy extends ShieldFairy {
  protected override moveWithCollision(dx: number, dy: number): void {
    super.moveWithCollision(dx * 2, dy * 2);
  }
}

/** A shield fairy authored at half the share: the defect "HP not doubled". */
class HalfHpFairy extends ShieldFairy {
  override setHostFloor(floorNumber: number): void {
    const hostHp = FAIRY_TYPICAL_HOST_HP_BY_FLOOR.get(floorNumber) ?? 1;
    this.setBaseMaxHp(Math.max(1, Math.round(hostHp * HALVED_HP_FRACTION)));
  }
}

type TileGrid = TileContent[][];

/** A grid of wall, with the given rectangles carved to floor. */
function carve(width: number, height: number, rects: readonly RectSpec[]): TileGrid {
  const grid: TileGrid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.wall,
    })),
  );
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        grid[y][x] = { tileId: `${x}#${y}`, type: FloorTypeValue.tile_floor };
      }
    }
  }
  return grid;
}

interface RectSpec {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function spawnPointOf(rect: RectSpec): MobSpawnPoint {
  return {
    x: rect.x + Math.floor(rect.w / 2),
    y: rect.y + Math.floor(rect.h / 2),
    w: rect.w,
    h: rect.h,
    region: 0,
  };
}

interface Floor {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly pm: PlayerManager;
  readonly loop: MobUpdateLoop;
  readonly ctx: () => SystemContext;
  readonly add: <T extends Mob>(mob: T) => T;
}

function buildFloor(grid: TileGrid, rooms: readonly RectSpec[], start: RectSpec): Floor {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
  map.mobSpawnPoints = rooms.map(spawnPointOf);
  map.startTile = { x: start.x + 1, y: start.y + 1 };
  const pm = new PlayerManager(start.x + 1, start.y + 1, undefined);
  const roster = new MobRoster(map, new SpellSystem());
  setPackAlertGrid(roster.grid);
  const loop = new MobUpdateLoop();
  const ctx = (): SystemContext => ({
    human: pm.human,
    cat: pm.cat,
    active: pm.active(),
    inactive: pm.inactive(),
    activeIsMoving: false,
    roster,
    gameMap: map,
    extraTargets: [],
  });
  const add = <T extends Mob>(mob: T): T => {
    mob.setMap(map);
    roster.add(mob);
    return mob;
  };
  return { map, roster, pm, loop, ctx, add };
}

function centre(entity: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: entity.x + TILE_SIZE / 2, y: entity.y + TILE_SIZE / 2 };
}

function distance(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Steps `walker` up to `speed` pixels straight toward `goal`. */
function stepToward(
  walker: { x: number; y: number },
  goal: { readonly x: number; readonly y: number },
  speed: number,
): void {
  const gap = distance(walker, goal);
  if (gap <= speed) {
    walker.x = goal.x;
    walker.y = goal.y;
    return;
  }
  walker.x += ((goal.x - walker.x) / gap) * speed;
  walker.y += ((goal.y - walker.y) / gap) * speed;
}

/** Parks the cat on `tile`, well out of the way but still a crawler the loop measures from. */
function park(player: Player, tile: { readonly x: number; readonly y: number }): void {
  player.x = tile.x * TILE_SIZE;
  player.y = tile.y * TILE_SIZE;
}

// ── HP ───────────────────────────────────────────────────────────────────────

/** A body authored at exactly a floor's typical host HP, levelled as a fairy is: the yardstick. */
class HostYardstick extends ShieldFairy {
  authorAt(hostHp: number): void {
    this.setBaseMaxHp(hostHp);
  }
}

/**
 * A spawned fairy's HP over its host's, at `level`: the fairy through the real
 * spawn key and `setHostFloor`, the host a body authored at the floor's
 * typical host HP and levelled on the same curve.
 */
function hpShare(makeFairy: () => Fairy | null, floorNumber: number, level: number): number {
  const hostHp = FAIRY_TYPICAL_HOST_HP_BY_FLOOR.get(floorNumber) ?? 0;
  const fairy = makeFairy();
  if (fairy === null || hostHp <= 0) return 0;
  fairy.setHostFloor(floorNumber);
  fairy.applyMobLevel(level);
  const host = new HostYardstick(1, 1, TILE_SIZE);
  host.authorAt(hostHp);
  host.applyMobLevel(level);
  return fairy.maxHp / host.maxHp;
}

function verifyHp(report: FairyGateReport): void {
  const map = new GameMap({ tileHeight: TILE_SIZE, mapSize: HP_MAP_SIZE });
  const spawned = (): Fairy | null => {
    const mob = createMob(FAIRY_SPAWN_KEYS.healer, 1, 1, map);
    return mob instanceof Fairy ? mob : null;
  };
  const halved = (): Fairy => new HalfHpFairy(1, 1, TILE_SIZE);
  const off: string[] = [];
  const probeOff: string[] = [];
  let worst = FAIRY_BASE_HP_FRACTION;
  for (const floorNumber of FAIRY_TYPICAL_HOST_HP_BY_FLOOR.keys()) {
    const hostHp = FAIRY_TYPICAL_HOST_HP_BY_FLOOR.get(floorNumber) ?? 1;
    // Both sides are rounded to whole HP, so the share can miss by up to a point on either.
    const slack = (HP_ROUNDING_SLACK * 2) / hostHp;
    for (const level of HP_CHECK_LEVELS) {
      const share = hpShare(spawned, floorNumber, level);
      if (Math.abs(share - FAIRY_BASE_HP_FRACTION) > slack)
        off.push(`floor ${floorNumber} L${level}`);
      if (Math.abs(share - FAIRY_BASE_HP_FRACTION) > Math.abs(worst - FAIRY_BASE_HP_FRACTION)) {
        worst = share;
      }
      const probeShare = hpShare(halved, floorNumber, level);
      if (Math.abs(probeShare - FAIRY_BASE_HP_FRACTION) > slack) probeOff.push(`${floorNumber}`);
    }
  }
  report.check(
    off.length === 0,
    'a spawned fairy has FAIRY_BASE_HP_FRACTION of its floor host HP at every level',
    off.length === 0 ? `worst share ${worst.toFixed(2)}` : off.join(', '),
  );
  report.checkCatches(
    probeOff.length === 0,
    'a fairy authored at half that share is caught',
    `${probeOff.length} cells off`,
  );
}

// ── Backing off ──────────────────────────────────────────────────────────────

const OPEN_W = 40;
const OPEN_H = 30;
const OPEN_ROOM: RectSpec = { x: 1, y: 1, w: OPEN_W - 2, h: OPEN_H - 2 };
const ALLY_TILE = { x: 20, y: 14 };
/** The fairy starts on the ally's crawler side, so backing off and hiding agree. */
const FAIRY_START_TILE = { x: 20, y: 11 };
const CHARGER_START_TILE = { x: 20, y: 3 };
const CAT_PARK_TILE = { x: 37, y: 27 };
/** Frames the fairy is given to settle before a crawler moves. */
const SETTLE_FRAMES = 60;
/** Frames the charge lasts; the charger stops a tile short of where the fairy started. */
const CHARGE_FRAMES = 150;
/**
 * The most frames from the charger crossing the fairy's preferred range to the
 * fairy's first step away from it. Well under a second.
 */
const MAX_REACTION_FRAMES = 15;
/** How far the fairy must have backed off by the charge's end, in tiles. */
const MIN_BACKOFF_TILES = 1.5;

interface BackoffResult {
  readonly reactionFrames: number | null;
  readonly backedOffTiles: number;
}

function backoffRun(makeFairy: (x: number, y: number) => Fairy): BackoffResult {
  const floor = buildFloor(carve(OPEN_W, OPEN_H, [OPEN_ROOM]), [], OPEN_ROOM);
  floor.add(new RootedGoblin(ALLY_TILE.x, ALLY_TILE.y));
  const fairy = floor.add(makeFairy(FAIRY_START_TILE.x, FAIRY_START_TILE.y));
  const human = floor.pm.human;
  park(human, CHARGER_START_TILE);
  park(floor.pm.cat, CAT_PARK_TILE);
  human.hp = human.maxHp;
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) floor.loop.update(floor.ctx());
  const settled = centre(fairy);
  const preferredPx = TILE_SIZE * SHIELD_PREFERRED_RANGE_TILES;
  let enteredAt: number | null = null;
  let reactedAt: number | null = null;
  for (let frame = 0; frame < CHARGE_FRAMES; frame++) {
    const before = centre(fairy);
    stepToward(human, { x: fairy.x, y: fairy.y }, PLAYER_SPEED);
    floor.loop.update(floor.ctx());
    const after = centre(fairy);
    const crawler = centre(human);
    if (enteredAt === null && distance(crawler, before) < preferredPx) enteredAt = frame;
    const awayGain = distance(after, crawler) - distance(before, crawler);
    const stepped = distance(after, before) > STEP_EPSILON_PX;
    if (enteredAt !== null && reactedAt === null && stepped && awayGain > 0) reactedAt = frame;
  }
  const reactionFrames = enteredAt === null || reactedAt === null ? null : reactedAt - enteredAt;
  return { reactionFrames, backedOffTiles: distance(centre(fairy), settled) / TILE_SIZE };
}

function verifyBackoff(report: FairyGateReport): void {
  const describe = (run: BackoffResult): string =>
    `reacted after ${run.reactionFrames ?? 'never'} frames, backed off ${run.backedOffTiles.toFixed(1)} tiles`;
  const real = backoffRun((x, y) => new ShieldFairy(x, y, TILE_SIZE));
  report.check(
    real.reactionFrames !== null &&
      real.reactionFrames <= MAX_REACTION_FRAMES &&
      real.backedOffTiles >= MIN_BACKOFF_TILES,
    `a fairy backs away from a charging crawler within ${MAX_REACTION_FRAMES} frames`,
    describe(real),
  );
  const oblivious = backoffRun((x, y) => new ObliviousFairy(x, y, TILE_SIZE));
  report.checkCatches(
    oblivious.reactionFrames !== null && oblivious.backedOffTiles >= MIN_BACKOFF_TILES,
    'a fairy that ignores the party is caught standing its ground',
    describe(oblivious),
  );
  const slow = backoffRun((x, y) => new SlowThinkingFairy(x, y, TILE_SIZE));
  report.checkCatches(
    slow.reactionFrames !== null &&
      slow.reactionFrames <= MAX_REACTION_FRAMES &&
      slow.backedOffTiles >= MIN_BACKOFF_TILES,
    'a fairy that re-thinks its spot only twice a second is caught reacting late',
    describe(slow),
  );
}

// ── Cover ────────────────────────────────────────────────────────────────────

/** The watcher stands still, north of the ally, inside notice range of the fairy's start. */
const WATCHER_TILE = { x: 20, y: 8 };
/** The fairy starts beside the ally, off the watcher's line. */
const COVER_FAIRY_START_TILE = { x: 24, y: 14 };
const COVER_FRAMES = 300;
/**
 * How far off the fairy-to-watcher line the ally may stand and still be between
 * them, in tiles: the fairy's own cover tolerance, plus the slack it is allowed
 * in arriving at its goal.
 */
const COVER_TOLERANCE_TILES = FAIRY_COVER_LINE_TOLERANCE_TILES + FAIRY_GOAL_ARRIVAL_TILES;

/** Whether `ally` stands between `from` and `to`, within the tolerance of the line. */
function isBetween(
  ally: { readonly x: number; readonly y: number },
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): boolean {
  const lineX = to.x - from.x;
  const lineY = to.y - from.y;
  const lengthSq = lineX * lineX + lineY * lineY;
  if (lengthSq === 0) return false;
  const along = ((ally.x - from.x) * lineX + (ally.y - from.y) * lineY) / lengthSq;
  if (along <= 0 || along >= 1) return false;
  const offLine = Math.hypot(ally.x - (from.x + lineX * along), ally.y - (from.y + lineY * along));
  return offLine <= TILE_SIZE * COVER_TOLERANCE_TILES;
}

function coverRun(makeFairy: (x: number, y: number) => Fairy): boolean {
  const floor = buildFloor(carve(OPEN_W, OPEN_H, [OPEN_ROOM]), [], OPEN_ROOM);
  const ally = floor.add(new RootedGoblin(ALLY_TILE.x, ALLY_TILE.y));
  const fairy = floor.add(makeFairy(COVER_FAIRY_START_TILE.x, COVER_FAIRY_START_TILE.y));
  park(floor.pm.human, WATCHER_TILE);
  park(floor.pm.cat, CAT_PARK_TILE);
  for (let frame = 0; frame < COVER_FRAMES; frame++) floor.loop.update(floor.ctx());
  return isBetween(centre(ally), centre(fairy), centre(floor.pm.human));
}

/** A shield fairy that cannot fly: the defect "stays where it was put". */
class GroundedFairy extends ShieldFairy {
  protected override moveWithCollision(_dx: number, _dy: number): void {
    // Holds its tile.
  }
}

function verifyCover(report: FairyGateReport): void {
  report.check(
    coverRun((x, y) => new ShieldFairy(x, y, TILE_SIZE)),
    'a fairy settles with its ally between it and a watching crawler',
  );
  report.checkCatches(
    coverRun((x, y) => new GroundedFairy(x, y, TILE_SIZE)),
    'a fairy left where it was placed, off the line, is caught without cover',
  );
}

// ── Running for the next room ────────────────────────────────────────────────

/** The side of every square room laid out in this file, in tiles. */
const ROOM_SIZE = 7;
/** A room's centre, offset from its corner, in tiles. */
const ROOM_CENTRE_TILES = Math.floor(ROOM_SIZE / 2);
/** One tile in from a room's far wall, in tiles from its corner. */
const ROOM_FAR_WALL_TILES = ROOM_SIZE - 2;
/** A room's last floor tile before its far wall, in tiles from its corner. */
const ROOM_LAST_TILE = ROOM_SIZE - 1;
const ROW_Y = 4;
const CORRIDOR_Y = ROW_Y + ROOM_CENTRE_TILES;
/**
 * Three rooms in a row: the party side, the fairy's own, and the far side.
 * Near and far sit on either side of home, each close enough to the fairy's
 * spawn tile that a refuge choice there is a leash question, not a distance
 * one — {@link FAIRY_SPAWN_LEASH_TILES} is what the "never lies through the
 * party" and "stays and fights when cornered" cases are actually testing.
 */
const NEAR_ROOM: RectSpec = { x: 7, y: ROW_Y, w: ROOM_SIZE, h: ROOM_SIZE };
const HOME_ROOM: RectSpec = { x: 14, y: ROW_Y, w: ROOM_SIZE, h: ROOM_SIZE };
const FAR_ROOM: RectSpec = { x: 22, y: ROW_Y, w: ROOM_SIZE, h: ROOM_SIZE };
const ROW_W = 34;
const ROW_GRID_H = 15;
/** Under both the near and far rooms' distance from the fairy's spawn, so a leash this small takes neither. */
const TINY_LEASH_TILES = 3;
const CORRIDOR: RectSpec = {
  x: NEAR_ROOM.x,
  y: CORRIDOR_Y,
  w: FAR_ROOM.x + FAR_ROOM.w - NEAR_ROOM.x,
  h: 1,
};
/** The crawler stands in the home room's near half, between the fairy and the near room. */
const PARTY_TILE = { x: HOME_ROOM.x + 1, y: CORRIDOR_Y };
/** One tile nearer the near room's centre than the far room's, so a party-blind choice goes near. */
const ROW_FAIRY_TILE = { x: HOME_ROOM.x + ROOM_CENTRE_TILES, y: CORRIDOR_Y - 2 };
const HOME_ALLY_TILE = { x: HOME_ROOM.x + ROOM_CENTRE_TILES, y: CORRIDOR_Y };
/**
 * Each room's ally stands at its own outer wall, away from home, rather than
 * its centre: far enough from the fairy's spawn tile to sit outside
 * `FAIRY_ALLY_SEARCH_TILES` even though the room's centre — where a refuge
 * lands — sits inside the spawn leash. Without that separation the fairy
 * would count the next room's ally as its own the moment it spawns, and never
 * count itself alone at all.
 */
const NEAR_ALLY_TILE = { x: NEAR_ROOM.x, y: CORRIDOR_Y };
const FAR_ALLY_TILE = { x: FAR_ROOM.x + ROOM_LAST_TILE, y: CORRIDOR_Y };
const CAT_ROW_TILE = { x: 1, y: 1 };
const FLEE_FRAMES = 600;
/** Frames the fairy is watched after it arrives, to see it stay among its new allies. */
const STAY_FRAMES = 120;
/**
 * The farthest a healer bound to a (dead) boss may ever stray from it under
 * retreat pressure: its own leash, stretched the same as any retreat step.
 * The room-arrival proxy this used to be checked against stops being sound
 * once a nearby room's distance and this stray radius are close enough to
 * overlap by coincidence, which the compact layout above makes true; the
 * distance from the dead ally is what the bound branch actually promises.
 */
const BOUND_HEALER_MAX_STRAY_TILES = FAIRY_BOUND_HEALER_LEASH_TILES * FAIRY_RETREAT_LEASH_STRETCH;
/** Slack over the theoretical stray radius for a goal's own arrival tolerance. */
const STRAY_SLACK_TILES = 1;

interface FleeResult {
  readonly arrivedInFarRoom: boolean;
  readonly enteredNearRoom: boolean;
  readonly stayedAfterArrival: boolean;
  readonly maxStepPx: number;
  /** Farthest the fairy ever stood from its dead ally's tile, in tiles. */
  readonly maxHomeDistTiles: number;
}

function rowFloor(): { floor: Floor; homeAlly: Mob } {
  const grid = carve(ROW_W, ROW_GRID_H, [NEAR_ROOM, HOME_ROOM, FAR_ROOM, CORRIDOR]);
  const floor = buildFloor(grid, [NEAR_ROOM, HOME_ROOM, FAR_ROOM], NEAR_ROOM);
  const homeAlly = floor.add(new RootedGoblin(HOME_ALLY_TILE.x, HOME_ALLY_TILE.y));
  floor.add(new RootedGoblin(NEAR_ALLY_TILE.x, NEAR_ALLY_TILE.y));
  floor.add(new RootedGoblin(FAR_ALLY_TILE.x, FAR_ALLY_TILE.y));
  return { floor, homeAlly };
}

function tileOf(entity: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: Math.floor((entity.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((entity.y + TILE_SIZE / 2) / TILE_SIZE),
  };
}

function fleeRun(makeFairy: (x: number, y: number) => Fairy, bind: boolean): FleeResult {
  const { floor, homeAlly } = rowFloor();
  const fairy = floor.add(makeFairy(ROW_FAIRY_TILE.x, ROW_FAIRY_TILE.y));
  if (bind) bindHealerToBoss(fairy, homeAlly);
  park(floor.pm.human, PARTY_TILE);
  park(floor.pm.cat, CAT_ROW_TILE);
  floor.loop.update(floor.ctx());
  homeAlly.hp = 0;
  let arrivedAt: number | null = null;
  let enteredNearRoom = false;
  let maxStepPx = 0;
  let stayedAfterArrival = true;
  let maxHomeDistPx = 0;
  for (let frame = 0; frame < FLEE_FRAMES; frame++) {
    const before = { x: fairy.x, y: fairy.y };
    floor.loop.update(floor.ctx());
    maxStepPx = Math.max(maxStepPx, distance(fairy, before));
    maxHomeDistPx = Math.max(maxHomeDistPx, distance(fairy, homeAlly));
    const tile = tileOf(fairy);
    if (isTileInRect(tile.x, tile.y, NEAR_ROOM)) enteredNearRoom = true;
    const inFar = isTileInRect(tile.x, tile.y, FAR_ROOM);
    if (arrivedAt === null && inFar) arrivedAt = frame;
    if (arrivedAt !== null && frame - arrivedAt <= STAY_FRAMES && !inFar)
      stayedAfterArrival = false;
  }
  return {
    arrivedInFarRoom: arrivedAt !== null,
    enteredNearRoom,
    stayedAfterArrival,
    maxStepPx,
    maxHomeDistTiles: maxHomeDistPx / TILE_SIZE,
  };
}

function verifyRunningForTheNextRoom(report: FairyGateReport): void {
  const describe = (run: FleeResult): string =>
    `${run.arrivedInFarRoom ? 'reached' : 'never reached'} the far room, ` +
    `${run.enteredNearRoom ? 'entered' : 'kept out of'} the party-side room, ` +
    `fastest step ${run.maxStepPx.toFixed(2)} px`;
  const real = fleeRun((x, y) => new ShieldFairy(x, y, TILE_SIZE), false);
  report.check(
    real.arrivedInFarRoom && !real.enteredNearRoom && real.stayedAfterArrival,
    'a fairy whose last ally dies runs for the room away from the party and stays there among its new allies',
    describe(real),
  );
  report.check(
    real.maxStepPx <= SHIELD_MAX_SPEED + STEP_EPSILON_PX,
    'a running fairy never steps faster than SHIELD_MAX_SPEED',
    `${real.maxStepPx.toFixed(SPEED_DISPLAY_DECIMALS)} px against ${SHIELD_MAX_SPEED.toFixed(SPEED_DISPLAY_DECIMALS)}`,
  );
  const tethered = fleeRun((x, y) => new ShieldFairy(x, y, TILE_SIZE), true);
  report.checkCatches(
    tethered.maxHomeDistTiles > BOUND_HEALER_MAX_STRAY_TILES + STRAY_SLACK_TILES,
    'a fairy that stays put when its room falls (here: bound to its dead ally as a boss healer is) is caught straying off it',
    `${describe(tethered)}, ${tethered.maxHomeDistTiles.toFixed(1)} tiles from its dead ally at the farthest`,
  );
  const fast = fleeRun((x, y) => new DoubledStepFairy(x, y, TILE_SIZE), false);
  report.checkCatches(
    fast.maxStepPx <= SHIELD_MAX_SPEED + STEP_EPSILON_PX,
    'a fairy whose steps are doubled is caught over the speed cap',
    `${fast.maxStepPx.toFixed(SPEED_DISPLAY_DECIMALS)} px`,
  );

  // The refuge choice on its own: the near room is the closer one, so a
  // choice blind to the party would take it.
  const { floor } = rowFloor();
  const from = { x: ROW_FAIRY_TILE.x * TILE_SIZE, y: ROW_FAIRY_TILE.y * TILE_SIZE };
  const party = [{ x: PARTY_TILE.x * TILE_SIZE, y: PARTY_TILE.y * TILE_SIZE }];
  const isSupportable = (mob: Mob): boolean =>
    mob.isAlive && mob.isHostile && !(mob instanceof Fairy);
  setPackAlertGrid(floor.roster.grid);
  const choose = (
    threats: readonly { x: number; y: number }[],
    leashRadiusPx = Number.POSITIVE_INFINITY,
  ) =>
    chooseFairyRefuge({
      map: floor.map,
      tileSize: TILE_SIZE,
      fromX: from.x,
      fromY: from.y,
      threats,
      passedOver: new WeakSet(),
      isSupportable,
      leashOriginX: from.x,
      leashOriginY: from.y,
      leashRadiusPx,
    });
  // Routing round the party is judged with the leash out of the way.
  const chosen = choose(party);
  const blind = choose([]);
  const roomOf = (refuge: ReturnType<typeof choose>): string =>
    refuge?.room === null || refuge === null
      ? 'none'
      : refuge.room.x === FAR_ROOM.x
        ? 'far'
        : refuge.room.x === NEAR_ROOM.x
          ? 'near'
          : 'other';
  report.check(
    roomOf(chosen) === 'far',
    'the refuge chosen never lies through the party',
    `chose the ${roomOf(chosen)} room`,
  );
  report.checkCatches(
    roomOf(blind) === 'far',
    'a refuge choice blind to the party is caught taking the nearer room past it',
    `chose the ${roomOf(blind)} room`,
  );

  // The leash on its own: a radius under every room's distance takes none of
  // them, and the shipped radius still reaches the far room it is sized for.
  const tinyLeash = choose([], TILE_SIZE * TINY_LEASH_TILES);
  report.check(
    roomOf(tinyLeash) === 'none',
    `a refuge past a ${TINY_LEASH_TILES}-tile leash is never chosen`,
    `chose the ${roomOf(tinyLeash)} room`,
  );
  const shippedLeash = choose(party, TILE_SIZE * FAIRY_SPAWN_LEASH_TILES);
  report.check(
    roomOf(shippedLeash) === 'far',
    `the shipped ${FAIRY_SPAWN_LEASH_TILES}-tile spawn leash still reaches the far room`,
    `chose the ${roomOf(shippedLeash)} room`,
  );
}

// ── Cornered: the only refuge lies past the party ───────────────────────────

/** The party-side room and the fairy's own, and no third room to run to. */
const CORNERED_ROOMS: readonly RectSpec[] = [NEAR_ROOM, HOME_ROOM];
const CORNERED_CORRIDOR: RectSpec = {
  x: NEAR_ROOM.x,
  y: CORRIDOR_Y,
  w: HOME_ROOM.x + HOME_ROOM.w - NEAR_ROOM.x,
  h: 1,
};
/**
 * The fairy starts past the room's centre, the crawler (at `HOME_ROOM.x + 1`)
 * still between it and the corridor out — one tile past centre is enough for
 * that ordering without pushing the near room's landing point outside the
 * spawn leash the way the room's literal far wall would.
 */
const CORNERED_FAIRY_TILE = { x: HOME_ROOM.x + ROOM_CENTRE_TILES + 1, y: CORRIDOR_Y - 2 };
const CORNERED_FRAMES = 600;
/** Nearer than this to the crawler, in tiles, and the fairy has flown into the party. */
const CORNERED_MIN_GAP_TILES = 2;

/**
 * A shield fairy that treats a refuge past the party as a last resort rather
 * than no refuge: the defect "only penalises running through the party".
 */
class PenaltyOnlyRefugeFairy extends ShieldFairy {
  protected override chooseRefuge(query: FairyRefugeQuery): FairyRefuge | null {
    return super.chooseRefuge(query) ?? super.chooseRefuge({ ...query, threats: [] });
  }
}

interface CorneredResult {
  readonly choseRefuge: boolean;
  readonly enteredNearRoom: boolean;
  readonly closestGapTiles: number;
}

function corneredRun(makeFairy: (x: number, y: number) => Fairy): CorneredResult {
  const grid = carve(ROW_W, ROW_GRID_H, [...CORNERED_ROOMS, CORNERED_CORRIDOR]);
  const floor = buildFloor(grid, CORNERED_ROOMS, NEAR_ROOM);
  const homeAlly = floor.add(new RootedGoblin(HOME_ALLY_TILE.x, HOME_ALLY_TILE.y));
  floor.add(new RootedGoblin(NEAR_ALLY_TILE.x, NEAR_ALLY_TILE.y));
  const fairy = floor.add(makeFairy(CORNERED_FAIRY_TILE.x, CORNERED_FAIRY_TILE.y));
  park(floor.pm.human, PARTY_TILE);
  park(floor.pm.cat, CAT_ROW_TILE);
  floor.loop.update(floor.ctx());
  homeAlly.hp = 0;
  let choseRefuge = false;
  let enteredNearRoom = false;
  let closestGapTiles = Infinity;
  for (let frame = 0; frame < CORNERED_FRAMES; frame++) {
    floor.loop.update(floor.ctx());
    if (fairy.fleeingTo !== null) choseRefuge = true;
    const tile = tileOf(fairy);
    if (isTileInRect(tile.x, tile.y, NEAR_ROOM)) enteredNearRoom = true;
    closestGapTiles = Math.min(closestGapTiles, distance(fairy, floor.pm.human) / TILE_SIZE);
  }
  return { choseRefuge, enteredNearRoom, closestGapTiles };
}

function verifyCornered(report: FairyGateReport): void {
  const describe = (run: CorneredResult): string =>
    `${run.choseRefuge ? 'ran for a room' : 'chose no refuge'}, ` +
    `${run.enteredNearRoom ? 'entered' : 'kept out of'} the party-side room, ` +
    `closest ${run.closestGapTiles.toFixed(2)} tiles from the crawler`;
  const real = corneredRun((x, y) => new ShieldFairy(x, y, TILE_SIZE));
  report.check(
    !real.choseRefuge && !real.enteredNearRoom && real.closestGapTiles >= CORNERED_MIN_GAP_TILES,
    'a fairy whose only refuge lies past the party stays and keeps its distance',
    describe(real),
  );
  const penaltyOnly = corneredRun((x, y) => new PenaltyOnlyRefugeFairy(x, y, TILE_SIZE));
  report.checkCatches(
    !penaltyOnly.enteredNearRoom && penaltyOnly.closestGapTiles >= CORNERED_MIN_GAP_TILES,
    'a refuge choice that only penalises the party is caught running through it',
    describe(penaltyOnly),
  );
}

// ── A refuge reached only by a detour ────────────────────────────────────────

/**
 * The fairy's room and the refuge, side by side with no door between them.
 * The only way round leaves the fairy's room on the side away from the refuge
 * and loops north, so for its first stretch the route leads away.
 */
const DETOUR_HOME: RectSpec = { x: 10, y: 10, w: ROOM_SIZE, h: ROOM_SIZE };
/** Close enough to the home room, straight-line, to sit inside the spawn leash — only the route is long. */
const DETOUR_REFUGE: RectSpec = { x: 18, y: 10, w: ROOM_SIZE, h: ROOM_SIZE };
const DETOUR_LOOP_X = 6;
const DETOUR_LOOP_Y = 3;
const DETOUR_EXIT_Y = DETOUR_HOME.y + ROOM_CENTRE_TILES;
const DETOUR_ENTRY_X = DETOUR_REFUGE.x + ROOM_CENTRE_TILES;
const DETOUR_CORRIDORS: readonly RectSpec[] = [
  { x: DETOUR_LOOP_X, y: DETOUR_EXIT_Y, w: DETOUR_HOME.x - DETOUR_LOOP_X, h: 1 },
  { x: DETOUR_LOOP_X, y: DETOUR_LOOP_Y, w: 1, h: DETOUR_EXIT_Y - DETOUR_LOOP_Y + 1 },
  { x: DETOUR_LOOP_X, y: DETOUR_LOOP_Y, w: DETOUR_ENTRY_X - DETOUR_LOOP_X + 1, h: 1 },
  { x: DETOUR_ENTRY_X, y: DETOUR_LOOP_Y, w: 1, h: DETOUR_REFUGE.y - DETOUR_LOOP_Y },
];
const DETOUR_W = 34;
const DETOUR_H = 20;
const DETOUR_FAIRY_TILE = { x: DETOUR_HOME.x + ROOM_FAR_WALL_TILES, y: DETOUR_HOME.y + 2 };
const DETOUR_ALLY_TILE = {
  x: DETOUR_HOME.x + ROOM_CENTRE_TILES,
  y: DETOUR_HOME.y + ROOM_FAR_WALL_TILES,
};
const DETOUR_REFUGE_ALLY_TILE = {
  x: DETOUR_REFUGE.x + ROOM_CENTRE_TILES,
  y: DETOUR_REFUGE.y + ROOM_CENTRE_TILES,
};
/** Both crawlers stand in the fairy's room, on the side toward the refuge. */
const DETOUR_HUMAN_TILE = { x: DETOUR_HOME.x + ROOM_LAST_TILE, y: DETOUR_HOME.y + ROOM_LAST_TILE };
const DETOUR_CAT_TILE = {
  x: DETOUR_HOME.x + ROOM_LAST_TILE,
  y: DETOUR_HOME.y + ROOM_FAR_WALL_TILES,
};
const DETOUR_FRAMES = 900;

/**
 * A shield fairy that measures its progress straight at the refuge: the
 * defect "a route that first leads away is no progress".
 */
class StraightLineStallFairy extends ShieldFairy {
  protected override refugeRouteTilesLeft(refuge: FairyRefuge): number | null {
    return this.distanceTo(refuge) / TILE_SIZE;
  }
}

/** The frame the fairy's centre first stood in the refuge room, or null. */
function detourRun(makeFairy: (x: number, y: number) => Fairy): number | null {
  const grid = carve(DETOUR_W, DETOUR_H, [DETOUR_HOME, DETOUR_REFUGE, ...DETOUR_CORRIDORS]);
  const floor = buildFloor(grid, [DETOUR_HOME, DETOUR_REFUGE], DETOUR_HOME);
  const homeAlly = floor.add(new RootedGoblin(DETOUR_ALLY_TILE.x, DETOUR_ALLY_TILE.y));
  floor.add(new RootedGoblin(DETOUR_REFUGE_ALLY_TILE.x, DETOUR_REFUGE_ALLY_TILE.y));
  const fairy = floor.add(makeFairy(DETOUR_FAIRY_TILE.x, DETOUR_FAIRY_TILE.y));
  park(floor.pm.human, DETOUR_HUMAN_TILE);
  park(floor.pm.cat, DETOUR_CAT_TILE);
  floor.loop.update(floor.ctx());
  homeAlly.hp = 0;
  for (let frame = 0; frame < DETOUR_FRAMES; frame++) {
    floor.loop.update(floor.ctx());
    const tile = tileOf(fairy);
    if (isTileInRect(tile.x, tile.y, DETOUR_REFUGE)) return frame;
  }
  return null;
}

function verifyDetour(report: FairyGateReport): void {
  const describe = (arrivedAt: number | null): string =>
    arrivedAt === null
      ? `never reached it in ${DETOUR_FRAMES} frames`
      : `reached it after ${arrivedAt} frames`;
  const real = detourRun((x, y) => new ShieldFairy(x, y, TILE_SIZE));
  report.check(
    real !== null,
    'a fairy reaches a refuge whose only route first leads away from it',
    describe(real),
  );
  const straight = detourRun((x, y) => new StraightLineStallFairy(x, y, TILE_SIZE));
  report.checkCatches(
    straight !== null,
    'a fairy that measures progress straight at the room is caught giving the detour up',
    describe(straight),
  );
}

// ── A boss's healer on the circus grounds ────────────────────────────────────

const CIRCUS_MAP_TILES = 50;
/** Wall thickness around the circus room, in tiles. */
const CIRCUS_ROOM_MARGIN_TILES = 2;
const CIRCUS_ROOM: RectSpec = {
  x: CIRCUS_ROOM_MARGIN_TILES,
  y: CIRCUS_ROOM_MARGIN_TILES,
  w: CIRCUS_MAP_TILES - CIRCUS_ROOM_MARGIN_TILES * 2,
  h: CIRCUS_MAP_TILES - CIRCUS_ROOM_MARGIN_TILES * 2,
};
const CIRCUS_CENTRE_TILE = { x: 25, y: 25 };
/** Wide enough that the ground forbidden to a fairy covers the whole fight. */
const CIRCUS_RADIUS_TILES = 8;
/** How far east of the circus centre the healer starts, in tiles. */
const CIRCUS_HEALER_OFFSET_TILES = 3;
const CIRCUS_HEALER_TILE = {
  x: CIRCUS_CENTRE_TILE.x + CIRCUS_HEALER_OFFSET_TILES,
  y: CIRCUS_CENTRE_TILE.y,
};
/** How far east of the circus centre the closing crawler starts, in tiles. */
const CIRCUS_CRAWLER_START_OFFSET_TILES = 6;
const CIRCUS_CRAWLER_START_X = CIRCUS_CENTRE_TILE.x + CIRCUS_CRAWLER_START_OFFSET_TILES;
/** Tiles per frame the crawler walks in on the healer and its boss: slow enough to be kept away from. */
const CIRCUS_CRAWLER_STEP_TILES = 0.02;
const CIRCUS_FRAMES = 300;
const CIRCUS_CAT_TILE = { x: 3, y: 3 };
/** The healer must have flown at least this far, in tiles, to be keeping its distance at all. */
const CIRCUS_MIN_TRAVEL_TILES = 1;
/** The gap to the crawler the healer must hold at the end, in tiles. */
const CIRCUS_MIN_GAP_TILES = 3.5;

/** A bound healer refused the ground every other fairy is refused: the defect under test. */
class GroundBoundHealer extends HealingFairy {
  protected override isHoverGoalAllowed(x: number, y: number): boolean {
    const map = this.map;
    if (map === null) return super.isHoverGoalAllowed(x, y);
    const tileX = Math.floor((x + TILE_SIZE / 2) / TILE_SIZE);
    const tileY = Math.floor((y + TILE_SIZE / 2) / TILE_SIZE);
    return super.isHoverGoalAllowed(x, y) && !isFairyGroundForbidden(map, tileX, tileY);
  }
}

interface CircusHealerResult {
  readonly travelledTiles: number;
  readonly finalGapTiles: number;
  readonly startForbidden: boolean;
}

function circusHealerRun(makeHealer: (x: number, y: number) => Fairy): CircusHealerResult {
  const floor = buildFloor(
    carve(CIRCUS_MAP_TILES, CIRCUS_MAP_TILES, [CIRCUS_ROOM]),
    [],
    CIRCUS_ROOM,
  );
  floor.map.circusCentre = CIRCUS_CENTRE_TILE;
  floor.map.circusRadiusTiles = CIRCUS_RADIUS_TILES;
  const boss = floor.add(new RootedGoblin(CIRCUS_CENTRE_TILE.x, CIRCUS_CENTRE_TILE.y));
  const healer = floor.add(makeHealer(CIRCUS_HEALER_TILE.x, CIRCUS_HEALER_TILE.y));
  bindHealerToBoss(healer, boss);
  park(floor.pm.cat, CIRCUS_CAT_TILE);
  const human = floor.pm.human;
  let travelledPx = 0;
  for (let frame = 0; frame < CIRCUS_FRAMES; frame++) {
    human.x = (CIRCUS_CRAWLER_START_X - frame * CIRCUS_CRAWLER_STEP_TILES) * TILE_SIZE;
    human.y = CIRCUS_CENTRE_TILE.y * TILE_SIZE;
    const before = { x: healer.x, y: healer.y };
    floor.loop.update(floor.ctx());
    travelledPx += distance(healer, before);
  }
  return {
    travelledTiles: travelledPx / TILE_SIZE,
    finalGapTiles: distance(healer, human) / TILE_SIZE,
    startForbidden: isFairyGroundForbidden(floor.map, CIRCUS_HEALER_TILE.x, CIRCUS_HEALER_TILE.y),
  };
}

function verifyCircusHealer(report: FairyGateReport): void {
  const describe = (run: CircusHealerResult): string =>
    `flew ${run.travelledTiles.toFixed(1)} tiles, ended ${run.finalGapTiles.toFixed(2)} tiles from the crawler`;
  const real = circusHealerRun((x, y) => new HealingFairy(x, y, TILE_SIZE));
  report.precondition(
    real.startForbidden,
    "the healer starts on ground forbidden to an unbound fairy: the circus's reach",
  );
  report.check(
    real.travelledTiles >= CIRCUS_MIN_TRAVEL_TILES && real.finalGapTiles >= CIRCUS_MIN_GAP_TILES,
    "a boss's healer on the circus grounds keeps its distance from a crawler closing in",
    describe(real),
  );
  const grounded = circusHealerRun((x, y) => new GroundBoundHealer(x, y, TILE_SIZE));
  report.checkCatches(
    grounded.travelledTiles >= CIRCUS_MIN_TRAVEL_TILES &&
      grounded.finalGapTiles >= CIRCUS_MIN_GAP_TILES,
    'a bound healer refused the circus grounds is caught frozen in place',
    describe(grounded),
  );
}

// ── Caught by a determined chase ─────────────────────────────────────────────

const CHASE_FAIRY_TILE = { x: 20, y: 14 };
const CHASE_START_TILE = { x: 20, y: 8 };
const CHASE_FRAMES = 1200;
/** Close enough to swing at, in tiles. */
const CAUGHT_TILES = 1;

interface ChaseResult {
  /** The frame the crawler got within reach, or null if it never did. */
  readonly caughtAt: number | null;
  /** The most the gap ever grew in one frame, in pixels; a chase that always closes stays at or under zero. */
  readonly worstGapGrowthPx: number;
}

function chaseRun(makeFairy: (x: number, y: number) => Fairy): ChaseResult {
  const floor = buildFloor(carve(OPEN_W, OPEN_H, [OPEN_ROOM]), [], OPEN_ROOM);
  const fairy = floor.add(makeFairy(CHASE_FAIRY_TILE.x, CHASE_FAIRY_TILE.y));
  const human = floor.pm.human;
  park(human, CHASE_START_TILE);
  park(floor.pm.cat, CAT_PARK_TILE);
  let worstGapGrowthPx = -Infinity;
  for (let frame = 0; frame < CHASE_FRAMES; frame++) {
    const gapBefore = distance(human, fairy);
    stepToward(human, { x: fairy.x, y: fairy.y }, PLAYER_SPEED);
    floor.loop.update(floor.ctx());
    const gapAfter = distance(human, fairy);
    worstGapGrowthPx = Math.max(worstGapGrowthPx, gapAfter - gapBefore);
    if (gapAfter <= TILE_SIZE * CAUGHT_TILES) return { caughtAt: frame, worstGapGrowthPx };
  }
  return { caughtAt: null, worstGapGrowthPx };
}

function verifyCaughtByAChase(report: FairyGateReport): void {
  const describe = (run: ChaseResult): string =>
    `${run.caughtAt === null ? `not caught in ${CHASE_FRAMES} frames` : `caught after ${run.caughtAt} frames`}, ` +
    `worst one-frame gap growth ${run.worstGapGrowthPx.toFixed(2)} px`;
  const real = chaseRun((x, y) => new ShieldFairy(x, y, TILE_SIZE));
  report.check(
    real.caughtAt !== null && real.worstGapGrowthPx <= STEP_EPSILON_PX,
    'a crawler chasing a lone fairy at PLAYER_SPEED closes the gap on every frame and catches it',
    describe(real),
  );
  const fast = chaseRun((x, y) => new DoubledStepFairy(x, y, TILE_SIZE));
  report.checkCatches(
    fast.caughtAt !== null && fast.worstGapGrowthPx <= STEP_EPSILON_PX,
    'a fairy stepping over the cap is caught opening the gap',
    describe(fast),
  );
}

export function verifyFairyPositioning(report: FairyGateReport): void {
  report.section('Positioning: distance, cover, running, HP');
  verifyHp(report);
  verifyBackoff(report);
  verifyCover(report);
  verifyRunningForTheNextRoom(report);
  verifyCornered(report);
  verifyDetour(report);
  verifyCircusHealer(report);
  verifyCaughtByAChase(report);
}
