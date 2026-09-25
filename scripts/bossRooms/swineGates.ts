/**
 * The Iron Colosseum's own gates: the things about the round room that only a
 * simulation can show — that the art and the tiles agree, that a crawler
 * slides round the curve, that a charging Tuskling still stops on it, that mud
 * never traps a crawler under the ball, that the cages keep to their caps, that
 * the room rewinds with a death, and that none of it made the fight easier.
 */

import { createCanvas } from 'canvas';

import { TILE_SIZE } from '../../src/core/constants.js';
import { DIFFICULTY_PROFILES } from '../../src/core/difficultyProfiles.js';
import {
  BallOfSwine,
  LUNGE_RANGE_TILES,
  TRAMPLE_RANGE_TILES,
} from '../../src/creatures/BallOfSwine.js';
import { HumanPlayer } from '../../src/creatures/HumanPlayer.js';
import { Tuskling } from '../../src/creatures/Tuskling.js';
import { level2 } from '../../src/levels/level2.js';
import { spawnExtraMobs } from '../../src/levels/spawner.js';
import {
  ARENA_CONCOURSE_REACH,
  ARENA_DOOR_COLUMN_OFFSETS,
  ARENA_RADIUS,
} from '../../src/map/arenaGeometry.js';
import type { GameMap } from '../../src/map/GameMap.js';
import { ARENA_FLOOR, ARENA_MUD } from '../../src/map/tileTypes.js';
import { buildColosseumDressing } from '../../src/systems/bossRooms/BossRoomDressings.js';
import {
  CAGE_RELEASE_MAX,
  COLOSSEUM_MUD_WALLOWS,
  parseColosseumDressingCheckpoint,
  type ColosseumDressingCheckpoint,
} from '../../src/systems/bossRooms/ColosseumDressingSystem.js';
import { PORTCULLIS_FRAMES } from '../../src/sprites/art/colosseumArt.js';
import {
  COLOSSEUM_FOOTING_RADIUS_TILES,
  colosseumRimCoversTile,
} from '../../src/map/tiles/bossRooms/colosseumGeometry.js';
import { liveShedTusklings, SHED_MAX_ALIVE } from '../../src/systems/ArenaSystem.js';
import { applyMovement } from '../../src/systems/GameLoopPhases.js';
import { ARENA_SLIDE_LIMIT_PX, clampIntoDrum } from '../../src/systems/bossRooms/colosseumSlide.js';
import { asGameContext } from '../nodeGameContext.js';
import type { GateReport, RoomEnvironment } from './harness.js';
import { SLAM_WINDOW_FRAMES, SWINE_SIM_PARTY_LEVEL, runSwineFight } from './swineFight.js';

const HALF_TILE = TILE_SIZE / 2;
const HALF = 0.5;
/** The most offenders a failure lists; the rest are the same fault. */
const MAX_LISTED = 8;
const FULL_TURN = Math.PI * 2;

/** Bearings round the drum each rim test is run at. */
export const RIM_BEARINGS = 32;

// ── Sliding round the curve ─────────────────────────────────────────────────

/** How long a crawler holds its direction against the wall. */
const SLIDE_FRAMES = 150;
/** The directions held, relative to straight out: into the wall at a slant, both ways round. */
const STEEP_SLANT_RADIANS = 1.05;
const SHALLOW_SLANT_RADIANS = 0.52;
const SLIDE_SLANTS: readonly number[] = [
  STEEP_SLANT_RADIANS,
  -STEEP_SLANT_RADIANS,
  SHALLOW_SLANT_RADIANS,
  -SHALLOW_SLANT_RADIANS,
];
/** Below this share of its input running along the wall, a crawler has arrived rather than stuck. */
const SLIDE_MIN_TANGENT_SHARE = 0.25;
/** A frame that covers less than this share of the along-wall pace it asked for is stuck. */
const SLIDE_MIN_PROGRESS_SHARE = 0.25;
/** Where the crawler starts: just inside the curve. */
const SLIDE_START_INSET_PX = 2;
/** A body stands where its collision anchor — the middle of its tile-sized box — stands. */
const ANCHOR_OFFSET = 0.5;

export interface SlideResult {
  readonly stuckFrames: number;
  readonly wallEntries: number;
  readonly runs: number;
}

function standsOnWalkable(map: GameMap, body: { x: number; y: number }): boolean {
  return map.isWalkable(
    Math.floor((body.x + ANCHOR_OFFSET * TILE_SIZE) / TILE_SIZE),
    Math.floor((body.y + ANCHOR_OFFSET * TILE_SIZE) / TILE_SIZE),
  );
}

/**
 * Holds a crawler against the wall at every bearing, slanted both ways, and
 * counts the frames it stops while it is still asking to move along the wall,
 * and the frames any of its collision probes stands on a wall tile.
 *
 * The door's own columns are skipped: the clamp leaves them to the tiles.
 */
export function simulateRimSlide(map: GameMap, clampOn = true): SlideResult {
  const arena = map.arenaExteriors[0];
  const centreX = arena.centre.x * TILE_SIZE;
  const centreY = arena.centre.y * TILE_SIZE;
  let stuckFrames = 0;
  let wallEntries = 0;
  let runs = 0;
  for (let index = 0; index < RIM_BEARINGS; index++) {
    const bearing = (index / RIM_BEARINGS) * FULL_TURN;
    for (const slant of SLIDE_SLANTS) {
      runs++;
      const start = ARENA_SLIDE_LIMIT_PX - SLIDE_START_INSET_PX;
      const crawler = new HumanPlayer(0, 0, TILE_SIZE);
      crawler.x = centreX + Math.cos(bearing) * start;
      crawler.y = centreY + Math.sin(bearing) * start;
      const heading = bearing + slant;
      const input = { dx: Math.cos(heading), dy: Math.sin(heading), isMobile: true };
      for (let frame = 0; frame < SLIDE_FRAMES; frame++) {
        const before = { x: crawler.x, y: crawler.y };
        applyMovement(crawler, input, map, 'sole');
        if (clampOn) clampIntoDrum(crawler, arena.centre, map);
        const offX = before.x + HALF_TILE - (centreX + HALF_TILE);
        const offY = before.y + HALF_TILE - (centreY + HALF_TILE);
        const radius = Math.hypot(offX, offY);
        const inDoorColumns = offY > 0 && Math.abs(offX + HALF_TILE) <= TILE_SIZE;
        if (!standsOnWalkable(map, crawler)) wallEntries++;
        if (radius === 0 || inDoorColumns) continue;
        const tangentShare = Math.abs((input.dx * offY - input.dy * offX) / radius);
        if (tangentShare < SLIDE_MIN_TANGENT_SHARE) break;
        const moved = Math.hypot(crawler.x - before.x, crawler.y - before.y);
        const wanted = crawler.speedMultiplier * tangentShare;
        if (moved < wanted * SLIDE_MIN_PROGRESS_SHARE) stuckFrames++;
      }
    }
  }
  return { stuckFrames, wallEntries, runs };
}

// ── Walking in from the concourse ───────────────────────────────────────────

/** Frames a crawler walks straight at the drum from the concourse. */
const CONCOURSE_WALK_FRAMES = 90;
/** Where the walk starts: the middle of the concourse ring, in tiles past the wall's outer edge. */
const CONCOURSE_MIDDLE_TILES = 1.5;
const CONCOURSE_START_TILES = ARENA_RADIUS + CONCOURSE_MIDDLE_TILES;
/** The most a single frame's step can carry a crawler, with slack; anything more was a teleport. */
const MAX_STEP_PX = 4;

export interface ConcourseWalk {
  readonly runs: number;
  /** Frames the clamp moved a crawler who was not standing on the drum's floor. */
  readonly clampsOutside: number;
  /** Frames a crawler moved further than a step could carry it. */
  readonly jumps: number;
}

/**
 * Walks a crawler from the concourse straight at the drum's middle from every
 * bearing, through the real movement code and the clamp, and counts every
 * frame the clamp touched a crawler standing anywhere but the drum's own floor,
 * and every frame a crawler moved further than one step. The wall is between
 * them and the drum; the clamp must never carry anyone through it.
 */
export function simulateConcourseWalks(map: GameMap): ConcourseWalk {
  const arena = map.arenaExteriors[0];
  let runs = 0;
  let clampsOutside = 0;
  let jumps = 0;
  for (let index = 0; index < RIM_BEARINGS; index++) {
    const bearing = (index / RIM_BEARINGS) * FULL_TURN;
    const crawler = new HumanPlayer(0, 0, TILE_SIZE);
    crawler.x = (arena.centre.x + Math.cos(bearing) * CONCOURSE_START_TILES) * TILE_SIZE;
    crawler.y = (arena.centre.y + Math.sin(bearing) * CONCOURSE_START_TILES) * TILE_SIZE;
    if (!standsOnWalkable(map, crawler)) continue;
    runs++;
    const input = { dx: -Math.cos(bearing), dy: -Math.sin(bearing), isMobile: true };
    for (let frame = 0; frame < CONCOURSE_WALK_FRAMES; frame++) {
      const before = { x: crawler.x, y: crawler.y };
      applyMovement(crawler, input, map, 'sole');
      const moved = { x: crawler.x, y: crawler.y };
      const clamp = clampIntoDrum(crawler, arena.centre, map);
      const onDrumFloor = isDrumFloor(map, moved);
      if (clamp.pulledPx > 0 && !onDrumFloor) clampsOutside++;
      if (Math.hypot(crawler.x - before.x, crawler.y - before.y) > MAX_STEP_PX) jumps++;
    }
  }
  return { runs, clampsOutside, jumps };
}

function isDrumFloor(map: GameMap, body: { x: number; y: number }): boolean {
  const type =
    map.structure[Math.floor((body.y + ANCHOR_OFFSET * TILE_SIZE) / TILE_SIZE)]?.[
      Math.floor((body.x + ANCHOR_OFFSET * TILE_SIZE) / TILE_SIZE)
    ]?.type;
  return type === ARENA_FLOOR || type === ARENA_MUD;
}

export function reportConcourse(report: GateReport, walk: ConcourseWalk): void {
  report.note(
    `concourse walk-ins: ${walk.clampsOutside} clamps outside the drum, ${walk.jumps} jumps over ${walk.runs} runs`,
  );
  if (walk.runs === 0) report.fail('no walk from the concourse started on walkable ground');
  if (walk.clampsOutside > 0) {
    report.fail(
      `the drum's clamp moved a crawler standing outside it on ${walk.clampsOutside} frames`,
    );
  }
  if (walk.jumps > 0)
    report.fail(`a crawler walking in from the concourse jumped on ${walk.jumps} frames`);
}

// ── The concourse ring stays one piece ──────────────────────────────────────

export interface ConcourseConnectivity {
  readonly walkableConcourseTiles: number;
  readonly orphanedTiles: number;
}

/**
 * Floods the live map from the arena's door tile and checks every walkable
 * concourse tile is still reachable from it.
 *
 * This is the one check here that runs against the built `GameMap` rather than
 * against the generator's own room graph, on purpose: a runtime block flag (the
 * colosseum rim's collision fix in `GameMap.blockColosseumRimOverhang`, or
 * anything future that permanently blocks a tile after generation) is invisible
 * to `verify:progression`'s room-graph model, which only ever sees the tiles
 * the generator itself laid down. A grid validator cannot see a runtime block
 * flag — only a walk of the live map, `isWalkable` and all, can catch one that
 * happens to sever the ring.
 */
export function checkConcourseConnectivity(map: GameMap): ConcourseConnectivity {
  if (map.arenaExteriors.length === 0) return { walkableConcourseTiles: 0, orphanedTiles: 0 };
  const arena = map.arenaExteriors[0];
  const centre = arena.centre;

  const concourseTiles: Array<{ x: number; y: number }> = [];
  for (let dy = -ARENA_CONCOURSE_REACH; dy <= ARENA_CONCOURSE_REACH; dy++) {
    for (let dx = -ARENA_CONCOURSE_REACH; dx <= ARENA_CONCOURSE_REACH; dx++) {
      const rad = Math.hypot(dx, dy);
      if (rad <= ARENA_RADIUS || rad > ARENA_CONCOURSE_REACH) continue;
      concourseTiles.push({ x: centre.x + dx, y: centre.y + dy });
    }
  }
  const walkableConcourseTiles = concourseTiles.filter((t) => map.isWalkable(t.x, t.y));

  const key = (x: number, y: number): number => y * CONCOURSE_FLOOD_KEY_STRIDE + x;
  const reachable = new Set<number>([key(arena.doorTile.x, arena.doorTile.y)]);
  const stack: Array<{ x: number; y: number }> = [arena.doorTile];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const k = key(nx, ny);
      if (reachable.has(k) || !map.isWalkable(nx, ny)) continue;
      reachable.add(k);
      stack.push({ x: nx, y: ny });
    }
  }

  const orphanedTiles = walkableConcourseTiles.filter((t) => !reachable.has(key(t.x, t.y))).length;
  return { walkableConcourseTiles: walkableConcourseTiles.length, orphanedTiles };
}

/** Larger than any generated map dimension, so the flood's keys never collide. */
const CONCOURSE_FLOOD_KEY_STRIDE = 100000;
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function reportConcourseConnectivity(
  report: GateReport,
  connectivity: ConcourseConnectivity,
): void {
  report.note(
    `concourse connectivity: ${connectivity.walkableConcourseTiles} walkable ring tiles, ` +
      `${connectivity.orphanedTiles} unreachable from the door`,
  );
  if (connectivity.orphanedTiles > 0) {
    report.fail(
      `${connectivity.orphanedTiles} walkable concourse tiles are cut off from the arena door`,
    );
  }
}

// ── Art and collision agree on the rim's overhang ───────────────────────────

export interface RimPaintAgreement {
  readonly concourseTilesChecked: number;
  /** Walkable tiles the rim's iron, shadow or crowd still paints over — a collision bug, not decoration. */
  readonly paintedButWalkable: number;
}

/**
 * Checks every concourse tile against `colosseumRimCoversTile` — the same
 * predicate both `GameMap.blockColosseumRimOverhang` (collision) and
 * `drawColosseumRim` (the painter) call — and fails if a tile it says the rim
 * paints over is nonetheless walkable. The two sides share one function
 * precisely so this can never happen, but a future edit to either the block
 * flags or the painter that stops calling it would still leave the picture and
 * the ground crawlers can stand on in agreement; this is what would catch it.
 */
export function checkRimPaintAgreement(map: GameMap): RimPaintAgreement {
  if (map.arenaExteriors.length === 0) return { concourseTilesChecked: 0, paintedButWalkable: 0 };
  const centre = map.arenaExteriors[0].centre;

  let concourseTilesChecked = 0;
  let paintedButWalkable = 0;
  for (let dy = -ARENA_CONCOURSE_REACH; dy <= ARENA_CONCOURSE_REACH; dy++) {
    for (let dx = -ARENA_CONCOURSE_REACH; dx <= ARENA_CONCOURSE_REACH; dx++) {
      const rad = Math.hypot(dx, dy);
      if (rad <= ARENA_RADIUS || rad > ARENA_CONCOURSE_REACH) continue;
      concourseTilesChecked++;
      if (!colosseumRimCoversTile(dx, dy)) continue;
      if (map.isWalkable(centre.x + dx, centre.y + dy)) paintedButWalkable++;
    }
  }
  return { concourseTilesChecked, paintedButWalkable };
}

export function reportRimPaintAgreement(report: GateReport, agreement: RimPaintAgreement): void {
  report.note(
    `rim paint vs collision: ${agreement.concourseTilesChecked} concourse tiles checked, ` +
      `${agreement.paintedButWalkable} painted but walkable`,
  );
  if (agreement.paintedButWalkable > 0) {
    report.fail(
      `${agreement.paintedButWalkable} walkable concourse tiles still have the rim's iron, ` +
        'shadow or crowd painted over them',
    );
  }
}

// ── A Tuskling charging the curve ───────────────────────────────────────────

/** How far inside the curve a charging Tuskling starts, so it is at full tilt when it arrives. */
const CHARGE_START_INSET_TILES = 1.5;
/** The frames a charge lasts; read from the Tuskling so the gate cannot drift from it. */
const CHARGE_FRAMES_READ = 'chargeTimer';
/** A charge long enough to reach the wall from where the gate starts it. */
const CHARGE_TIMER_FOR_GATE = 22;
/** Half the door's width plus a body, the span of bearings that leads out through it. */
const DOOR_HALF_SPAN_TILES = 1.5;
const DOOR_HALF_SPAN_PX = TILE_SIZE * DOOR_HALF_SPAN_TILES;
/** The state a charge ends in, bonked or not; a bonk reaches it with time still on the charge. */
const BONK_STATE = 'cooldown';

export interface ChargeResult {
  readonly bonked: number;
  readonly wallEntries: number;
  readonly runs: number;
}

/**
 * Sends a Tuskling charging straight at the wall from every bearing and counts
 * how many runs end in the bonk — the charge cut short against the iron — and
 * how many frames it stood on a wall tile.
 *
 * The charge is set up through the Tuskling's own fields rather than by baiting
 * it, because no target can stand beyond the wall in its line of sight.
 */
export function simulateTusklingCharges(map: GameMap): ChargeResult {
  const arena = map.arenaExteriors[0];
  const centreX = arena.centre.x * TILE_SIZE;
  const centreY = arena.centre.y * TILE_SIZE;
  let bonked = 0;
  let wallEntries = 0;
  let runs = 0;
  for (let index = 0; index < RIM_BEARINGS; index++) {
    const bearing = (index / RIM_BEARINGS) * FULL_TURN;
    const dx = Math.cos(bearing);
    const dy = Math.sin(bearing);
    // The door's columns lead out through the door, not into iron.
    if (dy > 0 && Math.abs(dx) * ARENA_SLIDE_LIMIT_PX < DOOR_HALF_SPAN_PX) continue;
    runs++;
    const start = ARENA_SLIDE_LIMIT_PX - CHARGE_START_INSET_TILES * TILE_SIZE;
    const tusk = new Tuskling(0, 0, TILE_SIZE);
    tusk.setMap(map);
    tusk.x = centreX + dx * start;
    tusk.y = centreY + dy * start;
    Reflect.set(tusk, 'state', 'charging');
    Reflect.set(tusk, 'chargeDx', dx);
    Reflect.set(tusk, 'chargeDy', dy);
    Reflect.set(tusk, CHARGE_FRAMES_READ, CHARGE_TIMER_FOR_GATE);
    for (let frame = 0; frame < CHARGE_TIMER_FOR_GATE; frame++) {
      tusk.updateAI([]);
      if (!standsOnWalkable(map, tusk)) wallEntries++;
      if (Reflect.get(tusk, 'state') === BONK_STATE) {
        // Only a bonk ends the charge before its timer does.
        if (Number(Reflect.get(tusk, CHARGE_FRAMES_READ)) > 0) bonked++;
        break;
      }
    }
  }
  return { bonked, wallEntries, runs };
}

// ── Report helpers ──────────────────────────────────────────────────────────

export function reportRim(report: GateReport, slide: SlideResult, charges: ChargeResult): void {
  report.note(
    `rim slide: ${slide.stuckFrames} stuck frames, ${slide.wallEntries} wall entries over ${slide.runs} runs`,
  );
  if (slide.runs === 0) report.fail('the rim slide ran no bearings');
  if (slide.stuckFrames > 0) {
    report.fail(`a crawler sliding round the drum stuck on ${slide.stuckFrames} frames`);
  }
  if (slide.wallEntries > 0) {
    report.fail(
      `a crawler sliding round the drum stood on a wall tile for ${slide.wallEntries} frames`,
    );
  }
  report.note(`tuskling charges: ${charges.bonked} of ${charges.runs} bonked on the curve`);
  if (charges.runs === 0) report.fail('no Tuskling charge was run at the curve');
  if (charges.bonked < charges.runs) {
    report.fail(`only ${charges.bonked} of ${charges.runs} Tuskling charges bonked on the curve`);
  }
  if (charges.wallEntries > 0) {
    report.fail(`a charging Tuskling stood on a wall tile for ${charges.wallEntries} frames`);
  }
}

// ── Paint agrees with collision ─────────────────────────────────────────────

/**
 * How far from a tile's centre the check samples, toward the tile's own side
 * of the ring's edge, in pixels. The edge is painted a fiftieth of a tile from
 * the nearest centres on either side — under a pixel at the game's scale — so
 * a centre sampled dead on reads the edge's antialiasing, not either material.
 * A pixel in, the edge must still be on the right side of every tile, so a ring
 * painted a pixel too far either way still fails.
 */
const PAINT_PROBE_INSET_PX = 1;
/** Sand and mud: warm — never blue- or green-leaning — and dark. */
const SAND_MAX_LIGHTNESS = 105;
const RGBA = 4;
const RGB_CHANNELS = 3;
const GREEN = 1;
const BLUE = 2;
/** The outermost ring of tiles the check covers: the wall's outer edge. */
const PAINT_REACH_TILES = ARENA_RADIUS;

function readsAsSand(r: number, g: number, b: number): boolean {
  const lightness = (r + g + b) / RGB_CHANNELS;
  return r >= g && g >= b && r > b && lightness <= SAND_MAX_LIGHTNESS;
}

export interface PaintAgreement {
  readonly floorChecked: number;
  readonly wallChecked: number;
  readonly rimChecked: number;
  readonly floorWrong: readonly string[];
  readonly wallWrong: readonly string[];
  /** Bearings where a crawler's reach ends on iron, or where iron starts too far past it. */
  readonly rimWrong: readonly string[];
}

/** Bearings the rim is read along. */
const RIM_PAINT_BEARINGS = 360;
/** The furthest past a held crawler's shoulder the first iron may start, in pixels. */
const FIRST_IRON_SLACK_PX = 4;

/**
 * Renders the ring's baked tiles at the game's own scale, as the chunk cache
 * does, and holds the picture to the tiles and to the clamp:
 *
 * - every wall tile reads as iron at its centre;
 * - every floor tile a crawler can reach the middle of reads as sand or mud;
 * - along every bearing, the farthest a held crawler's shoulder reaches is
 *   still sand, and the iron starts within `FIRST_IRON_SLACK_PX` beyond it —
 *   no strip of sand the art offers and the clamp withholds.
 *
 * The door's own opening is left out: it is the passage, which is neither.
 */
export function checkPaintAgreement(map: GameMap): PaintAgreement {
  const arena = map.arenaExteriors[0];
  const reach = PAINT_REACH_TILES + 1;
  const originX = (arena.centre.x - reach) * TILE_SIZE;
  const originY = (arena.centre.y - reach) * TILE_SIZE;
  const size = (reach * 2 + 1) * TILE_SIZE;
  const canvas = createCanvas(size, size);
  const nodeCtx = canvas.getContext('2d');
  map.renderCanvas(asGameContext(nodeCtx), originX, originY, size, size);
  const { data } = nodeCtx.getImageData(0, 0, size, size);
  const sandAt = (px: number, py: number): boolean => {
    const index = (Math.floor(py) * size + Math.floor(px)) * RGBA;
    return readsAsSand(data[index], data[index + GREEN], data[index + BLUE]);
  };
  const middle = reach * TILE_SIZE + HALF_TILE;
  const shoulderPx = COLOSSEUM_FOOTING_RADIUS_TILES * TILE_SIZE;

  const floorWrong: string[] = [];
  const wallWrong: string[] = [];
  let floorChecked = 0;
  let wallChecked = 0;
  for (let dy = -PAINT_REACH_TILES; dy <= PAINT_REACH_TILES; dy++) {
    for (let dx = -PAINT_REACH_TILES; dx <= PAINT_REACH_TILES; dx++) {
      const radius = Math.hypot(dx, dy);
      if (radius === 0 || radius > PAINT_REACH_TILES) continue;
      const walkable = map.isWalkable(arena.centre.x + dx, arena.centre.y + dy);
      const inDoorColumns = dy > 0 && ARENA_DOOR_COLUMN_OFFSETS.includes(dx);
      if (walkable && inDoorColumns) continue;
      // A floor tile whose middle lies past the held circle is iron by design:
      // no crawler can stand there, and the rim check below covers its edge.
      if (walkable && radius * TILE_SIZE > shoulderPx - PAINT_PROBE_INSET_PX) continue;
      const inset = walkable ? -PAINT_PROBE_INSET_PX : PAINT_PROBE_INSET_PX;
      const sand = sandAt(
        middle + dx * TILE_SIZE + (dx / radius) * inset,
        middle + dy * TILE_SIZE + (dy / radius) * inset,
      );
      const where = `(${dx},${dy})`;
      if (walkable) {
        floorChecked++;
        if (!sand) floorWrong.push(where);
      } else {
        wallChecked++;
        if (sand) wallWrong.push(where);
      }
    }
  }

  const rimWrong: string[] = [];
  let rimChecked = 0;
  const doorLeftPx = (Math.min(...ARENA_DOOR_COLUMN_OFFSETS) - HALF) * TILE_SIZE;
  const doorRightPx = (Math.max(...ARENA_DOOR_COLUMN_OFFSETS) + HALF) * TILE_SIZE;
  for (let index = 0; index < RIM_PAINT_BEARINGS; index++) {
    const bearing = (index / RIM_PAINT_BEARINGS) * FULL_TURN;
    const dirX = Math.cos(bearing);
    const dirY = Math.sin(bearing);
    const offX = dirX * shoulderPx;
    const offY = dirY * shoulderPx;
    if (offY > 0 && offX >= doorLeftPx && offX <= doorRightPx) continue;
    rimChecked++;
    const along = (distance: number): boolean =>
      sandAt(middle + dirX * distance, middle + dirY * distance);
    if (!along(shoulderPx - PAINT_PROBE_INSET_PX)) {
      rimWrong.push(`${index}°: iron inside the reach`);
      continue;
    }
    let ironFound = false;
    for (let step = 0; step <= FIRST_IRON_SLACK_PX; step++) {
      if (!along(shoulderPx + step)) {
        ironFound = true;
        break;
      }
    }
    if (!ironFound) rimWrong.push(`${index}°: sand past the reach`);
  }
  return { floorChecked, wallChecked, rimChecked, floorWrong, wallWrong, rimWrong };
}

export function reportPaint(report: GateReport, paint: PaintAgreement): void {
  report.note(
    `paint vs tiles: ${paint.floorChecked} floor and ${paint.wallChecked} wall centres, ` +
      `${paint.rimChecked} rim bearings checked`,
  );
  if (paint.floorChecked === 0 || paint.wallChecked === 0 || paint.rimChecked === 0) {
    report.fail('the paint check found no floor, no wall or no rim to sample');
  }
  if (paint.floorWrong.length > 0) {
    report.fail(
      `walkable tiles painted as iron at ${paint.floorWrong.slice(0, MAX_LISTED).join(' ')}`,
    );
  }
  if (paint.wallWrong.length > 0) {
    report.fail(`wall tiles painted as sand at ${paint.wallWrong.slice(0, MAX_LISTED).join(' ')}`);
  }
  if (paint.rimWrong.length > 0) {
    report.fail(
      `${paint.rimWrong.length} bearings where the art and the clamp disagree: ` +
        paint.rimWrong.slice(0, MAX_LISTED).join(', '),
    );
  }
}

// ── Escaping the trample from the mud ───────────────────────────────────────

/** Bearings the ball's committed line is tried from, at every mud tile. */
const CHORD_BEARINGS = 16;
/** Frames a crawler is given to get clear; longer than any committed charge takes. */
const CHORD_FRAMES = 90;

export interface MudEscape {
  readonly trials: number;
  readonly caught: number;
  /** Tightest clearance any escape kept from the trample's reach, in pixels. */
  readonly tightestMarginPx: number;
  readonly mudTiles: number;
}

/**
 * The fastest the ball can come at a crawler: frenzied, at full momentum,
 * read off a real levelled ball through its own speed rule.
 */
function fastestBallSpeed(map: GameMap): number {
  const ball = spawnExtraMobs(level2, map, SWINE_SIM_PARTY_LEVEL, DIFFICULTY_PROFILES.normal).find(
    (mob): mob is BallOfSwine => mob instanceof BallOfSwine,
  );
  if (ball === undefined) throw new Error('no Ball of Swine to measure');
  const FRENZIED_HP_SHARE = 0.1;
  ball.hp = Math.max(1, Math.floor(ball.maxHp * FRENZIED_HP_SHARE));
  const speedRule: unknown = Reflect.get(ball, 'currentSpeed');
  if (typeof speedRule !== 'function') throw new Error('the ball has no currentSpeed()');
  const speed: unknown = Reflect.apply(speedRule, ball, []);
  if (typeof speed !== 'number') throw new Error('currentSpeed() did not return a number');
  return speed;
}

/**
 * From every mud tile, the ball commits to a line through the crawler from its
 * lunge range, from every bearing, at its fastest; the crawler, at mud pace
 * through the real movement code, walks square off that line toward whichever
 * side keeps it further from the wall. It is caught if the ball's centre comes
 * within trample reach of it before the ball has passed.
 */
export function simulateMudEscapes(map: GameMap): MudEscape {
  const arena = map.arenaExteriors[0];
  const speed = fastestBallSpeed(map);
  const reach = TRAMPLE_RANGE_TILES * TILE_SIZE;
  let trials = 0;
  let caught = 0;
  let tightestMarginPx = Infinity;
  let mudTiles = 0;
  for (const patch of COLOSSEUM_MUD_WALLOWS) {
    for (const offset of patch) {
      const tileX = arena.centre.x + offset.x;
      const tileY = arena.centre.y + offset.y;
      if (map.structure[tileY]?.[tileX]?.type !== ARENA_MUD) continue;
      mudTiles++;
      for (let index = 0; index < CHORD_BEARINGS; index++) {
        const bearing = (index / CHORD_BEARINGS) * FULL_TURN;
        const along = { x: -Math.cos(bearing), y: -Math.sin(bearing) };
        // Of the two ways off the line, the one toward the arena's middle.
        const toMiddle = { x: arena.centre.x - tileX, y: arena.centre.y - tileY };
        const side = along.x * toMiddle.y - along.y * toMiddle.x >= 0 ? 1 : -1;
        const escape = { dx: -along.y * side, dy: along.x * side, isMobile: true };
        const crawler = new HumanPlayer(tileX, tileY, TILE_SIZE);
        crawler.isActive = true;
        const start = { x: crawler.x + HALF_TILE, y: crawler.y + HALF_TILE };
        const ball = {
          x: start.x - along.x * LUNGE_RANGE_TILES * TILE_SIZE,
          y: start.y - along.y * LUNGE_RANGE_TILES * TILE_SIZE,
        };
        let margin = Infinity;
        for (let frame = 0; frame < CHORD_FRAMES; frame++) {
          applyMovement(crawler, escape, map, 'sole');
          clampIntoDrum(crawler, arena.centre, map);
          ball.x += along.x * speed;
          ball.y += along.y * speed;
          const gap = Math.hypot(crawler.x + HALF_TILE - ball.x, crawler.y + HALF_TILE - ball.y);
          margin = Math.min(margin, gap - reach);
          const passed = (ball.x - start.x) * along.x + (ball.y - start.y) * along.y > reach;
          if (passed) break;
        }
        trials++;
        if (margin <= 0) caught++;
        tightestMarginPx = Math.min(tightestMarginPx, margin);
      }
    }
  }
  return { trials, caught, tightestMarginPx, mudTiles };
}

export function reportMud(report: GateReport, escape: MudEscape): void {
  report.note(
    `mud escapes: ${escape.caught} of ${escape.trials} caught over ${escape.mudTiles} mud tiles, ` +
      `tightest clearance ${escape.tightestMarginPx.toFixed(1)}px`,
  );
  if (escape.mudTiles === 0 || escape.trials === 0) report.fail('no mud tile was tried');
  if (escape.caught > 0) {
    report.fail(`${escape.caught} committed charges caught a crawler walking out of the mud`);
  }
}

// ── The ball rolls through mud unslowed ─────────────────────────────────────

/** Frames the ball rolls across a wallow and across open sand, to compare. */
const ROLL_FRAMES = 20;

/**
 * Rolls the real ball across a mud patch and across open sand at the same
 * momentum and returns how far it went on each. Mud must not slow it: a
 * wallow that drained the ball would hand the crawler free slams.
 */
export function rollThroughMud(map: GameMap): { onMud: number; onSand: number } {
  const arena = map.arenaExteriors[0];
  const roll = (fromX: number, fromY: number): number => {
    const ball = new BallOfSwine(fromX, fromY, TILE_SIZE);
    ball.setMap(map);
    ball.setArena(arena.centre.x, arena.centre.y);
    // Inert until ArenaSystem opens the fight; this rig drives it directly.
    ball.fightStarted = true;
    Reflect.set(ball, 'heading', 0);
    const startX = ball.x;
    for (let frame = 0; frame < ROLL_FRAMES; frame++) ball.updateAI([]);
    return Math.abs(ball.x - startX);
  };
  const patch = COLOSSEUM_MUD_WALLOWS[0];
  const first = patch[0];
  const MUD_RUN_START = 2;
  return {
    onMud: roll(arena.centre.x + first.x - MUD_RUN_START, arena.centre.y + first.y),
    onSand: roll(arena.centre.x - MUD_RUN_START, arena.centre.y + MUD_RUN_START),
  };
}

// ── The fight, against the room as it stood before ──────────────────────────

/** Floors the fight is measured on; the same ones the baseline was. */
const FIGHT_RUNS = 8;
export const FIGHT_SEEDS: readonly number[] = Array.from(
  { length: FIGHT_RUNS },
  (_, index) => index + 1,
);
const FRAMES_PER_MINUTE = 3600;
const PERCENT = 100;

export interface FightSummary {
  readonly killFrames: number;
  readonly hitsOnCrawler: number;
  readonly damageShare: number;
  readonly slamsPerFiveMinutes: number;
  readonly tusklingsSpawned: number;
  readonly ballStuckFrames: number;
  readonly killed: number;
  readonly runs: number;
  readonly cagesReleased: number;
  readonly cageFaults: readonly string[];
}

/**
 * Runs the fight on every floor in `FIGHT_SEEDS` — once fought, once only
 * dodged for five minutes — and averages what the room is judged on. The
 * cages are watched every frame of the fought runs: they may never exceed the
 * fight's own budget or the shared live pool, and never open while the ball is
 * above the health at which it starts shedding.
 */
export function measureFights(): FightSummary {
  let killFrames = 0;
  let hitsOnCrawler = 0;
  let damageShare = 0;
  let slams = 0;
  let tusklingsSpawned = 0;
  let ballStuckFrames = 0;
  let killed = 0;
  let cagesReleased = 0;
  const cageFaults: string[] = [];
  for (const seed of FIGHT_SEEDS) {
    let released = 0;
    let lastPhases: readonly string[] = [];
    const fought = runSwineFight({
      seed,
      fightsBack: true,
      onFrame: (fight) => {
        const phases = fight.dressing.cagePhases;
        phases.forEach((phase, index) => {
          if (phase === 'rattling' && lastPhases[index] !== 'rattling') {
            if (!fight.ball.isShedding) {
              const percent = Math.round((fight.ball.hp / fight.ball.maxHp) * PERCENT);
              cageFaults.push(`seed ${seed}: a cage rattled with the ball at ${percent}% health`);
            }
          }
        });
        lastPhases = phases;
        released = Math.max(released, fight.dressing.cagesReleased);
        if (fight.dressing.cagesReleased > CAGE_RELEASE_MAX) {
          cageFaults.push(`seed ${seed}: ${fight.dressing.cagesReleased} cages released`);
        }
        const live = liveShedTusklings(fight.roster.mobs);
        if (live > SHED_MAX_ALIVE)
          cageFaults.push(`seed ${seed}: ${live} loose Tusklings alive at once`);
      },
    });
    const dodged = runSwineFight({ seed, fightsBack: false, budgetFrames: SLAM_WINDOW_FRAMES });
    killFrames += fought.killFrames;
    hitsOnCrawler += fought.hitsOnCrawler;
    damageShare += fought.damageShare;
    tusklingsSpawned += fought.tusklingsSpawned;
    ballStuckFrames += fought.ballStuckFrames + dodged.ballStuckFrames;
    slams += (dodged.slams * SLAM_WINDOW_FRAMES) / Math.max(1, dodged.frames);
    if (fought.killed) killed++;
    cagesReleased += released;
  }
  const runs = FIGHT_SEEDS.length;
  return {
    killFrames: killFrames / runs,
    hitsOnCrawler: hitsOnCrawler / runs,
    damageShare: damageShare / runs,
    slamsPerFiveMinutes: slams / runs,
    tusklingsSpawned: tusklingsSpawned / runs,
    ballStuckFrames,
    killed,
    runs,
    cagesReleased,
    cageFaults: cageFaults.slice(0, MAX_LISTED),
  };
}

/** A fight is its minutes to kill, not its frames, when read by a person. */
export function minutesOf(frames: number): string {
  return (frames / FRAMES_PER_MINUTE).toFixed(2);
}

// ── The room rewinds ────────────────────────────────────────────────────────

/** Cages, decals and door a checkpoint test sets up, in cage indices and arena-local tiles. */
const REWIND_OPEN_CAGE_COUNT = 2;
const REWIND_OTHER_CAGE_COUNT = 4;
const REWIND_OPEN_CAGES: readonly number[] = Array.from(
  { length: REWIND_OPEN_CAGE_COUNT },
  (_, index) => index,
);
const REWIND_OTHER_CAGES: readonly number[] = Array.from(
  { length: REWIND_OTHER_CAGE_COUNT },
  (_, index) => index + REWIND_OPEN_CAGE_COUNT,
);
/** Where a rewind test's decals land: on the wallows' own tiles, which are sand-side by construction. */
const REWIND_DECAL_TILES = COLOSSEUM_MUD_WALLOWS.flat();
const REWIND_DECAL_LIFE = 500;
const REWIND_SETTLE_FRAMES = 40;

function sameSnapshot(a: ColosseumDressingCheckpoint, b: ColosseumDressingCheckpoint): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Drives the dressing through a death and an abort and checks it comes back
 * whole: a save's snapshot survives JSON, a rewind restores the cages, the mud
 * and the blood exactly and puts the portcullis where the snapshot had it, and
 * an abort puts back the room as it was at the seal. A save older than the
 * snapshot's fields reads as an untouched room.
 */
export function checkRewinds(env: RoomEnvironment): string[] {
  const failures: string[] = [];
  const dressing = buildColosseumDressing(env.gameMap);
  if (dressing === null) return ['the colosseum built no dressing'];
  const { centre } = env.gameMap.arenaExteriors[0];
  const decal = (index: number) => {
    const tile = REWIND_DECAL_TILES[index % REWIND_DECAL_TILES.length];
    return {
      x: (centre.x + tile.x) * TILE_SIZE + HALF_TILE,
      y: (centre.y + tile.y) * TILE_SIZE + HALF_TILE,
      variant: index,
      life: REWIND_DECAL_LIFE,
    };
  };
  const settle = (): void => {
    for (let frame = 0; frame < REWIND_SETTLE_FRAMES; frame++) dressing.update(env.frame);
  };

  env.gameMap.lockArenaDoor();
  dressing.restoreCheckpoint({
    openCages: REWIND_OPEN_CAGES,
    portcullisDown: true,
    mudSplatter: [decal(0), decal(1)],
    bloodDecals: [decal(2)],
  });
  settle();
  const saved = dressing.captureCheckpoint();
  if (saved.openCages.length !== REWIND_OPEN_CAGES.length) {
    failures.push(
      `a snapshot kept ${saved.openCages.length} open cages of ${REWIND_OPEN_CAGES.length}`,
    );
  }

  const parsed = parseColosseumDressingCheckpoint(JSON.parse(JSON.stringify(saved)));
  if (parsed === undefined || !sameSnapshot(parsed, saved)) {
    failures.push('a snapshot did not survive a trip through a save');
  }
  const fromOldSave = parseColosseumDressingCheckpoint({});
  if (fromOldSave === undefined || fromOldSave.openCages.length > 0 || fromOldSave.portcullisDown) {
    failures.push("a save older than the room's own state did not read as an untouched room");
  }
  if (parseColosseumDressingCheckpoint({ openCages: 'all' }) !== undefined) {
    failures.push('a malformed snapshot was accepted');
  }

  // A death: the fight moves on, then the scene rewinds.
  env.gameMap.unlockArenaDoor();
  dressing.restoreCheckpoint({
    openCages: REWIND_OTHER_CAGES,
    portcullisDown: false,
    mudSplatter: [],
    bloodDecals: [decal(0), decal(1)],
  });
  settle();
  dressing.resetForCheckpoint();
  dressing.restoreCheckpoint(saved);
  const rewound = dressing.captureCheckpoint();
  if (!sameSnapshot({ ...rewound, portcullisDown: true }, saved)) {
    failures.push('a rewind did not restore the cages, the mud and the blood');
  }
  if (dressing.portcullisFrame !== PORTCULLIS_FRAMES - 1) {
    failures.push(`a rewind left the portcullis on frame ${dressing.portcullisFrame}, not down`);
  }

  // An abort: the room goes back to how it stood when it sealed.
  env.gameMap.unlockArenaDoor();
  dressing.restoreCheckpoint({
    openCages: [],
    portcullisDown: false,
    mudSplatter: [],
    bloodDecals: [],
  });
  settle();
  const beforeSeal = dressing.captureCheckpoint();
  dressing.onSeal();
  dressing.restoreCheckpoint({
    openCages: REWIND_OTHER_CAGES,
    portcullisDown: true,
    mudSplatter: [decal(1)],
    bloodDecals: [],
  });
  dressing.onFightAborted();
  if (!sameSnapshot(dressing.captureCheckpoint(), beforeSeal)) {
    failures.push('an abort did not put the room back as it stood at the seal');
  }

  // A won room, told twice.
  dressing.onBossDefeated();
  const once = dressing.captureCheckpoint();
  dressing.onBossDefeated();
  if (!sameSnapshot(once, dressing.captureCheckpoint())) {
    failures.push('hearing the kill twice changed the room');
  }
  return failures;
}
