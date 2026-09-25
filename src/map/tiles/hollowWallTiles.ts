/**
 * Briar Hollow's roofless walls.
 *
 * The village's buildings have no roofs: you walk through the doorway and see
 * the whole room from above, with the walls drawn round you. That only works in
 * this game's 3/4 projection if the walls nearest the camera are cut down, so
 * the three wall runs are drawn at different heights:
 *
 * - The **north** wall — the back of the room — stands full height
 *   (`HOLLOW_WALL_FACE_TILES`), and its inner face hangs below its cap, showing
 *   planks, a fieldstone footing, a porthole window or a shelf. It rises into
 *   the row above, which is outside the building, so nothing it hides matters.
 * - The **south** wall — between the camera and the room — is a cutaway,
 *   `HOLLOW_WALL_CUTAWAY_TILES` tall. At full height it would hide the room and
 *   everyone in it; this low it still reads as a wall, and its cap still covers
 *   the feet of anyone standing right behind it, which is what sells "inside".
 * - The **east and west** walls are cut to the same height as the south. A
 *   full-height side wall's cap sits a whole tile north of the ground it stands
 *   on in this projection, so every side doorway would appear a tile north of
 *   where it can be walked through, and a crawler standing in it would vanish
 *   behind the wall south of the door.
 *
 * Every wall is half a tile thick, on the inner half of its tile, and stands on
 * a fieldstone footing that fills the outer half — so the whole blocked tile
 * reads as masonry and no walkable-looking ground is left inside it. Log-end
 * posts stand at the corners and either side of each doorway, and rise past the
 * wall top: they are the main silhouette cue.
 *
 * What a wall tile looks like depends only on its place in its building — which
 * runs it belongs to, which neighbours are doorways, and a few position-hashed
 * choices (a window, a shelf, a flower box). Which side is indoors is read from
 * the building's rectangle in the site record (`hollowSiteRegistry`), never from
 * a per-tile flag. Each distinct look is painted once into a small cache and
 * blitted, so a village of several hundred wall tiles costs a few dozen paints.
 */

import { HOLLOW_THRESHOLD, type TileContent } from '../tileTypes';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { MapSpriteExtentsPx } from '../../core/SpriteLoader';
import type { VillageBuildingDef, VillageBuildingId } from '../overworld/briarHollowSite';
import { briarHollowSiteFor } from './hollowSiteRegistry';
import type { GroundPalette } from '../ground/GroundPalette';
import { OVERWORLD_GROUND, type GroundMaterial } from '../town/groundMaterials';
import { tileHash } from './hollowTileHash';
import { mulberry32, type Rng } from '../../sprites/person/rng';
import {
  BRASS,
  CLOTH,
  INK,
  IRON,
  LOG,
  MOSS,
  STONE,
  WOOD,
  drawBriarKnot,
  drawFieldstones,
  drawWattle,
  drawLantern,
  drawLogEnd,
  drawPlanks,
  fillRoundRect,
  type ClothColour,
} from '../../sprites/art/villageArt';

// ── Geometry, in tiles ────────────────────────────────────────────────────────

/** Height of the north wall's inner face. */
export const HOLLOW_WALL_FACE_TILES = 1.1;
/** Height of the south and side walls: the cutaway. */
export const HOLLOW_WALL_CUTAWAY_TILES = 0.35;
/** Height of a corner or door post on the north wall. */
export const HOLLOW_POST_TILES = 1.3;
/** How far a post on a cut-down wall stands proud of the wall top. */
const CUTAWAY_POST_STUB_TILES = 0.22;
/** How tall the posts either side of a side or south doorway stand. */
const LOW_DOOR_POST_TILES = 0.8;
/** Thickness of every wall, on the inner half of its tile; the outer half is footing. */
const WALL_THICKNESS_TILES = 0.5;
/** The log post's width, centred on the wall's body. */
const POST_WIDTH_TILES = 0.42;
/** Share of a wall face that is fieldstone footing. */
const FOOTING_SHARE = 0.22;
/** A doorway this wide or wider is an open side: no door, no lintel, just posts. */
const OPEN_SIDE_MIN_WIDTH = 3;
/** Depth of the carved lintel over a north doorway, on the cap line. */
const LINTEL_DEPTH_TILES = 0.22;

/**
 * How far past its own tile a lintel-carrying jamb's art reaches: across the
 * doorway and onto the far jamb's post, where the lintel rests. Overhead, so
 * it covers nothing a crawler stands on.
 */
function lintelReachTiles(piece: WallPiece): number {
  return piece.lintel ? piece.doorWidth + POST_WIDTH_TILES : 0;
}

/** Painting density of the wall cache: twice the tile size, so walls are sharp on Retina. */
const WALL_CACHE_DENSITY = 2;

/** How far any wall piece can reach above its own tile. */
const WALL_REACH_UP_TILES = 1;

// ── Colours not in the shared palette ─────────────────────────────────────────

/** Through a porthole: the dim green of the world outside. */
const WINDOW_GLASS = '#2c3a2c';
const WINDOW_GLINT = 'rgba(210,230,200,0.35)';
/** The shadow the cap throws down the top of the face. */
const CAP_SHADOW = 'rgba(0,0,0,0.35)';
/**
 * A warm umber wash over the footing: enough to calm the stones into a base
 * rather than a band of speckle, without turning the one cool material in the
 * village into a cold slab round every house.
 */
const FOOTING_SHADOW = 'rgba(48,34,18,0.3)';
/** The worn, smooth band along the threshold sill. */
const SILL_WEAR = 'rgba(255,230,190,0.1)';

// ── What a wall tile is ───────────────────────────────────────────────────────

type Direction = 'north' | 'south' | 'east' | 'west';

/** A shop's signboard pictogram. */
export type SignPictogram = 'anvil' | 'bowl' | 'mortar' | 'coin' | 'gear' | 'saw';

/** The outbuildings: working sheds whose walls are woven wattle between posts. */
const WATTLED_BUILDINGS: ReadonlySet<VillageBuildingId> = new Set(['barn', 'sawmill', 'garn_hut']);

const SHOP_SIGNS: Partial<Record<VillageBuildingId, SignPictogram>> = {
  forge: 'anvil',
  cookhouse: 'bowl',
  infirmary: 'mortar',
  store: 'coin',
  workshop: 'gear',
  sawmill: 'saw',
};

/** What a porthole-less stretch of north face carries. */
export type FaceFeature = 'plain' | 'window' | 'shelf' | 'pegs';

/**
 * Everything a wall tile's look depends on — and nothing else. Two tiles with
 * equal pieces share one cached painting, which is why position never appears
 * here: a window's place along the wall is decided when the piece is built.
 */
export interface WallPiece {
  /** Which of the building's four runs this tile belongs to; two for a corner. */
  readonly north: boolean;
  readonly south: boolean;
  readonly east: boolean;
  readonly west: boolean;
  /** Which neighbours are this building's doorway tiles. */
  readonly doorNorth: boolean;
  readonly doorSouth: boolean;
  readonly doorEast: boolean;
  readonly doorWest: boolean;
  /** Width of the doorway beside this tile, or 0 when there is none. */
  readonly doorWidth: number;
  /** This jamb carries the lintel across its doorway (the west jamb of a narrow north door). */
  readonly lintel: boolean;
  /** This jamb has the open door leaf swung back against it. */
  readonly leaf: boolean;
  /** This jamb's post has a lantern hanging from it. */
  readonly lantern: boolean;
  readonly sign: SignPictogram | null;
  readonly feature: FaceFeature;
  /** A flower box on the south cutaway, and the household colour of its blooms. */
  readonly flowers: ClothColour | null;
  /** Seed for grain and stone lay; a handful of values, so the cache stays small. */
  readonly grain: number;
  /** An outbuilding's walls are woven briar wattle between the posts, not planks. */
  readonly wattle: boolean;
}

/** Variety in grain and stone lay without letting the cache grow with the map. */
const GRAIN_VARIANTS = 4;
const GRAIN_SALT = 0x3a11;
const FEATURE_SALT = 0x7f02;
/** Every how-many tiles along a north wall a porthole comes round. */
const WINDOW_PERIOD_MIN = 3;
const WINDOW_PERIOD_SPREAD = 2;
/** Chance a plain stretch of north face carries a shelf or a peg rail instead. */
const FURNISHED_FACE_CHANCE = 0.35;
/** Every how-many tiles along a south cutaway a flower box sits. */
const FLOWER_BOX_PERIOD = 3;

interface WallLayout {
  readonly pieces: ReadonlyMap<number, WallPiece>;
  readonly lanterns: ReadonlyArray<{ readonly tx: number; readonly ty: number }>;
}

const layouts = new WeakMap<TileContent[][], WallLayout>();

function keyOf(tx: number, ty: number): number {
  return ty * WALL_KEY_STRIDE + tx;
}
const WALL_KEY_STRIDE = 65536;

function householdColour(
  colours: ReadonlyMap<VillageBuildingId, ClothColour>,
  id: VillageBuildingId,
): ClothColour {
  return colours.get(id) ?? 'madder';
}

/** Where a wall tile stands in its building, before its derived fittings are worked out. */
export interface WallPlacement {
  readonly north: boolean;
  readonly south: boolean;
  readonly east: boolean;
  readonly west: boolean;
  readonly doorNorth: boolean;
  readonly doorSouth: boolean;
  readonly doorEast: boolean;
  readonly doorWest: boolean;
  readonly doorWidth: number;
  readonly feature: FaceFeature;
  readonly flowers: ClothColour | null;
  /** The building's pictogram, if this tile is the jamb its signboard hangs on. */
  readonly sign: SignPictogram | null;
  readonly grain: number;
  /** An outbuilding's walls are woven briar wattle between the posts, not planks. */
  readonly wattle: boolean;
}

/**
 * A wall tile's full look from its placement. The one place the door fittings
 * are decided — the game's layout and the gate's enumeration both come
 * through here — so a gate that paints every combination paints what ships.
 */
export function wallPieceFor(placement: WallPlacement): WallPiece {
  const besideDoor =
    placement.doorNorth || placement.doorSouth || placement.doorEast || placement.doorWest;
  const narrowDoor = besideDoor && placement.doorWidth < OPEN_SIDE_MIN_WIDTH;
  // The jamb west of a door in a north or south wall, or north of one in a side
  // wall, carries the door's fittings: one lantern, one leaf, one lintel a door.
  const firstJamb = placement.doorEast || placement.doorSouth;
  return {
    ...placement,
    doorWidth: besideDoor ? placement.doorWidth : 0,
    lintel: narrowDoor && placement.north && placement.doorEast,
    leaf: narrowDoor && firstJamb,
    lantern: besideDoor && firstJamb,
    sign: besideDoor && firstJamb ? placement.sign : null,
  };
}

/** Builds every wall piece of one building. */
function buildingPieces(
  building: VillageBuildingDef,
  colour: ClothColour,
  pieces: Map<number, WallPiece>,
  lanterns: Array<{ tx: number; ty: number }>,
): void {
  const { rect } = building;
  const doorKeys = new Set(building.doorways.map((door) => keyOf(door.x, door.y)));
  const isDoor = (x: number, y: number): boolean => doorKeys.has(keyOf(x, y));
  const buildingHash = tileHash(rect.x, rect.y, FEATURE_SALT);
  const windowPeriod = WINDOW_PERIOD_MIN + (buildingHash % WINDOW_PERIOD_SPREAD);
  const windowPhase = buildingHash % windowPeriod;
  const shopSign = SHOP_SIGNS[building.id] ?? null;
  const wattle = WATTLED_BUILDINGS.has(building.id);
  let signPlaced = false;
  // Doorways on one wall are one contiguous run in every template, so a
  // doorway's width is the count of doorway tiles on its line.
  const doorsInRow = (y: number): number => building.doorways.filter((door) => door.y === y).length;
  const doorsInColumn = (x: number): number =>
    building.doorways.filter((door) => door.x === x).length;

  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const north = y === rect.y;
      const south = y === rect.y + rect.h - 1;
      const west = x === rect.x;
      const east = x === rect.x + rect.w - 1;
      if (!(north || south || west || east) || isDoor(x, y)) continue;

      const doorNorth = isDoor(x, y - 1);
      const doorSouth = isDoor(x, y + 1);
      const doorEast = isDoor(x + 1, y);
      const doorWest = isDoor(x - 1, y);
      const besideDoor = doorNorth || doorSouth || doorEast || doorWest;
      const doorWidth = doorEast || doorWest ? doorsInRow(y) : besideDoor ? doorsInColumn(x) : 0;
      const firstJamb = doorEast || doorSouth;
      const sign = shopSign !== null && besideDoor && firstJamb && !signPlaced ? shopSign : null;
      if (sign !== null) signPlaced = true;

      const runIndex = north || south ? x - rect.x : y - rect.y;
      const isCorner = (north || south) && (west || east);
      const featureRoll = tileHash(x, y, FEATURE_SALT) / FEATURE_HASH_RANGE;
      let feature: FaceFeature = 'plain';
      if (north && !isCorner && !besideDoor) {
        if (runIndex % windowPeriod === windowPhase) feature = 'window';
        else if (featureRoll < FURNISHED_FACE_CHANCE) {
          feature = featureRoll < FURNISHED_FACE_CHANCE / 2 ? 'shelf' : 'pegs';
        }
      }
      const flowers =
        south && !isCorner && !besideDoor && (runIndex + windowPhase) % FLOWER_BOX_PERIOD === 0
          ? colour
          : null;

      const piece = wallPieceFor({
        wattle,
        north,
        south,
        east,
        west,
        doorNorth,
        doorSouth,
        doorEast,
        doorWest,
        doorWidth,
        feature,
        flowers,
        sign,
        grain: tileHash(x, y, GRAIN_SALT) % GRAIN_VARIANTS,
      });
      pieces.set(keyOf(x, y), piece);
      if (piece.lantern) lanterns.push({ tx: x, ty: y });
    }
  }
}
const FEATURE_HASH_RANGE = 0x100000000;

function layoutFor(structure: TileContent[][]): WallLayout {
  const cached = layouts.get(structure);
  if (cached !== undefined) return cached;
  const pieces = new Map<number, WallPiece>();
  const lanterns: Array<{ tx: number; ty: number }> = [];
  const site = briarHollowSiteFor(structure);
  if (site !== undefined) {
    for (const building of site.buildings) {
      const colour = householdColour(site.dressing.householdColours, building.id);
      buildingPieces(building, colour, pieces, lanterns);
    }
  }
  const layout: WallLayout = { pieces, lanterns };
  layouts.set(structure, layout);
  return layout;
}

/**
 * The tiles whose door post carries a lantern — one per doorway. Their glow is
 * drawn live by the village's ambience, over the lantern painted here.
 */
export function hollowDoorLanternTiles(
  structure: TileContent[][],
): ReadonlyArray<{ readonly tx: number; readonly ty: number }> {
  return layoutFor(structure).lanterns;
}

/** Where a lantern hangs on its post, relative to the tile's top-left, in tiles. */
export function hollowDoorLanternOffset(
  structure: TileContent[][],
  tx: number,
  ty: number,
): { readonly x: number; readonly y: number } | null {
  const piece = layoutFor(structure).pieces.get(keyOf(tx, ty));
  if (!piece?.lantern) return null;
  const post = doorPostPlacement(piece);
  return { x: post.lanternX, y: post.lanternY + LANTERN_GLASS_OFFSET_TILES };
}
/** From the lantern's hook down to the centre of its glass. */
const LANTERN_GLASS_OFFSET_TILES = 0.2;

// ── Every shape, for the gate ─────────────────────────────────────────────────

const RUN_KINDS: ReadonlyArray<Pick<WallPlacement, 'north' | 'south' | 'east' | 'west'>> = [
  { north: true, south: false, east: false, west: false },
  { north: false, south: true, east: false, west: false },
  { north: false, south: false, east: true, west: false },
  { north: false, south: false, east: false, west: true },
  { north: true, south: false, east: false, west: true },
  { north: true, south: false, east: true, west: false },
  { north: false, south: true, east: false, west: true },
  { north: false, south: true, east: true, west: false },
];
const NO_DOOR = { doorNorth: false, doorSouth: false, doorEast: false, doorWest: false };
/** Every doorway width a template uses: a door, a double door, an open side. */
const GATE_DOOR_WIDTHS = [1, 2, OPEN_SIDE_MIN_WIDTH] as const;
const FACE_FEATURES: readonly FaceFeature[] = ['plain', 'window', 'shelf', 'pegs'];
const FLOWER_COLOURS: ReadonlyArray<ClothColour | null> = [null, 'madder', 'woad', 'weld'];
const PICTOGRAMS: ReadonlyArray<SignPictogram | null> = [
  null,
  'anvil',
  'bowl',
  'mortar',
  'coin',
  'gear',
  'saw',
];

/**
 * Every wall piece a village can produce: each run and corner, beside no door
 * or a door on either hand at every width, with every face feature, flower box
 * and sign it can carry, in planks and in wattle. For the gate that paints them all.
 */
export function everyWallPiece(): WallPiece[] {
  const pieces: WallPiece[] = [];
  for (const run of RUN_KINDS) {
    const alongRun = run.north || run.south;
    const acrossCorner = alongRun && (run.east || run.west);
    const doorOptions: Array<typeof NO_DOOR> = [NO_DOOR];
    // A jamb's doorway lies along its own run: east or west of a north or
    // south wall tile, north or south of a side wall tile. A corner is a jamb
    // for either of its two runs, on the side away from its own corner.
    if (alongRun) {
      if (!run.east) doorOptions.push({ ...NO_DOOR, doorEast: true });
      if (!run.west) doorOptions.push({ ...NO_DOOR, doorWest: true });
    }
    if (!alongRun || acrossCorner) {
      if (!run.south) doorOptions.push({ ...NO_DOOR, doorSouth: true });
      if (!run.north) doorOptions.push({ ...NO_DOOR, doorNorth: true });
    }
    for (const doors of doorOptions) {
      const besideDoor = doors.doorNorth || doors.doorSouth || doors.doorEast || doors.doorWest;
      const widths = besideDoor ? GATE_DOOR_WIDTHS : [0];
      const features =
        run.north && !acrossCorner && !besideDoor ? FACE_FEATURES : ['plain' as const];
      const flowerOptions = run.south && !acrossCorner && !besideDoor ? FLOWER_COLOURS : [null];
      const signs = besideDoor ? PICTOGRAMS : [null];
      for (const doorWidth of widths) {
        for (const feature of features) {
          for (const flowers of flowerOptions) {
            for (const sign of signs) {
              for (const wattle of [false, true]) {
                pieces.push(
                  wallPieceFor({
                    ...run,
                    ...doors,
                    doorWidth,
                    feature,
                    flowers,
                    sign,
                    grain: 0,
                    wattle,
                  }),
                );
              }
            }
          }
        }
      }
    }
  }
  return pieces;
}

/** Paints one piece with no cache and no clip, its tile's top-left at (ox, oy). */
export function paintWallPieceUncached(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  ox: number,
  oy: number,
  ts: number,
): void {
  paintWallPiece(ctx, piece, ox, oy, ts);
}

/** How far a piece may reach: up for its height, right across the doorway it spans with a lintel. */
export function wallPieceReachPx(
  piece: WallPiece,
  ts: number,
): { readonly up: number; readonly right: number } {
  return {
    up: Math.ceil(ts * WALL_REACH_UP_TILES),
    right: Math.ceil(lintelReachTiles(piece) * ts),
  };
}

// ── The cache ─────────────────────────────────────────────────────────────────

interface CachedPiece {
  readonly surface: CanvasSurface;
  /** Tile-size pixels left of and above the tile's origin that the surface covers. */
  readonly padUp: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Paintings shared by every piece of the same shape, keyed on the tile size
 * and the piece's contents, never on position.
 */
const pieceCache = new Map<string, CachedPiece>();

/**
 * Each tile's own piece object, straight to its shared painting, per tile
 * size. The layout builds one piece per wall tile and keeps it for the map's
 * life, so after a tile's first draw its lookup is one weak-map hit rather
 * than a serialised key every frame.
 */
const pieceLookups = new Map<number, WeakMap<WallPiece, CachedPiece>>();

function cachedPiece(piece: WallPiece, ts: number): CachedPiece {
  let lookup = pieceLookups.get(ts);
  if (lookup === undefined) {
    lookup = new WeakMap();
    pieceLookups.set(ts, lookup);
  }
  const known = lookup.get(piece);
  if (known !== undefined) return known;
  const key = `${ts}|${JSON.stringify(piece)}`;
  const entry = pieceCache.get(key) ?? paintPiece(piece, ts);
  pieceCache.set(key, entry);
  lookup.set(piece, entry);
  return entry;
}

function paintPiece(piece: WallPiece, ts: number): CachedPiece {
  const padUp = Math.ceil(ts * WALL_REACH_UP_TILES);
  const width = ts * (1 + lintelReachTiles(piece));
  const height = padUp + ts;
  const surface = allocCanvas(width * WALL_CACHE_DENSITY, height * WALL_CACHE_DENSITY);
  const ctx = surfaceContext(surface);
  ctx.scale(WALL_CACHE_DENSITY, WALL_CACHE_DENSITY);
  paintWallPiece(ctx, piece, 0, padUp, ts);
  return { surface, padUp, width, height };
}

/** Draws a `HOLLOW_WALL` tile. */
export function drawHollowWallTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const piece = layoutFor(structure).pieces.get(keyOf(tx, ty));
  if (piece === undefined) {
    // A wall tile no building claims — only possible on a hand-built test map.
    drawOrphanWall(ctx, sx, sy, ts);
    return;
  }
  const cached = cachedPiece(piece, ts);
  ctx.drawImage(cached.surface, sx, sy - cached.padUp, cached.width, cached.height);
}

/** How far a wall tile's art reaches past its square: up for its height, right for a lintel. */
export function hollowWallExtentsPx(
  structure: TileContent[][],
  tx: number,
  ty: number,
  ts: number,
): MapSpriteExtentsPx {
  const piece = layoutFor(structure).pieces.get(keyOf(tx, ty));
  const right = piece === undefined ? 0 : Math.ceil(lintelReachTiles(piece) * ts);
  return { left: 0, up: Math.ceil(ts * WALL_REACH_UP_TILES), right, down: 0 };
}

function drawOrphanWall(ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number): void {
  ctx.fillStyle = WOOD.body;
  ctx.fillRect(sx, sy, ts, ts);
}

// ── Painting ──────────────────────────────────────────────────────────────────

/** The outline round every piece, as a fraction of a tile. */
const INK_WIDTH_TILES = 0.03;
/** Board and stone sizes, as fractions of a tile. */
const PLANK_BOARD_TILES = 0.16;
const CAP_BOARD_TILES = 0.12;
const STONE_COURSE_TILES = 0.14;
const FOOTING_STONE_TILES = 0.16;

interface PostPlacement {
  /** Left edge of the post, in tiles from the tile's left edge. */
  readonly x: number;
  /** Ground line the post stands on, in tiles from the tile's top edge. */
  readonly footY: number;
  readonly height: number;
  /** Where a lantern's hook hangs, in tiles from the tile's top-left. */
  readonly lanternX: number;
  readonly lanternY: number;
}

/** Where the post of a corner or a door jamb stands in its tile, and how tall. */
function doorPostPlacement(piece: WallPiece): PostPlacement {
  // The wall's body is the inner half of its tile: the east half of a west
  // wall, the south half of a north wall.
  const bodyX = piece.west ? WALL_THICKNESS_TILES : 0;
  const bodyY = piece.north ? WALL_THICKNESS_TILES : 0;
  const tall = piece.north;
  const nextToDoor = piece.doorEast || piece.doorWest || piece.doorNorth || piece.doorSouth;
  const height = tall
    ? HOLLOW_POST_TILES
    : nextToDoor
      ? LOW_DOOR_POST_TILES
      : HOLLOW_WALL_CUTAWAY_TILES + CUTAWAY_POST_STUB_TILES;
  // Along a north or south wall the jamb post sits at the tile's edge against
  // the doorway; on a side wall it sits in the body, at the end nearest the door.
  let x = (piece.east || piece.west ? bodyX : 0) + (WALL_THICKNESS_TILES - POST_WIDTH_TILES) / 2;
  if (!(piece.east || piece.west)) {
    x = piece.doorEast
      ? 1 - POST_WIDTH_TILES - POST_EDGE_MARGIN_TILES
      : piece.doorWest
        ? POST_EDGE_MARGIN_TILES
        : x;
  }
  let footY = bodyY + WALL_THICKNESS_TILES;
  if ((piece.east || piece.west) && !(piece.north || piece.south)) {
    footY = piece.doorNorth ? POST_WIDTH_TILES : 1;
  }
  const lanternOnRight = piece.doorWest;
  const lanternX = lanternOnRight
    ? x + POST_WIDTH_TILES + LANTERN_REACH_TILES
    : x - LANTERN_REACH_TILES;
  const clampedLanternX = Math.min(1 - LANTERN_EDGE_TILES, Math.max(LANTERN_EDGE_TILES, lanternX));
  return {
    x,
    footY,
    height,
    lanternX: clampedLanternX,
    lanternY: footY - height + LANTERN_DROP_TILES,
  };
}
/** Keeps a jamb post's rounded top and outline off the doorway it stands beside. */
const POST_EDGE_MARGIN_TILES = 0.04;
/** How far the lantern's bracket reaches off its post. */
const LANTERN_REACH_TILES = 0.12;
/** Keeps a lantern inside its own tile's column. */
const LANTERN_EDGE_TILES = 0.14;
/** How far below the post top the lantern hook sits. */
const LANTERN_DROP_TILES = 0.2;
const LANTERN_SIZE_TILES = 0.3;

function paintWallPiece(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  ox: number,
  oy: number,
  ts: number,
): void {
  const rng = mulberry32(piece.grain + GRAIN_SEED_BASE);
  const isSide = (piece.east || piece.west) && !(piece.north || piece.south);
  if (piece.north) paintNorthRun(ctx, piece, ox, oy, ts, rng);
  else if (piece.south) paintSouthRun(ctx, piece, ox, oy, ts, rng);
  else if (isSide) paintSideRun(ctx, piece, ox, oy, ts, rng);
  paintPosts(ctx, piece, ox, oy, ts, rng);
  if (piece.lintel) paintLintel(ctx, piece, ox, oy, ts);
  if (piece.lantern) {
    const post = doorPostPlacement(piece);
    drawLantern(ctx, ox + post.lanternX * ts, oy + post.lanternY * ts, ts * LANTERN_SIZE_TILES);
  }
  if (piece.sign !== null) paintSign(ctx, piece, piece.sign, ox, oy, ts);
}
const GRAIN_SEED_BASE = 0x5eed;

/** The horizontal extent a north or south run covers in this tile, in tiles. */
function runSpan(piece: WallPiece): { readonly x0: number; readonly x1: number } {
  const x0 = piece.west ? WALL_THICKNESS_TILES : 0;
  const x1 = piece.east ? WALL_THICKNESS_TILES : 1;
  return { x0, x1 };
}

/** A wall cap: the top of the wall seen from above, a board laid along its length. */
function paintCap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  direction: 'horizontal' | 'vertical',
  ts: number,
  rng: Rng,
): void {
  if (w <= 0 || h <= 0) return;
  drawPlanks(ctx, x, y, w, h, rng, {
    direction,
    boardPx: ts * CAP_BOARD_TILES,
    base: WOOD.mid,
    highlight: WOOD.highlight,
    seam: WOOD.dark,
    nailChance: 0,
  });
  strokeInside(ctx, x, y, w, h, ts * INK_WIDTH_TILES);
}

/**
 * Outlines a rectangle with the whole stroke inside it. A stroke is centred on
 * its path, so an outline traced on a tile's edge would put half its width on
 * the walkable tile next door.
 */
function strokeInside(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lineWidth: number,
): void {
  const half = lineWidth / 2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x + half, y + half, w - lineWidth, h - lineWidth);
}

/** A plank wall face with its fieldstone footing course along the bottom. */
function paintFace(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  height: number,
  ts: number,
  rng: Rng,
  wattle: boolean,
): void {
  if (w <= 0 || height <= 0) return;
  const footing = height * FOOTING_SHARE;
  if (wattle) {
    drawWattle(ctx, x, top, w, height - footing, rng);
  } else {
    drawPlanks(ctx, x, top, w, height - footing, rng, {
      direction: 'horizontal',
      boardPx: ts * PLANK_BOARD_TILES,
      base: WOOD.body,
      highlight: WOOD.light,
      seam: WOOD.deep,
    });
  }
  drawFieldstones(ctx, x, top + height - footing, w, footing, rng, ts * STONE_COURSE_TILES);
  ctx.fillStyle = CAP_SHADOW;
  ctx.fillRect(x, top, w, Math.max(1, ts * CAP_SHADOW_TILES));
  const line = ts * INK_WIDTH_TILES;
  ctx.strokeStyle = INK;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.moveTo(x, top + height - line / 2);
  ctx.lineTo(x + w, top + height - line / 2);
  ctx.stroke();
}
const CAP_SHADOW_TILES = 0.06;

/** Fieldstone footing lying on the ground in the tile's outer half. */
function paintFooting(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  if (w <= 0 || h <= 0) return;
  drawFieldstones(ctx, x, y, w, h, rng, ts * FOOTING_STONE_TILES, FOOTING_MOSS_CHANCE);
  ctx.fillStyle = FOOTING_SHADOW;
  ctx.fillRect(x, y, w, h);
}
/** Moss on the footing's stones: the ground course is damp and shaded. */
const FOOTING_MOSS_CHANCE = 0.25;

function paintNorthRun(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  ox: number,
  oy: number,
  ts: number,
  rng: Rng,
): void {
  const { x0, x1 } = runSpan(piece);
  const left = ox + x0 * ts;
  const width = (x1 - x0) * ts;
  const foot = oy + ts;
  const faceTop = foot - HOLLOW_WALL_FACE_TILES * ts;
  const capTop = faceTop - WALL_THICKNESS_TILES * ts;
  // The footing's outer half and the corner's outer column sit behind the
  // face; only a side column at a corner shows beside it.
  if (piece.west) paintFooting(ctx, ox, oy, WALL_THICKNESS_TILES * ts, ts, ts, rng);
  if (piece.east) {
    paintFooting(ctx, ox + WALL_THICKNESS_TILES * ts, oy, WALL_THICKNESS_TILES * ts, ts, ts, rng);
  }
  paintCap(ctx, left, capTop, width, faceTop - capTop, 'horizontal', ts, rng);
  paintFace(ctx, left, faceTop, width, foot - faceTop, ts, rng, piece.wattle);
  paintCapMoss(ctx, left, capTop, width, ts, rng);
  paintFaceFeature(ctx, piece.feature, left, faceTop, width, foot - faceTop, ts, rng);
  if (piece.leaf) paintDoorLeafFlat(ctx, left, faceTop, width, foot - faceTop, ts, rng);
}

/** Moss creeping along the cap's north edge — the one north-facing surface this view shows. */
function paintCapMoss(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  ts: number,
  rng: Rng,
): void {
  const tufts = Math.max(1, Math.round(w / (ts * MOSS_TUFT_SPACING_TILES)));
  for (let tuft = 0; tuft < tufts; tuft++) {
    if (rng() > MOSS_TUFT_CHANCE) continue;
    const tx = x + ((tuft + rng()) / tufts) * w;
    const radius = ts * MOSS_TUFT_RADIUS_TILES * (MOSS_TUFT_MIN_SCALE + rng());
    fillRoundRect(ctx, tx - radius, y, radius * 2, radius, radius / 2, MOSS.body);
  }
}
const MOSS_TUFT_SPACING_TILES = 0.25;
const MOSS_TUFT_CHANCE = 0.55;
const MOSS_TUFT_RADIUS_TILES = 0.06;
const MOSS_TUFT_MIN_SCALE = 0.6;

function paintFaceFeature(
  ctx: CanvasRenderingContext2D,
  feature: FaceFeature,
  x: number,
  top: number,
  w: number,
  height: number,
  ts: number,
  rng: Rng,
): void {
  const centreX = x + w / 2;
  switch (feature) {
    case 'plain':
      return;
    case 'window': {
      const radius = ts * PORTHOLE_RADIUS_TILES;
      const cy = top + height * PORTHOLE_HEIGHT_SHARE;
      // Plank shutters folded back either side of the round frame.
      for (const side of [-1, 1]) {
        const shutterX =
          side < 0
            ? centreX - radius * (1 + SHUTTER_GAP_SHARE) - radius
            : centreX + radius * (1 + SHUTTER_GAP_SHARE);
        drawPlanks(ctx, shutterX, cy - radius, radius, radius * 2, rng, {
          direction: 'vertical',
          boardPx: radius / SHUTTER_BOARDS,
          base: WOOD.dark,
          highlight: WOOD.mid,
          seam: WOOD.deep,
          nailChance: 0,
        });
        strokeInside(ctx, shutterX, cy - radius, radius, radius * 2, ts * INK_WIDTH_TILES);
      }
      ctx.fillStyle = WOOD.highlight;
      ctx.beginPath();
      ctx.arc(centreX, cy, radius * PORTHOLE_FRAME_SCALE, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = WINDOW_GLASS;
      ctx.beginPath();
      ctx.arc(centreX, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = WOOD.dark;
      ctx.lineWidth = ts * INK_WIDTH_TILES;
      ctx.beginPath();
      ctx.moveTo(centreX - radius, cy);
      ctx.lineTo(centreX + radius, cy);
      ctx.moveTo(centreX, cy - radius);
      ctx.lineTo(centreX, cy + radius);
      ctx.stroke();
      ctx.fillStyle = WINDOW_GLINT;
      ctx.beginPath();
      ctx.arc(
        centreX - radius * GLINT_OFFSET_SHARE,
        cy - radius * GLINT_OFFSET_SHARE,
        radius * GLINT_RADIUS_SHARE,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.arc(centreX, cy, radius * PORTHOLE_FRAME_SCALE, 0, Math.PI * 2);
      ctx.strokeStyle = INK;
      ctx.stroke();
      return;
    }
    case 'shelf': {
      const shelfY = top + height * SHELF_HEIGHT_SHARE;
      const shelfW = w * SHELF_WIDTH_SHARE;
      const shelfX = centreX - shelfW / 2;
      const jarCount = JARS_PER_SHELF;
      for (let jar = 0; jar < jarCount; jar++) {
        const jarW = shelfW / (jarCount + 1);
        const jarH = ts * JAR_HEIGHT_TILES * (JAR_MIN_SCALE + rng() * (1 - JAR_MIN_SCALE));
        const jarCentre = shelfX + ((jar + 1 / 2) / jarCount) * shelfW;
        const tone = jar % 2 === 0 ? CLOTH.linen.dark : STONE.light;
        fillRoundRect(
          ctx,
          jarCentre - jarW / 2,
          shelfY - jarH,
          jarW,
          jarH,
          jarW * JAR_CORNER_SHARE,
          tone,
        );
      }
      const board = ts * SHELF_BOARD_TILES;
      fillRoundRect(ctx, shelfX, shelfY, shelfW, board, board / 2, WOOD.light);
      strokeInside(ctx, shelfX, shelfY, shelfW, board, ts * INK_WIDTH_TILES);
      return;
    }
    case 'pegs': {
      const railY = top + height * PEG_RAIL_HEIGHT_SHARE;
      const rail = ts * PEG_RAIL_TILES;
      const railInset = w * PEG_RAIL_INSET_SHARE;
      fillRoundRect(ctx, x + railInset, railY, w - railInset * 2, rail, rail / 2, WOOD.light);
      for (const [index, along] of PEG_POSITIONS.entries()) {
        const px = x + w * along;
        const peg = ts * PEG_WIDTH_TILES;
        ctx.fillStyle = WOOD.deep;
        ctx.fillRect(px - peg / 2, railY - peg / 2, peg, rail + peg);
        // Things hung up by use, so a stretch of wall reads as lived beside.
        if (index === 0) {
          ctx.strokeStyle = CLOTH.linen.dark;
          ctx.lineWidth = ts * ROPE_WIDTH_TILES;
          ctx.beginPath();
          ctx.ellipse(
            px,
            railY + ts * ROPE_COIL_DROP_TILES,
            ts * ROPE_COIL_RX_TILES,
            ts * ROPE_COIL_RY_TILES,
            0,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        } else if (index === PEG_POSITIONS.length - 1) {
          const clothW = ts * HUNG_CLOTH_W_TILES;
          fillRoundRect(
            ctx,
            px - clothW / 2,
            railY + rail / 2,
            clothW,
            ts * HUNG_CLOTH_H_TILES,
            clothW * JAR_CORNER_SHARE,
            CLOTH.woad.body,
          );
        }
      }
      return;
    }
  }
}
const PORTHOLE_RADIUS_TILES = 0.17;
/** The shutters stand this far off the frame, as a share of the porthole's radius. */
const SHUTTER_GAP_SHARE = 0.05;
const SHUTTER_BOARDS = 2;
const GLINT_OFFSET_SHARE = 0.4;
const GLINT_RADIUS_SHARE = 0.3;
const JAR_CORNER_SHARE = 0.3;
const PEG_RAIL_INSET_SHARE = 0.12;
const PEG_WIDTH_TILES = 0.06;
const ROPE_COIL_DROP_TILES = 0.14;
const ROPE_COIL_RX_TILES = 0.07;
const ROPE_COIL_RY_TILES = 0.11;
const HUNG_CLOTH_W_TILES = 0.12;
const HUNG_CLOTH_H_TILES = 0.24;
const PORTHOLE_HEIGHT_SHARE = 0.4;
const PORTHOLE_FRAME_SCALE = 1.28;
const SHELF_HEIGHT_SHARE = 0.45;
const SHELF_WIDTH_SHARE = 0.72;
const SHELF_BOARD_TILES = 0.05;
const JARS_PER_SHELF = 3;
const JAR_HEIGHT_TILES = 0.15;
const JAR_MIN_SCALE = 0.6;
const PEG_RAIL_HEIGHT_SHARE = 0.3;
const PEG_RAIL_TILES = 0.05;
const PEG_POSITIONS = [0.25, 0.5, 0.75] as const;
const ROPE_WIDTH_TILES = 0.035;

/** The open door, swung back flat against the north wall's inner face beside its doorway. */
function paintDoorLeafFlat(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  height: number,
  ts: number,
  rng: Rng,
): void {
  const leafW = Math.min(w, ts) * DOOR_LEAF_WIDTH_SHARE;
  const leafH = height * DOOR_LEAF_HEIGHT_SHARE;
  const leafX = x + w - leafW - ts * DOOR_LEAF_INSET_TILES;
  const leafTop = top + height - leafH;
  paintRoundTopDoor(ctx, leafX, leafTop, leafW, leafH, ts, rng);
}
const DOOR_LEAF_WIDTH_SHARE = 0.72;
const DOOR_LEAF_HEIGHT_SHARE = 0.86;
const DOOR_LEAF_INSET_TILES = 0.04;

/** A low round-topped plank door with brass strap hinges. */
function paintRoundTopDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.moveTo(x, top + h);
    ctx.lineTo(x, top + w / 2);
    ctx.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, top + h);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    drawPlanks(ctx, x, top, w, h, rng, {
      direction: 'vertical',
      boardPx: w / DOOR_BOARDS,
      base: WOOD.mid,
      highlight: WOOD.highlight,
      seam: WOOD.dark,
      nailChance: 0,
    });
    ctx.fillStyle = BRASS.body;
    for (const strap of DOOR_STRAPS) {
      ctx.fillRect(x, top + h * strap, w * DOOR_STRAP_LENGTH, ts * DOOR_STRAP_TILES);
    }
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = ts * INK_WIDTH_TILES;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}
const DOOR_BOARDS = 3;
const DOOR_STRAPS = [0.35, 0.72] as const;
const DOOR_STRAP_LENGTH = 0.6;
const DOOR_STRAP_TILES = 0.04;

function paintSouthRun(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  ox: number,
  oy: number,
  ts: number,
  rng: Rng,
): void {
  const { x0, x1 } = runSpan(piece);
  const left = ox + x0 * ts;
  const width = (x1 - x0) * ts;
  const bodyFoot = oy + WALL_THICKNESS_TILES * ts;
  const faceTop = bodyFoot - HOLLOW_WALL_CUTAWAY_TILES * ts;
  const capTop = faceTop - WALL_THICKNESS_TILES * ts;
  // The door leaf stands inside, against the wall, so it is drawn first and
  // the cutaway covers its foot.
  if (piece.leaf) {
    const leafW = ts * DOOR_LEAF_WIDTH_SHARE;
    const leafH = ts * LOW_DOOR_LEAF_TILES;
    const leafX = piece.doorEast ? ox + ts - leafW - ts * DOOR_LEAF_INSET_TILES : left;
    paintRoundTopDoor(ctx, leafX, oy - leafH + ts * LEAF_FOOT_INSET_TILES, leafW, leafH, ts, rng);
  }
  paintFooting(ctx, ox, bodyFoot, ts, ts - WALL_THICKNESS_TILES * ts, ts, rng);
  if (piece.west) paintFooting(ctx, ox, oy, WALL_THICKNESS_TILES * ts, ts, ts, rng);
  if (piece.east) {
    paintFooting(ctx, ox + WALL_THICKNESS_TILES * ts, oy, WALL_THICKNESS_TILES * ts, ts, ts, rng);
  }
  paintCap(ctx, left, capTop, width, faceTop - capTop, 'horizontal', ts, rng);
  paintFace(ctx, left, faceTop, width, bodyFoot - faceTop, ts, rng, piece.wattle);
  if (piece.flowers !== null) paintFlowerBox(ctx, piece.flowers, left, bodyFoot, width, ts, rng);
}
/** The open leaf of a door in a cut-down wall: taller than the wall, so its top shows over it. */
const LOW_DOOR_LEAF_TILES = 0.85;
const LEAF_FOOT_INSET_TILES = 0.3;

/** A planter on the footing in front of a south cutaway, with blooms in the household's colour. */
function paintFlowerBox(
  ctx: CanvasRenderingContext2D,
  colour: ClothColour,
  x: number,
  footY: number,
  w: number,
  ts: number,
  rng: Rng,
): void {
  const boxW = w * FLOWER_BOX_WIDTH_SHARE;
  const boxX = x + (w - boxW) / 2;
  const boxH = ts * FLOWER_BOX_HEIGHT_TILES;
  const boxTop = footY - boxH * FLOWER_BOX_RISE_SHARE;
  const blooms = FLOWER_BLOOMS;
  for (let bloom = 0; bloom < blooms; bloom++) {
    const bx =
      boxX + ((bloom + 1 / 2) / blooms) * boxW + (rng() - 1 / 2) * ts * FLOWER_JITTER_TILES;
    const by = boxTop - ts * (FLOWER_LEAF_RISE_TILES + rng() * FLOWER_LEAF_RISE_TILES);
    const leafW = ts * FLOWER_LEAF_WIDTH_TILES;
    fillRoundRect(ctx, bx - leafW / 2, by, leafW, boxTop - by, leafW / 2, MOSS.body);
    const tone = bloom % 2 === 0 ? CLOTH[colour].light : CLOTH[colour].body;
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(bx, by, ts * FLOWER_BLOOM_RADIUS_TILES, 0, Math.PI * 2);
    ctx.fill();
  }
  fillRoundRect(ctx, boxX, boxTop, boxW, boxH, boxH * FLOWER_BOX_CORNER_SHARE, WOOD.mid);
  ctx.fillStyle = WOOD.dark;
  ctx.fillRect(boxX, boxTop + boxH * FLOWER_BOX_LIT_SHARE, boxW, boxH * (1 - FLOWER_BOX_LIT_SHARE));
  strokeInside(ctx, boxX, boxTop, boxW, boxH, ts * INK_WIDTH_TILES);
}
const FLOWER_BOX_WIDTH_SHARE = 0.8;
const FLOWER_BOX_HEIGHT_TILES = 0.18;
/** How much of the box stands above the foot of the wall it sits against. */
const FLOWER_BOX_RISE_SHARE = 0.4;
const FLOWER_BLOOMS = 3;
const FLOWER_LEAF_RISE_TILES = 0.09;
const FLOWER_BLOOM_RADIUS_TILES = 0.085;
const FLOWER_JITTER_TILES = 0.04;
const FLOWER_LEAF_WIDTH_TILES = 0.1;
const FLOWER_BOX_CORNER_SHARE = 0.15;
/** The lit top board's share of the box; the rest is its shaded front. */
const FLOWER_BOX_LIT_SHARE = 0.55;

function paintSideRun(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  ox: number,
  oy: number,
  ts: number,
  rng: Rng,
): void {
  const bodyX = ox + (piece.west ? WALL_THICKNESS_TILES : 0) * ts;
  const footingX = ox + (piece.west ? 0 : WALL_THICKNESS_TILES) * ts;
  const width = WALL_THICKNESS_TILES * ts;
  const rise = HOLLOW_WALL_CUTAWAY_TILES * ts;
  paintFooting(ctx, footingX, oy, width, ts, ts, rng);
  // Beside a doorway the wall stops at the tile's edge against the gap, so its
  // end face — the one face of a side wall this view can see — shows there.
  const endsSouth = piece.doorSouth;
  const endsNorth = piece.doorNorth;
  const capTop = oy - rise + (endsNorth ? POST_WIDTH_TILES * ts : 0);
  const capBottom = oy + ts - rise;
  if (piece.leaf) {
    const leafH = ts * LOW_DOOR_LEAF_TILES;
    const leafX = piece.west ? bodyX + width - ts * SIDE_LEAF_THICKNESS_TILES : bodyX;
    const leafW = ts * SIDE_LEAF_THICKNESS_TILES;
    fillRoundRect(ctx, leafX, oy + ts - leafH, leafW, leafH, leafW / 2, WOOD.mid);
  }
  paintCap(ctx, bodyX, capTop, width, capBottom - capTop, 'vertical', ts, rng);
  if (endsSouth) paintFace(ctx, bodyX, capBottom, width, rise, ts, rng, piece.wattle);
}
/** An open door seen edge-on against a side wall: a thin board. */
const SIDE_LEAF_THICKNESS_TILES = 0.1;

/** The log posts: at a corner, and on a jamb beside its doorway. */
function paintPosts(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  ox: number,
  oy: number,
  ts: number,
  rng: Rng,
): void {
  const isCorner = (piece.north || piece.south) && (piece.east || piece.west);
  const nextToDoor = piece.doorEast || piece.doorWest || piece.doorNorth || piece.doorSouth;
  if (!isCorner && !nextToDoor) return;
  const post = doorPostPlacement(piece);
  if (isCorner && !nextToDoor) {
    const bodyX = piece.west ? WALL_THICKNESS_TILES : 0;
    const bodyY = piece.north ? WALL_THICKNESS_TILES : 0;
    paintLogPost(
      ctx,
      ox + (bodyX + (WALL_THICKNESS_TILES - POST_WIDTH_TILES) / 2) * ts,
      oy + (bodyY + WALL_THICKNESS_TILES) * ts,
      post.height,
      ts,
      rng,
    );
    return;
  }
  paintLogPost(ctx, ox + post.x * ts, oy + post.footY * ts, post.height, ts, rng);
}

/** One upright log: barked front, a pale cut end on top. */
function paintLogPost(
  ctx: CanvasRenderingContext2D,
  x: number,
  footY: number,
  heightTiles: number,
  ts: number,
  rng: Rng,
): void {
  const w = POST_WIDTH_TILES * ts;
  const top = footY - heightTiles * ts;
  fillRoundRect(ctx, x, top, w, footY - top, w * POST_CORNER_SHARE, LOG.bark);
  ctx.fillStyle = LOG.barkLight;
  // The lit stripe starts below the cut end, which is drawn over the top.
  const litTop = top + w * POST_END_DROP;
  const litBottom = footY - w * POST_LIGHT_FOOT_SHARE;
  ctx.fillRect(x + w * POST_LIGHT_INSET, litTop, w * POST_LIGHT_WIDTH, litBottom - litTop);
  ctx.strokeStyle = LOG.barkDark;
  ctx.lineWidth = Math.max(1, ts * INK_WIDTH_TILES);
  for (let furrow = 0; furrow < POST_FURROWS; furrow++) {
    const fx = x + w * (POST_FURROW_BAND_START + POST_FURROW_BAND_WIDTH * rng());
    const drift = (rng() - 1 / 2) * ts * POST_FURROW_DRIFT_TILES;
    ctx.beginPath();
    ctx.moveTo(fx, top + w / 2 + rng() * ts * POST_FURROW_SLACK_TILES);
    ctx.lineTo(fx + drift, footY - rng() * ts * POST_FURROW_SLACK_TILES);
    ctx.stroke();
  }
  const line = ts * INK_WIDTH_TILES;
  ctx.strokeStyle = INK;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.roundRect(x + line / 2, top, w - line, footY - top - line / 2, w * POST_CORNER_SHARE);
  ctx.stroke();
  drawLogEnd(ctx, x + w / 2, top + w * POST_END_DROP, w / 2, w * POST_END_SQUASH);
  ctx.beginPath();
  ctx.ellipse(x + w / 2, top + w * POST_END_DROP, w / 2, w * POST_END_SQUASH, 0, 0, Math.PI * 2);
  ctx.stroke();
}
const POST_CORNER_SHARE = 0.2;
const POST_LIGHT_INSET = 0.14;
const POST_LIGHT_WIDTH = 0.22;
/** The lit stripe stops short of the foot, where the post is in its own shadow. */
const POST_LIGHT_FOOT_SHARE = 0.25;
const POST_FURROWS = 2;
/** Furrows keep to the middle of the log's face, where the bark is not in shadow. */
const POST_FURROW_BAND_START = 0.3;
const POST_FURROW_BAND_WIDTH = 0.4;
/** How far a furrow may start below the top or stop above the foot. */
const POST_FURROW_SLACK_TILES = 0.2;
const POST_FURROW_DRIFT_TILES = 0.06;
/** The cut end is an ellipse: a disc seen from above at this game's tilt. */
const POST_END_SQUASH = 0.28;
const POST_END_DROP = 0.3;

/** The carved lintel over a narrow north doorway, spanning the gap on the cap line. */
function paintLintel(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  ox: number,
  oy: number,
  ts: number,
): void {
  const foot = oy + ts;
  const faceTop = foot - HOLLOW_WALL_FACE_TILES * ts;
  const x = ox + (1 - POST_WIDTH_TILES) * ts;
  const w = (piece.doorWidth + POST_WIDTH_TILES) * ts;
  const y = faceTop - LINTEL_DEPTH_TILES * ts * LINTEL_RAISE_SHARE;
  const h = LINTEL_DEPTH_TILES * ts;
  fillRoundRect(ctx, x, y, w, h, h * LINTEL_CORNER_SHARE, WOOD.mid);
  ctx.fillStyle = WOOD.dark;
  ctx.fillRect(x, y + h * LINTEL_LIT_SHARE, w, h * (1 - LINTEL_LIT_SHARE));
  strokeInside(ctx, x, y, w, h, ts * INK_WIDTH_TILES);
  drawBriarKnot(ctx, x + w / 2, y + h / 2, h * LINTEL_KNOT_SCALE, WOOD.worn, ts * INK_WIDTH_TILES);
}
/** How much of the lintel rises above the face top rather than hanging below it. */
const LINTEL_RAISE_SHARE = 0.5;
const LINTEL_KNOT_SCALE = 0.42;
const LINTEL_CORNER_SHARE = 0.2;
/** The beam's lit upper face; below it, its shaded front. */
const LINTEL_LIT_SHARE = 0.7;

/** A hanging signboard with a shop's pictogram, on its bracket above the jamb. */
function paintSign(
  ctx: CanvasRenderingContext2D,
  piece: WallPiece,
  pictogram: SignPictogram,
  ox: number,
  oy: number,
  ts: number,
): void {
  const post = doorPostPlacement(piece);
  const boardW = ts * SIGN_WIDTH_TILES;
  const boardH = ts * SIGN_HEIGHT_TILES;
  const postCentre = post.x + POST_WIDTH_TILES / 2;
  const halfSpan = SIGN_WIDTH_TILES / 2 + SIGN_EDGE_MARGIN_TILES;
  const centreX = ox + Math.min(1 - halfSpan, Math.max(halfSpan, postCentre)) * ts;
  // The board hangs from a bracket above the post, clear of the post's cut end.
  const chainDrop = boardH * SIGN_CHAIN_SHARE;
  const boardTop = oy + (post.footY - post.height) * ts - boardH - ts * SIGN_LIFT_TILES;
  const top = boardTop - chainDrop;
  ctx.strokeStyle = IRON.dark;
  ctx.lineWidth = ts * INK_WIDTH_TILES;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const chainX = centreX + side * boardW * SIGN_CHAIN_SPREAD_SHARE;
    ctx.moveTo(chainX, top);
    ctx.lineTo(chainX, boardTop);
  }
  ctx.stroke();
  const boardLeft = centreX - boardW / 2;
  fillRoundRect(ctx, boardLeft, boardTop, boardW, boardH, boardH * SIGN_CORNER_SHARE, WOOD.light);
  strokeInside(ctx, boardLeft, boardTop, boardW, boardH, ts * INK_WIDTH_TILES);
  paintPictogram(ctx, pictogram, centreX, boardTop + boardH / 2, boardH * SIGN_PICTOGRAM_SHARE, ts);
}
const SIGN_WIDTH_TILES = 0.8;
const SIGN_HEIGHT_TILES = 0.5;
const SIGN_LIFT_TILES = 0.1;
/** The two short chains the board hangs from: their drop, and how far apart they hang. */
const SIGN_CHAIN_SHARE = 0.16;
const SIGN_CHAIN_SPREAD_SHARE = 0.3;
const SIGN_CORNER_SHARE = 0.1;
const SIGN_PICTOGRAM_SHARE = 1.05;
/** Keeps the board off its tile's edge, where the next tile is walkable street. */
const SIGN_EDGE_MARGIN_TILES = 0.04;

/** A point of a pictogram, in half-sizes from its centre: x right, y down. */
type PictogramPoint = readonly [number, number];

const ANVIL_OUTLINE: readonly PictogramPoint[] = [
  [-1, -0.4],
  [0.7, -0.4],
  [0.3, 0],
  [0.3, 0.3],
  [0.6, 0.6],
  [-0.6, 0.6],
  [-0.3, 0.3],
  [-0.3, 0],
];
const MORTAR_OUTLINE: readonly PictogramPoint[] = [
  [-0.7, -0.2],
  [0.7, -0.2],
  [0.4, 0.6],
  [-0.4, 0.6],
];
const PESTLE_LINE: readonly PictogramPoint[] = [
  [0.1, -0.1],
  [0.7, -1],
];
/** The bowl: a half disc, with one curl of steam over it. */
const BOWL_CENTRE: PictogramPoint = [0, -0.2];
const BOWL_RADIUS = 0.8;
const STEAM_CURVE: readonly PictogramPoint[] = [
  [-0.2, -0.4],
  [-0.5, -0.8],
  [-0.1, -1],
];
const COIN_RADIUS = 0.85;
const COIN_FACE_RADIUS = 0.62;
const COIN_HOLE_RADIUS = 0.2;
const GEAR_OUTER_RADIUS = 0.95;
const GEAR_ROOT_RADIUS = 0.6;
const GEAR_HUB_RADIUS = 0.28;
/** The saw blade's spine, its toothed edge, and its handle. */
const SAW_SPINE: readonly PictogramPoint[] = [
  [-0.9, -0.3],
  [0.6, -0.3],
  [0.6, 0.2],
];
const SAW_EDGE_Y = 0.2;
const SAW_TOOTH_Y = 0.45;
const SAW_BLADE_LENGTH = 1.5;
const SAW_HANDLE: readonly PictogramPoint[] = [
  [0.55, -0.5],
  [0.9, 0.4],
];

/** The shop's mark, burnt dark into the board. */
function paintPictogram(
  ctx: CanvasRenderingContext2D,
  pictogram: SignPictogram,
  cx: number,
  cy: number,
  size: number,
  ts: number,
): void {
  const half = size / 2;
  const at = ([px, py]: PictogramPoint): [number, number] => [cx + px * half, cy + py * half];
  const tracePolygon = (points: readonly PictogramPoint[]): void => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const [x, y] = at(point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  };
  ctx.fillStyle = WOOD.deep;
  ctx.strokeStyle = WOOD.deep;
  ctx.lineWidth = Math.max(1, ts * PICTOGRAM_LINE_TILES);
  switch (pictogram) {
    case 'anvil':
      tracePolygon(ANVIL_OUTLINE);
      ctx.closePath();
      ctx.fill();
      return;
    case 'bowl': {
      const [bx, by] = at(BOWL_CENTRE);
      ctx.beginPath();
      ctx.arc(bx, by, half * BOWL_RADIUS, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      const [start, control, end] = STEAM_CURVE.map(at);
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      ctx.quadraticCurveTo(control[0], control[1], end[0], end[1]);
      ctx.stroke();
      return;
    }
    case 'mortar':
      tracePolygon(MORTAR_OUTLINE);
      ctx.closePath();
      ctx.fill();
      tracePolygon(PESTLE_LINE);
      ctx.stroke();
      return;
    case 'coin':
      ctx.beginPath();
      ctx.arc(cx, cy, half * COIN_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      // A brass face inside a dark rim, with a square-ish hole: a coin reads
      // by its rim and its hole, not by its disc.
      ctx.fillStyle = BRASS.light;
      ctx.beginPath();
      ctx.arc(cx, cy, half * COIN_FACE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = WOOD.deep;
      ctx.beginPath();
      ctx.arc(cx, cy, half * COIN_HOLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'gear': {
      ctx.beginPath();
      const corners = GEAR_TEETH * 2;
      for (let corner = 0; corner < corners; corner++) {
        const angle = (corner / corners) * Math.PI * 2;
        const radius = half * (corner % 2 === 0 ? GEAR_OUTER_RADIUS : GEAR_ROOT_RADIUS);
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (corner === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = WOOD.light;
      ctx.beginPath();
      ctx.arc(cx, cy, half * GEAR_HUB_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'saw': {
      tracePolygon(SAW_SPINE);
      const toothPitch = SAW_BLADE_LENGTH / SAW_TEETH;
      const [spineEndX] = at(SAW_SPINE[SAW_SPINE.length - 1]);
      for (let tooth = 0; tooth < SAW_TEETH; tooth++) {
        const tipX = spineEndX - (tooth + 1 / 2) * toothPitch * half;
        ctx.lineTo(tipX, cy + SAW_TOOTH_Y * half);
        ctx.lineTo(tipX - (toothPitch * half) / 2, cy + SAW_EDGE_Y * half);
      }
      ctx.closePath();
      ctx.fill();
      const [[hx0, hy0], [hx1, hy1]] = SAW_HANDLE.map(at);
      ctx.fillRect(hx0, hy0, hx1 - hx0, hy1 - hy0);
      return;
    }
  }
}
const PICTOGRAM_LINE_TILES = 0.07;
const GEAR_TEETH = 6;
const SAW_TEETH = 5;

// ── Threshold ─────────────────────────────────────────────────────────────────

/**
 * The worn sill board across a doorway, laid over the floor the ground pass
 * has already drawn. Only the wall's-width strip carries it; the rest of the
 * tile is floor, because a doorway is a gap in a half-tile wall.
 */
export function drawHollowThresholdSill(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const doorway = doorwaySide(structure, tx, ty);
  if (doorway === null) return;
  // An open side has no door to step over: its floor runs straight out, and
  // a sill along several tiles would read as a wall of its own.
  if (doorway.width >= OPEN_SIDE_MIN_WIDTH) return;
  const wall = doorway.wall;
  const rng = mulberry32(tileHash(tx, ty, GRAIN_SALT));
  const thickness = WALL_THICKNESS_TILES * ts * SILL_SHARE;
  const horizontal = wall === 'north' || wall === 'south';
  // The sill lies where the wall would stand: the inner half of the tile.
  const x = horizontal
    ? sx
    : wall === 'west'
      ? sx + ts * (1 - WALL_THICKNESS_TILES)
      : sx + ts * (WALL_THICKNESS_TILES - SILL_SHARE * WALL_THICKNESS_TILES);
  const y = !horizontal
    ? sy
    : wall === 'north'
      ? sy + ts * (1 - WALL_THICKNESS_TILES)
      : sy + ts * (WALL_THICKNESS_TILES - SILL_SHARE * WALL_THICKNESS_TILES);
  const w = horizontal ? ts : thickness;
  const h = horizontal ? thickness : ts;
  drawPlanks(ctx, x, y, w, h, rng, {
    direction: horizontal ? 'horizontal' : 'vertical',
    boardPx: thickness,
    base: WOOD.mid,
    highlight: WOOD.light,
    seam: WOOD.deep,
    nailChance: 1,
  });
  // Feet cross the middle of the sill, so that is where it is worn pale.
  const wearInset = (1 - SILL_WEAR_SHARE) / 2;
  ctx.fillStyle = SILL_WEAR;
  if (horizontal) ctx.fillRect(x + w * wearInset, y, w * SILL_WEAR_SHARE, h);
  else ctx.fillRect(x, y + h * wearInset, w, h * SILL_WEAR_SHARE);
}
/** Share of the wall's thickness the sill board covers. */
const SILL_SHARE = 0.7;
/** Share of the sill's length worn smooth. */
const SILL_WEAR_SHARE = 0.5;

/**
 * The ground palette a doorway's floor is drawn from. A threshold carries no
 * record of the floor it replaced, and the plain palette draws every one as
 * planks; a doorway into a building with a working floor — the forge's gravel,
 * the barn's and the sawmill's beaten earth — draws that floor instead, so the
 * doorway is not a strip of boards across a dirt yard.
 */
export function hollowThresholdPalette(
  structure: TileContent[][],
  tx: number,
  ty: number,
): GroundPalette {
  const site = briarHollowSiteFor(structure);
  const building = site?.buildings.find((candidate) =>
    candidate.doorways.some((door) => door.x === tx && door.y === ty),
  );
  if (building === undefined || building.floor === 'planks') return OVERWORLD_GROUND;
  return building.id === 'forge' ? GRAVEL_DOORWAY_PALETTE : EARTH_DOORWAY_PALETTE;
}

function doorwayPalette(material: GroundMaterial): GroundPalette {
  return {
    ...OVERWORLD_GROUND,
    materialForTileType: (type) =>
      type === HOLLOW_THRESHOLD ? material : OVERWORLD_GROUND.materialForTileType(type),
  };
}
const GRAVEL_DOORWAY_PALETTE = doorwayPalette('gravel');
const EARTH_DOORWAY_PALETTE = doorwayPalette('dirt');

/** Which wall a threshold tile is cut into and how wide its doorway is, or null when it is no known doorway. */
function doorwaySide(
  structure: TileContent[][],
  tx: number,
  ty: number,
): { readonly wall: Direction; readonly width: number } | null {
  const site = briarHollowSiteFor(structure);
  if (site === undefined) return null;
  for (const building of site.buildings) {
    if (!building.doorways.some((door) => door.x === tx && door.y === ty)) continue;
    const { rect } = building;
    const inRow = building.doorways.filter((door) => door.y === ty).length;
    const inColumn = building.doorways.filter((door) => door.x === tx).length;
    if (ty === rect.y) return { wall: 'north', width: inRow };
    if (ty === rect.y + rect.h - 1) return { wall: 'south', width: inRow };
    if (tx === rect.x) return { wall: 'west', width: inColumn };
    return { wall: 'east', width: inColumn };
  }
  return null;
}
