import type { TileContent } from '../tileTypes';
import {
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_THRESHOLD,
  HORDER_BOSS_ROOM_FLOOR,
  JUICER_BOSS_ROOM_FLOOR,
  KRAKAREN_BOSS_ROOM_FLOOR,
  ARENA_FLOOR,
  FLOOR_GRATE,
  SPIDER_LAB_FLOOR,
  CLUB_FLOOR,
  DANCE_FLOOR,
  DRILL_SAND_FLOOR,
  QUEST_EXIT_DOOR_CLOSED,
  QUEST_EXIT_DOOR_OPEN,
  positionHash,
} from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import { drawWallShadow } from './helpers';
import { drawGroundTile } from './groundTiles';
import { DUNGEON_GROUND } from '../dungeon/groundMaterials';
import { getSpriteDef } from '../../core/SpriteLoader';

const GYM_RUBBER_DOT_TILE_STRIDE = 3;
const GYM_RUBBER_DOT_ALPHA = 0.04;
const GYM_RUBBER_DOT_RADIUS_FRACTION = 0.18;
const GYM_RUBBER_DOT_CENTER_FRACTION = 0.5;
const GYM_LINE_TILE_STRIDE = 4;
const GYM_LINE_ALPHA = 0.18;

/**
 * The two tones of the Krakaren lair's wet stone, exported because her bake
 * gate measures her lightness against the floor she is seen on and a copied hex
 * goes stale the first time this file is retouched.
 */
export const KRAKAREN_LAIR_STONE_LIGHT = '#1a1e24';
export const KRAKAREN_LAIR_STONE_DARK = '#161a20';

const KRAKAREN_WET_SHEEN_HASH_X = 7;
const KRAKAREN_WET_SHEEN_HASH_Y = 13;
const KRAKAREN_WET_SHEEN_STRIDE = 5;
const KRAKAREN_ELLIPSE_MAJOR_FRACTION = 0.35;
const KRAKAREN_ELLIPSE_MINOR_FRACTION = 0.25;
const KRAKAREN_CRACK_HASH_X = 1;
const KRAKAREN_CRACK_HASH_Y = 3;
const KRAKAREN_CRACK_STRIDE = 7;
const KRAKAREN_CRACK_START_X_FRACTION = 0.2;
const KRAKAREN_CRACK_START_Y_FRACTION = 0.3;
const KRAKAREN_CRACK_END_X_FRACTION = 0.8;
const KRAKAREN_CRACK_END_Y_FRACTION = 0.7;
const KRAKAREN_SLIME_HASH_X = 11;
const KRAKAREN_SLIME_HASH_Y = 5;
const KRAKAREN_SLIME_STRIDE = 9;
const KRAKAREN_SLIME_CENTER_X_FRACTION = 0.6;
const KRAKAREN_SLIME_CENTER_Y_FRACTION = 0.4;
const KRAKAREN_SLIME_MAJOR_FRACTION = 0.12;
const KRAKAREN_SLIME_MINOR_FRACTION = 0.08;

const GRATE_BASE_FILL_FRACTION = 0.06;
const GRATE_GAP_DIVISIONS = 6;
const GRATE_HORIZONTAL_INSET_FRACTION = 0.1;
const GRATE_HORIZONTAL_WIDTH_FRACTION = 0.8;
const GRATE_FRAME_OUTER_FRACTION = 0.08;
const GRATE_FRAME_THICKNESS_FRACTION = 0.04;
const GRATE_FRAME_HEIGHT_FRACTION = 0.84;
const GRATE_VOID_INSET_FRACTION = 0.14;
const GRATE_VOID_SIZE_FRACTION = 0.72;
const GRATE_RIM_OUTER_FRACTION = 0.08;
const GRATE_RIM_SIZE_FRACTION = 0.84;

const SPIDER_WEB_HASH_X = 5;
const SPIDER_WEB_HASH_Y = 7;
const SPIDER_WEB_STRIDE = 9;
const SPIDER_WEB_START_X_FRACTION = 0.2;
const SPIDER_WEB_START_Y_FRACTION = 0.1;
const SPIDER_WEB_END_X_FRACTION = 0.8;
const SPIDER_WEB_END_Y_FRACTION = 0.9;
const SPIDER_WEB_ALT_START_X_FRACTION = 0.8;
const SPIDER_WEB_ALT_END_X_FRACTION = 0.2;

const CLUB_SUNBURST_TILE_STRIDE = 6;
const CLUB_SUNBURST_RAY_COUNT = 8;
const CLUB_SUNBURST_RADIUS_FRACTION = 0.32;
const CLUB_SUNBURST_CENTER_FRACTION = 0.5;
const DANCE_PANEL_INSET_FRACTION = 0.12;
const DANCE_PANEL_SIZE_FRACTION = 0.76;

// Lazily computed bounding box of HORDER_BOSS_ROOM_FLOOR tiles for a given map structure.
// Keyed on the structure array so it's automatically GC'd with the map.
const _hoarderBoundsCache = new WeakMap<
  TileContent[][],
  { minX: number; minY: number; maxX: number; maxY: number } | null
>();

function findHoarderBounds(
  structure: TileContent[][],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const cached = _hoarderBoundsCache.get(structure);
  if (cached !== undefined) return cached;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let y = 0; y < structure.length; y++) {
    const row = structure[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x].type === HORDER_BOSS_ROOM_FLOOR) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const result = isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  _hoarderBoundsCache.set(structure, result);
  return result;
}

const _spiderLabBoundsCache = new WeakMap<
  TileContent[][],
  { minX: number; minY: number; maxX: number; maxY: number } | null
>();

function findSpiderLabBounds(
  structure: TileContent[][],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const cached = _spiderLabBoundsCache.get(structure);
  if (cached !== undefined) return cached;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let y = 0; y < structure.length; y++) {
    const row = structure[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x].type === SPIDER_LAB_FLOOR) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const result = isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  _spiderLabBoundsCache.set(structure, result);
  return result;
}

/** Tiles per steel plate. The seam between plates is the floor's whole character. */
const ARENA_PLATE_TILES = 2;
/** Divisions of the anti-slip crosshatch inside a plate. */
const ARENA_GRID_DIVISIONS = 4;
const ARENA_RIVET_RADIUS = 1.3;
const ARENA_BASE = '#191b21';
/**
 * The two plate tones, exported because the ball's bake gate measures the boss's
 * contrast against the floor it rolls on and the review harness paints it as a
 * backdrop. Both had a copied hex that this file's own rewrite left behind, so the
 * gate was measuring against a colour the game no longer draws.
 */
export const ARENA_PLATE_LIGHT = '#20232b';
export const ARENA_PLATE_DARK = '#14161b';
const ARENA_HATCH = '#23262e';
const ARENA_SEAM = '#0d0e12';
const ARENA_SEAM_LIT = '#2f343e';
const ARENA_RIVET = '#333944';
const ARENA_RIVET_GLINT = '#4b5563';
const ARENA_SEAM_WIDTH = 2;
/** How far in from a tile's own edge a rivet sits, as a fraction of the tile. */
const ARENA_RIVET_INSET = 0.15;
const ARENA_RIVET_GLINT_OFFSET = 0.4;
const ARENA_RIVET_GLINT_RADIUS = 0.45;
const ARENA_HATCH_ALPHA = 0.55;

/**
 * Drain channels, cut on a stride so they read as a grid of gutters running to the
 * middle of the floor rather than as noise.
 *
 * The arena has to look like somewhere blood is expected. A drain is the cheapest
 * possible way to say that, and it gives an otherwise featureless 26-tile disc
 * something for the eye to measure the ball's line against.
 */
const ARENA_DRAIN_STRIDE = 7;
const ARENA_DRAIN_WIDTH_FRACTION = 0.22;
const ARENA_DRAIN_DARK = '#0a0b0e';
const ARENA_DRAIN_GRATE = '#1d2027';
const ARENA_DRAIN_BARS = 3;

/**
 * Coefficients that decorrelate the gouge and blood strides from each other and from
 * the drains. Their own constants rather than a reused geometry number: retuning the
 * plate size should not silently redistribute every stain on the floor.
 */
const ARENA_GOUGE_HASH_SKEW = 2;
const ARENA_BLOOD_HASH_SKEW = 2;

/** Gouges torn in the plate. Sparse, and never on the same tile as a drain. */
const ARENA_GOUGE_STRIDE = 5;
const ARENA_GOUGE_COUNT = 3;
const ARENA_GOUGE_LENGTH_FRACTION = 0.34;
const ARENA_GOUGE_ALPHA = 0.5;
const ARENA_GOUGE_COLOR = '#2b303a';

/** Dried blood, on its own coarser stride so stains and gouges rarely coincide. */
const ARENA_BLOOD_STRIDE = 6;
const ARENA_BLOOD_BLOTS = 4;
const ARENA_BLOOD_ALPHA = 0.3;
const ARENA_BLOOD_COLOR = '#5d1616';
const ARENA_BLOOD_DARK = '#33090c';
const ARENA_BLOOD_MAX_RADIUS_FRACTION = 0.17;

/**
 * A tile's own random stream.
 *
 * Hashed off the tile coordinate rather than seeded once per frame, so a tile paints
 * the same way every time it is drawn — the chunk cache redraws tiles whenever the
 * camera crosses a boundary, and a per-frame stream makes the whole floor crawl.
 */
function arenaTileNoise(tx: number, ty: number, salt: number): () => number {
  // `Math.imul` throughout: the plain multiply overflows 2^53 and quietly drops the
  // low bits, which is where an LCG keeps what little entropy it has.
  let state = Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663) ^ Math.imul(salt, 83492791);
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function drawArenaFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  // Plates alternate tone in a checker of `ARENA_PLATE_TILES`, which is what makes
  // the seams read as the edges of something rather than as a drawn grid.
  const plateX = Math.floor(tx / ARENA_PLATE_TILES);
  const plateY = Math.floor(ty / ARENA_PLATE_TILES);
  ctx.fillStyle = ARENA_BASE;
  ctx.fillRect(sx, sy, ts, ts);
  ctx.fillStyle = (plateX + plateY) % 2 === 0 ? ARENA_PLATE_LIGHT : ARENA_PLATE_DARK;
  ctx.fillRect(sx, sy, ts, ts);

  ctx.save();
  ctx.globalAlpha = ARENA_HATCH_ALPHA;
  ctx.strokeStyle = ARENA_HATCH;
  ctx.lineWidth = 1;
  const gridStep = ts / ARENA_GRID_DIVISIONS;
  for (let i = 1; i < ARENA_GRID_DIVISIONS; i++) {
    const at = Math.round(i * gridStep);
    ctx.beginPath();
    ctx.moveTo(sx + at + 0.5, sy);
    ctx.lineTo(sx + at + 0.5, sy + ts);
    ctx.moveTo(sx, sy + at + 0.5);
    ctx.lineTo(sx + ts, sy + at + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // Plate seams: a dark groove on the leading edge and a lit lip on the far side,
  // so the plate reads as sitting slightly above its neighbour.
  if (tx % ARENA_PLATE_TILES === 0) {
    ctx.fillStyle = ARENA_SEAM;
    ctx.fillRect(sx, sy, ARENA_SEAM_WIDTH, ts);
    ctx.fillStyle = ARENA_SEAM_LIT;
    ctx.fillRect(sx + ARENA_SEAM_WIDTH, sy, 1, ts);
  }
  if (ty % ARENA_PLATE_TILES === 0) {
    ctx.fillStyle = ARENA_SEAM;
    ctx.fillRect(sx, sy, ts, ARENA_SEAM_WIDTH);
    ctx.fillStyle = ARENA_SEAM_LIT;
    ctx.fillRect(sx, sy + ARENA_SEAM_WIDTH, ts, 1);
  }

  // One rivet per tile, in whichever of its corners is also a corner of the plate —
  // so a plate ends up bolted at its four corners without any tile having to paint
  // outside its own cell, which the chunk cache would clip.
  const rivetX =
    sx + ts * (tx % ARENA_PLATE_TILES === 0 ? ARENA_RIVET_INSET : 1 - ARENA_RIVET_INSET);
  const rivetY =
    sy + ts * (ty % ARENA_PLATE_TILES === 0 ? ARENA_RIVET_INSET : 1 - ARENA_RIVET_INSET);
  ctx.fillStyle = ARENA_RIVET;
  ctx.beginPath();
  ctx.arc(rivetX, rivetY, ARENA_RIVET_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ARENA_RIVET_GLINT;
  ctx.beginPath();
  ctx.arc(
    rivetX - ARENA_RIVET_RADIUS * ARENA_RIVET_GLINT_OFFSET,
    rivetY - ARENA_RIVET_RADIUS * ARENA_RIVET_GLINT_OFFSET,
    ARENA_RIVET_RADIUS * ARENA_RIVET_GLINT_RADIUS,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const onDrain = tx % ARENA_DRAIN_STRIDE === 0 || ty % ARENA_DRAIN_STRIDE === 0;
  if (onDrain) {
    const width = ts * ARENA_DRAIN_WIDTH_FRACTION;
    const inset = (ts - width) / 2;
    ctx.fillStyle = ARENA_DRAIN_DARK;
    if (tx % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx + inset, sy, width, ts);
    if (ty % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx, sy + inset, ts, width);
    ctx.fillStyle = ARENA_DRAIN_GRATE;
    for (let bar = 1; bar <= ARENA_DRAIN_BARS; bar++) {
      const along = (ts * bar) / (ARENA_DRAIN_BARS + 1);
      if (tx % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx + inset, sy + along, width, 1);
      if (ty % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx + along, sy + inset, 1, width);
    }
  } else if ((tx * ARENA_GOUGE_HASH_SKEW + ty) % ARENA_GOUGE_STRIDE === 0) {
    // Tusk gouges. Skipped on drain tiles, where the drain already owns the eye.
    const noise = arenaTileNoise(tx, ty, 1);
    ctx.save();
    ctx.globalAlpha = ARENA_GOUGE_ALPHA;
    ctx.strokeStyle = ARENA_GOUGE_COLOR;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const angle = noise() * Math.PI;
    for (let i = 0; i < ARENA_GOUGE_COUNT; i++) {
      const cx = sx + ts * (0.2 + noise() * 0.6);
      const cy = sy + ts * (0.2 + noise() * 0.6);
      const half = (ts * ARENA_GOUGE_LENGTH_FRACTION) / 2;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(angle) * half, cy - Math.sin(angle) * half);
      ctx.lineTo(cx + Math.cos(angle) * half, cy + Math.sin(angle) * half);
      ctx.stroke();
    }
    ctx.restore();
  }

  if ((tx + ty * ARENA_BLOOD_HASH_SKEW) % ARENA_BLOOD_STRIDE === 0) {
    const noise = arenaTileNoise(tx, ty, 2);
    ctx.save();
    ctx.globalAlpha = ARENA_BLOOD_ALPHA;
    for (let i = 0; i < ARENA_BLOOD_BLOTS; i++) {
      const cx = sx + ts * (0.15 + noise() * 0.7);
      const cy = sy + ts * (0.15 + noise() * 0.7);
      const r = ts * ARENA_BLOOD_MAX_RADIUS_FRACTION * (0.3 + noise() * 0.7);
      ctx.fillStyle = i % 2 === 0 ? ARENA_BLOOD_COLOR : ARENA_BLOOD_DARK;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * (0.5 + noise() * 0.5), noise() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

const DRILL_SAND_BASE = '#c0a878';
const DRILL_SAND_TRODDEN = 'rgba(146,124,84,0.32)';
const DRILL_SAND_GROOVE_SHADOW = 'rgba(120,98,62,0.5)';
const DRILL_SAND_GROOVE_LIGHT = 'rgba(226,208,168,0.4)';
const DRILL_SAND_GROOVE_COUNT = 3;
const DRILL_SAND_PATCH_FRACTION = 0.4;
const DRILL_SAND_HASH_X = 37;
const DRILL_SAND_HASH_Y = 53;
const DRILL_SAND_HASH_MOD = 89;

// Quest exit barricade — the doorway the goblin mother nails shut for the
// length of a wave the player took, and that same doorway smashed open once it
// ends. A floor generates neither: the room is walked through, not fought out of.
// Both states paint the doorway itself rather than an object standing in it: the
// timber overruns the tile edges on the doorway's own axis, so a three-tile
// doorway reads as one continuous run of boards and not as three stamps of the
// same crate. Nothing here uses the grey of `FLOOR_GRATE` — four of those sit in
// this very room, and the two must never read as relatives.

/** The unlit passage behind the boards; the gaps between planks read as depth against it. */
const DOOR_VOID_COLOR = '#080605';
/** Lifted a little in the smashed-open state so the way through reads as walkable, not filled in. */
const DOOR_OPEN_VOID_COLOR = '#100c08';
/** Shading down the jamb ends of the void, so the hole reads as a passage with sides. */
const DOOR_VOID_JAMB_SHADE = 'rgba(0,0,0,0.6)';
const DOOR_VOID_JAMB_SHADE_FRACTION = 0.14;

const DOOR_PLANK_COUNT = 4;
/**
 * How far past the tile edge every board runs. The boards are nailed to the
 * stone jambs — which are the *neighbouring* tiles — so a plank that stops at
 * the tile boundary would leave a hairline of floor at each end and turn the
 * barricade back into a piece of furniture.
 */
const DOOR_PLANK_OVERRUN_FRACTION = 0.15;
/** Dark seam between stacked boards; the void shows through it. */
const DOOR_PLANK_GAP_FRACTION = 0.06;
const DOOR_PLANK_LIGHT_EDGE_FRACTION = 0.04;
const DOOR_PLANK_SHADOW_EDGE_FRACTION = 0.05;
/** Cast shadow thrown onto the void by the board above it. */
const DOOR_PLANK_CAST_SHADOW_FRACTION = 0.03;
const DOOR_PLANK_CAST_SHADOW_COLOR = 'rgba(0,0,0,0.75)';
const DOOR_PLANK_LOWER_SHADE_COLOR = 'rgba(0,0,0,0.22)';
const DOOR_PLANK_LOWER_SHADE_FRACTION = 0.4;

/**
 * Warm timber against cold stone: floor 1's masonry is a dark warm brown and
 * floor 2's a grey-green, and a board has to stay legible as wood on both. The
 * three tones are cycled per board so a stack never reads as one flat panel.
 */
const DOOR_PLANK_TONES = ['#7d5527', '#5f401d', '#8d6531'] as const;
const DOOR_PLANK_LIGHT_EDGE_COLOR = '#b18449';
const DOOR_PLANK_GRAIN_COLOR = 'rgba(40,22,8,0.45)';
const DOOR_PLANK_GRAIN_MARGIN_FRACTION = 0.12;

const DOOR_NAIL_COLOR = '#241f1c';
const DOOR_NAIL_HIGHLIGHT_COLOR = 'rgba(190,180,170,0.55)';
const DOOR_NAIL_RADIUS_FRACTION = 0.045;
const DOOR_NAIL_MIN_RADIUS_PX = 1;
/** How far in from the tile edge a nail bites, i.e. how far onto the stone jamb. */
const DOOR_NAIL_INSET_FRACTION = 0.09;

/**
 * Salts feeding `positionHash` for the several independent choices a barricade
 * tile makes (which board takes which tone, where the grain runs, how far a
 * snapped stub reaches, where a fragment landed). Kept apart from each other the
 * same way `KRAKAREN_CRACK_HASH_X/Y` are kept apart from the wet-sheen salts:
 * reusing a salt correlates two features meant to look independent.
 */
const DOOR_HASH_TONE_X = 163;
const DOOR_HASH_TONE_Y = 223;
const DOOR_HASH_GRAIN_X = 179;
const DOOR_HASH_GRAIN_Y = 227;
const DOOR_HASH_STUB_LENGTH_X = 191;
const DOOR_HASH_STUB_LENGTH_Y = 233;
const DOOR_HASH_TOOTH_X = 193;
const DOOR_HASH_TOOTH_Y = 239;
const DOOR_HASH_FRAGMENT_X = 241;
const DOOR_HASH_FRAGMENT_Y = 251;
const DOOR_HASH_FRAGMENT_ANGLE_X = 257;
const DOOR_HASH_FRAGMENT_ANGLE_Y = 263;
const DOOR_HASH_FRAGMENT_LENGTH_X = 269;
const DOOR_HASH_FRAGMENT_LENGTH_Y = 271;
const DOOR_HASH_FRAGMENT_TONE_X = 277;
const DOOR_HASH_FRAGMENT_TONE_Y = 281;
const DOOR_HASH_NAIL_X = 283;
const DOOR_HASH_NAIL_Y = 293;

/** Turns a `positionHash` result into a fraction in `[0, 1)`. */
const DOOR_HASH_UNIT_MOD = 1000;
function doorHashUnit(seedX: number, seedY: number): number {
  return (positionHash(seedX, seedY) % DOOR_HASH_UNIT_MOD) / DOOR_HASH_UNIT_MOD;
}

const DOOR_STUB_MIN_LENGTH_FRACTION = 0.18;
const DOOR_STUB_MAX_LENGTH_FRACTION = 0.4;
const DOOR_STUB_TEETH = 4;
/** How deep a snapped tooth bites into its stub, relative to the stub's own length. */
const DOOR_STUB_TOOTH_DEPTH_FRACTION = 0.6;

const DOOR_FRAGMENT_COUNT = 3;
const DOOR_FRAGMENT_MIN_LENGTH_FRACTION = 0.13;
const DOOR_FRAGMENT_MAX_LENGTH_FRACTION = 0.26;
const DOOR_FRAGMENT_THICKNESS_FRACTION = 0.07;
const DOOR_FRAGMENT_MIN_THICKNESS_PX = 2;
const DOOR_FRAGMENT_SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const DOOR_LOOSE_NAIL_COUNT = 2;
/** Fragments and nails are kept off the extreme edges so they don't clip in half. */
const DOOR_DEBRIS_MARGIN_FRACTION = 0.16;

/**
 * Which way the boards run: across the doorway, i.e. along the wall line they
 * plug a hole in. `horizontal` boards span the tile left to right.
 */
type DoorwayAxis = 'horizontal' | 'vertical';

/** Off the edge of the grid counts as solid: nothing can be walked to out there. */
function isSolidAt(structure: TileContent[][], x: number, y: number): boolean {
  const withinRows = y >= 0 && y < structure.length;
  if (!withinRows) return true;
  const row = structure[y];
  if (x < 0 || x >= row.length) return true;
  return !isWalkableTileType(row[x]);
}

function isBarricadeAt(structure: TileContent[][], x: number, y: number): boolean {
  const withinRows = y >= 0 && y < structure.length;
  if (!withinRows) return false;
  const row = structure[y];
  if (x < 0 || x >= row.length) return false;
  const { type } = row[x];
  return type === QUEST_EXIT_DOOR_CLOSED || type === QUEST_EXIT_DOOR_OPEN;
}

/**
 * The four directions a doorway can face, as unit steps paired with the step at
 * right angles to them.
 */
const DOORWAY_PROBE_DIRECTIONS = [
  { dx: 0, dy: -1, perpX: 1, perpY: 0 },
  { dx: 0, dy: 1, perpX: 1, perpY: 0 },
  { dx: -1, dy: 0, perpX: 0, perpY: 1 },
  { dx: 1, dy: 0, perpX: 0, perpY: 1 },
] as const;

const DEFAULT_DOORWAY_AXIS: DoorwayAxis = 'horizontal';

/**
 * Which way the boards run. A barricade tile is one of the room's own perimeter
 * *floor* tiles, not a tile of the wall line — the stone jambs sit one tile
 * further out — so neither of its along-wall neighbours is stone and the
 * orientation cannot be read from them directly.
 *
 * The run itself is the reliable signal: a wide doorway's tiles are all
 * barricades, and they lie along the wall. A one-tile doorway has no such
 * neighbour, so its facing is found by looking one tile outward and asking
 * which direction has stone on *both* sides of the gap; the boards then run at
 * right angles to that.
 */
function doorwayAxis(structure: TileContent[][], tx: number, ty: number): DoorwayAxis {
  const runsLeftToRight =
    isBarricadeAt(structure, tx - 1, ty) || isBarricadeAt(structure, tx + 1, ty);
  const runsTopToBottom =
    isBarricadeAt(structure, tx, ty - 1) || isBarricadeAt(structure, tx, ty + 1);
  // A doorway that wraps a room's corner has both, and neither answer is right
  // for the corner tile itself; the wall-line probe below settles it instead.
  if (runsLeftToRight && !runsTopToBottom) return 'horizontal';
  if (runsTopToBottom && !runsLeftToRight) return 'vertical';

  let outwardAxis: DoorwayAxis | null = null;
  for (const { dx, dy, perpX, perpY } of DOORWAY_PROBE_DIRECTIONS) {
    const flankedOnBothSides =
      isSolidAt(structure, tx + dx + perpX, ty + dy + perpY) &&
      isSolidAt(structure, tx + dx - perpX, ty + dy - perpY);
    if (!flankedOnBothSides) continue;
    // Boards run along the wall, i.e. across the way out.
    const axisAcrossThisDirection: DoorwayAxis = dy === 0 ? 'vertical' : 'horizontal';
    const alreadyClaimedByAnotherDirection =
      outwardAxis !== null && outwardAxis !== axisAcrossThisDirection;
    if (alreadyClaimedByAnotherDirection) return DEFAULT_DOORWAY_AXIS;
    outwardAxis = axisAcrossThisDirection;
  }
  return outwardAxis ?? DEFAULT_DOORWAY_AXIS;
}

/**
 * Whether the tile ends the run at the given end of the plank axis — i.e. the
 * board is nailed to stone there rather than carrying on into another barricade
 * tile. A one-tile doorway is an end at both ends; the middle of a wide run is
 * an end at neither, which is what keeps it reading as one opening.
 */
function isRunEnd(
  structure: TileContent[][],
  axis: DoorwayAxis,
  tx: number,
  ty: number,
  side: 'start' | 'end',
): boolean {
  const step = side === 'start' ? -1 : 1;
  const neighbourX = axis === 'horizontal' ? tx + step : tx;
  const neighbourY = axis === 'horizontal' ? ty : ty + step;
  return !isBarricadeAt(structure, neighbourX, neighbourY);
}

/**
 * Runs `paint` in a frame where the boards always span left to right, clipped to
 * the tile. A doorway in a side wall is the same barricade seen a quarter turn
 * round, so rotating the frame beats keeping two copies of the painter in step.
 */
function withDoorwayFrame(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  axis: DoorwayAxis,
  paint: () => void,
): void {
  const QUARTER_TURN = Math.PI / 2;
  const TILE_CENTER_FRACTION = 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  if (axis === 'vertical') {
    const centerX = sx + ts * TILE_CENTER_FRACTION;
    const centerY = sy + ts * TILE_CENTER_FRACTION;
    ctx.translate(centerX, centerY);
    ctx.rotate(QUARTER_TURN);
    ctx.translate(-centerX, -centerY);
  }
  paint();
  ctx.restore();
}

/**
 * The seed that must stay constant along a doorway run: a board that changed
 * colour or thickness at a tile boundary would break a three-wide doorway back
 * into three separate objects. Only the coordinate perpendicular to the run may
 * feed anything the eye tracks from tile to tile.
 */
function doorRunSeed(axis: DoorwayAxis, tx: number, ty: number): number {
  return axis === 'horizontal' ? ty : tx;
}

/**
 * The hole in the wall, before anything is nailed across it. The stone sides are
 * shaded only where the tile actually meets a jamb: shading both edges of every
 * tile drew a seam down the middle of a wide doorway and broke the run into
 * separate holes.
 */
function drawDoorwayVoid(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  color: string,
  jambAtStart: boolean,
  jambAtEnd: boolean,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, ts, ts);
  const jambShadeWidth = ts * DOOR_VOID_JAMB_SHADE_FRACTION;
  ctx.fillStyle = DOOR_VOID_JAMB_SHADE;
  if (jambAtStart) ctx.fillRect(sx, sy, jambShadeWidth, ts);
  if (jambAtEnd) ctx.fillRect(sx + ts - jambShadeWidth, sy, jambShadeWidth, ts);
}

function drawNailHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, ts: number): void {
  const radius = Math.max(DOOR_NAIL_MIN_RADIUS_PX, ts * DOOR_NAIL_RADIUS_FRACTION);
  ctx.fillStyle = DOOR_NAIL_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = DOOR_NAIL_HIGHLIGHT_COLOR;
  ctx.fillRect(cx - radius, cy - radius, radius, Math.max(1, radius / 2));
}

function doorPlankTone(runSeed: number, plankIndex: number): string {
  const toneIndex =
    (positionHash(runSeed * DOOR_HASH_TONE_X + plankIndex, runSeed * DOOR_HASH_TONE_Y) +
      plankIndex) %
    DOOR_PLANK_TONES.length;
  return DOOR_PLANK_TONES[toneIndex];
}

type BarricadeBand = { top: number; height: number };

function barricadeBand(sy: number, ts: number, plankIndex: number): BarricadeBand {
  const bandHeight = ts / DOOR_PLANK_COUNT;
  const gap = ts * DOOR_PLANK_GAP_FRACTION;
  return { top: sy + bandHeight * plankIndex + gap / 2, height: bandHeight - gap };
}

/** One heavy board of the barricade, running off both tile edges into the jambs. */
function drawBarricadePlank(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  runSeed: number,
  plankIndex: number,
  nailAtStart: boolean,
  nailAtEnd: boolean,
): void {
  const overrun = ts * DOOR_PLANK_OVERRUN_FRACTION;
  const left = sx - overrun;
  const width = ts + overrun * 2;
  const { top, height } = barricadeBand(sy, ts, plankIndex);

  ctx.fillStyle = DOOR_PLANK_CAST_SHADOW_COLOR;
  ctx.fillRect(left, top + height, width, ts * DOOR_PLANK_CAST_SHADOW_FRACTION);

  ctx.fillStyle = doorPlankTone(runSeed, plankIndex);
  ctx.fillRect(left, top, width, height);

  ctx.fillStyle = DOOR_PLANK_LOWER_SHADE_COLOR;
  const lowerShadeHeight = height * DOOR_PLANK_LOWER_SHADE_FRACTION;
  ctx.fillRect(left, top + height - lowerShadeHeight, width, lowerShadeHeight);

  const lightEdgeHeight = Math.max(1, ts * DOOR_PLANK_LIGHT_EDGE_FRACTION);
  ctx.fillStyle = DOOR_PLANK_LIGHT_EDGE_COLOR;
  ctx.fillRect(left, top, width, lightEdgeHeight);

  const shadowEdgeHeight = Math.max(1, ts * DOOR_PLANK_SHADOW_EDGE_FRACTION);
  ctx.fillStyle = DOOR_PLANK_CAST_SHADOW_COLOR;
  ctx.fillRect(left, top + height - shadowEdgeHeight, width, shadowEdgeHeight);

  // One grain line per board, not two: at 32 px a board is about seven pixels
  // tall and a second line turns the timber to noise.
  const grainMargin = ts * DOOR_PLANK_GRAIN_MARGIN_FRACTION;
  const grainY =
    top +
    lightEdgeHeight +
    (height - lightEdgeHeight - shadowEdgeHeight) *
      doorHashUnit(tx * DOOR_HASH_GRAIN_X + plankIndex, ty * DOOR_HASH_GRAIN_Y);
  ctx.fillStyle = DOOR_PLANK_GRAIN_COLOR;
  ctx.fillRect(sx + grainMargin, grainY, ts - grainMargin * 2, 1);

  // Nails only where the board actually meets stone. The middle tile of a wide
  // doorway touches no jamb, and a nail there would read as a post in mid-air.
  const nailY = top + height / 2;
  if (nailAtStart) drawNailHead(ctx, sx + ts * DOOR_NAIL_INSET_FRACTION, nailY, ts);
  if (nailAtEnd) drawNailHead(ctx, sx + ts * (1 - DOOR_NAIL_INSET_FRACTION), nailY, ts);
}

/**
 * A snapped-off length of board still nailed to one jamb, jagged where the rest
 * of it was smashed through — the evidence that this doorway was boarded at all
 * rather than simply left open.
 */
function drawSplinteredStub(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  runSeed: number,
  plankIndex: number,
  side: 'start' | 'end',
): void {
  const overrun = ts * DOOR_PLANK_OVERRUN_FRACTION;
  const sideChannel = side === 'start' ? 0 : 1;
  const lengthSpan = DOOR_STUB_MAX_LENGTH_FRACTION - DOOR_STUB_MIN_LENGTH_FRACTION;
  const stubLength =
    ts *
    (DOOR_STUB_MIN_LENGTH_FRACTION +
      lengthSpan *
        doorHashUnit(
          runSeed * DOOR_HASH_STUB_LENGTH_X + plankIndex,
          runSeed * DOOR_HASH_STUB_LENGTH_Y + sideChannel,
        ));
  const left = side === 'start' ? sx - overrun : sx + ts - stubLength;
  const width = stubLength + overrun;
  const { top, height } = barricadeBand(sy, ts, plankIndex);

  ctx.fillStyle = DOOR_PLANK_CAST_SHADOW_COLOR;
  ctx.fillRect(left, top + height, width, ts * DOOR_PLANK_CAST_SHADOW_FRACTION);

  ctx.fillStyle = doorPlankTone(runSeed, plankIndex);
  ctx.fillRect(left, top, width, height);

  const lightEdgeHeight = Math.max(1, ts * DOOR_PLANK_LIGHT_EDGE_FRACTION);
  ctx.fillStyle = DOOR_PLANK_LIGHT_EDGE_COLOR;
  ctx.fillRect(left, top, width, lightEdgeHeight);
  const shadowEdgeHeight = Math.max(1, ts * DOOR_PLANK_SHADOW_EDGE_FRACTION);
  ctx.fillStyle = DOOR_PLANK_CAST_SHADOW_COLOR;
  ctx.fillRect(left, top + height - shadowEdgeHeight, width, shadowEdgeHeight);

  // The broken end, cut back to the void colour along a zigzag. Rectangular
  // notches were tried first and read as a row of tidy blocks; a board that was
  // kicked through tears to points, and only the points say "smashed".
  const brokenEdgeX = side === 'start' ? left + width : left;
  const towardStub = side === 'start' ? -1 : 1;
  const maxToothDepth = stubLength * DOOR_STUB_TOOTH_DEPTH_FRACTION;
  ctx.fillStyle = DOOR_OPEN_VOID_COLOR;
  ctx.beginPath();
  ctx.moveTo(brokenEdgeX, top);
  for (let tooth = 0; tooth <= DOOR_STUB_TEETH; tooth++) {
    const depth =
      maxToothDepth *
      doorHashUnit(
        runSeed * DOOR_HASH_TOOTH_X + tooth + plankIndex,
        runSeed * DOOR_HASH_TOOTH_Y + sideChannel,
      );
    ctx.lineTo(brokenEdgeX + towardStub * depth, top + (height * tooth) / DOOR_STUB_TEETH);
  }
  ctx.lineTo(brokenEdgeX, top + height);
  ctx.closePath();
  ctx.fill();

  const nailX =
    side === 'start'
      ? sx + ts * DOOR_NAIL_INSET_FRACTION
      : sx + ts * (1 - DOOR_NAIL_INSET_FRACTION);
  drawNailHead(ctx, nailX, top + height / 2, ts);
}

/** Broken board fragments and bent nails left lying in the smashed doorway. */
function drawDoorDebris(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const margin = ts * DOOR_DEBRIS_MARGIN_FRACTION;
  const spread = ts - margin * 2;
  const thickness = Math.max(DOOR_FRAGMENT_MIN_THICKNESS_PX, ts * DOOR_FRAGMENT_THICKNESS_FRACTION);
  const lengthSpan = DOOR_FRAGMENT_MAX_LENGTH_FRACTION - DOOR_FRAGMENT_MIN_LENGTH_FRACTION;

  for (let fragment = 0; fragment < DOOR_FRAGMENT_COUNT; fragment++) {
    const cx =
      sx +
      margin +
      spread * doorHashUnit(tx * DOOR_HASH_FRAGMENT_X + fragment, ty * DOOR_HASH_FRAGMENT_Y);
    const cy =
      sy +
      margin +
      spread * doorHashUnit(tx * DOOR_HASH_FRAGMENT_Y + fragment, ty * DOOR_HASH_FRAGMENT_X);
    const angle =
      doorHashUnit(tx * DOOR_HASH_FRAGMENT_ANGLE_X + fragment, ty * DOOR_HASH_FRAGMENT_ANGLE_Y) *
      Math.PI *
      2;
    const length =
      ts *
      (DOOR_FRAGMENT_MIN_LENGTH_FRACTION +
        lengthSpan *
          doorHashUnit(
            tx * DOOR_HASH_FRAGMENT_LENGTH_X + fragment,
            ty * DOOR_HASH_FRAGMENT_LENGTH_Y,
          ));
    const toneIndex =
      positionHash(tx * DOOR_HASH_FRAGMENT_TONE_X + fragment, ty * DOOR_HASH_FRAGMENT_TONE_Y) %
      DOOR_PLANK_TONES.length;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = DOOR_FRAGMENT_SHADOW_COLOR;
    ctx.fillRect(-length / 2, -thickness / 2 + thickness, length, thickness);
    ctx.fillStyle = DOOR_PLANK_TONES[toneIndex];
    ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
    ctx.fillStyle = DOOR_PLANK_LIGHT_EDGE_COLOR;
    ctx.fillRect(-length / 2, -thickness / 2, length, 1);
    ctx.restore();
  }

  for (let nail = 0; nail < DOOR_LOOSE_NAIL_COUNT; nail++) {
    const nx =
      sx + margin + spread * doorHashUnit(tx * DOOR_HASH_NAIL_X + nail, ty * DOOR_HASH_NAIL_Y);
    const ny =
      sy + margin + spread * doorHashUnit(tx * DOOR_HASH_NAIL_Y + nail, ty * DOOR_HASH_NAIL_X);
    drawNailHead(ctx, nx, ny, ts);
  }
}

export function drawSpecialFloorTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  switch (type) {
    // Safe-room floor and the scuffed traffic band inside its doorways, both
    // resolved through the generated `ground_dungeon` sheet. No `drawWallShadow`
    // here: the ground renderer's own occlusion pass shades the wall contact, and
    // running both stacked two bands of shade against every north wall.
    case SAFE_ROOM_FLOOR:
    case SAFE_ROOM_THRESHOLD: {
      drawGroundTile(ctx, DUNGEON_GROUND, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Raked sand over a garrison's drill hall. It lives here rather than with the
    // interior furniture because every prop standing on it resolves its own
    // ground through this dispatcher — a floor that only `drawInteriorTile` knows
    // how to paint leaves a solid black square under every dummy on it.
    case DRILL_SAND_FLOOR: {
      ctx.fillStyle = DRILL_SAND_BASE;
      ctx.fillRect(sx, sy, ts, ts);
      const troddenHash = (tx * DRILL_SAND_HASH_X + ty * DRILL_SAND_HASH_Y) % DRILL_SAND_HASH_MOD;
      const patchSize = Math.floor(ts * DRILL_SAND_PATCH_FRACTION);
      ctx.fillStyle = DRILL_SAND_TRODDEN;
      ctx.fillRect(
        sx + (troddenHash % patchSize),
        sy + (troddenHash % patchSize),
        patchSize,
        patchSize,
      );
      // The grooves sit at fixed rows inside the tile so they run unbroken across
      // a whole rank of them: a drill floor is raked in lanes, not in squares.
      for (let groove = 0; groove < DRILL_SAND_GROOVE_COUNT; groove++) {
        const gy = sy + Math.floor(((groove + 1) * ts) / (DRILL_SAND_GROOVE_COUNT + 1));
        ctx.fillStyle = DRILL_SAND_GROOVE_SHADOW;
        ctx.fillRect(sx, gy, ts, 1);
        ctx.fillStyle = DRILL_SAND_GROOVE_LIGHT;
        ctx.fillRect(sx, gy + 1, ts, 1);
      }
      break;
    }

    // Hoarder Boss Room floor — single room image UV-mapped across all floor tiles
    case HORDER_BOSS_ROOM_FLOOR: {
      const def = getSpriteDef('hoarders_room');
      const bounds = findHoarderBounds(structure);
      if (def && bounds) {
        const { img } = def;
        const roomW = bounds.maxX - bounds.minX + 1;
        const roomH = bounds.maxY - bounds.minY + 1;
        const srcX = ((tx - bounds.minX) / roomW) * img.width;
        const srcY = ((ty - bounds.minY) / roomH) * img.height;
        const srcW = img.width / roomW;
        const srcH = img.height / roomH;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, sx, sy, ts, ts);
      } else {
        ctx.fillStyle = '#281c0c';
        ctx.fillRect(sx, sy, ts, ts);
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Juicer Gym floor — dark rubber mat
    case JUICER_BOSS_ROOM_FLOOR: {
      // Very dark grey rubber base
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(sx, sy, ts, ts);
      // Subtle grid lines every tile
      ctx.fillStyle = '#222';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Rubber texture dots (deterministic pattern)
      if ((tx + ty) % GYM_RUBBER_DOT_TILE_STRIDE === 0) {
        ctx.fillStyle = `rgba(255,255,255,${GYM_RUBBER_DOT_ALPHA})`;
        ctx.beginPath();
        ctx.arc(
          sx + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          sy + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          ts * GYM_RUBBER_DOT_RADIUS_FRACTION,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Orange gym line markings every 4 tiles
      if (tx % GYM_LINE_TILE_STRIDE === 0) {
        ctx.fillStyle = `rgba(249,115,22,${GYM_LINE_ALPHA})`;
        ctx.fillRect(sx, sy, 2, ts);
      }
      if (ty % GYM_LINE_TILE_STRIDE === 0) {
        ctx.fillStyle = `rgba(249,115,22,${GYM_LINE_ALPHA})`;
        ctx.fillRect(sx, sy, ts, 2);
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Krakaren Clone lair — dark wet cavern floor
    case KRAKAREN_BOSS_ROOM_FLOOR: {
      const cavBase = (tx + ty) % 2 === 0 ? KRAKAREN_LAIR_STONE_LIGHT : KRAKAREN_LAIR_STONE_DARK;
      ctx.fillStyle = cavBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Wet sheen patches
      if (
        (tx * KRAKAREN_WET_SHEEN_HASH_X + ty * KRAKAREN_WET_SHEEN_HASH_Y) %
          KRAKAREN_WET_SHEEN_STRIDE ===
        0
      ) {
        ctx.fillStyle = 'rgba(100,140,180,0.08)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          sy + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          ts * KRAKAREN_ELLIPSE_MAJOR_FRACTION,
          ts * KRAKAREN_ELLIPSE_MINOR_FRACTION,
          (tx + ty) * GYM_RUBBER_DOT_CENTER_FRACTION,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Crack lines
      if ((tx * KRAKAREN_CRACK_HASH_X + ty * KRAKAREN_CRACK_HASH_Y) % KRAKAREN_CRACK_STRIDE === 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(
          sx + ts * KRAKAREN_CRACK_START_X_FRACTION,
          sy + ts * KRAKAREN_CRACK_START_Y_FRACTION,
        );
        ctx.lineTo(
          sx + ts * KRAKAREN_CRACK_END_X_FRACTION,
          sy + ts * KRAKAREN_CRACK_END_Y_FRACTION,
        );
        ctx.stroke();
      }
      // Pink slime drips (hints at the Krakaren)
      if ((tx * KRAKAREN_SLIME_HASH_X + ty * KRAKAREN_SLIME_HASH_Y) % KRAKAREN_SLIME_STRIDE === 0) {
        ctx.fillStyle = 'rgba(220,100,140,0.15)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * KRAKAREN_SLIME_CENTER_X_FRACTION,
          sy + ts * KRAKAREN_SLIME_CENTER_Y_FRACTION,
          ts * KRAKAREN_SLIME_MAJOR_FRACTION,
          ts * KRAKAREN_SLIME_MINOR_FRACTION,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Arena floor — riveted steel plate, drained toward the middle, and filthy.
    //
    // The one large floor region in the game that is not a generated ground
    // material, because it is a *plated* surface rather than a granular one:
    // seamless tiling has nothing to add to a floor whose whole character is the
    // seam every two tiles, and its transitions are all against its own wall.
    case ARENA_FLOOR: {
      drawArenaFloor(ctx, sx, sy, ts, tx, ty);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Floor Grate — dark metal grate over dungeon floor
    case FLOOR_GRATE: {
      // Base floor (same as concrete)
      ctx.fillStyle = '#505050';
      ctx.fillRect(sx, sy, ts, ts);
      // Grate bars — horizontal slits
      ctx.fillStyle = '#2a2a2a';
      const barH = Math.max(2, ts * GRATE_BASE_FILL_FRACTION);
      const gap = ts / GRATE_GAP_DIVISIONS;
      for (let i = 1; i < GRATE_GAP_DIVISIONS; i++) {
        ctx.fillRect(
          sx + ts * GRATE_HORIZONTAL_INSET_FRACTION,
          sy + gap * i - barH / 2,
          ts * GRATE_HORIZONTAL_WIDTH_FRACTION,
          barH,
        );
      }
      // Vertical frame bars
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(
        sx + ts * GRATE_FRAME_OUTER_FRACTION,
        sy + ts * GRATE_FRAME_OUTER_FRACTION,
        ts * GRATE_FRAME_THICKNESS_FRACTION,
        ts * GRATE_FRAME_HEIGHT_FRACTION,
      );
      ctx.fillRect(
        sx + ts * (1 - GRATE_FRAME_OUTER_FRACTION - GRATE_FRAME_THICKNESS_FRACTION),
        sy + ts * GRATE_FRAME_OUTER_FRACTION,
        ts * GRATE_FRAME_THICKNESS_FRACTION,
        ts * GRATE_FRAME_HEIGHT_FRACTION,
      );
      // Dark centre void below grate
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(
        sx + ts * GRATE_VOID_INSET_FRACTION,
        sy + ts * GRATE_VOID_INSET_FRACTION,
        ts * GRATE_VOID_SIZE_FRACTION,
        ts * GRATE_VOID_SIZE_FRACTION,
      );
      // Metallic rim highlight
      ctx.strokeStyle = '#6a6a6a';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        sx + ts * GRATE_RIM_OUTER_FRACTION,
        sy + ts * GRATE_RIM_OUTER_FRACTION,
        ts * GRATE_RIM_SIZE_FRACTION,
        ts * GRATE_RIM_SIZE_FRACTION,
      );
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Spider Lab floor — UV-mapped spider_room_floor image across the entire room
    case SPIDER_LAB_FLOOR: {
      const def = getSpriteDef('spider_room_floor');
      const bounds = findSpiderLabBounds(structure);
      if (def && bounds) {
        const { img } = def;
        const roomW = bounds.maxX - bounds.minX + 1;
        const roomH = bounds.maxY - bounds.minY + 1;
        const srcX = ((tx - bounds.minX) / roomW) * img.width;
        const srcY = ((ty - bounds.minY) / roomH) * img.height;
        const srcW = img.width / roomW;
        const srcH = img.height / roomH;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, sx, sy, ts, ts);
      } else {
        // Fallback: dark tiled lab floor with subtle webbing
        const base = (tx + ty) % 2 === 0 ? '#1a1610' : '#161208';
        ctx.fillStyle = base;
        ctx.fillRect(sx, sy, ts, ts);
        ctx.strokeStyle = '#0d0a06';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx + ts - 1, sy, 1, ts);
        ctx.strokeRect(sx, sy + ts - 1, ts, 1);
        if ((tx * SPIDER_WEB_HASH_X + ty * SPIDER_WEB_HASH_Y) % SPIDER_WEB_STRIDE === 0) {
          ctx.strokeStyle = 'rgba(80,60,20,0.2)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(sx + ts * SPIDER_WEB_START_X_FRACTION, sy + ts * SPIDER_WEB_START_Y_FRACTION);
          ctx.lineTo(sx + ts * SPIDER_WEB_END_X_FRACTION, sy + ts * SPIDER_WEB_END_Y_FRACTION);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(
            sx + ts * SPIDER_WEB_ALT_START_X_FRACTION,
            sy + ts * SPIDER_WEB_START_Y_FRACTION,
          );
          ctx.lineTo(sx + ts * SPIDER_WEB_ALT_END_X_FRACTION, sy + ts * SPIDER_WEB_END_Y_FRACTION);
          ctx.stroke();
        }
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Desperado Club floor — dark polished art-deco stone with gold grout
    case CLUB_FLOOR: {
      const clubBase = (tx + ty) % 2 === 0 ? '#1a1420' : '#161019';
      ctx.fillStyle = clubBase;
      ctx.fillRect(sx, sy, ts, ts);
      ctx.fillStyle = 'rgba(198,168,64,0.28)';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Sparse art-deco sunburst inlay
      if (tx % CLUB_SUNBURST_TILE_STRIDE === 0 && ty % CLUB_SUNBURST_TILE_STRIDE === 0) {
        const cx = sx + ts * CLUB_SUNBURST_CENTER_FRACTION;
        const cy = sy + ts * CLUB_SUNBURST_CENTER_FRACTION;
        ctx.strokeStyle = 'rgba(198,168,64,0.22)';
        ctx.lineWidth = 1;
        for (let r = 0; r < CLUB_SUNBURST_RAY_COUNT; r++) {
          const ang = (r / CLUB_SUNBURST_RAY_COUNT) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(
            cx + Math.cos(ang) * ts * CLUB_SUNBURST_RADIUS_FRACTION,
            cy + Math.sin(ang) * ts * CLUB_SUNBURST_RADIUS_FRACTION,
          );
          ctx.stroke();
        }
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Dance floor — dark reflective panels; the pulsing coloured lights are drawn
    // as a per-frame overlay by DesperadoClubSystem (the static tile cache can't animate).
    case DANCE_FLOOR: {
      ctx.fillStyle = '#0b0810';
      ctx.fillRect(sx, sy, ts, ts);
      ctx.fillStyle = (tx + ty) % 2 === 0 ? '#1d1526' : '#150f1e';
      ctx.fillRect(
        sx + ts * DANCE_PANEL_INSET_FRACTION,
        sy + ts * DANCE_PANEL_INSET_FRACTION,
        ts * DANCE_PANEL_SIZE_FRACTION,
        ts * DANCE_PANEL_SIZE_FRACTION,
      );
      break;
    }

    // Quest exit barricade, closed — the doorway the goblin mother boards over
    // while her wave is live. Walkable by tile type: the
    // offline progression validator flood-fills the raw grid, and only a live
    // `GameMap` block flag (the arena-door pattern) is allowed to deny passage,
    // or everything past this room reads as unreachable.
    case QUEST_EXIT_DOOR_CLOSED: {
      const axis = doorwayAxis(structure, tx, ty);
      const runSeed = doorRunSeed(axis, tx, ty);
      const nailAtStart = isRunEnd(structure, axis, tx, ty, 'start');
      const nailAtEnd = isRunEnd(structure, axis, tx, ty, 'end');

      withDoorwayFrame(ctx, sx, sy, ts, axis, () => {
        // The doorway void goes down first, over the whole tile, so the seams
        // between boards read as depth rather than as lines drawn on a panel.
        drawDoorwayVoid(ctx, sx, sy, ts, DOOR_VOID_COLOR, nailAtStart, nailAtEnd);
        for (let plank = 0; plank < DOOR_PLANK_COUNT; plank++) {
          drawBarricadePlank(ctx, sx, sy, ts, tx, ty, runSeed, plank, nailAtStart, nailAtEnd);
        }
      });

      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Quest exit barricade, broken open — the same doorway once the wave ends.
    // Its own tile type rather than a flag on the closed one because
    // the base dungeon floor is baked into reusable chunk canvases: the open
    // state has to be a distinct tile written into the grid at runtime.
    case QUEST_EXIT_DOOR_OPEN: {
      const axis = doorwayAxis(structure, tx, ty);
      const runSeed = doorRunSeed(axis, tx, ty);
      const stubAtStart = isRunEnd(structure, axis, tx, ty, 'start');
      const stubAtEnd = isRunEnd(structure, axis, tx, ty, 'end');

      withDoorwayFrame(ctx, sx, sy, ts, axis, () => {
        drawDoorwayVoid(ctx, sx, sy, ts, DOOR_OPEN_VOID_COLOR, stubAtStart, stubAtEnd);
        for (let plank = 0; plank < DOOR_PLANK_COUNT; plank++) {
          if (stubAtStart) drawSplinteredStub(ctx, sx, sy, ts, runSeed, plank, 'start');
          if (stubAtEnd) drawSplinteredStub(ctx, sx, sy, ts, runSeed, plank, 'end');
        }
        drawDoorDebris(ctx, sx, sy, ts, tx, ty);
      });

      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    default:
      return false;
  }
  return true;
}
