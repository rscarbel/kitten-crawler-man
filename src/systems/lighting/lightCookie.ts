/**
 * Light that stops at walls: a tile-grid shadowcast from a light, the soft
 * per-tile field of how much of each tile the light sees, and the small
 * quarter-resolution masks ("cookies") that field is rasterised into.
 *
 * Every edge here is soft. A pixel's share of the light is read off the
 * field by bilinear interpolation between tile centres, so a shadow's edge
 * and the top of a lit wall fade over a tile rather than stopping on a line.
 * A floor pixel never borrows light from a wall tile beside it, though, so a
 * corridor behind a one-tile wall stays dark right up to the wall.
 */

import { TILE_SIZE } from '../../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { WALL_FACE_RISE_TILES } from '../../map/dungeon/wallLight';

/** Rows of wall a face reaches into above the floor it stands on. */
export const WALL_FACE_ROWS = Math.ceil(WALL_FACE_RISE_TILES);

/** The lighting buffers are painted at this fraction of the world's resolution. */
export const LIGHT_BUFFER_SCALE = 0.25;
/** Pixels one tile spans in a lighting buffer. */
export const LIGHT_PX_PER_TILE = TILE_SIZE * LIGHT_BUFFER_SCALE;

/** Offsets the eight octants of a shadowcast are mapped through: xx, xy, yx, yy. */
const OCTANTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

const HALF = 0.5;
/** Packs a tile into one number for the shadowcast's seen set; maps are far under 65536 wide. */
const TILE_KEY_SHIFT = 16;
const TILE_KEY_MASK = 0xffff;

/**
 * Every tile visible from the centre of `(originX, originY)` within
 * `radiusTiles`, by recursive shadowcasting. Opaque tiles that are seen are
 * visited too — a light falls on the face of the wall that stops it — and
 * nothing behind them is. The origin is always visited.
 */
export function shadowcast(
  originX: number,
  originY: number,
  radiusTiles: number,
  isOpaque: (x: number, y: number) => boolean,
  visit: (x: number, y: number) => void,
): void {
  visit(originX, originY);
  const seen = new Set<number>();
  const visitOnce = (x: number, y: number): void => {
    const key = (y << TILE_KEY_SHIFT) ^ (x & TILE_KEY_MASK);
    if (seen.has(key)) return;
    seen.add(key);
    visit(x, y);
  };
  seen.add((originY << TILE_KEY_SHIFT) ^ (originX & TILE_KEY_MASK));
  const rows = Math.ceil(radiusTiles);
  for (const [xx, xy, yx, yy] of OCTANTS) {
    castOctant(originX, originY, 1, 1, 0, rows, radiusTiles, xx, xy, yx, yy, isOpaque, visitOnce);
  }
}

function castOctant(
  cx: number,
  cy: number,
  firstRow: number,
  startSlope: number,
  endSlope: number,
  rows: number,
  radiusTiles: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
  isOpaque: (x: number, y: number) => boolean,
  visit: (x: number, y: number) => void,
): void {
  if (startSlope < endSlope) return;
  let start = startSlope;
  const radiusSq = radiusTiles * radiusTiles;
  for (let row = firstRow; row <= rows; row++) {
    const dy = -row;
    let blocked = false;
    let nextStart = start;
    for (let dx = -row; dx <= 0; dx++) {
      const x = cx + dx * xx + dy * xy;
      const y = cy + dx * yx + dy * yy;
      const leftSlope = (dx - HALF) / (dy + HALF);
      const rightSlope = (dx + HALF) / (dy - HALF);
      // Strict at both edges: a tile the open cone only touches at a corner
      // is not seen, or a light in a one-tile corridor would light the side
      // wall of a branch it has no line to past the branch's corner.
      if (start <= rightSlope) continue;
      if (endSlope >= leftSlope) break;
      if (dx * dx + dy * dy <= radiusSq) visit(x, y);
      const opaque = isOpaque(x, y);
      if (blocked) {
        if (opaque) {
          nextStart = rightSlope;
          continue;
        }
        blocked = false;
        start = nextStart;
      } else if (opaque && row < rows) {
        blocked = true;
        castOctant(
          cx,
          cy,
          row + 1,
          start,
          leftSlope,
          rows,
          radiusTiles,
          xx,
          xy,
          yx,
          yy,
          isOpaque,
          visit,
        );
        nextStart = rightSlope;
      }
    }
    if (blocked) break;
  }
}

/** A falloff curve: a value at each share of a light's radius, straight lines between. */
type FalloffStops = ReadonlyArray<{ readonly at: number; readonly value: number }>;

/**
 * How much of the dark a fixed light cuts at a share of its reach. Held flat
 * round the centre so a body standing near a light is fully lit, then let
 * down softly so a pool has no rim.
 */
const CUT_STOPS: FalloffStops = [
  { at: 0, value: 1 },
  { at: 0.35, value: 0.92 },
  { at: 0.7, value: 0.45 },
  { at: 1, value: 0 },
];

/**
 * The cut of a light carried by something moving. Softer through the middle
 * than a fixed light's, so a crawler's light reads as a glow round them
 * rather than a spotlight following them about.
 */
const SOFT_CUT_STOPS: FalloffStops = [
  { at: 0, value: 1 },
  { at: 0.2, value: 0.94 },
  { at: 0.5, value: 0.62 },
  { at: 0.78, value: 0.22 },
  { at: 1, value: 0 },
];

function falloffAt(stops: FalloffStops, share: number): number {
  if (share <= 0) return stops[0]?.value ?? 0;
  for (let index = 1; index < stops.length; index++) {
    const prev = stops[index - 1];
    const next = stops[index];
    if (share <= next.at) {
      const t = (share - prev.at) / (next.at - prev.at);
      return prev.value + (next.value - prev.value) * t;
    }
  }
  return 0;
}

/** The cut a fixed light makes at `share` of its reach. */
export function lightCutAt(share: number): number {
  return falloffAt(CUT_STOPS, share);
}

/** A glow's colour stops, parsed once into numbers the rasteriser can blend. */
export interface ParsedGlowStops {
  readonly at: Float32Array;
  readonly rgba: Float32Array;
}

const RGBA_CHANNELS = 4;
const RGB_CHANNELS = 3;
const BYTE_MAX = 255;

/** Parses `rgba(r,g,b,a)` stops; the glow tables are written that way. */
export function parseGlowStops(
  stops: ReadonlyArray<{ readonly offset: number; readonly color: string }>,
): ParsedGlowStops {
  const at = new Float32Array(stops.length);
  const rgba = new Float32Array(stops.length * RGBA_CHANNELS);
  stops.forEach((stop, index) => {
    at[index] = stop.offset;
    const parts = /rgba?\(([^)]*)\)/.exec(stop.color)?.[1]?.split(',').map(Number) ?? [];
    for (let channel = 0; channel < RGBA_CHANNELS; channel++) {
      rgba[index * RGBA_CHANNELS + channel] = parts[channel] ?? (channel === RGB_CHANNELS ? 1 : 0);
    }
  });
  return { at, rgba };
}

// ── What one tile sees ──────────────────────────────────────────────────────

/** Bit flags for the open sides of a wall tile. */
const OPEN_NORTH = 1;
const OPEN_SOUTH = 2;
const OPEN_EAST = 4;
const OPEN_WEST = 8;

/**
 * The share of a light seen from tile (`fromX`, `fromY`) that falls on the
 * wall at (`x`, `y`), on the side of it the player sees. A wall with floor to
 * its south is drawn as a face looking south, so only a light south of it
 * lights it, however much of it the shadowcast reached from the north; a side
 * lip takes light from its open side. A wall seen only from the north shows
 * just its top, which catches a little light at its lip and no more. Solid
 * mass glimpsed past a corner takes none: light never pools on the wall tops.
 */
function wallLightShare(
  x: number,
  y: number,
  fromX: number,
  fromY: number,
  isOpaque: (x: number, y: number) => boolean,
): number {
  let open = 0;
  if (!isOpaque(x, y - 1)) open |= OPEN_NORTH;
  if (!isOpaque(x, y + 1)) open |= OPEN_SOUTH;
  if (!isOpaque(x + 1, y)) open |= OPEN_EAST;
  if (!isOpaque(x - 1, y)) open |= OPEN_WEST;
  if ((open & OPEN_SOUTH) !== 0) return fromY > y ? 1 : 0;
  if ((open & (OPEN_EAST | OPEN_WEST)) !== 0) {
    const facesLight =
      ((open & OPEN_EAST) !== 0 && fromX > x) || ((open & OPEN_WEST) !== 0 && fromX < x);
    return facesLight ? 1 : 0;
  }
  if ((open & OPEN_NORTH) !== 0) return fromY < y ? WALL_TOP_LIP_LIGHT : 0;
  return 0;
}

/** How much of a light the top of a wall seen from the north catches at its lip. */
const WALL_TOP_LIP_LIGHT = 0.35;

/**
 * Every tile a light seen from one tile's centre reaches, on a small grid
 * round that tile, with the share of the light each takes: the open tiles in
 * sight, the walls in sight whose visible side faces the light (see
 * {@link wallLightShare}), and the upper rows of each such face.
 */
export class OriginVisibility {
  readonly originTileX: number;
  readonly originTileY: number;
  readonly sizeTiles: number;
  /** The share of the light each tile takes, 0–1. */
  readonly seen: Float32Array;

  constructor(
    fromX: number,
    fromY: number,
    reachTiles: number,
    isOpaque: (x: number, y: number) => boolean,
    alsoLit?: { readonly x: number; readonly y: number },
  ) {
    const span = Math.ceil(reachTiles) + 1;
    this.originTileX = fromX - span;
    this.originTileY = fromY - span;
    this.sizeTiles = span * 2 + 1;
    const size = this.sizeTiles;
    this.seen = new Float32Array(size * size);
    const mark = (x: number, y: number, share = 1): void => {
      const lx = x - this.originTileX;
      const ly = y - this.originTileY;
      if (lx < 0 || ly < 0 || lx >= size || ly >= size) return;
      const index = ly * size + lx;
      this.seen[index] = Math.max(this.seen[index], share);
    };
    const feet: Array<{ x: number; y: number }> = [];
    shadowcast(fromX, fromY, reachTiles + HALF, isOpaque, (x, y) => {
      if (!isOpaque(x, y)) {
        mark(x, y);
        return;
      }
      const share = wallLightShare(x, y, fromX, fromY, isOpaque);
      if (share <= 0) return;
      mark(x, y, share);
      if (!isOpaque(x, y + 1)) feet.push({ x, y });
    });
    if (alsoLit !== undefined) mark(alsoLit.x, alsoLit.y);
    // A wall face rises over more than its foot tile, and the shadowcast only
    // reaches the foot; the light falls on the whole face.
    for (const foot of feet) {
      for (let rise = 1; rise < WALL_FACE_ROWS; rise++) {
        if (!isOpaque(foot.x, foot.y - rise)) break;
        mark(foot.x, foot.y - rise);
      }
    }
  }

  /** Whether a map tile is lit from this origin. */
  sees(tileX: number, tileY: number): boolean {
    const lx = tileX - this.originTileX;
    const ly = tileY - this.originTileY;
    if (lx < 0 || ly < 0 || lx >= this.sizeTiles || ly >= this.sizeTiles) return false;
    return this.seen[ly * this.sizeTiles + lx] > 0;
  }
}

/** The most origin visibilities a cache keeps before it forgets the oldest. */
const VISIBILITY_CACHE_LIMIT = 512;

/**
 * Origin visibilities by tile and reach. A moving light is seen from the
 * tile centres round it, and those change only when it crosses into a new
 * tile, so most frames rebuild nothing.
 */
export class VisibilityCache {
  private readonly entries = new Map<number, OriginVisibility>();

  constructor(private readonly isOpaque: (x: number, y: number) => boolean) {}

  get(tileX: number, tileY: number, reachTiles: number): OriginVisibility {
    const key = tileSizeKey(tileX, tileY, reachTiles);
    const cached = lruGet(this.entries, key);
    if (cached !== undefined) return cached;
    const made = new OriginVisibility(tileX, tileY, reachTiles, this.isOpaque);
    lruSet(this.entries, key, made, VISIBILITY_CACHE_LIMIT);
    return made;
  }

  /** Forgets everything; the walls changed. */
  clear(): void {
    this.entries.clear();
  }
}

// ── The field ───────────────────────────────────────────────────────────────

/**
 * A tile centre with less of a moving light's weight than this is left out:
 * the light it would add is below what a screen can show, and leaving it out
 * saves a draw.
 */
const MIN_ORIGIN_WEIGHT = 0.02;

/** One origin a light is seen from, and its share of the light. */
export interface FieldPart {
  readonly visibility: OriginVisibility;
  readonly weight: number;
}

/**
 * How much of each tile round a light the light sees, 0–1, on a small local
 * grid. A light seen from one tile is 1 on every tile that tile lights; a
 * moving light is seen from the tile centres round it, weighted by how near
 * it is to each, so what it lights changes smoothly as it moves instead of
 * jumping a tile at a time. Reused frame to frame: {@link rebuild} refills it.
 */
export class LightField {
  originTileX = 0;
  originTileY = 0;
  sizeTiles = 0;
  vis = new Float32Array(0);
  private opaque = new Uint8Array(0);

  /** Refills the field from `parts`, whose weights need not add to one. */
  rebuild(parts: ReadonlyArray<FieldPart>, isOpaque: (x: number, y: number) => boolean): this {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let totalWeight = 0;
    for (const part of parts) {
      const v = part.visibility;
      minX = Math.min(minX, v.originTileX);
      minY = Math.min(minY, v.originTileY);
      maxX = Math.max(maxX, v.originTileX + v.sizeTiles);
      maxY = Math.max(maxY, v.originTileY + v.sizeTiles);
      totalWeight += part.weight;
    }
    if (parts.length === 0) {
      this.sizeTiles = 0;
      return this;
    }
    const size = Math.max(maxX - minX, maxY - minY);
    this.originTileX = minX;
    this.originTileY = minY;
    this.sizeTiles = size;
    if (this.vis.length !== size * size) {
      this.vis = new Float32Array(size * size);
      this.opaque = new Uint8Array(size * size);
    } else {
      this.vis.fill(0);
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        this.opaque[y * size + x] = isOpaque(minX + x, minY + y) ? 1 : 0;
      }
    }
    const scale = totalWeight > 0 ? 1 / totalWeight : 0;
    for (const part of parts) {
      const v = part.visibility;
      const share = part.weight * scale;
      const offsetX = v.originTileX - minX;
      const offsetY = v.originTileY - minY;
      for (let ly = 0; ly < v.sizeTiles; ly++) {
        for (let lx = 0; lx < v.sizeTiles; lx++) {
          this.vis[(ly + offsetY) * size + lx + offsetX] += share * v.seen[ly * v.sizeTiles + lx];
        }
      }
    }
    return this;
  }

  /** The field's value on a tile, by map coordinates; 0 off the grid. */
  at(tileX: number, tileY: number): number {
    const lx = tileX - this.originTileX;
    const ly = tileY - this.originTileY;
    if (lx < 0 || ly < 0 || lx >= this.sizeTiles || ly >= this.sizeTiles) return 0;
    return this.vis[ly * this.sizeTiles + lx];
  }

  /**
   * The light's share at a point given in local tile units, blended between
   * tile centres. A point on open floor takes no more light from a wall
   * round it than its own tile has, so floor never takes light from a wall it
   * is not lit through.
   */
  sample(localX: number, localY: number): number {
    const size = this.sizeTiles;
    const ownX = Math.floor(localX);
    const ownY = Math.floor(localY);
    if (ownX < 0 || ownY < 0 || ownX >= size || ownY >= size) return 0;
    const own = ownY * size + ownX;
    const ownVis = this.vis[own];
    const ownOpaque = this.opaque[own] === 1;
    const u = localX - HALF;
    const v = localY - HALF;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const fx = u - i0;
    const fy = v - j0;
    const c00 = this.corner(i0, j0, ownVis, ownOpaque);
    const c10 = this.corner(i0 + 1, j0, ownVis, ownOpaque);
    const c01 = this.corner(i0, j0 + 1, ownVis, ownOpaque);
    const c11 = this.corner(i0 + 1, j0 + 1, ownVis, ownOpaque);
    const top = c00 * (1 - fx) + c10 * fx;
    const bottom = c01 * (1 - fx) + c11 * fx;
    return top * (1 - fy) + bottom * fy;
  }

  private corner(i: number, j: number, ownVis: number, ownOpaque: boolean): number {
    const size = this.sizeTiles;
    if (i < 0 || j < 0 || i >= size || j >= size) return ownOpaque ? 0 : ownVis;
    const index = j * size + i;
    // Floor may darken toward a wall the light does not reach, which keeps the
    // edge between them soft, but never brightens from one: that is how light
    // would leak through a wall onto the floor behind it.
    if (!ownOpaque && this.opaque[index] === 1) return Math.min(ownVis, this.vis[index]);
    return this.vis[index];
  }
}

/**
 * Fills `out` with the four tile centres round a world point, each weighted
 * by how near the point is to it — bilinear weights, so they move smoothly
 * with the point. Centres inside a wall, and centres with almost none of the
 * weight, are left out, and the rest share their weight so it still adds up
 * to one. Returns how many it wrote.
 */
export function originsAround(
  worldX: number,
  worldY: number,
  isOpaque: (x: number, y: number) => boolean,
  out: Array<{ x: number; y: number; weight: number }>,
): number {
  const u = worldX / TILE_SIZE - HALF;
  const v = worldY / TILE_SIZE - HALF;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fx = u - i0;
  const fy = v - j0;
  let count = 0;
  count = putOrigin(out, count, i0, j0, (1 - fx) * (1 - fy), isOpaque);
  count = putOrigin(out, count, i0 + 1, j0, fx * (1 - fy), isOpaque);
  count = putOrigin(out, count, i0, j0 + 1, (1 - fx) * fy, isOpaque);
  count = putOrigin(out, count, i0 + 1, j0 + 1, fx * fy, isOpaque);
  if (count === 0) {
    const ownX = Math.floor(worldX / TILE_SIZE);
    const ownY = Math.floor(worldY / TILE_SIZE);
    count = putOrigin(out, count, ownX, ownY, 1, NEVER_OPAQUE);
  }
  let total = 0;
  for (let index = 0; index < count; index++) total += out[index].weight;
  if (total > 0) {
    for (let index = 0; index < count; index++) out[index].weight /= total;
  }
  return count;
}

const NEVER_OPAQUE = (): boolean => false;

/** Writes one origin into `out` at `count`, reusing the slot, unless it is left out. */
function putOrigin(
  out: Array<{ x: number; y: number; weight: number }>,
  count: number,
  x: number,
  y: number,
  weight: number,
  isOpaque: (x: number, y: number) => boolean,
): number {
  if (weight < MIN_ORIGIN_WEIGHT || isOpaque(x, y)) return count;
  if (count >= out.length) out.push({ x: 0, y: 0, weight: 0 });
  const slot = out[count];
  slot.x = x;
  slot.y = y;
  slot.weight = weight;
  return count + 1;
}

// ── Rasterising ─────────────────────────────────────────────────────────────

export interface RasterTarget {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Where a raster target lies in the world: its pixel (0, 0)'s tile and its pixels per tile. */
export interface RasterPlacement {
  readonly tileX: number;
  readonly tileY: number;
  readonly pxPerTile: number;
}

/**
 * Writes a light's cut into the alpha of `target`, combined with what is
 * there already as overlapping lights add up: `1 - (1 - a)(1 - b)`.
 */
export function rasteriseCut(
  field: LightField,
  target: RasterTarget,
  placement: RasterPlacement,
  centreX: number,
  centreY: number,
  reachTiles: number,
  strength: number,
  soft: boolean,
): void {
  const stops = soft ? SOFT_CUT_STOPS : CUT_STOPS;
  const { pxPerTile } = placement;
  const centreTileX = centreX / TILE_SIZE;
  const centreTileY = centreY / TILE_SIZE;
  const left = Math.max(0, Math.floor((centreTileX - reachTiles - placement.tileX) * pxPerTile));
  const top = Math.max(0, Math.floor((centreTileY - reachTiles - placement.tileY) * pxPerTile));
  const right = Math.min(
    target.width,
    Math.ceil((centreTileX + reachTiles - placement.tileX) * pxPerTile),
  );
  const bottom = Math.min(
    target.height,
    Math.ceil((centreTileY + reachTiles - placement.tileY) * pxPerTile),
  );
  const alphaIndex = RGBA_CHANNELS - 1;
  for (let py = top; py < bottom; py++) {
    const tileY = placement.tileY + (py + HALF) / pxPerTile;
    const dy = tileY - centreTileY;
    for (let px = left; px < right; px++) {
      const tileX = placement.tileX + (px + HALF) / pxPerTile;
      const dx = tileX - centreTileX;
      const share = Math.sqrt(dx * dx + dy * dy) / reachTiles;
      if (share >= 1) continue;
      const seen = field.sample(tileX - field.originTileX, tileY - field.originTileY);
      if (seen <= 0) continue;
      const cut = falloffAt(stops, share) * seen * strength;
      const index = (py * target.width + px) * RGBA_CHANNELS + alphaIndex;
      const had = target.data[index] / BYTE_MAX;
      target.data[index] = (1 - (1 - had) * (1 - cut)) * BYTE_MAX;
    }
  }
}

/**
 * Writes a light's coloured glow into `target`, shaped by the same field as
 * its cut so the colour stops softly where the light does.
 */
export function rasteriseGlow(
  field: LightField,
  target: RasterTarget,
  placement: RasterPlacement,
  centreX: number,
  centreY: number,
  radiusTiles: number,
  stops: ParsedGlowStops,
): void {
  const { pxPerTile } = placement;
  const centreTileX = centreX / TILE_SIZE;
  const centreTileY = centreY / TILE_SIZE;
  const { at, rgba } = stops;
  const last = at.length - 1;
  for (let py = 0; py < target.height; py++) {
    const tileY = placement.tileY + (py + HALF) / pxPerTile;
    const dy = tileY - centreTileY;
    for (let px = 0; px < target.width; px++) {
      const tileX = placement.tileX + (px + HALF) / pxPerTile;
      const dx = tileX - centreTileX;
      const share = Math.sqrt(dx * dx + dy * dy) / radiusTiles;
      if (share >= 1) continue;
      const seen = field.sample(tileX - field.originTileX, tileY - field.originTileY);
      if (seen <= 0) continue;
      let stop = 1;
      while (stop < last && at[stop] < share) stop++;
      const span = at[stop] - at[stop - 1];
      const t = span > 0 ? Math.min(1, Math.max(0, (share - at[stop - 1]) / span)) : 1;
      const index = (py * target.width + px) * RGBA_CHANNELS;
      for (let channel = 0; channel < RGBA_CHANNELS; channel++) {
        const from = rgba[(stop - 1) * RGBA_CHANNELS + channel];
        const to = rgba[stop * RGBA_CHANNELS + channel];
        const value = from + (to - from) * t;
        target.data[index + channel] = channel === RGB_CHANNELS ? value * seen * BYTE_MAX : value;
      }
    }
  }
}

// ── Static cookies ──────────────────────────────────────────────────────────

export interface CookieRequest {
  /** The tile the shadowcast runs from. */
  readonly emitterTileX: number;
  readonly emitterTileY: number;
  /** The centre of the pool, in world pixels. */
  readonly centreX: number;
  readonly centreY: number;
  readonly reachTiles: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly isOpaque: (x: number, y: number) => boolean;
  /** A tile lit whatever the shadowcast says: the wall a sconce hangs on. */
  readonly alsoLit?: { readonly x: number; readonly y: number };
}

/**
 * A fixed light's cookie: the field and the tiles it reaches, worked out
 * when the light is placed, and its cut and glow masks, painted the first
 * time each is drawn. A floor carries hundreds of lights and a player sees a
 * fraction of them, so only the masks that are ever drawn are ever held.
 */
export class LightCookie {
  /** The tile the cookie's top-left corner sits on. */
  readonly originTileX: number;
  readonly originTileY: number;
  /** Tiles along each side of the cookie. */
  readonly sizeTiles: number;
  /** Every tile the light reaches, as `y * mapWidth + x`. */
  readonly litTiles: Int32Array;
  /** How much of the dark the light cuts on each of {@link litTiles}, 0–1. */
  readonly litStrength: Float32Array;
  private readonly field = new LightField();
  private painted: CanvasSurface | null = null;
  private glowPainted: PlacedSurface | null = null;

  constructor(private readonly request: CookieRequest) {
    const { emitterTileX, emitterTileY, reachTiles, mapWidth, mapHeight } = request;
    const visibility = new OriginVisibility(
      emitterTileX,
      emitterTileY,
      reachTiles,
      request.isOpaque,
      request.alsoLit,
    );
    this.field.rebuild([{ visibility, weight: 1 }], request.isOpaque);
    this.originTileX = this.field.originTileX;
    this.originTileY = this.field.originTileY;
    this.sizeTiles = this.field.sizeTiles;

    const lit: number[] = [];
    const strengths: number[] = [];
    const reachPx = reachTiles * TILE_SIZE;
    for (let ly = 0; ly < this.sizeTiles; ly++) {
      for (let lx = 0; lx < this.sizeTiles; lx++) {
        if (this.field.vis[ly * this.sizeTiles + lx] <= 0) continue;
        const x = this.originTileX + lx;
        const y = this.originTileY + ly;
        if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
        const distance = Math.hypot(
          (x + HALF) * TILE_SIZE - request.centreX,
          (y + HALF) * TILE_SIZE - request.centreY,
        );
        const strength = lightCutAt(distance / reachPx);
        if (strength <= 0) continue;
        lit.push(y * mapWidth + x);
        strengths.push(strength);
      }
    }
    this.litTiles = Int32Array.from(lit);
    this.litStrength = Float32Array.from(strengths);
  }

  private blank(): { surface: CanvasSurface; ctx: CanvasRenderingContext2D; image: ImageData } {
    const sizePx = this.sizeTiles * LIGHT_PX_PER_TILE;
    const surface = allocCanvas(sizePx, sizePx);
    const ctx = surfaceContext(surface);
    return { surface, ctx, image: ctx.createImageData(sizePx, sizePx) };
  }

  private get placement(): RasterPlacement {
    return { tileX: this.originTileX, tileY: this.originTileY, pxPerTile: LIGHT_PX_PER_TILE };
  }

  /** The cut mask, painted on first use. */
  get surface(): CanvasSurface {
    if (this.painted !== null) return this.painted;
    const { surface, ctx, image } = this.blank();
    rasteriseCut(
      this.field,
      image,
      this.placement,
      this.request.centreX,
      this.request.centreY,
      this.request.reachTiles,
      1,
      false,
    );
    ctx.putImageData(image, 0, 0);
    this.painted = surface;
    return surface;
  }

  /**
   * The coloured glow, painted on first use over just the square its radius
   * covers — far fewer pixels to add every frame than the whole cookie.
   */
  glow(radiusTiles: number, stops: ParsedGlowStops): PlacedSurface {
    if (this.glowPainted !== null) return this.glowPainted;
    const placed = paintGlow(
      this.field,
      this.request.centreX,
      this.request.centreY,
      radiusTiles,
      stops,
    );
    this.glowPainted = placed;
    return placed;
  }
}

/** A painted surface and the tile its top-left corner sits on. */
export interface PlacedSurface {
  readonly surface: CanvasSurface;
  readonly tileX: number;
  readonly tileY: number;
  readonly sizeTiles: number;
}

/** Paints a glow over the square of tiles its radius covers round its centre. */
function paintGlow(
  field: LightField,
  centreX: number,
  centreY: number,
  radiusTiles: number,
  stops: ParsedGlowStops,
): PlacedSurface {
  const tileX = Math.floor(centreX / TILE_SIZE - radiusTiles);
  const tileY = Math.floor(centreY / TILE_SIZE - radiusTiles);
  const sizeTiles = Math.ceil(radiusTiles * 2) + 2;
  const sizePx = sizeTiles * LIGHT_PX_PER_TILE;
  const surface = allocCanvas(sizePx, sizePx);
  const ctx = surfaceContext(surface);
  const image = ctx.createImageData(sizePx, sizePx);
  rasteriseGlow(
    field,
    image,
    { tileX, tileY, pxPerTile: LIGHT_PX_PER_TILE },
    centreX,
    centreY,
    radiusTiles,
    stops,
  );
  ctx.putImageData(image, 0, 0);
  return { surface, tileX, tileY, sizeTiles };
}

/** The most per-tile cookies a moving-light cache keeps before it forgets the oldest. */
const ORIGIN_COOKIE_LIMIT = 192;

/**
 * Cut and glow masks for a light sitting exactly on a tile centre, by tile.
 * A moving light is drawn as the weighted sum of the masks of the tile
 * centres round it, so it moves smoothly while every mask it uses is painted
 * once and drawn by the GPU after — nothing is painted on the CPU per frame.
 */
export class OriginCookieCache {
  private readonly cuts = new Map<number, PlacedSurface>();
  private readonly glows = new Map<number, PlacedSurface>();
  private readonly colourIndices = new Map<string, number>();
  private readonly field = new LightField();

  constructor(
    private readonly visibility: VisibilityCache,
    private readonly isOpaque: (x: number, y: number) => boolean,
  ) {}

  /** The soft cut of a light of `reachTiles` centred on tile (`tileX`, `tileY`). */
  cut(tileX: number, tileY: number, reachTiles: number): PlacedSurface {
    const key = tileSizeKey(tileX, tileY, reachTiles);
    const cached = lruGet(this.cuts, key);
    if (cached !== undefined) return cached;
    const visibility = this.visibility.get(tileX, tileY, reachTiles);
    this.field.rebuild([{ visibility, weight: 1 }], this.isOpaque);
    const sizeTiles = visibility.sizeTiles;
    const sizePx = sizeTiles * LIGHT_PX_PER_TILE;
    const surface = allocCanvas(sizePx, sizePx);
    const ctx = surfaceContext(surface);
    const image = ctx.createImageData(sizePx, sizePx);
    rasteriseCut(
      this.field,
      image,
      {
        tileX: visibility.originTileX,
        tileY: visibility.originTileY,
        pxPerTile: LIGHT_PX_PER_TILE,
      },
      (tileX + HALF) * TILE_SIZE,
      (tileY + HALF) * TILE_SIZE,
      reachTiles,
      1,
      true,
    );
    ctx.putImageData(image, 0, 0);
    const placed = {
      surface,
      tileX: visibility.originTileX,
      tileY: visibility.originTileY,
      sizeTiles,
    };
    lruSet(this.cuts, key, placed, ORIGIN_COOKIE_LIMIT);
    return placed;
  }

  /** The glow of a light centred on a tile, in the colour `colourKey` names. */
  glow(
    tileX: number,
    tileY: number,
    radiusTiles: number,
    colourKey: string,
    stops: ParsedGlowStops,
  ): PlacedSurface {
    let colourIndex = this.colourIndices.get(colourKey);
    if (colourIndex === undefined) {
      colourIndex = this.colourIndices.size;
      this.colourIndices.set(colourKey, colourIndex);
    }
    const key = tileSizeKey(tileX, tileY, radiusTiles) * COLOUR_KEY_SLOTS + colourIndex;
    const cached = lruGet(this.glows, key);
    if (cached !== undefined) return cached;
    const visibility = this.visibility.get(tileX, tileY, radiusTiles);
    this.field.rebuild([{ visibility, weight: 1 }], this.isOpaque);
    const placed = paintGlow(
      this.field,
      (tileX + HALF) * TILE_SIZE,
      (tileY + HALF) * TILE_SIZE,
      radiusTiles,
      stops,
    );
    lruSet(this.glows, key, placed, ORIGIN_COOKIE_LIMIT);
    return placed;
  }
}

/** Map widths and size steps the numeric cache keys are packed with; far beyond any floor. */
const KEY_TILE_SPAN = 4096;
const KEY_SIZE_STEPS = 4096;
/** Sizes in tiles are keyed to a hundredth of a tile. */
const KEY_SIZE_SCALE = 100;
/** Glow colours a glow key leaves room for. */
const COLOUR_KEY_SLOTS = 32;

/** One number for a tile and a size in tiles, so a cache lookup builds no string. */
function tileSizeKey(tileX: number, tileY: number, sizeTiles: number): number {
  return (
    ((tileY + KEY_TILE_SPAN) * KEY_TILE_SPAN * 2 + tileX + KEY_TILE_SPAN) * KEY_SIZE_STEPS +
    Math.round(sizeTiles * KEY_SIZE_SCALE)
  );
}

/** A cached value, moved to the young end so one in use is never the next forgotten. */
function lruGet<T>(map: Map<number, T>, key: number): T | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
}

/** Caches a value, forgetting the least recently used one when the cache is full. */
function lruSet<T>(map: Map<number, T>, key: number, value: T, limit: number): void {
  if (map.size >= limit) {
    const oldest = map.keys().next();
    if (oldest.done !== true) map.delete(oldest.value);
  }
  map.set(key, value);
}

/** Shadowcasts from the emitter; the masks themselves are painted when first drawn. */
export function buildLightCookie(request: CookieRequest): LightCookie {
  return new LightCookie(request);
}
