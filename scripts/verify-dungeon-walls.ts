/**
 * Dungeon walls draw what the 3/4 camera promises, fall away into the dark, and
 * paint nothing past their own tile.
 *
 * Over several generated maps per floor, plus the hand-laid wall-case fixture on
 * both floors, every wall tile (and every sign plaque drawn as wall, and the void
 * border, which is the same rock) is painted
 * on its own into a canvas one margin larger on every side, and:
 *
 * - **nothing lands in the margin.** Terrain is baked into 16x16-tile chunks
 *   clipped to their own rect, so a wall painter that reaches past its tile is
 *   cut off at every chunk seam. Painting alone into an oversized canvas finds
 *   that on any tile, not just the ones that happen to sit on a seam;
 * - **every open side shows the wall's structure**: along a side with floor
 *   beyond it, a rim, arris or cap brighter than the wall top can ever be, and a
 *   face over floor to the south — so a room's edge is a wall, never just a lit
 *   wall top or the dark;
 * - **rock beyond the light is pure black**, opaque `#000`, the colour of the
 *   void and the fog, so unexplored rock and the edge of the screen are one;
 * - **the dark only deepens with distance.** Over the wall-top tiles of a map,
 *   the mean brightness of tiles further from open floor is never above that of
 *   nearer ones;
 * - **no seams.** Between two wall-top tiles nothing steps harder than a joint in
 *   the top does — the void border included, which is the same rock;
 * - **the map's edge is dark**, so a wall top never runs lit into the end of the
 *   world;
 * - **a wall one tile thick from side to side reads as wall**: between its two
 *   slivers its top is lit capstone, not the rock's dark top, which in a strip
 *   that narrow reads as a slot cut into the floor.
 *
 * Open floor, faces and distance are worked out here from the tile types alone,
 * not by the painter's own classifier, so a classifier that went wrong cannot
 * vouch for itself. Light is measured from open floor and from the face standing
 * over it, whose cap is where the wall top begins.
 *
 * Every check is proved able to fail: painters that spill past their tile, leave
 * open sides black, draw only a flat lit top, tint the dark, brighten with
 * distance, leave the void black beside lit rock and light the map's edge are
 * each run through the same checks and must be caught by the check meant for
 * them.
 *
 *   npx tsx scripts/verify-dungeon-walls.ts
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { TutorialMap } from '../src/map/TutorialMap.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { setDungeonFloorTheme, type DungeonFloorThemeId } from '../src/map/dungeon/floorTheme.js';
import { buildWallCaseStructure } from '../src/map/dungeon/wallCaseFixture.js';
import { WALL_FACE_RISE_TILES, WALL_FADE_TILES } from '../src/map/dungeon/wallLight.js';
import { drawTerrainTile } from '../src/map/tiles/terrainTiles.js';
import {
  ARENA_CAGE,
  CRAWLER_SIGN,
  FloorTypeValue,
  METAL_WALL,
  VOID_TYPE,
  type TileContent,
} from '../src/map/tileTypes.js';

/** Maps per floor. Wall shapes repeat heavily, so a handful covers every case the generator makes. */
const SEEDS_PER_FLOOR = 4;
const FIRST_SEED = 101;
const FLOORS: ReadonlyArray<{ readonly level: number; readonly theme: DungeonFloorThemeId }> = [
  { level: 1, theme: 'cellars' },
  { level: 2, theme: 'service_level' },
];

/** Blank pixels on every side of the tile; anything painted here escaped its rect. */
const MARGIN_PX = 8;
/** Depth of the strip along an open side in which the wall's structure must show. */
const STRUCTURE_STRIP_PX = 4;
/**
 * Brighter than the wall top can ever be on either floor (its lightest stop, lit
 * arris and all, stays under 72): a pixel this bright is a cap, a rim, an arris or
 * a face.
 */
const STRUCTURE_MIN_LUMINANCE = 80;
/**
 * Luminance spread a face shows across its tile. Measured faces sit at 10 to 14
 * on both floors; the wall top's joints and pits put it under 5.
 */
const FACE_MIN_SPREAD = 7;
/** Share of the lines across a strip which must hold such a pixel. */
const STRUCTURE_MIN_SHARE = 0.4;
/** The edge of the map must be this dark: the rock has given out entirely. */
const EDGE_MAX_LUMINANCE = 2;
/**
 * A step across a tile boundary larger than any joint in the wall top makes (a
 * joint darkens the top by under 20) — the kind a wall top lit up to a black
 * neighbour makes.
 */
const SEAM_STEP = 24;
/** Share of a boundary's pixels allowed to step that far before it counts as a seam. */
const SEAM_MAX_SHARE = 0.25;
/** Tiles out from lit space beyond which a wall tile must be pure black. */
const DARK_BEYOND_TILES = WALL_FADE_TILES;
/**
 * Mean luminance down the middle of a thin wall's tile it must reach. The rock's
 * top averages about 46 where fully lit and a thin wall's capstone top over 80;
 * halfway keeps the check clear of both.
 */
const THIN_TOP_MIN_LUMINANCE = 60;
/** The middle third of the tile, clear of both slivers. */
const THIRDS = 3;
const THIN_TOP_SAMPLE_SHARE = 1 / THIRDS;
/** Width of a distance bin when comparing brightness against distance. */
const DISTANCE_BIN_TILES = 0.5;
/** Slack, in luminance points, before a further bin counts as brighter. */
const BRIGHTNESS_TOLERANCE = 1.5;
/** A bin needs this many tiles before its mean is trusted. */
const MIN_BIN_TILES = 20;
const SEARCH_RADIUS = Math.ceil(DARK_BEYOND_TILES + WALL_FACE_RISE_TILES) + 1;

const RGBA = 4;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA = 255;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;

type CheckName = 'spill' | 'open-side' | 'dark' | 'falloff' | 'edge' | 'seam' | 'thin';

interface Failure {
  readonly check: CheckName;
  readonly message: string;
}

type TilePainter = (
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
) => void;

const paintWall: TilePainter = (ctx, structure, type, sx, sy, ts, tx, ty) => {
  drawTerrainTile(ctx, structure, type, sx, sy, ts, tx, ty);
};

const SOLID_TYPES: ReadonlySet<number> = new Set([
  FloorTypeValue.wall,
  VOID_TYPE,
  METAL_WALL,
  ARENA_CAGE,
]);

function typeAt(structure: TileContent[][], x: number, y: number): number | undefined {
  return structure[y]?.[x]?.type;
}

function isSolid(structure: TileContent[][], x: number, y: number): boolean {
  const type = typeAt(structure, x, y);
  return type === undefined || SOLID_TYPES.has(type);
}

/** A sign seated in a pocket of north wall, which is drawn as that wall. */
function isPlaque(structure: TileContent[][], x: number, y: number): boolean {
  return (
    typeAt(structure, x, y) === CRAWLER_SIGN &&
    isSolid(structure, x, y - 1) &&
    isSolid(structure, x - 1, y) &&
    isSolid(structure, x + 1, y) &&
    !isSolid(structure, x, y + 1)
  );
}

function isOpen(structure: TileContent[][], x: number, y: number): boolean {
  return !isSolid(structure, x, y) && !isPlaque(structure, x, y);
}

/**
 * How far above an open tile the light reaches: the face standing over it, when
 * wall stands over it — one tile when that wall is a single tile thick.
 */
function riseAbove(structure: TileContent[][], x: number, y: number): number {
  if (isOpen(structure, x, y - 1)) return 0;
  return isOpen(structure, x, y - 2) ? 1 : WALL_FACE_RISE_TILES;
}

/** Gap between the tile at (tx, ty) and the nearest lit space, in tiles, capped. */
function distanceToOpen(structure: TileContent[][], tx: number, ty: number): number {
  let nearest = SEARCH_RADIUS;
  for (let y = ty - SEARCH_RADIUS; y <= ty + SEARCH_RADIUS; y++) {
    for (let x = tx - SEARCH_RADIUS; x <= tx + SEARCH_RADIUS; x++) {
      if (!isOpen(structure, x, y)) continue;
      const litTop = y - riseAbove(structure, x, y);
      const gapX = Math.max(0, Math.abs(x - tx) - 1);
      const gapY = Math.max(0, litTop - (ty + 1), ty - (y + 1));
      nearest = Math.min(nearest, Math.hypot(gapX, gapY));
    }
  }
  return nearest;
}

const canvasSide = TILE_SIZE + MARGIN_PX * 2;
const canvas = createCanvas(canvasSide, canvasSide);
const nodeCtx = canvas.getContext('2d');
const ctx = asGameContext(nodeCtx);

function luminanceAt(data: Uint8ClampedArray, x: number, y: number): number {
  const index = (y * canvasSide + x) * RGBA;
  return LUMA_RED * data[index] + LUMA_GREEN * data[index + 1] + LUMA_BLUE * data[index + 2];
}

function meanLuminance(data: Uint8ClampedArray): number {
  let total = 0;
  for (let y = MARGIN_PX; y < MARGIN_PX + TILE_SIZE; y++) {
    for (let x = MARGIN_PX; x < MARGIN_PX + TILE_SIZE; x++) total += luminanceAt(data, x, y);
  }
  return total / (TILE_SIZE * TILE_SIZE);
}

type Side = 'north' | 'south' | 'east' | 'west';

/**
 * Whether the wall's structure shows along an open side: a lit rim, arris or cap
 * brighter than the wall top can ever be, in enough of the lines running across
 * the strip by that side. A wall top alone, however lit, never passes.
 */
function structureShows(data: Uint8ClampedArray, side: Side): boolean {
  const lo = MARGIN_PX;
  const hi = MARGIN_PX + TILE_SIZE;
  let lines = 0;
  let bright = 0;
  for (let along = lo; along < hi; along++) {
    lines++;
    for (let depth = 0; depth < STRUCTURE_STRIP_PX; depth++) {
      const x = side === 'west' ? lo + depth : side === 'east' ? hi - 1 - depth : along;
      const y = side === 'north' ? lo + depth : side === 'south' ? hi - 1 - depth : along;
      if (luminanceAt(data, x, y) >= STRUCTURE_MIN_LUMINANCE) {
        bright++;
        break;
      }
    }
  }
  return bright / lines >= STRUCTURE_MIN_SHARE;
}

/**
 * Whether a face is visible in the tile. A face's courses, joints, band and foot
 * give it real contrast top to bottom; a wall top, lit or not, has almost none.
 */
function faceShows(data: Uint8ClampedArray): boolean {
  let total = 0;
  let squares = 0;
  for (let y = MARGIN_PX; y < MARGIN_PX + TILE_SIZE; y++) {
    for (let x = MARGIN_PX; x < MARGIN_PX + TILE_SIZE; x++) {
      const luminance = luminanceAt(data, x, y);
      total += luminance;
      squares += luminance * luminance;
    }
  }
  const pixels = TILE_SIZE * TILE_SIZE;
  const mean = total / pixels;
  return Math.sqrt(Math.max(0, squares / pixels - mean * mean)) >= FACE_MIN_SPREAD;
}

/** Mean luminance of the tile's middle columns, top to bottom. */
function middleLuminance(data: Uint8ClampedArray): number {
  const width = Math.round(TILE_SIZE * THIN_TOP_SAMPLE_SHARE);
  const left = MARGIN_PX + Math.round((TILE_SIZE - width) / 2);
  let total = 0;
  for (let y = MARGIN_PX; y < MARGIN_PX + TILE_SIZE; y++) {
    for (let x = left; x < left + width; x++) total += luminanceAt(data, x, y);
  }
  return total / (width * TILE_SIZE);
}

/**
 * A wall with floor on both its east and west and no face: all it shows is its
 * top between two slivers. With floor one or two rows south, most of the tile is
 * the face standing over that floor, whose masonry is darker than any cap.
 */
function isThinTop(structure: TileContent[][], x: number, y: number): boolean {
  const showsFace = isOpen(structure, x, y + 1) || isOpen(structure, x, y + 2);
  return isOpen(structure, x - 1, y) && isOpen(structure, x + 1, y) && !showsFace;
}

/** Whether a wall tile shows only wall top: no open floor anywhere around it, no face. */
function isTopOnly(structure: TileContent[][], tx: number, ty: number): boolean {
  for (let y = ty - 1; y <= ty + 2; y++) {
    for (let x = tx - 1; x <= tx + 1; x++) {
      if (isOpen(structure, x, y)) return false;
    }
  }
  return true;
}

/** Share of edge pixel pairs across a tile boundary that jump by more than a seam allows. */
function seamShare(a: Float32Array, b: Float32Array): number {
  let jumps = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > SEAM_STEP) jumps++;
  return jumps / a.length;
}

interface SweepResult {
  readonly checked: number;
  readonly dark: number;
  readonly failures: Failure[];
}

function sweep(painter: TilePainter, structure: TileContent[][]): SweepResult {
  const failures: Failure[] = [];
  const bins = new Map<number, { total: number; count: number }>();
  const rows = structure.length;
  const columns = structure[0]?.length ?? 0;
  /** The bottom row of each tile in the row above, kept while it is the row above. */
  let bottomsAbove = new Map<number, Float32Array>();
  let bottomsHere = new Map<number, Float32Array>();
  let checked = 0;
  let dark = 0;
  for (let ty = 0; ty < rows; ty++) {
    let rightOfPrevious: Float32Array | null = null;
    for (let tx = 0; tx < columns; tx++) {
      const type = typeAt(structure, tx, ty);
      const drawn =
        type === FloorTypeValue.wall || type === VOID_TYPE || isPlaque(structure, tx, ty);
      if (!drawn) {
        rightOfPrevious = null;
        continue;
      }
      checked++;
      const where = `(${tx}, ${ty})`;
      const distance = distanceToOpen(structure, tx, ty);
      const isDark = distance >= DARK_BEYOND_TILES;
      if (isDark) dark++;
      ctx.clearRect(0, 0, canvasSide, canvasSide);
      painter(
        ctx,
        structure,
        type === VOID_TYPE ? VOID_TYPE : FloorTypeValue.wall,
        MARGIN_PX,
        MARGIN_PX,
        TILE_SIZE,
        tx,
        ty,
      );
      const { data } = nodeCtx.getImageData(0, 0, canvasSide, canvasSide);

      let spilled = 0;
      for (let y = 0; y < canvasSide; y++) {
        for (let x = 0; x < canvasSide; x++) {
          const inside =
            x >= MARGIN_PX &&
            x < MARGIN_PX + TILE_SIZE &&
            y >= MARGIN_PX &&
            y < MARGIN_PX + TILE_SIZE;
          if (!inside && data[(y * canvasSide + x) * RGBA + ALPHA_OFFSET] !== 0) spilled++;
        }
      }
      if (spilled > 0) {
        failures.push({
          check: 'spill',
          message: `${where} painted ${spilled} px outside its tile`,
        });
      }

      if (isDark) {
        let notBlack = 0;
        for (let y = MARGIN_PX; y < MARGIN_PX + TILE_SIZE; y++) {
          for (let x = MARGIN_PX; x < MARGIN_PX + TILE_SIZE; x++) {
            const index = (y * canvasSide + x) * RGBA;
            const pureBlack =
              data[index] === 0 &&
              data[index + 1] === 0 &&
              data[index + 2] === 0 &&
              data[index + ALPHA_OFFSET] === OPAQUE_ALPHA;
            if (!pureBlack) notBlack++;
          }
        }
        if (notBlack > 0) {
          failures.push({
            check: 'dark',
            message: `${where} is ${distance.toFixed(1)} tiles from floor but ${notBlack} px are not opaque black`,
          });
        }
      }

      const openSides: ReadonlyArray<[Side, boolean]> = [
        ['north', isOpen(structure, tx, ty - 1)],
        ['south', isOpen(structure, tx, ty + 1)],
        ['west', isOpen(structure, tx - 1, ty)],
        ['east', isOpen(structure, tx + 1, ty)],
      ];
      for (const [side, open] of openSides) {
        if (!open) continue;
        // A face stands on the floor to its south; along that side it is the
        // face, not a rim, that has to show.
        const shows = side === 'south' ? faceShows(data) : structureShows(data, side);
        if (!shows) {
          failures.push({
            check: 'open-side',
            message: `${where}: no wall structure shows on its ${side} side`,
          });
        }
      }

      if (!isDark && isThinTop(structure, tx, ty)) {
        const middle = middleLuminance(data);
        if (middle < THIN_TOP_MIN_LUMINANCE) {
          failures.push({
            check: 'thin',
            message: `${where} is one tile thick but its middle averages ${middle.toFixed(1)}, a dark slot`,
          });
        }
      }

      const atMapEdge = tx === 0 || ty === 0 || tx === columns - 1 || ty === rows - 1;
      if (atMapEdge) {
        let litEdge = 0;
        for (let along = MARGIN_PX; along < MARGIN_PX + TILE_SIZE; along++) {
          const edgeX =
            tx === 0 ? MARGIN_PX : tx === columns - 1 ? MARGIN_PX + TILE_SIZE - 1 : along;
          const edgeY = ty === 0 ? MARGIN_PX : ty === rows - 1 ? MARGIN_PX + TILE_SIZE - 1 : along;
          if (luminanceAt(data, edgeX, edgeY) > EDGE_MAX_LUMINANCE) litEdge++;
        }
        if (litEdge > 0) {
          failures.push({
            check: 'edge',
            message: `${where} is lit at the edge of the map (${litEdge} px)`,
          });
        }
      }

      const left = new Float32Array(TILE_SIZE);
      const right = new Float32Array(TILE_SIZE);
      const top = new Float32Array(TILE_SIZE);
      const bottom = new Float32Array(TILE_SIZE);
      for (let i = 0; i < TILE_SIZE; i++) {
        left[i] = luminanceAt(data, MARGIN_PX, MARGIN_PX + i);
        right[i] = luminanceAt(data, MARGIN_PX + TILE_SIZE - 1, MARGIN_PX + i);
        top[i] = luminanceAt(data, MARGIN_PX + i, MARGIN_PX);
        bottom[i] = luminanceAt(data, MARGIN_PX + i, MARGIN_PX + TILE_SIZE - 1);
      }
      const topOnly = isTopOnly(structure, tx, ty);
      const westTopOnly = isTopOnly(structure, tx - 1, ty);
      const northTopOnly = isTopOnly(structure, tx, ty - 1);
      if (
        topOnly &&
        westTopOnly &&
        rightOfPrevious !== null &&
        seamShare(rightOfPrevious, left) > SEAM_MAX_SHARE
      ) {
        failures.push({ check: 'seam', message: `${where} steps against the tile to its west` });
      }
      const above = bottomsAbove.get(tx);
      if (
        topOnly &&
        northTopOnly &&
        above !== undefined &&
        seamShare(above, top) > SEAM_MAX_SHARE
      ) {
        failures.push({ check: 'seam', message: `${where} steps against the tile to its north` });
      }
      rightOfPrevious = right;
      bottomsHere.set(tx, bottom);

      if (topOnly && !isDark) {
        const bin = Math.floor(distance / DISTANCE_BIN_TILES);
        const entry = bins.get(bin) ?? { total: 0, count: 0 };
        entry.total += meanLuminance(data);
        entry.count++;
        bins.set(bin, entry);
      }
    }
    bottomsAbove = bottomsHere;
    bottomsHere = new Map();
  }

  const trusted = [...bins.entries()]
    .filter(([, entry]) => entry.count >= MIN_BIN_TILES)
    .sort(([a], [b]) => a - b)
    .map(([bin, entry]) => ({ bin, mean: entry.total / entry.count }));
  for (let i = 1; i < trusted.length; i++) {
    const nearer = trusted[i - 1];
    const further = trusted[i];
    if (further.mean > nearer.mean + BRIGHTNESS_TOLERANCE) {
      failures.push({
        check: 'falloff',
        message:
          `wall top ${(further.bin * DISTANCE_BIN_TILES).toFixed(1)} tiles out averages ` +
          `${further.mean.toFixed(1)}, brighter than ${nearer.mean.toFixed(1)} nearer in`,
      });
    }
  }
  return { checked, dark, failures };
}

const MAX_FAILURES_SHOWN = 12;
let failed = false;

function report(label: string, result: SweepResult): void {
  const status = result.failures.length === 0 ? 'ok  ' : 'FAIL';
  console.log(
    `${status} ${label}: ${result.checked} wall tiles (${result.dark} beyond the light), ` +
      `${result.failures.length} problems`,
  );
  for (const failure of result.failures.slice(0, MAX_FAILURES_SHOWN)) {
    console.log(`       [${failure.check}] ${failure.message}`);
  }
  if (result.failures.length > 0) failed = true;
}

function floorMap(level: number, worldSeed: number): GameMap {
  const levelDef = getLevelDef(`level${level}`);
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed,
  });
}

await loadGameSpritesInNode();

// Each check must be able to fail. Every broken painter runs over a real floor
// and has to be caught by the check meant for it, or a green line below for that
// check means nothing.
const PEAK_CHANNEL = 255;
const DISTANCE_TO_GREY = PEAK_CHANNEL / DARK_BEYOND_TILES;
/** About the wall top's own colour where it is fully lit. */
const FLAT_TOP_COLOR = 'rgb(46,43,39)';
setDungeonFloorTheme('cellars');
const selfTestMap = floorMap(1, FIRST_SEED);
const BROKEN_PAINTERS: ReadonlyArray<{
  readonly name: string;
  readonly check: CheckName;
  readonly painter: TilePainter;
  /** The map it runs over, where the generated floor may hold none of the case. */
  readonly structure?: TileContent[][];
}> = [
  {
    name: 'spills a pixel past its tile',
    check: 'spill',
    painter: (paintCtx, structure, type, sx, sy, ts, tx, ty) => {
      paintWall(paintCtx, structure, type, sx, sy, ts, tx, ty);
      paintCtx.fillStyle = '#ffffff';
      paintCtx.fillRect(sx + ts, sy, 1, 1);
    },
  },
  {
    name: 'leaves every tile black',
    check: 'open-side',
    painter: (paintCtx, _structure, _type, sx, sy, ts) => {
      paintCtx.fillStyle = '#000000';
      paintCtx.fillRect(sx, sy, ts, ts);
    },
  },
  {
    name: 'draws only a flat lit wall top, no face, sliver or rim',
    check: 'open-side',
    painter: (paintCtx, _structure, _type, sx, sy, ts) => {
      paintCtx.fillStyle = FLAT_TOP_COLOR;
      paintCtx.fillRect(sx, sy, ts, ts);
    },
  },
  {
    name: 'tints the dark',
    check: 'dark',
    painter: (paintCtx, _structure, _type, sx, sy, ts) => {
      paintCtx.fillStyle = '#010101';
      paintCtx.fillRect(sx, sy, ts, ts);
    },
  },
  {
    name: 'brightens with distance',
    check: 'falloff',
    painter: (paintCtx, structure, _type, sx, sy, ts, tx, ty) => {
      const grey = Math.min(
        PEAK_CHANNEL,
        Math.round(distanceToOpen(structure, tx, ty) * DISTANCE_TO_GREY),
      );
      paintCtx.fillStyle = `rgb(${grey},${grey},${grey})`;
      paintCtx.fillRect(sx, sy, ts, ts);
    },
  },
  {
    name: 'leaves the void border black against a lit wall top',
    check: 'seam',
    painter: (paintCtx, structure, type, sx, sy, ts, tx, ty) => {
      if (type === VOID_TYPE) {
        paintCtx.fillStyle = '#000000';
        paintCtx.fillRect(sx, sy, ts, ts);
        return;
      }
      paintWall(paintCtx, structure, type, sx, sy, ts, tx, ty);
    },
  },
  {
    name: "leaves the rock's dark top between a thin wall's slivers",
    check: 'thin',
    structure: buildWallCaseStructure(),
    painter: (paintCtx, structure, type, sx, sy, ts, tx, ty) => {
      paintWall(paintCtx, structure, type, sx, sy, ts, tx, ty);
      if (!isThinTop(structure, tx, ty)) return;
      const middleWidth = Math.round(ts * THIN_TOP_SAMPLE_SHARE);
      paintCtx.fillStyle = FLAT_TOP_COLOR;
      paintCtx.fillRect(sx + Math.round((ts - middleWidth) / 2), sy, middleWidth, ts);
    },
  },
  {
    name: 'lights the edge of the map',
    check: 'edge',
    painter: (paintCtx, _structure, _type, sx, sy, ts) => {
      paintCtx.fillStyle = FLAT_TOP_COLOR;
      paintCtx.fillRect(sx, sy, ts, ts);
    },
  },
];
for (const { name, check, painter, structure } of BROKEN_PAINTERS) {
  const caught = sweep(painter, structure ?? selfTestMap.structure).failures.some(
    (f) => f.check === check,
  );
  console.log(
    `${caught ? 'ok  ' : 'FAIL'} self-test: a painter that ${name} fails the ${check} check`,
  );
  if (!caught) failed = true;
}

for (const theme of ['cellars', 'service_level'] as const) {
  setDungeonFloorTheme(theme);
  report(`wall-case fixture, ${theme}`, sweep(paintWall, buildWallCaseStructure()));
}

// The tutorial is a cellar walled right out to the map's edge, with no void
// border, so it is where the light giving out at the edge is tested for real.
setDungeonFloorTheme('cellars');
report('tutorial', sweep(paintWall, new TutorialMap().structure));

for (const { level, theme } of FLOORS) {
  setDungeonFloorTheme(theme);
  for (let index = 0; index < SEEDS_PER_FLOOR; index++) {
    const worldSeed = FIRST_SEED + index;
    report(
      `floor ${level}, seed ${worldSeed}`,
      sweep(paintWall, floorMap(level, worldSeed).structure),
    );
  }
}

if (failed) {
  console.log('\nverify-dungeon-walls: FAILED');
  process.exit(1);
}
console.log('\nverify-dungeon-walls: all checks passed');
