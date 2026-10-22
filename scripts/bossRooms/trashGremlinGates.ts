/**
 * The Trash Gremlin's lair's own gates, run by `gates:boss-rooms` on every generated
 * floor of its sweep, plus the fight sims, run once per sweep.
 *
 * Per floor:
 * - **Layout.** Four island clusters of two to four heaps, four to six towers,
 *   six to eight bags, the mattress on open floor — and no tower where its
 *   fall could never start (a line with nowhere to go is a tower that only
 *   ever crumples).
 * - **Topple.** Every tower's warning is at least the locked-telegraph floor,
 *   its line never covers anything but open floor, a crawler standing in the
 *   line who walks out the way the room's hazard points — at the slowest speed
 *   a crawler has in this room — is never hit, and one who stands still is.
 * - **Checkpoints.** A toppled tower comes back standing after a death (from a
 *   checkpoint that went through JSON), after an abort, and after a death in
 *   mid-wobble and mid-fall; a save with it down lays it down on a fresh floor.
 *
 * Once per sweep:
 * - **Bile over junk.** A crawler behind an island is hit as often as one in
 *   the open at the same range, within ten percent.
 * - **Caps.** Enraged, with every bag burst and every heap free to hatch, the
 *   live roaches never pass its cap, and the flies never pass theirs.
 * - **Hatch sites.** Every roach in that run first appears on open floor beside
 *   a trash pile or a garbage bag, and never on the gremlin.
 * - **Fights finish.** The fight sim on all four doorway sides ends with the
 *   gremlin dead every time.
 */

import { createCanvas } from 'canvas';

import { TILE_SIZE } from '../../src/core/constants.js';
import { CatPlayer } from '../../src/creatures/CatPlayer.js';
import { Cockroach } from '../../src/creatures/Cockroach.js';
import { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../../src/creatures/mobLevelScaling.js';
import { GameMap } from '../../src/map/GameMap.js';
import {
  TRASH_BAG,
  TRASH_PILE,
  TRASH_RUBBLE,
  TRASH_TOWER,
  TRASH_GREMLIN_FLOOR,
  type TileContent,
} from '../../src/map/tileTypes.js';
import { slowestTileSpeedFactor } from '../../src/map/tileSpeed.js';
import type { DamageSource } from '../../src/Player.js';
import { TRASH_GREMLIN_BOSS_TYPE } from '../../src/systems/bossRooms/BossRoomDressings.js';
import {
  approachLaneTiles,
  spawnClearTiles,
  type DoorSide,
  type TilePoint,
} from '../../src/systems/bossRooms/bossRoomLayout.js';
import {
  TrashGremlinRoomSystem,
  MAX_FLIES,
  TOWER_FALL_TICKS,
  TOWER_WOBBLE_FRAMES,
} from '../../src/systems/bossRooms/TrashGremlinRoomSystem.js';
import { parseTrashGremlinRoomCheckpoint } from '../../src/systems/bossRooms/trashGremlinRoomCheckpoint.js';
import {
  NEST_TILES_DEEP,
  NEST_TILES_WIDE,
} from '../../src/systems/bossRooms/trashGremlinLayout.js';
import { applyMovement } from '../../src/systems/GameLoopPhases.js';
import type { SystemContext } from '../../src/systems/GameSystem.js';
import { stepAlongEscape } from '../../src/systems/GroundHazardSource.js';
import { MobRoster } from '../../src/systems/kits/SceneWorld.js';
import { SpellSystem } from '../../src/systems/SpellSystem.js';
import { asGameContext } from '../nodeGameContext.js';
import {
  TRASH_GREMLIN_FLEE_RANGE_TILES,
  SIM_RANDOM_SEEDS,
  measureTrashGremlinSide,
  stageTrashGremlinFight,
  withSeededRandom,
} from './trashGremlinFightSim.js';
import {
  DOOR_SIDES,
  DrawCallCounter,
  gauntletBossRoom,
  generateFloor,
  type GateReport,
  type RoomGateContext,
} from './harness.js';

const HALF = 0.5;
const DECIMALS = 2;
/**
 * How much less often a crawler behind an island may be hit than one in the
 * open: the lobbed bile is meant to clear the junk, so an island must not
 * become cover.
 */
const COVER_TOLERANCE_SHARE = 0.1;
const tileKey = (tile: TilePoint): string => `${tile.x},${tile.y}`;

// ── Layout ───────────────────────────────────────────────────────────────────

const ISLAND_CLUSTERS = 4;
const ISLAND_TILES_MIN = 2;
const ISLAND_TILES_MAX = 4;
const TOWERS_MIN = 4;
const TOWERS_MAX = 6;
const BAGS_MIN = 6;
const BAGS_MAX = 8;

function layoutGates(room: TrashGremlinRoomSystem, gameMap: GameMap, report: GateReport): void {
  const { layout } = room;
  const clusters = layout.clusters.filter((cluster) => cluster.length > 0);
  if (clusters.length !== ISLAND_CLUSTERS) {
    report.fail(`${clusters.length} island clusters, want ${ISLAND_CLUSTERS}`);
  }
  for (const cluster of clusters) {
    const heaps = cluster.filter((t) => gameMap.structure[t.y][t.x].type === TRASH_PILE).length;
    if (heaps < ISLAND_TILES_MIN || heaps > ISLAND_TILES_MAX) {
      report.fail(`an island has ${heaps} heaps, want ${ISLAND_TILES_MIN}-${ISLAND_TILES_MAX}`);
    }
  }
  const count = (type: number): number =>
    layout.placements.filter((p) => gameMap.structure[p.y][p.x].type === type).length;
  const towers = count(TRASH_TOWER);
  const bags = count(TRASH_BAG);
  if (towers < TOWERS_MIN || towers > TOWERS_MAX) {
    report.fail(`${towers} towers, want ${TOWERS_MIN}-${TOWERS_MAX}`);
  }
  if (bags < BAGS_MIN || bags > BAGS_MAX) report.fail(`${bags} bags, want ${BAGS_MIN}-${BAGS_MAX}`);
  for (let dy = 0; dy < NEST_TILES_DEEP; dy++) {
    for (let dx = 0; dx < NEST_TILES_WIDE; dx++) {
      const x = layout.nest.x + dx;
      const y = layout.nest.y + dy;
      if (!gameMap.isWalkable(x, y))
        report.fail(`the mattress lies over solid ground at ${x},${y}`);
    }
  }
  const forbidden = new Set<string>();
  for (const doorway of layout.doorways) {
    for (const tile of approachLaneTiles(doorway, room.bounds)) forbidden.add(tileKey(tile));
  }
  for (const tile of spawnClearTiles(layout.spawn)) forbidden.add(tileKey(tile));
  for (const tower of room.towers) {
    if (forbidden.has(tileKey(tower)))
      report.fail(`a tower at ${tileKey(tower)} stands in an approach or the spawn`);
  }
  report.note(`${towers} towers, ${bags} bags, ${layout.placements.length} junk tiles`);
}

// ── Topple ───────────────────────────────────────────────────────────────────

/** A crawler who counts the towers that land on it. */
class ToppleTarget extends HumanPlayer {
  avalancheHits = 0;
  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (source?.kind === 'environmental' && source.hazard === 'trashAvalanche')
      this.avalancheHits++;
    const connected = super.takeDamage(amount, source);
    this.hp = this.maxHp;
    return connected;
  }
}

interface FreshRoom {
  readonly gameMap: GameMap;
  readonly room: TrashGremlinRoomSystem;
}

function freshRoom(seed: number): FreshRoom | null {
  const { gameMap, levelDef } = generateFloor(1, seed);
  const located = gauntletBossRoom(gameMap, levelDef, TRASH_GREMLIN_BOSS_TYPE);
  if (located === null) return null;
  return { gameMap, room: new TrashGremlinRoomSystem(gameMap, located.bounds) };
}

function frameFor(gameMap: GameMap, human: HumanPlayer, cat: CatPlayer): SystemContext {
  return {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster: new MobRoster(gameMap, new SpellSystem()),
    gameMap,
  };
}

/** Runs a topple to its impact with the crawler either escaping or standing, and says whether it was hit. */
function runTopple(
  seed: number,
  towerIndex: number,
  crawlerEscapes: boolean,
): { hit: boolean; line: readonly TilePoint[]; escapeFrames: number } | null {
  const fresh = freshRoom(seed);
  if (fresh === null) return null;
  const { gameMap, room } = fresh;
  const spawn = room.layout.spawn;
  if (
    !room.startTopple(towerIndex, {
      x: (spawn.x + HALF) * TILE_SIZE,
      y: (spawn.y + HALF) * TILE_SIZE,
    })
  )
    return null;
  const topple = room.activeTopple;
  if (topple === null || topple.line.length === 0) return null;
  const middle = topple.line[Math.floor(topple.line.length / 2)];
  const crawler = new ToppleTarget(middle.x, middle.y, TILE_SIZE);
  const door = room.layout.doorways[0]?.tile ?? spawn;
  const cat = new CatPlayer(door.x, door.y, TILE_SIZE);
  const frame = frameFor(gameMap, crawler, cat);
  const pace = slowestTileSpeedFactor();
  let escapeFrames = 0;
  for (let tick = 0; tick < TOWER_WOBBLE_FRAMES + TOWER_FALL_TICKS; tick++) {
    if (crawlerEscapes) {
      const escape = room.getHazardEscapeVector(crawler.x, crawler.y);
      if (escape !== null) {
        escapeFrames++;
        stepAlongEscape(crawler, escape, pace, (dx, dy) =>
          applyMovement(crawler, { dx, dy, isMobile: true }, gameMap),
        );
      }
    }
    room.update(frame);
  }
  return { hit: crawler.avalancheHits > 0, line: topple.line, escapeFrames };
}

function toppleGates(
  room: TrashGremlinRoomSystem,
  gameMap: GameMap,
  seed: number,
  report: GateReport,
): void {
  const warning = TOWER_WOBBLE_FRAMES + TOWER_FALL_TICKS;
  // Widened to `number`: the check is on the values as they stand, not their literal types.
  const wobble: number = TOWER_WOBBLE_FRAMES;
  if (wobble < LOCKED_TELEGRAPH_MIN_FRAMES) {
    report.fail(
      `a tower rocks ${TOWER_WOBBLE_FRAMES} frames, under the ${LOCKED_TELEGRAPH_MIN_FRAMES}-frame telegraph floor`,
    );
  }
  let worstEscape = 0;
  let lines = 0;
  room.towers.forEach((_, index) => {
    const escaping = runTopple(seed, index, true);
    const standing = runTopple(seed, index, false);
    if (escaping === null || standing === null) return;
    lines++;
    for (const tile of escaping.line) {
      const inside =
        tile.x >= room.bounds.x &&
        tile.y >= room.bounds.y &&
        tile.x < room.bounds.x + room.bounds.w &&
        tile.y < room.bounds.y + room.bounds.h;
      if (!inside || gameMap.structure[tile.y][tile.x].type !== TRASH_GREMLIN_FLOOR) {
        report.fail(
          `tower ${index}'s fall line reaches ${tileKey(tile)}, which is not open lair floor`,
        );
      }
    }
    if (escaping.hit)
      report.fail(
        `tower ${index}: a crawler walking out of its line at the slowest pace is still hit`,
      );
    if (!standing.hit)
      report.fail(
        `tower ${index}: a crawler standing in its line is not hit — the gate cannot see a hit`,
      );
    worstEscape = Math.max(worstEscape, escaping.escapeFrames);
  });
  if (lines === 0) report.fail('no tower has anywhere to fall');
  report.note(
    `topple: ${lines} lines, warning ${warning} frames, slowest escape ${worstEscape} frames`,
  );
}

// ── Checkpoints ──────────────────────────────────────────────────────────────

function towerTypes(room: TrashGremlinRoomSystem, gameMap: GameMap): number[] {
  return room.towers.map((t) => gameMap.structure[t.y][t.x].type);
}

/** Advances a room until its current topple lands. */
function finishTopple(room: TrashGremlinRoomSystem, frame: SystemContext): void {
  for (
    let tick = 0;
    tick < TOWER_WOBBLE_FRAMES + TOWER_FALL_TICKS && room.activeTopple !== null;
    tick++
  ) {
    room.update(frame);
  }
}

function checkpointGates(seed: number, report: GateReport): void {
  const fresh = freshRoom(seed);
  if (fresh === null) return;
  const { gameMap, room } = fresh;
  const door = room.layout.doorways[0]?.tile ?? room.layout.spawn;
  const frame = frameFor(
    gameMap,
    new HumanPlayer(door.x, door.y, TILE_SIZE),
    new CatPlayer(door.x, door.y, TILE_SIZE),
  );
  const from = { x: door.x * TILE_SIZE, y: door.y * TILE_SIZE };
  const standingTypes = towerTypes(room, gameMap);
  const floorSnapshot = gameMap.structure
    .map((row) => row.map((tile) => tile.type).join(','))
    .join('\n');
  const mapUnchanged = (): boolean =>
    gameMap.structure.map((row) => row.map((tile) => tile.type).join(',')).join('\n') ===
    floorSnapshot;
  const allStanding = (): boolean =>
    towerTypes(room, gameMap).every((type, i) => type === standingTypes[i]);
  const noWobble = (): boolean =>
    room.towers.every((t) => gameMap.structure[t.y][t.x].damageStage === undefined);
  const beforeFight = parseTrashGremlinRoomCheckpoint(
    JSON.parse(JSON.stringify(room.captureCheckpoint())),
  );
  if (beforeFight === null || beforeFight === undefined) {
    report.fail('a fresh lair checkpoint does not survive JSON');
    return;
  }

  // Death: a tower down, then rewound through a saved checkpoint.
  room.startTopple(0, from);
  finishTopple(room, frame);
  if (gameMap.structure[room.towers[0].y][room.towers[0].x].type !== TRASH_RUBBLE) {
    report.fail('a finished topple did not leave rubble where the tower stood');
  }
  const afterTopple = parseTrashGremlinRoomCheckpoint(
    JSON.parse(JSON.stringify(room.captureCheckpoint())),
  );
  room.resetForCheckpoint();
  room.restoreCheckpoint(beforeFight);
  if (!allStanding() || !mapUnchanged())
    report.fail('a death does not stand a toppled tower back up and clear its rubble');

  // A save with the tower down, loaded onto a fresh floor.
  const loaded = freshRoom(seed);
  if (afterTopple !== null && afterTopple !== undefined && loaded !== null) {
    loaded.room.restoreCheckpoint(afterTopple);
    const tower = loaded.room.towers[0];
    if (loaded.gameMap.structure[tower.y][tower.x].type !== TRASH_RUBBLE) {
      report.fail('loading a save with a tower down leaves it standing');
    }
  } else {
    report.fail('a checkpoint with a tower down does not survive JSON');
  }

  // Abort: the fight ends with its alive; everything the fight knocked over comes back.
  room.onSeal();
  room.startTopple(0, from);
  finishTopple(room, frame);
  const second = room.towers.length > 1 ? 1 : 0;
  room.startTopple(second, from);
  room.update(frame);
  // Bags burst and cracked mid-fight, the way the breakable-prop system leaves them.
  const bags = room.layout.placements.filter((p) => p.kind === 'bag');
  if (bags.length > 0) {
    const tile = gameMap.structure[bags[0].y][bags[0].x];
    tile.type = tile.groundType ?? TRASH_GREMLIN_FLOOR;
    delete tile.groundType;
  }
  if (bags.length > 1) gameMap.structure[bags[1].y][bags[1].x].damageStage = 1;
  room.update(frame);
  room.onFightAborted();
  if (!allStanding() || !noWobble() || !mapUnchanged())
    report.fail('an abort does not put the lair back as it was at the seal');
  if (bags.some((bag) => gameMap.structure[bag.y][bag.x].damageStage !== undefined)) {
    report.fail('an abort leaves a bag the fight cracked still cracked');
  }

  // Deaths mid-wobble and mid-fall.
  for (const ticks of [TOWER_WOBBLE_FRAMES / 2, TOWER_WOBBLE_FRAMES + TOWER_FALL_TICKS / 2]) {
    room.startTopple(0, from);
    for (let tick = 0; tick < ticks; tick++) room.update(frame);
    room.resetForCheckpoint();
    room.restoreCheckpoint(beforeFight);
    if (!allStanding() || !noWobble() || !mapUnchanged()) {
      report.fail(`a death ${ticks} frames into a topple does not stand the tower back up`);
    }
  }
}

// ── A calm floor ─────────────────────────────────────────────────────────────

/** Tiles on a side of the floor sample; the middle is measured, clear of the walls' grime. */
const FLOOR_SAMPLE_TILES = 12;
const FLOOR_SAMPLE_MARGIN_TILES = 2;
const RED_WEIGHT = 0.299;
const GREEN_WEIGHT = 0.587;
const BLUE_WEIGHT = 0.114;
const RGBA = 4;
/**
 * The most the floor's brightness may vary, as a standard deviation in 0-255
 * luminance, and the most it may change between neighbouring pixels on
 * average. The floor is the backdrop the crawlers and its junk are read
 * against; past these it competes with them, and a checker or a speckle at
 * 32 px is dizzying. The calm floor measures about 4.0 and 0.8; a two-tone
 * checkerboard with speckled grime measured 13.8 and 6.0.
 */
export const FLOOR_MAX_LUMINANCE_STD_DEV = 6;
export const FLOOR_MAX_MEAN_GRADIENT = 1.5;

/** Luminance spread and mean neighbour difference of the lair's bare floor at game size. */
export function measureFloorCalm(): { stdDev: number; meanGradient: number } {
  const grid: TileContent[][] = [];
  for (let y = 0; y < FLOOR_SAMPLE_TILES; y++) {
    const row: TileContent[] = [];
    for (let x = 0; x < FLOOR_SAMPLE_TILES; x++)
      row.push({ tileId: `${x},${y}`, type: TRASH_GREMLIN_FLOOR });
    grid.push(row);
  }
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
  const size = FLOOR_SAMPLE_TILES * TILE_SIZE;
  const canvas = createCanvas(size, size);
  const nodeCtx = canvas.getContext('2d');
  map.renderCanvas(asGameContext(nodeCtx), 0, 0, size, size);
  const inset = FLOOR_SAMPLE_MARGIN_TILES * TILE_SIZE;
  const span = size - inset * 2;
  const { data } = nodeCtx.getImageData(inset, inset, span, span);
  const luminance = new Float64Array(span * span);
  for (let i = 0; i < luminance.length; i++) {
    luminance[i] =
      data[i * RGBA] * RED_WEIGHT +
      data[i * RGBA + 1] * GREEN_WEIGHT +
      data[i * RGBA + 2] * BLUE_WEIGHT;
  }
  const mean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
  const variance =
    luminance.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luminance.length;
  let gradient = 0;
  let pairs = 0;
  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) {
      const here = luminance[y * span + x];
      if (x + 1 < span) {
        gradient += Math.abs(luminance[y * span + x + 1] - here);
        pairs++;
      }
      if (y + 1 < span) {
        gradient += Math.abs(luminance[(y + 1) * span + x] - here);
        pairs++;
      }
    }
  }
  return { stdDev: Math.sqrt(variance), meanGradient: gradient / pairs };
}

function floorCalmGates(report: GateReport): void {
  const { stdDev, meanGradient } = measureFloorCalm();
  report.note(
    `floor: luminance std-dev ${stdDev.toFixed(DECIMALS)} (max ${FLOOR_MAX_LUMINANCE_STD_DEV}), mean gradient ${meanGradient.toFixed(DECIMALS)} (max ${FLOOR_MAX_MEAN_GRADIENT})`,
  );
  if (stdDev > FLOOR_MAX_LUMINANCE_STD_DEV)
    report.fail(
      `the lair's floor varies too much in brightness (std-dev ${stdDev.toFixed(DECIMALS)}): it will compete with everything on it`,
    );
  if (meanGradient > FLOOR_MAX_MEAN_GRADIENT)
    report.fail(
      `the lair's floor is too busy (mean gradient ${meanGradient.toFixed(DECIMALS)}): fine pattern at 32 px reads as noise`,
    );
}

// ── Once per sweep ───────────────────────────────────────────────────────────

/** Boluses fired at each target when measuring the bile's hit rate. */
const BILE_SHOTS = 12;
/** Frames between shots: long enough for a bolus to land before the next. */
const BILE_SHOT_SPACING = 100;
const VOMIT_SPEED = 3.5;
/** How far past an island's far edge the hiding crawler stands. */
const HIDE_BEHIND_TILES = 1.5;
const OPEN_SEARCH_STEPS = 72;
const PERCENT = 100;

/** A crawler who counts bile that reaches it, whether or not a dodge roll spares it. */
class BileTarget extends HumanPlayer {
  reached = 0;
  override takeDamage(amount: number, source?: DamageSource): boolean {
    const isBolus =
      source?.kind === 'mob' && source.mobType === 'TrashGremlin' && source.undodgeable !== true;
    if (isBolus) this.reached++;
    const connected = super.takeDamage(amount, source);
    this.hp = this.maxHp;
    return connected;
  }
}

/** Fires boluses from `from` at a crawler standing at `at`, and returns the share that reached it. */
function bileHitRate(
  side: DoorSide,
  from: { x: number; y: number },
  at: { x: number; y: number },
): { rate: number; poolsOffFloor: number } {
  const fight = stageTrashGremlinFight(side);
  const { trashGremlin, bossRoom, frame } = fight;
  const target = new BileTarget(0, 0, TILE_SIZE);
  target.x = at.x - TILE_SIZE * HALF;
  target.y = at.y - TILE_SIZE * HALF;
  const shooterFrame: SystemContext = { ...frame, human: target, active: target };
  fight.cat.x = target.x;
  fight.cat.y = target.y;
  // Stood aside so the pool rules around its feet cannot swallow the result.
  trashGremlin.x = from.x - TILE_SIZE * HALF;
  trashGremlin.y = from.y - TILE_SIZE * HALF;
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  const length = Math.hypot(dx, dy);
  for (let shot = 0; shot < BILE_SHOTS; shot++) {
    trashGremlin.pendingVomitProjectiles.push({
      x: from.x,
      y: from.y,
      dx: (dx / length) * VOMIT_SPEED,
      dy: (dy / length) * VOMIT_SPEED,
    });
    for (let tick = 0; tick < BILE_SHOT_SPACING; tick++) {
      trashGremlin.x = from.x - TILE_SIZE * HALF;
      trashGremlin.y = from.y - TILE_SIZE * HALF;
      bossRoom.update(shooterFrame);
    }
  }
  const offFloor = bossRoom
    .acidPools()
    .filter(
      (pool) =>
        !fight.frame.gameMap.isWalkable(
          Math.floor(pool.x / TILE_SIZE),
          Math.floor(pool.y / TILE_SIZE),
        ),
    ).length;
  return { rate: target.reached / BILE_SHOTS, poolsOffFloor: offFloor };
}

function bileGates(report: GateReport): void {
  let poolsOffFloor = 0;
  for (const side of DOOR_SIDES) {
    const fight = stageTrashGremlinFight(side);
    const room = fight.dressings.parts.trashGremlin;
    if (room === null) continue;
    const gameMap = fight.frame.gameMap;
    const spawn = room.layout.spawn;
    const from = { x: (spawn.x + HALF) * TILE_SIZE, y: (spawn.y + HALF) * TILE_SIZE };
    let measured = 0;
    room.layout.clusters.forEach((cluster, index) => {
      if (cluster.length === 0) return;
      const cx = (cluster.reduce((sum, t) => sum + t.x, 0) / cluster.length + HALF) * TILE_SIZE;
      const cy = (cluster.reduce((sum, t) => sum + t.y, 0) / cluster.length + HALF) * TILE_SIZE;
      const toIsland = Math.hypot(cx - from.x, cy - from.y);
      const ux = (cx - from.x) / toIsland;
      const uy = (cy - from.y) / toIsland;
      const reach = toIsland + HIDE_BEHIND_TILES * TILE_SIZE;
      const behind = { x: from.x + ux * reach, y: from.y + uy * reach };
      if (
        !gameMap.isWalkable(Math.floor(behind.x / TILE_SIZE), Math.floor(behind.y / TILE_SIZE)) ||
        gameMap.hasWalkableLine(from.x, from.y, behind.x, behind.y)
      ) {
        report.note(`bile ${side} island ${index}: no hiding spot behind it, skipped`);
        return;
      }
      let open: { x: number; y: number } | null = null;
      for (let step = 1; step <= OPEN_SEARCH_STEPS && open === null; step++) {
        const angle = Math.atan2(uy, ux) + (step * Math.PI * 2) / OPEN_SEARCH_STEPS;
        const candidate = {
          x: from.x + Math.cos(angle) * reach,
          y: from.y + Math.sin(angle) * reach,
        };
        if (
          gameMap.isWalkable(
            Math.floor(candidate.x / TILE_SIZE),
            Math.floor(candidate.y / TILE_SIZE),
          ) &&
          gameMap.hasWalkableLine(from.x, from.y, candidate.x, candidate.y)
        ) {
          open = candidate;
        }
      }
      if (open === null) {
        report.note(`bile ${side} island ${index}: no open spot at the same range, skipped`);
        return;
      }
      const behindRun = bileHitRate(side, from, behind);
      const openRun = bileHitRate(side, from, open);
      // Hugging the far side of the heap: the bolus reaches the crawler while
      // still over the junk, which is where a pool could land on a heap.
      const hugging = firstOpenPast(gameMap, from, ux, uy, toIsland);
      const huggingRun = hugging === null ? null : bileHitRate(side, from, hugging);
      measured++;
      poolsOffFloor +=
        behindRun.poolsOffFloor + openRun.poolsOffFloor + (huggingRun?.poolsOffFloor ?? 0);
      const behindRate = behindRun.rate;
      const openRate = openRun.rate;
      report.note(
        `bile ${side} island ${index}: behind ${(behindRate * PERCENT).toFixed(0)}%, open ${(openRate * PERCENT).toFixed(0)}%` +
          (huggingRun === null ? '' : `, hugging ${(huggingRun.rate * PERCENT).toFixed(0)}%`),
      );
      if (openRate === 0) {
        report.fail(
          `bile ${side} island ${index}: no bolus reached a crawler in the open — nothing was measured`,
        );
      }
      if (behindRate < openRate * (1 - COVER_TOLERANCE_SHARE)) {
        report.fail(
          `bile ${side}: a crawler behind island ${index} is hit ${(behindRate * PERCENT).toFixed(0)}% of the time, in the open ${(openRate * PERCENT).toFixed(0)}%`,
        );
      }
    });
    if (measured === 0)
      report.fail(`bile ${side}: no island could be measured, so nothing was checked`);
  }
  if (poolsOffFloor > 0) report.fail(`${poolsOffFloor} acid pools formed over a heap or a wall`);
}

/** How far past a heap's centre the hugging crawler is looked for, in steps along the ray. */
const HUG_SEARCH_STEP_TILES = 0.25;
const HUG_SEARCH_MAX_TILES = 3;

/** The centre of the first open tile past an island along a ray from `from`. */
function firstOpenPast(
  gameMap: GameMap,
  from: { x: number; y: number },
  ux: number,
  uy: number,
  toIsland: number,
): { x: number; y: number } | null {
  let passedJunk = false;
  for (let t = 0; t <= HUG_SEARCH_MAX_TILES; t += HUG_SEARCH_STEP_TILES) {
    const x = from.x + ux * (toIsland + t * TILE_SIZE);
    const y = from.y + uy * (toIsland + t * TILE_SIZE);
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (!gameMap.isWalkable(tx, ty)) {
      passedJunk = true;
      continue;
    }
    if (passedJunk) return { x: (tx + HALF) * TILE_SIZE, y: (ty + HALF) * TILE_SIZE };
  }
  return null;
}

/** How long the crawler stands at the edge of its flee range, on its bed's side. */
const STANDOFF_FRAMES = 600;
/** Just past its flee range: close enough to pull it toward the bed and straight back. */
const STANDOFF_PAST_FLEE_TILES = 0.3;
/** Reversals of its walk allowed in the standoff; a flee-and-return loop makes dozens. */
const STANDOFF_MAX_REVERSALS = 4;

/**
 * A crawler standing still just outside its flee range, between it and its
 * bed. It must not walk at them toward the bed, turn and flee, and walk back:
 * counted as reversals of its walking direction while it is not winding up.
 */
function standoffGates(report: GateReport): void {
  withSeededRandom(SIM_RANDOM_SEEDS[0], () => {
    const fight = stageTrashGremlinFight('south');
    fight.step();
    const bed = fight.trashGremlin.restingPlace;
    if (bed === null) {
      report.fail('standoff: the lair never gave it a bed');
      return;
    }
    const gremlinAt = { x: fight.trashGremlin.x, y: fight.trashGremlin.y };
    const toBed = Math.hypot(bed.x - gremlinAt.x, bed.y - gremlinAt.y);
    if (toBed === 0) {
      report.fail('standoff: it starts on its bed, so the standoff cannot be staged');
      return;
    }
    const reach = (TRASH_GREMLIN_FLEE_RANGE_TILES + STANDOFF_PAST_FLEE_TILES) * TILE_SIZE;
    const stand = {
      x: gremlinAt.x + ((bed.x - gremlinAt.x) / toBed) * reach,
      y: gremlinAt.y + ((bed.y - gremlinAt.y) / toBed) * reach,
    };
    let reversals = 0;
    let lastStep: { dx: number; dy: number } | null = null;
    for (let frame = 0; frame < STANDOFF_FRAMES; frame++) {
      fight.crawler.x = stand.x;
      fight.crawler.y = stand.y;
      const beforeX = fight.trashGremlin.x;
      const beforeY = fight.trashGremlin.y;
      fight.step();
      const dx = fight.trashGremlin.x - beforeX;
      const dy = fight.trashGremlin.y - beforeY;
      if (fight.trashGremlin.vomitProgress !== null || (dx === 0 && dy === 0)) continue;
      if (lastStep !== null && dx * lastStep.dx + dy * lastStep.dy < 0) reversals++;
      lastStep = { dx, dy };
    }
    report.note(`standoff: ${reversals} reversals of its walk in ${STANDOFF_FRAMES} frames`);
    if (reversals > STANDOFF_MAX_REVERSALS) {
      report.fail(
        `standoff: it turned back ${reversals} times against a crawler standing still — it is oscillating between its bed and running`,
      );
    }
  });
}

/**
 * Past the margin it keeps before walking home, still inside its aggro range:
 * the only band where its bed's direction decides whether it walks at the
 * crawler.
 */
const STANDOFF_FAR_TILES = 9.9;
/**
 * Frames the far stand runs: short of its wander timer, so nothing but the
 * walk home can move it.
 */
const STANDOFF_FAR_FRAMES = 280;
/** How far it may drift toward a crawler standing between it and its bed. */
const STANDOFF_MAX_APPROACH_TILES = 0.25;

/**
 * A crawler standing still between it and its bed, past the margin but in
 * its aggro range. It must not walk home through them: the gap to them must
 * not shrink.
 */
function standoffFarGates(report: GateReport): void {
  withSeededRandom(SIM_RANDOM_SEEDS[0], () => {
    const fight = stageTrashGremlinFight('south');
    fight.step();
    const bed = fight.trashGremlin.restingPlace;
    if (bed === null) return;
    const gremlinAt = { x: fight.trashGremlin.x, y: fight.trashGremlin.y };
    const toBed = Math.hypot(bed.x - gremlinAt.x, bed.y - gremlinAt.y);
    if (toBed === 0) return;
    const reach = STANDOFF_FAR_TILES * TILE_SIZE;
    const stand = {
      x: gremlinAt.x + ((bed.x - gremlinAt.x) / toBed) * reach,
      y: gremlinAt.y + ((bed.y - gremlinAt.y) / toBed) * reach,
    };
    let closest = reach;
    for (let frame = 0; frame < STANDOFF_FAR_FRAMES; frame++) {
      fight.crawler.x = stand.x;
      fight.crawler.y = stand.y;
      fight.step();
      const gap = Math.hypot(fight.trashGremlin.x - stand.x, fight.trashGremlin.y - stand.y);
      closest = Math.min(closest, gap);
    }
    const approach = (reach - closest) / TILE_SIZE;
    report.note(
      `standoff far: it closed ${approach.toFixed(2)} tiles on a crawler between it and its bed`,
    );
    if (approach > STANDOFF_MAX_APPROACH_TILES) {
      report.fail(
        `standoff far: it walked ${approach.toFixed(2)} tiles toward a crawler standing between it and its bed`,
      );
    }
  });
}

/** How long the enraged cap run lasts: long enough for several purges and every bag. */
const CAP_RUN_FRAMES = 3600;
const BAG_BURST_EVERY_FRAMES = 240;
/** Takes the gremlin well past its enrage line, so the run tests the enraged cap. */
const CAP_RUN_DAMAGE_FRACTION = 0.75;

function capGates(report: GateReport): void {
  const fight = stageTrashGremlinFight('south');
  const room = fight.dressings.parts.trashGremlin;
  if (room === null) {
    report.fail('caps: the staged fight has no lair, so no cap, hatch-site or fly gate ran');
    return;
  }
  const gameMap = fight.frame.gameMap;
  // Walked in and set down beside the island nearest the door, so the heaps are in hatching range.
  const firstCluster = room.layout.clusters.find((cluster) => cluster.length > 0) ?? [];
  const perch = firstCluster.length > 0 ? firstCluster[0] : room.layout.spawn;
  const standAt =
    [
      { x: perch.x + 1, y: perch.y },
      { x: perch.x - 1, y: perch.y },
      { x: perch.x, y: perch.y + 1 },
      { x: perch.x, y: perch.y - 1 },
    ].find((t) => gameMap.isWalkable(t.x, t.y)) ?? room.layout.spawn;
  fight.crawler.x = standAt.x * TILE_SIZE;
  fight.crawler.y = standAt.y * TILE_SIZE;
  const trashGremlin = fight.trashGremlin;
  trashGremlin.takeDamageFrom(Math.ceil(trashGremlin.hp * CAP_RUN_DAMAGE_FRACTION), null, null);
  let maxRoaches = 0;
  let maxCap = 0;
  let rustlesSeen = 0;
  const bags = room.layout.placements.filter((p) => p.kind === 'bag');
  const bagTiles = new Set(bags.map(tileKey));
  const seenRoaches = new Set<Cockroach>();
  const strayHatches: string[] = [];
  let hatchesChecked = 0;
  for (let tick = 0; tick < CAP_RUN_FRAMES && trashGremlin.isAlive; tick++) {
    if (tick % BAG_BURST_EVERY_FRAMES === 0) {
      const bag = bags.shift();
      if (bag !== undefined) {
        const tile = gameMap.structure[bag.y][bag.x];
        tile.type = tile.groundType ?? TRASH_GREMLIN_FLOOR;
        delete tile.groundType;
        gameMap.markTileDirty(bag.x, bag.y);
      }
    }
    fight.step();
    const gremlinTile = tileOfBody(trashGremlin);
    let live = 0;
    for (const mob of fight.roster.mobs) {
      if (!(mob instanceof Cockroach) || !mob.isAlive) continue;
      live++;
      if (seenRoaches.has(mob)) continue;
      seenRoaches.add(mob);
      hatchesChecked++;
      const stray = strayHatchReason(gameMap, bagTiles, tileOfBody(mob), gremlinTile);
      if (stray !== null) strayHatches.push(stray);
    }
    maxRoaches = Math.max(maxRoaches, live);
    maxCap = Math.max(maxCap, trashGremlin.cockroachCap);
    rustlesSeen = Math.max(rustlesSeen, room.liveRustles);
  }
  report.note(
    `caps: most roaches alive ${maxRoaches} (cap ${maxCap}), most heaps rustling at once ${rustlesSeen}`,
  );
  if (maxRoaches > maxCap)
    report.fail(`${maxRoaches} roaches alive at once, over its cap of ${maxCap}`);
  if (rustlesSeen === 0) report.fail('no heap ever hatched a roach — the nests are not being used');
  report.note(
    `hatch sites: ${hatchesChecked} roaches checked, ${strayHatches.length} away from the junk`,
  );
  if (hatchesChecked === 0) report.fail('hatch sites: no roach appeared, so none was checked');
  for (const stray of strayHatches) report.fail(`hatch sites: ${stray}`);

  // Flies: whatever the room, never more specks than the cap.
  const canvas = createCanvas(
    gameMap.structure[0].length * TILE_SIZE,
    gameMap.structure.length * TILE_SIZE,
  );
  const nodeCtx = canvas.getContext('2d');
  const counter = new DrawCallCounter(nodeCtx);
  counter.counting = true;
  room.renderAbove(asGameContext(nodeCtx), 0, 0);
  const specks = counter.counts.fillRect;
  // Each fly is a speck and, on alternate beats, a wing.
  if (specks > MAX_FLIES * 2)
    report.fail(`${specks} fly rectangles in a frame, over the ${MAX_FLIES}-fly cap`);
}

function tileOfBody(body: { x: number; y: number }): TilePoint {
  return {
    x: Math.floor((body.x + TILE_SIZE * HALF) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * HALF) / TILE_SIZE),
  };
}

const NEIGHBOUR_STEPS: readonly TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Why a roach's first tile is not a place the junk could have let it out, or
 * null when it is. A pile releases onto an open tile beside it; a garbage bag
 * that bursts leaves its own tile open and the roach comes out there, so a
 * bag's tile counts whether the bag still stands or not. A roach on the
 * gremlin's own tile is never right, whatever junk is beside it.
 */
function strayHatchReason(
  gameMap: GameMap,
  bagTiles: ReadonlySet<string>,
  tile: TilePoint,
  gremlinTile: TilePoint,
): string | null {
  if (tile.x === gremlinTile.x && tile.y === gremlinTile.y)
    return `a roach appeared at ${tileKey(tile)}, on the gremlin itself`;
  if (!gameMap.isWalkable(tile.x, tile.y))
    return `a roach appeared at ${tileKey(tile)}, which is not open floor`;
  if (bagTiles.has(tileKey(tile))) return null;
  const besideJunk = NEIGHBOUR_STEPS.some((step) => {
    const next = { x: tile.x + step.x, y: tile.y + step.y };
    const type = gameMap.structure[next.y]?.[next.x]?.type;
    return type === TRASH_PILE || type === TRASH_BAG || bagTiles.has(tileKey(next));
  });
  return besideJunk ? null : `a roach appeared at ${tileKey(tile)}, beside no trash pile or bag`;
}

function fightGates(report: GateReport): void {
  for (const side of DOOR_SIDES) {
    const measured = measureTrashGremlinSide(side);
    report.note(
      `fight ${side}: time-to-kill s ${measured.fight.timeToKillSeconds.toFixed(DECIMALS)}, ` +
        `attacks/min ${measured.fight.attacksPerMinute.toFixed(DECIMALS)}, ` +
        `hits on crawler ${measured.fight.hitsOnCrawler.toFixed(DECIMALS)}, ` +
        `room hazard hits ${measured.fight.roomHazardHits.toFixed(DECIMALS)}, unfinished ${measured.unfinishedFights}`,
    );
    if (measured.unfinishedFights > 0)
      report.fail(`fight ${side}: ${measured.unfinishedFights} fights never finished`);
  }
}

let sweepGatesRun = false;

/** The lair's gates for one generated floor, and the once-per-sweep sims on the first. */
export function trashGremlinRoomGates(context: RoomGateContext): void {
  const { seed, report } = context;
  const fresh = freshRoom(seed);
  if (fresh === null) {
    report.fail('the lair could not be rebuilt from its seed');
    return;
  }
  layoutGates(fresh.room, fresh.gameMap, report);
  toppleGates(fresh.room, fresh.gameMap, seed, report);
  checkpointGates(seed, report);
  if (sweepGatesRun) return;
  sweepGatesRun = true;
  floorCalmGates(report);
  standoffGates(report);
  standoffFarGates(report);
  // The long sims can be skipped while iterating on the per-floor gates.
  if (process.env.TRASH_GREMLIN_SKIP_SIMS === '1') return;
  bileGates(report);
  capGates(report);
  fightGates(report);
}
