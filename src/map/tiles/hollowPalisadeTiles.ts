/**
 * Briar Hollow's palisade and gate: every wall tier at every damage look, the
 * rubble a breach leaves, the trampled gap a flattened fence leaves, and the
 * village gate with its swinging doors.
 *
 * The ring is drawn as a line of posts along its own path. Each tile looks at
 * which of its four neighbours are also ring tiles (the gate counts) and runs
 * an "arm" of wall from its centre toward each of them, so straight runs,
 * corners and the stepped chamfers all join without a special case. The wall
 * stands on a ground line a little below the tile's centre; a north–south run
 * is a column of posts one behind the other, which is how a wall seen end-on
 * reads in this projection.
 *
 * Everything is clipped to the tile's own columns — the art may rise above the
 * tile (that is height) and dip a little into the wall tile below it on a
 * north–south run, but never reaches sideways onto ground a crawler can stand
 * on.
 *
 * Each distinct look (tier, damage, which arms, which side is outside, spikes,
 * a buttress, a variant) is painted once into a small cache and blitted, so a
 * ring of two hundred tiles costs a few dozen paints.
 */

import {
  HOLLOW_GATE,
  HOLLOW_PALISADE,
  HOLLOW_PALISADE_GAP,
  type PalisadeTier,
  type TileContent,
} from '../tileTypes';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { MapSpriteExtentsPx } from '../../core/SpriteLoader';
import { briarHollowSiteFor } from './hollowSiteRegistry';
import { tileHash } from './hollowTileHash';
import { mulberry32, range, type Rng } from '../../sprites/person/rng';
import {
  INK,
  IRON,
  LOG,
  MOSS,
  STONE,
  WOOD,
  drawBriarKnot,
  drawContactShadow,
  drawFieldstones,
  drawLogSide,
  fillRoundRect,
} from '../../sprites/art/villageArt';
import { tileCoordKey } from '../tileIndex';

// ── Geometry, in tiles ────────────────────────────────────────────────────────

/** The line the wall stands on, down from the tile's top edge. */
const GROUND_Y = 0.78;
/** Wall heights per tier, the fence knee-high and the fortified wall tallest. */
const TIER_HEIGHT: Readonly<Record<PalisadeTier, number>> = {
  fence: 0.7,
  wood: 1.2,
  stone: 1.3,
  fortified: 1.5,
};
/** How far any palisade art rises above its tile. */
export const PALISADE_REACH_UP_TILES = 1.3;
/** How far a north–south run's posts reach into the (wall) tile below. */
const PALISADE_REACH_DOWN_TILES = 0.4;
/** The gate's posts stand taller than any wall. */
const GATE_POST_HEIGHT_TILES = 1.95;
const GATE_REACH_UP_TILES = 1.6;
/** The gate is drawn whole from its middle tile, a tile and a half each way plus the posts. */
const GATE_HALF_SPAN_TILES = 1.5;
const GATE_POST_WIDTH_TILES = 0.44;
/** How far the gate reaches along the wall it stands in, past its middle tile. */
const GATE_REACH_SIDE_TILES = GATE_HALF_SPAN_TILES + GATE_POST_WIDTH_TILES;
/** How far open the doors swing, at full: nearly square to the wall. */
const GATE_OPEN_ANGLE = (80 * Math.PI) / 180;
/** A north/south gate's doors swing toward the village; that depth reads as a reduced climb up the screen. */
const GATE_DEPTH_FORESHORTEN = 0.5;
const GATE_DOOR_HEIGHT = 1.35;
const GATE_BEAM_HEIGHT = 1.72;
const GATE_BEAM_DEPTH = 0.22;
const GATE_BAND_AT = [0.2, 0.75] as const;
/** How thick a closed east/west door reads as, standing on its own edge along the wall line. */
const GATE_EW_DOOR_THICKNESS_TILES = 0.12;
const GATE_EW_LEAF_LENGTH_TILES = GATE_HALF_SPAN_TILES - 0.12;
/** How far an open east/west door's face swings sideways, unforeshortened: it turns square to the camera, not away from it. */
const GATE_EW_REACH_ACROSS_TILES =
  GATE_EW_LEAF_LENGTH_TILES * Math.sin(GATE_OPEN_ANGLE) + GATE_POST_WIDTH_TILES;
/** Where a post's own ground line sits, off the gate's middle tile, along the wall it stands in. */
const GATE_POST_SPAN_TILES = GATE_HALF_SPAN_TILES + GATE_POST_WIDTH_TILES / 2 - 0.18;
/** A capstone's rise above its post, and a contact shadow's dip below its post's ground line. */
const GATE_POST_TOP_MARGIN_TILES = 0.1;

/** Posts along an arm, as offsets from the tile centre: spaced a quarter tile, so runs join seamlessly. */
const STAKE_OFFSETS = [0.125, 0.375] as const;
const STAKE_WIDTH = 0.24;
const STAKE_TIP = 0.16;
/** Where the lashing binds a stake, as a share of its height from the foot. */
const LASHING_AT = 0.72;
const LASHING_DEPTH = 0.07;
/** The inner rail, as a share of the stake's height. */
const RAIL_AT = 0.42;
const RAIL_RADIUS = 0.05;
/** A wall's top in this projection shows its thickness, foreshortened. */
const WALL_CAP_DEPTH = 0.2;
const COLUMN_HALF_WIDTH = 0.2;
/** Stone wall face height; its stakes rise the rest of the tier's height above it. */
const STONE_FACE_HEIGHT = 0.95;
const STONE_COURSE = 0.13;
const FORTIFIED_FACE_HEIGHT = 1.22;
const ASHLAR_COURSE = 0.17;
const MERLON_WIDTH = 0.16;
const MERLON_HEIGHT = 0.17;
const HOARDING_DEPTH = 0.24;
/** Every how many path tiles a fortified wall carries a buttress. */
export const BUTTRESS_EVERY_TILES = 3;
const BUTTRESS_HALF_WIDTH = 0.2;
const BUTTRESS_REACH = 0.08;
const FENCE_PANEL_TOP = 0.52;
const FENCE_PANEL_BOTTOM = 0.1;
const FENCE_POST_WIDTH = 0.1;
const FENCE_LEAN = 0.05;
const BERM_DEPTH = 0.16;
const BERM_HALF_WIDTH = 0.3;
const SPIKE_LENGTH = 0.34;
const SPIKE_WIDTH = 0.085;
/** How far a spike's point climbs for its length, leaning out from the wall. */
const SPIKE_RISE = 0.75;
/** Alternate spikes splay left and right, so a row reads as a bristle rather than a comb. */
const SPIKE_SPLAY = 0.07;
/** On the south face a spike is driven in low on the wall and runs out over the ground in front. */
const SPIKE_FACE_ROOT = 0.2;
const SPIKE_GROUND_REACH = 0.19;
const SPIKE_SHADOW_SHIFT = 0.03;
/** Behind a north wall a spike is rooted part-way up and pokes this far past the wall's top. */
const SPIKE_BEHIND_ROOT = 0.35;
const SPIKE_BEHIND_POKE = 0.9;
/** On an end-on run a spike sticks out from low on the column's side. */
const SPIKE_SIDE_ROOT = 0.25;
/** A south-face spike is drawn after the wall it is driven into. */
const ON_FACE_SORT = 0.01;
/** A foot lies on the wall's own line when it is this close to it. */
const ON_LINE_EPSILON = 1e-6;
/** A wrecked wall leans; a cracked one only splits. */
const WRECKED_LEAN = 0.07;
const WRECKED_SKIP_CHANCE = 0.4;
const CRACKED_SNAP_CHANCE = 0.5;
/** A cracked wall has already lost the odd stake: the gap is what reads at game size. */
const CRACKED_SKIP_CHANCE = 0.15;
const SNAPPED_HEIGHT_SHARE = 0.62;

const INK_WIDTH = 0.025;
const CACHE_DENSITY = 2;
const VARIANT_COUNT = 4;
const VARIANT_SALT = 911;
const RUBBLE_SALT = 457;

/** Cues for which side of a wall is outside the village, where the spikes and the hoarding go. */
type Side = 'north' | 'south' | 'east' | 'west';

/** Damage looks, matching `damageStageFor`: 0 intact, 1 cracked, 2 wrecked. */
const STAGE_CRACKED = 1;
const STAGE_WRECKED = 2;

const DIR_NORTH = 1;
const DIR_EAST = 2;
const DIR_SOUTH = 4;
const DIR_WEST = 8;

// ── Site lookup ───────────────────────────────────────────────────────────────

/** A gate's middle tile, which draws the whole gate, and which wall it stands in. */
interface GateMiddle {
  readonly x: number;
  readonly y: number;
  readonly side: Side;
}

interface PalisadeLayout {
  /** Palisade path and every gate's tiles, by `tileCoordKey`. */
  readonly ring: ReadonlySet<number>;
  /** A tile's index along the palisade path, for the fortified wall's buttress rhythm. */
  readonly pathIndex: ReadonlyMap<number, number>;
  readonly centreX: number;
  readonly centreY: number;
  readonly halfW: number;
  readonly halfH: number;
  /** Every gate's middle tile, one per wall it stands in. */
  readonly gateMiddles: readonly GateMiddle[];
}

const layouts = new WeakMap<TileContent[][], PalisadeLayout>();

function isRingType(type: number | undefined): boolean {
  return type === HOLLOW_PALISADE || type === HOLLOW_PALISADE_GAP || type === HOLLOW_GATE;
}

function layoutFor(structure: TileContent[][]): PalisadeLayout {
  const cached = layouts.get(structure);
  if (cached !== undefined) return cached;
  const site = briarHollowSiteFor(structure);
  const ring = new Set<number>();
  const pathIndex = new Map<number, number>();
  let layout: PalisadeLayout;
  if (site === undefined) {
    // A hand-built test map: fall back to "any palisade-type neighbour".
    for (let ty = 0; ty < structure.length; ty++) {
      const row = structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        if (isRingType(row[tx].type)) ring.add(tileCoordKey(tx, ty));
      }
    }
    layout = { ring, pathIndex, centreX: 0, centreY: 0, halfW: 1, halfH: 1, gateMiddles: [] };
  } else {
    site.palisadePath.forEach((tile, index) => {
      const key = tileCoordKey(tile.x, tile.y);
      ring.add(key);
      pathIndex.set(key, index);
    });
    for (const gate of site.gates) {
      for (const tile of gate.tiles) ring.add(tileCoordKey(tile.x, tile.y));
    }
    const bounds = site.palisadeBounds;
    const gateMiddles = site.gates.map((gate): GateMiddle => {
      const middle = gate.tiles[Math.floor(gate.tiles.length / 2)];
      return { x: middle.x, y: middle.y, side: gate.facing };
    });
    layout = {
      ring,
      pathIndex,
      centreX: bounds.x + bounds.w / 2,
      centreY: bounds.y + bounds.h / 2,
      halfW: bounds.w / 2,
      halfH: bounds.h / 2,
      gateMiddles,
    };
  }
  layouts.set(structure, layout);
  return layout;
}

/** The tile at (tx, ty), or undefined off the grid. */
function contentAt(structure: TileContent[][], tx: number, ty: number): TileContent | undefined {
  if (ty < 0 || ty >= structure.length) return undefined;
  const row = structure[ty];
  return tx >= 0 && tx < row.length ? row[tx] : undefined;
}

function connections(layout: PalisadeLayout, tx: number, ty: number): number {
  let mask = 0;
  if (layout.ring.has(tileCoordKey(tx, ty - 1))) mask |= DIR_NORTH;
  if (layout.ring.has(tileCoordKey(tx + 1, ty))) mask |= DIR_EAST;
  if (layout.ring.has(tileCoordKey(tx, ty + 1))) mask |= DIR_SOUTH;
  if (layout.ring.has(tileCoordKey(tx - 1, ty))) mask |= DIR_WEST;
  return mask;
}

/** Outside is whichever way the tile sits furthest from the ring's centre, measured against the ring's shape. */
function outsideOf(layout: PalisadeLayout, tx: number, ty: number): Side {
  const dx = (tx + 0.5 - layout.centreX) / layout.halfW;
  const dy = (ty + 0.5 - layout.centreY) / layout.halfH;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'north' : 'south';
  return dx < 0 ? 'west' : 'east';
}

// ── The piece a tile draws ────────────────────────────────────────────────────

interface PalisadePiece {
  readonly tier: PalisadeTier;
  readonly stage: number;
  readonly mask: number;
  readonly outside: Side;
  readonly spiked: boolean;
  readonly buttress: boolean;
  readonly variant: number;
}

function pieceKey(piece: PalisadePiece, ts: number): string {
  return [
    piece.tier,
    piece.stage,
    piece.mask,
    piece.outside,
    piece.spiked ? 1 : 0,
    piece.buttress ? 1 : 0,
    piece.variant,
    ts,
  ].join('|');
}

function pieceFor(structure: TileContent[][], tx: number, ty: number): PalisadePiece {
  const layout = layoutFor(structure);
  const tile = contentAt(structure, tx, ty);
  const tier = tile?.wallTier ?? 'fence';
  const index = layout.pathIndex.get(tileCoordKey(tx, ty));
  return {
    tier,
    stage: tier === 'fence' ? 0 : (tile?.damageStage ?? 0),
    mask: connections(layout, tx, ty),
    outside: outsideOf(layout, tx, ty),
    spiked: tile?.wallSpiked === true && tier !== 'fence',
    buttress: tier === 'fortified' && index !== undefined && index % BUTTRESS_EVERY_TILES === 1,
    variant: tileHash(tx, ty, VARIANT_SALT) % VARIANT_COUNT,
  };
}

interface CachedArt {
  readonly surface: CanvasSurface;
  readonly padUp: number;
  readonly padLeft: number;
  readonly width: number;
  readonly height: number;
}

const pieceCache = new Map<string, CachedArt>();

function cachedPiece(piece: PalisadePiece, ts: number): CachedArt {
  const key = pieceKey(piece, ts);
  const hit = pieceCache.get(key);
  if (hit !== undefined) return hit;
  const padUp = Math.ceil(ts * PALISADE_REACH_UP_TILES);
  const padDown = Math.ceil(ts * PALISADE_REACH_DOWN_TILES);
  const width = ts;
  const height = padUp + ts + padDown;
  const surface = allocCanvas(width * CACHE_DENSITY, height * CACHE_DENSITY);
  const ctx = surfaceContext(surface);
  ctx.scale(CACHE_DENSITY, CACHE_DENSITY);
  paintPalisadePiece(ctx, piece, 0, padUp, ts);
  const entry: CachedArt = { surface, padUp, padLeft: 0, width, height };
  pieceCache.set(key, entry);
  return entry;
}

// ── Public entry points ───────────────────────────────────────────────────────

/** Draws a `HOLLOW_PALISADE` tile. */
export function drawHollowPalisadeTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const cached = cachedPiece(pieceFor(structure, tx, ty), ts);
  ctx.drawImage(cached.surface, sx, sy - cached.padUp, cached.width, cached.height);
}

/** How far a palisade tile's art reaches: up for its height, and down on a north–south run. */
export function hollowPalisadeExtentsPx(ts: number): MapSpriteExtentsPx {
  return {
    left: 0,
    up: Math.ceil(ts * PALISADE_REACH_UP_TILES),
    right: 0,
    down: Math.ceil(ts * PALISADE_REACH_DOWN_TILES),
  };
}

/**
 * Paints one palisade look at (x, y) with tile size `ts`, for the review
 * sheet and the art gate. The same painter the map's cache uses.
 */
export function paintPalisadeForReview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  look: {
    tier: PalisadeTier;
    stage: number;
    mask: number;
    outside: Side;
    spiked: boolean;
    buttress: boolean;
    variant: number;
  },
): void {
  paintPalisadePiece(ctx, look, x, y, ts);
}

export const PALISADE_DIRS = {
  north: DIR_NORTH,
  east: DIR_EAST,
  south: DIR_SOUTH,
  west: DIR_WEST,
} as const;
export type PalisadeSide = Side;

// ── Painting a wall piece ─────────────────────────────────────────────────────

/** A drawable along the wall, ordered back to front by where it stands. */
interface WallItem {
  readonly footY: number;
  readonly x: number;
  readonly draw: () => void;
}

interface Arm {
  readonly dir: number;
  readonly horizontal: boolean;
  /** Foot-line span of the arm, in tile units from the tile's top-left. */
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

function armsOf(mask: number): Arm[] {
  const arms: Arm[] = [];
  const half = 0.5;
  if ((mask & DIR_WEST) !== 0) {
    arms.push({ dir: DIR_WEST, horizontal: true, x0: 0, x1: half, y0: GROUND_Y, y1: GROUND_Y });
  }
  if ((mask & DIR_EAST) !== 0) {
    arms.push({ dir: DIR_EAST, horizontal: true, x0: half, x1: 1, y0: GROUND_Y, y1: GROUND_Y });
  }
  if ((mask & DIR_NORTH) !== 0) {
    arms.push({
      dir: DIR_NORTH,
      horizontal: false,
      x0: half,
      x1: half,
      y0: GROUND_Y - half,
      y1: GROUND_Y,
    });
  }
  if ((mask & DIR_SOUTH) !== 0) {
    arms.push({
      dir: DIR_SOUTH,
      horizontal: false,
      x0: half,
      x1: half,
      y0: GROUND_Y,
      y1: GROUND_Y + half,
    });
  }
  return arms;
}

/** Stake feet along the tile's arms, plus a post at the centre wherever the run turns or ends. */
function stakeFeet(mask: number): Array<{ x: number; y: number; corner: boolean }> {
  const feet: Array<{ x: number; y: number; corner: boolean }> = [];
  const straight = mask === (DIR_EAST | DIR_WEST) || mask === (DIR_NORTH | DIR_SOUTH);
  if (!straight) feet.push({ x: 0.5, y: GROUND_Y, corner: true });
  for (const offset of STAKE_OFFSETS) {
    if ((mask & DIR_WEST) !== 0) feet.push({ x: 0.5 - offset, y: GROUND_Y, corner: false });
    if ((mask & DIR_EAST) !== 0) feet.push({ x: 0.5 + offset, y: GROUND_Y, corner: false });
    if ((mask & DIR_NORTH) !== 0) feet.push({ x: 0.5, y: GROUND_Y - offset, corner: false });
    if ((mask & DIR_SOUTH) !== 0) feet.push({ x: 0.5, y: GROUND_Y + offset, corner: false });
  }
  return feet;
}

function paintPalisadePiece(
  ctx: CanvasRenderingContext2D,
  piece: PalisadePiece,
  ox: number,
  oy: number,
  u: number,
): void {
  const rng = mulberry32(
    piece.variant * 7919 + piece.mask * 131 + piece.stage * 17 + piece.tier.length,
  );
  ctx.save();
  try {
    // The tile's own columns only: height may rise above, nothing reaches sideways.
    ctx.beginPath();
    ctx.rect(
      ox,
      oy - u * PALISADE_REACH_UP_TILES,
      u,
      u * (1 + PALISADE_REACH_UP_TILES + PALISADE_REACH_DOWN_TILES),
    );
    ctx.clip();
    const lean =
      piece.stage >= STAGE_WRECKED ? (piece.variant % 2 === 0 ? 1 : -1) * WRECKED_LEAN : 0;
    const paint = new WallPainter(ctx, ox, oy, u, rng, piece, lean);
    switch (piece.tier) {
      case 'fence':
        paint.fence();
        break;
      case 'wood':
        paint.wood();
        break;
      case 'stone':
        paint.stone();
        break;
      case 'fortified':
        paint.fortified();
        break;
    }
  } finally {
    ctx.restore();
  }
}

class WallPainter {
  private readonly arms: Arm[];

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly ox: number,
    private readonly oy: number,
    private readonly u: number,
    private readonly rng: Rng,
    private readonly piece: PalisadePiece,
    private readonly lean: number,
  ) {
    this.arms = armsOf(piece.mask);
  }

  private px(x: number): number {
    return this.ox + x * this.u;
  }

  private py(y: number): number {
    return this.oy + y * this.u;
  }

  private drawItems(items: WallItem[]): void {
    items.sort((a, b) => a.footY - b.footY || a.x - b.x);
    for (const item of items) item.draw();
  }

  private get outsideSign(): number {
    const side = this.piece.outside;
    return side === 'south' || side === 'east' ? 1 : -1;
  }

  /** A low mound of packed earth and stones along the wall's foot, so the blocked tile reads as built ground. */
  private berm(color: string, rim: string): void {
    for (const arm of this.arms) {
      if (arm.horizontal) {
        fillRoundRect(
          this.ctx,
          this.px(arm.x0),
          this.py(GROUND_Y - BERM_DEPTH * 0.6),
          (arm.x1 - arm.x0) * this.u,
          BERM_DEPTH * 1.6 * this.u,
          BERM_DEPTH * 0.5 * this.u,
          color,
        );
      } else {
        fillRoundRect(
          this.ctx,
          this.px(0.5 - BERM_HALF_WIDTH),
          this.py(arm.y0 - BERM_DEPTH * 0.3),
          BERM_HALF_WIDTH * 2 * this.u,
          (arm.y1 - arm.y0 + BERM_DEPTH) * this.u,
          BERM_DEPTH * 0.5 * this.u,
          color,
        );
      }
    }
    drawContactShadow(
      this.ctx,
      this.px(0.5),
      this.py(GROUND_Y + BERM_DEPTH * 0.4),
      this.u * 0.46,
      this.u * 0.12,
    );
    this.ctx.fillStyle = rim;
    if (this.arms.length === 0) return;
    for (let pebble = 0; pebble < 5; pebble++) {
      const arm = this.arms[pebble % this.arms.length];
      const t = this.rng();
      const x = arm.horizontal
        ? arm.x0 + (arm.x1 - arm.x0) * t
        : 0.5 + range(this.rng, -0.22, 0.22);
      const y = arm.horizontal
        ? GROUND_Y + range(this.rng, 0.02, 0.12)
        : arm.y0 + (arm.y1 - arm.y0) * t;
      this.ctx.beginPath();
      this.ctx.ellipse(this.px(x), this.py(y), this.u * 0.035, this.u * 0.022, 0, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  /** One sharpened log stake standing at (x, footY), `height` tall. */
  private stake(
    x: number,
    footY: number,
    height: number,
    options: { snapped: boolean; lashed: boolean; width?: number },
  ): void {
    const ctx = this.ctx;
    const w = options.width ?? STAKE_WIDTH;
    const shownHeight = options.snapped ? height * SNAPPED_HEIGHT_SHARE : height;
    const topX = x + this.lean * (shownHeight / height);
    const left = this.px(x - w / 2);
    const right = this.px(x + w / 2);
    const topLeft = this.px(topX - w / 2);
    const topRight = this.px(topX + w / 2);
    const bottom = this.py(footY);
    const shoulder = this.py(footY - shownHeight + (options.snapped ? 0 : STAKE_TIP));
    const tip = this.py(footY - shownHeight);
    ctx.fillStyle = LOG.bark;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(topLeft, shoulder);
    if (options.snapped) {
      // A splintered break: a jagged top instead of a point.
      const step = (topRight - topLeft) / 4;
      ctx.lineTo(topLeft + step, tip + this.u * 0.03);
      ctx.lineTo(topLeft + step * 2, tip - this.u * 0.02);
      ctx.lineTo(topLeft + step * 3, tip + this.u * 0.04);
    } else {
      ctx.lineTo(this.px(topX), tip);
    }
    ctx.lineTo(topRight, shoulder);
    ctx.lineTo(right, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = this.u * INK_WIDTH;
    ctx.stroke();
    // Lit from the upper left: a pale strip down the left of the log, a shadow down the right.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = LOG.barkLight;
    ctx.fillRect(left + (right - left) * 0.18, shoulder, (right - left) * 0.2, bottom - shoulder);
    ctx.fillStyle = LOG.barkDark;
    ctx.fillRect(left + (right - left) * 0.72, shoulder, (right - left) * 0.2, bottom - shoulder);
    ctx.globalAlpha = 1;
    // The whittled point shows pale wood.
    if (!options.snapped) {
      ctx.fillStyle = LOG.cut;
      ctx.beginPath();
      ctx.moveTo(this.px(topX), tip);
      ctx.lineTo(topLeft + (topRight - topLeft) * 0.3, shoulder);
      ctx.lineTo(topLeft + (topRight - topLeft) * 0.62, shoulder);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = LOG.cutDark;
      ctx.fillRect(
        topLeft + (topRight - topLeft) * 0.2,
        tip,
        (topRight - topLeft) * 0.6,
        this.u * 0.03,
      );
    }
    if (options.lashed && !options.snapped) {
      const bandY = this.py(footY - height * LASHING_AT);
      ctx.fillStyle = LOG.cutDark;
      ctx.fillRect(left, bandY, right - left, this.u * LASHING_DEPTH);
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(left, bandY + this.u * LASHING_DEPTH * 0.55, right - left, this.u * 0.012);
      ctx.globalAlpha = 1;
    }
    if (this.piece.stage >= STAGE_CRACKED) {
      ctx.strokeStyle = LOG.barkDark;
      ctx.lineWidth = this.u * 0.018;
      ctx.beginPath();
      const crackX = left + (right - left) * range(this.rng, 0.35, 0.65);
      ctx.moveTo(crackX, shoulder + (bottom - shoulder) * 0.15);
      ctx.lineTo(crackX + this.u * 0.02, shoulder + (bottom - shoulder) * 0.45);
      ctx.lineTo(crackX - this.u * 0.01, shoulder + (bottom - shoulder) * 0.7);
      ctx.stroke();
    }
  }

  /** Whether a stake is standing at all: a wrecked wall has gaps where stakes fell out. */
  private stakeMissing(corner: boolean): boolean {
    if (corner) return false;
    const chance =
      this.piece.stage >= STAGE_WRECKED
        ? WRECKED_SKIP_CHANCE
        : this.piece.stage >= STAGE_CRACKED
          ? CRACKED_SKIP_CHANCE
          : 0;
    return this.rng() < chance;
  }

  private stakeSnapped(): boolean {
    return this.piece.stage >= STAGE_CRACKED && this.rng() < CRACKED_SNAP_CHANCE;
  }

  /** Sharpened stakes angled outward from the wall's foot, on the outside face. */
  /**
   * Sharpened stakes angled outward from the wall, on the outside face.
   * On the south face they lean out toward the camera; on the north face they
   * rise behind the wall, long enough that their points show over its top.
   */
  private spikes(wallHeight: number): WallItem[] {
    if (!this.piece.spiked) return [];
    const items: WallItem[] = [];
    const side = this.piece.outside;
    const sign = this.outsideSign;
    const horizontalWall = side === 'north' || side === 'south';
    let alternate = 0;
    for (const foot of stakeFeet(this.piece.mask)) {
      if (foot.corner) continue;
      const alongWall = horizontalWall
        ? Math.abs(foot.y - GROUND_Y) < ON_LINE_EPSILON
        : Math.abs(foot.x - 0.5) < ON_LINE_EPSILON;
      if (!alongWall) continue;
      const splay = (alternate++ % 2 === 0 ? -1 : 1) * SPIKE_SPLAY;
      let rootX: number;
      let rootY: number;
      let tipX: number;
      let tipY: number;
      if (side === 'south') {
        // Driven into the face and angled out at the camera: in this projection
        // that reads as a pale point hanging down the front of the wall.
        rootX = foot.x;
        rootY = GROUND_Y - wallHeight * SPIKE_FACE_ROOT;
        tipX = foot.x + splay;
        tipY = GROUND_Y + SPIKE_GROUND_REACH;
      } else if (side === 'north') {
        rootX = foot.x;
        rootY = GROUND_Y - WALL_CAP_DEPTH - wallHeight * SPIKE_BEHIND_ROOT;
        tipX = foot.x + splay;
        tipY = GROUND_Y - wallHeight - SPIKE_LENGTH * SPIKE_BEHIND_POKE;
      } else {
        rootX = 0.5 + sign * COLUMN_HALF_WIDTH * 0.8;
        rootY = foot.y - wallHeight * SPIKE_SIDE_ROOT;
        tipX = rootX + sign * SPIKE_LENGTH;
        tipY = rootY - SPIKE_LENGTH * SPIKE_RISE;
      }
      items.push({
        footY: side === 'south' ? GROUND_Y + ON_FACE_SORT : foot.y,
        x: rootX,
        draw: () => this.spike(rootX, rootY, tipX, tipY),
      });
    }
    return items;
  }

  private spike(rootX: number, rootY: number, tipX: number, tipY: number): void {
    const ctx = this.ctx;
    if (tipY > rootY) {
      // Out over the ground in front: its shadow falls on the grass beneath it.
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = this.u * SPIKE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(this.px(rootX), this.py(GROUND_Y));
      ctx.lineTo(this.px(tipX + SPIKE_SHADOW_SHIFT), this.py(tipY + SPIKE_SHADOW_SHIFT));
      ctx.stroke();
    }
    const dx = tipX - rootX;
    const dy = tipY - rootY;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * SPIKE_WIDTH;
    const ny = (dx / length) * SPIKE_WIDTH;
    ctx.fillStyle = LOG.cut;
    ctx.beginPath();
    ctx.moveTo(this.px(rootX + nx), this.py(rootY + ny));
    ctx.lineTo(this.px(tipX), this.py(tipY));
    ctx.lineTo(this.px(rootX - nx), this.py(rootY - ny));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = this.u * INK_WIDTH;
    ctx.stroke();
    ctx.fillStyle = LOG.cut;
    ctx.beginPath();
    ctx.arc(this.px(tipX), this.py(tipY), this.u * 0.015, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Fence ───────────────────────────────────────────────────────────────

  /** A flimsy hurdle: woven withies between wobbly posts, with holes in it. */
  fence(): void {
    const ctx = this.ctx;
    const height = TIER_HEIGHT.fence;
    const items: WallItem[] = [];
    for (const arm of this.arms) {
      const holeAt = this.rng();
      items.push({
        footY: arm.y1 - 0.001,
        x: arm.x0,
        draw: () => {
          if (arm.horizontal) {
            const sag = this.u * 0.04 * (this.piece.variant % 2 === 0 ? 1 : -0.5);
            const top = this.py(GROUND_Y - FENCE_PANEL_TOP);
            const bottom = this.py(GROUND_Y - FENCE_PANEL_BOTTOM);
            this.wattleBand(this.px(arm.x0), top + sag, (arm.x1 - arm.x0) * this.u, bottom - top);
            // The hole it obviously needs mending: a torn patch through the weave.
            if (holeAt < 0.6) {
              const hx = this.px(arm.x0 + (arm.x1 - arm.x0) * range(this.rng, 0.2, 0.6));
              ctx.fillStyle = 'rgba(20,14,8,0.85)';
              ctx.beginPath();
              ctx.ellipse(
                hx,
                (top + bottom) / 2 + sag,
                this.u * 0.07,
                this.u * 0.09,
                0.3,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
          } else {
            const left = this.px(0.5 - FENCE_POST_WIDTH * 0.45);
            const top = this.py(arm.y0 - FENCE_PANEL_TOP);
            const bottom = this.py(arm.y1 - FENCE_PANEL_BOTTOM);
            this.wattleBand(left, top, FENCE_POST_WIDTH * 0.9 * this.u, bottom - top);
          }
        },
      });
    }
    const posts: Array<{ x: number; y: number }> = [{ x: 0.5, y: GROUND_Y }];
    for (const arm of this.arms) {
      if (!arm.horizontal) posts.push({ x: 0.5, y: (arm.y0 + arm.y1) / 2 });
    }
    for (const post of posts) {
      const wobble = range(this.rng, -FENCE_LEAN, FENCE_LEAN);
      items.push({
        footY: post.y,
        x: post.x,
        draw: () => {
          const bottom = this.py(post.y);
          const top = this.py(post.y - height);
          ctx.strokeStyle = INK;
          ctx.lineWidth = this.u * (FENCE_POST_WIDTH + INK_WIDTH * 2);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(this.px(post.x), bottom);
          ctx.lineTo(this.px(post.x + wobble), top);
          ctx.stroke();
          ctx.strokeStyle = LOG.barkLight;
          ctx.lineWidth = this.u * FENCE_POST_WIDTH;
          ctx.beginPath();
          ctx.moveTo(this.px(post.x), bottom);
          ctx.lineTo(this.px(post.x + wobble), top);
          ctx.stroke();
          ctx.fillStyle = LOG.cut;
          ctx.beginPath();
          ctx.ellipse(
            this.px(post.x + wobble),
            top,
            this.u * 0.045,
            this.u * 0.025,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        },
      });
    }
    drawContactShadow(ctx, this.px(0.5), this.py(GROUND_Y + 0.03), this.u * 0.42, this.u * 0.08);
    this.drawItems(items);
  }

  /** A band of woven rods, loose and pale, in pixels. */
  private wattleBand(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(42,26,16,0.55)';
    ctx.fillRect(x, y, w, h);
    const rods = 4;
    ctx.lineCap = 'round';
    for (let rod = 0; rod < rods; rod++) {
      const ry = y + ((rod + 0.5) / rods) * h;
      ctx.strokeStyle = rod % 2 === 0 ? LOG.barkLight : WOOD.light;
      ctx.lineWidth = Math.max(1, (h / rods) * 0.7);
      ctx.beginPath();
      ctx.moveTo(x, ry);
      const waves = Math.max(1, Math.round(w / (this.u * 0.2)));
      for (let wave = 1; wave <= waves; wave++) {
        const wx = x + (wave / waves) * w;
        const sway = (wave + rod) % 2 === 0 ? -h * 0.05 : h * 0.05;
        ctx.quadraticCurveTo(wx - w / waves / 2, ry + sway, wx, ry);
      }
      ctx.stroke();
    }
    if (h > w) {
      // An end-on run: a few withies crossing it.
      ctx.strokeStyle = LOG.bark;
      ctx.lineWidth = Math.max(1, w * 0.4);
      for (let cross = 0; cross < 3; cross++) {
        const cy = y + ((cross + 0.5) / 3) * h;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x + w, cy + h * 0.04);
        ctx.stroke();
      }
    }
  }

  // ── Wood ────────────────────────────────────────────────────────────────

  /** Sharpened log stakes, lashed near the top, a rail along the inside. */
  wood(): void {
    const height = TIER_HEIGHT.wood;
    this.berm(WOOD.deep, LOG.barkDark);
    const items: WallItem[] = [];
    const behindSpikes = this.piece.outside === 'north';
    const spikeItems = this.spikes(TIER_HEIGHT.wood);
    if (behindSpikes) {
      for (const spike of spikeItems) spike.draw();
    }
    for (const foot of stakeFeet(this.piece.mask)) {
      if (this.stakeMissing(foot.corner)) continue;
      const snapped = this.stakeSnapped();
      items.push({
        footY: foot.y,
        x: foot.x,
        draw: () =>
          this.stake(foot.x, foot.y, height * (foot.corner ? 1.06 : 1), {
            snapped,
            lashed: true,
            width: foot.corner ? STAKE_WIDTH * 1.15 : STAKE_WIDTH,
          }),
      });
    }
    items.push(...this.innerRail(height));
    if (!behindSpikes) items.push(...spikeItems);
    this.drawItems(items);
  }

  /** The rail that ties the stakes together, on whichever face is inside the village. */
  private innerRail(height: number): WallItem[] {
    const items: WallItem[] = [];
    const inside = -this.outsideSign;
    const side = this.piece.outside;
    for (const arm of this.arms) {
      if (arm.horizontal && (side === 'north' || side === 'south')) {
        // Only the north wall's rail faces the camera; the south wall's is behind its stakes.
        if (inside < 0) continue;
        const railY = GROUND_Y + 0.06;
        items.push({
          footY: railY,
          x: arm.x0,
          draw: () =>
            drawLogSide(
              this.ctx,
              this.px(arm.x0),
              this.py(railY - height * RAIL_AT),
              (arm.x1 - arm.x0) * this.u,
              RAIL_RADIUS * this.u,
              this.rng,
              false,
            ),
        });
      } else if (!arm.horizontal && (side === 'east' || side === 'west')) {
        const railX = 0.5 + inside * (STAKE_WIDTH * 0.5 + RAIL_RADIUS);
        items.push({
          footY: arm.y1,
          x: railX,
          draw: () => {
            const top = this.py(arm.y0 - height * RAIL_AT);
            const bottom = this.py(arm.y1 - height * RAIL_AT);
            fillRoundRect(
              this.ctx,
              this.px(railX - RAIL_RADIUS),
              top,
              RAIL_RADIUS * 2 * this.u,
              bottom - top + RAIL_RADIUS * this.u,
              RAIL_RADIUS * this.u,
              LOG.barkLight,
            );
          },
        });
      }
    }
    return items;
  }

  // ── Stone ───────────────────────────────────────────────────────────────

  /** Mortared fieldstone to shoulder height, the wooden wall's stakes still showing above it. */
  stone(): void {
    this.berm(STONE.deep, STONE.dark);
    const face = STONE_FACE_HEIGHT;
    const behindSpikes = this.piece.outside === 'north';
    const spikeItems = this.spikes(face);
    if (behindSpikes) for (const spike of spikeItems) spike.draw();
    const items: WallItem[] = [];
    for (const arm of this.arms) {
      items.push({
        footY: arm.y1,
        x: arm.x0,
        draw: () => this.masonryArm(arm, face, 'fieldstone'),
      });
    }
    const stakeHeight = TIER_HEIGHT.stone - face + WALL_CAP_DEPTH;
    for (const foot of stakeFeet(this.piece.mask)) {
      if (this.stakeMissing(foot.corner)) continue;
      const snapped = this.stakeSnapped();
      const seat = foot.y - face - WALL_CAP_DEPTH * 0.5;
      items.push({
        footY: foot.y + 0.001,
        x: foot.x,
        draw: () =>
          this.stake(foot.x, seat, stakeHeight, {
            snapped,
            lashed: false,
            width: STAKE_WIDTH * 0.8,
          }),
      });
    }
    if (!behindSpikes) items.push(...spikeItems);
    this.drawItems(items);
  }

  /** One arm of a masonry wall: its face, and its top showing the wall's thickness. */
  private masonryArm(arm: Arm, faceHeight: number, style: 'fieldstone' | 'ashlar'): void {
    const ctx = this.ctx;
    const lean = this.lean * 0.5;
    if (arm.horizontal) {
      const x = this.px(arm.x0);
      const w = (arm.x1 - arm.x0) * this.u;
      const faceTop = this.py(GROUND_Y - faceHeight);
      const faceBottom = this.py(GROUND_Y);
      this.masonry(x, faceTop, w, faceBottom - faceTop, style);
      const capTop = this.py(GROUND_Y - faceHeight - WALL_CAP_DEPTH);
      this.cap(x + lean * this.u, capTop, w, faceTop - capTop, style);
      ctx.strokeStyle = INK;
      ctx.lineWidth = this.u * INK_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, faceBottom);
      ctx.lineTo(x + w, faceBottom);
      ctx.moveTo(x, capTop);
      ctx.lineTo(x + w, capTop);
      ctx.stroke();
      this.masonryDamage(x, faceTop, w, faceBottom - faceTop);
      return;
    }
    const x = this.px(0.5 - COLUMN_HALF_WIDTH);
    const w = COLUMN_HALF_WIDTH * 2 * this.u;
    const capTop = this.py(arm.y0 - faceHeight);
    const capBottom = this.py(arm.y1 - faceHeight);
    const faceBottom = this.py(arm.y1);
    this.masonry(x, capBottom, w, faceBottom - capBottom, style);
    this.cap(x, capTop, w, capBottom - capTop, style);
    ctx.strokeStyle = INK;
    ctx.lineWidth = this.u * INK_WIDTH;
    ctx.strokeRect(x, capTop, w, faceBottom - capTop);
    this.masonryDamage(x, capBottom, w, faceBottom - capBottom);
  }

  private masonry(
    x: number,
    y: number,
    w: number,
    h: number,
    style: 'fieldstone' | 'ashlar',
  ): void {
    if (h <= 0 || w <= 0) return;
    if (style === 'fieldstone') {
      drawFieldstones(this.ctx, x, y, w, h, this.rng, STONE_COURSE * this.u, 0.15);
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    try {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = STONE.dark;
      ctx.fillRect(x, y, w, h);
      const course = ASHLAR_COURSE * this.u;
      const rows = Math.max(1, Math.round(h / course));
      const rowH = h / rows;
      const blockW = course * 2;
      const mortar = Math.max(1, this.u * 0.02);
      for (let row = 0; row < rows; row++) {
        const top = y + row * rowH;
        let cursor = x - (row % 2 === 0 ? 0 : blockW / 2);
        while (cursor < x + w) {
          const tone = this.rng();
          ctx.fillStyle = tone < 0.3 ? STONE.body : tone < 0.85 ? STONE.light : STONE.highlight;
          ctx.fillRect(cursor + mortar, top + mortar, blockW - mortar * 2, rowH - mortar * 2);
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = STONE.highlight;
          ctx.fillRect(
            cursor + mortar,
            top + mortar,
            blockW - mortar * 2,
            (rowH - mortar * 2) * 0.25,
          );
          ctx.globalAlpha = 1;
          cursor += blockW;
        }
      }
      // The face darkens toward its foot, where rain splash and moss collect.
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(20,30,16,0.35)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    } finally {
      ctx.restore();
    }
  }

  private cap(x: number, y: number, w: number, h: number, style: 'fieldstone' | 'ashlar'): void {
    if (h <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = style === 'ashlar' ? STONE.highlight : STONE.light;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y + h * 0.7, w, h * 0.3);
    if (style === 'fieldstone') {
      ctx.fillStyle = MOSS.body;
      ctx.globalAlpha = 0.45;
      const tufts = 3;
      for (let tuft = 0; tuft < tufts; tuft++) {
        ctx.beginPath();
        ctx.ellipse(
          x + w * range(this.rng, 0.1, 0.9),
          y + h * range(this.rng, 0.2, 0.6),
          this.u * 0.05,
          this.u * 0.02,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Cracks when cracked; knocked-out stones and a broken top when wrecked. */
  private masonryDamage(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    if (this.piece.stage >= STAGE_CRACKED) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = this.u * 0.03;
      ctx.beginPath();
      let cx = x + w * range(this.rng, 0.25, 0.75);
      let cy = y + h * 0.05;
      ctx.moveTo(cx, cy);
      const zigs = 4;
      for (let zig = 0; zig < zigs; zig++) {
        cx += this.u * range(this.rng, -0.07, 0.07);
        cy += (h * 0.8) / zigs;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      // One stone already knocked out: a crack alone is a hairline at game size.
      const hx = x + w * range(this.rng, 0.2, 0.6);
      const hy = y + h * range(this.rng, 0.3, 0.6);
      fillRoundRect(ctx, hx, hy, this.u * 0.14, this.u * 0.1, this.u * 0.03, 'rgba(16,12,8,0.85)');
    }
    if (this.piece.stage >= STAGE_WRECKED) {
      const holes = 2;
      for (let hole = 0; hole < holes; hole++) {
        const hx = x + w * range(this.rng, 0.15, 0.7);
        const hy = y + h * range(this.rng, 0.15, 0.6);
        fillRoundRect(
          ctx,
          hx,
          hy,
          this.u * 0.16,
          this.u * 0.11,
          this.u * 0.04,
          'rgba(16,12,8,0.9)',
        );
      }
      // Rubble at the foot.
      for (let stone = 0; stone < 3; stone++) {
        fillRoundRect(
          ctx,
          x + w * range(this.rng, 0.05, 0.8),
          y + h + range(this.rng, -0.02, 0.05) * this.u,
          this.u * 0.1,
          this.u * 0.06,
          this.u * 0.03,
          STONE.body,
        );
      }
    }
  }

  // ── Fortified ───────────────────────────────────────────────────────────

  /** Dressed stone with crenels, a timber hoarding on the outside, and banded buttresses. */
  fortified(): void {
    this.berm(STONE.deep, STONE.dark);
    const face = FORTIFIED_FACE_HEIGHT;
    const behind = this.piece.outside === 'north';
    const spikeItems = this.spikes(face);
    if (behind) {
      for (const spike of spikeItems) spike.draw();
      this.hoarding(face);
      if (this.piece.buttress) this.buttress(face);
    }
    const items: WallItem[] = [];
    for (const arm of this.arms) {
      items.push({
        footY: arm.y1,
        x: arm.x0,
        draw: () => {
          this.masonryArm(arm, face, 'ashlar');
          this.merlons(arm, face);
        },
      });
    }
    this.drawItems(items);
    if (!behind) {
      if (this.piece.buttress) this.buttress(face);
      this.hoarding(face);
      for (const spike of spikeItems) spike.draw();
    }
  }

  /** The crenellation: merlons standing on the wall top, gaps between. */
  private merlons(arm: Arm, face: number): void {
    const ctx = this.ctx;
    const count = 2;
    for (let merlon = 0; merlon < count; merlon++) {
      if (this.piece.stage >= STAGE_WRECKED && merlon === this.piece.variant % count) continue;
      const t = (merlon + 0.5) / count;
      const footX = arm.horizontal ? arm.x0 + (arm.x1 - arm.x0) * t : 0.5;
      const footY = arm.horizontal ? GROUND_Y : arm.y0 + (arm.y1 - arm.y0) * t;
      const top = footY - face - WALL_CAP_DEPTH * 0.5 - MERLON_HEIGHT;
      const x = this.px(footX - MERLON_WIDTH / 2);
      fillRoundRect(
        ctx,
        x,
        this.py(top),
        MERLON_WIDTH * this.u,
        MERLON_HEIGHT * this.u,
        this.u * 0.015,
        STONE.light,
      );
      ctx.fillStyle = STONE.highlight;
      ctx.fillRect(x, this.py(top), MERLON_WIDTH * this.u, this.u * 0.04);
      ctx.strokeStyle = INK;
      ctx.lineWidth = this.u * INK_WIDTH;
      ctx.strokeRect(x, this.py(top), MERLON_WIDTH * this.u, MERLON_HEIGHT * this.u);
    }
  }

  /** A timber gallery hung out over the outer face just under the top. */
  private hoarding(face: number): void {
    const side = this.piece.outside;
    for (const arm of this.arms) {
      if (arm.horizontal !== (side === 'north' || side === 'south')) continue;
      if (arm.horizontal) {
        const x = this.px(arm.x0);
        const w = (arm.x1 - arm.x0) * this.u;
        const top =
          side === 'south'
            ? this.py(GROUND_Y - face + 0.02)
            : this.py(GROUND_Y - face - WALL_CAP_DEPTH - HOARDING_DEPTH * 0.6);
        const h = HOARDING_DEPTH * this.u * (side === 'south' ? 1 : 0.6);
        this.hoardingBoards(x, top, w, h);
      } else {
        const sign = this.outsideSign;
        const x = this.px(0.5 + sign * COLUMN_HALF_WIDTH - (sign > 0 ? 0 : HOARDING_DEPTH * 0.55));
        const top = this.py(arm.y0 - face);
        const bottom = this.py(arm.y1 - face + HOARDING_DEPTH);
        this.hoardingBoards(x, top, HOARDING_DEPTH * 0.55 * this.u, bottom - top);
      }
    }
  }

  private hoardingBoards(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = WOOD.dark;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = WOOD.deep;
    ctx.lineWidth = Math.max(1, this.u * 0.015);
    const horizontalBoards = w >= h;
    const boards = Math.max(2, Math.round((horizontalBoards ? w : h) / (this.u * 0.1)));
    for (let board = 1; board < boards; board++) {
      ctx.beginPath();
      if (horizontalBoards) {
        const bx = x + (board / boards) * w;
        ctx.moveTo(bx, y);
        ctx.lineTo(bx, y + h);
      } else {
        const by = y + (board / boards) * h;
        ctx.moveTo(x, by);
        ctx.lineTo(x + w, by);
      }
      ctx.stroke();
    }
    ctx.fillStyle = WOOD.light;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y, w, Math.max(1, this.u * 0.025));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = INK;
    ctx.lineWidth = this.u * INK_WIDTH;
    ctx.strokeRect(x, y, w, h);
  }

  /** A stone pier on the outside face, bound with two iron bands. */
  private buttress(face: number): void {
    const ctx = this.ctx;
    const side = this.piece.outside;
    let x: number;
    let top: number;
    let w: number;
    let h: number;
    if (side === 'south' || side === 'north') {
      x = this.px(0.5 - BUTTRESS_HALF_WIDTH);
      w = BUTTRESS_HALF_WIDTH * 2 * this.u;
      top = this.py(
        GROUND_Y - face * 0.85 + (side === 'south' ? 0 : -WALL_CAP_DEPTH - BUTTRESS_REACH),
      );
      h = (face * 0.85 + (side === 'south' ? BUTTRESS_REACH : 0)) * this.u;
    } else {
      const sign = this.outsideSign;
      x = this.px(0.5 + sign * COLUMN_HALF_WIDTH - (sign > 0 ? 0 : BUTTRESS_REACH));
      w = BUTTRESS_REACH * this.u;
      top = this.py(GROUND_Y - face * 0.85 - 0.2);
      h = (face * 0.85 + 0.2) * this.u;
    }
    this.masonry(x, top, w, h, 'ashlar');
    ctx.strokeStyle = INK;
    ctx.lineWidth = this.u * INK_WIDTH;
    ctx.strokeRect(x, top, w, h);
    for (const at of [0.3, 0.7]) {
      const bandY = top + h * at;
      ctx.fillStyle = IRON.body;
      ctx.fillRect(x, bandY, w, this.u * 0.05);
      ctx.fillStyle = IRON.glint;
      ctx.fillRect(x, bandY, w, this.u * 0.012);
      ctx.fillStyle = IRON.dark;
      for (const rivet of [0.2, 0.8]) {
        ctx.beginPath();
        ctx.arc(x + w * rivet, bandY + this.u * 0.025, this.u * 0.012, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ── Breach and gap ────────────────────────────────────────────────────────────

/**
 * The ground-layer look of a fallen segment: tier-coloured rubble with a
 * broken stake or two for a breach, trampled earth and a snapped post for a
 * flattened fence. Drawn over the tile's own ground; nothing here stands tall
 * enough to need sorting.
 */
export function drawHollowPalisadeGapTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const tier = contentAt(structure, tx, ty)?.wallTier;
  paintGapPiece(ctx, sx, sy, ts, tier ?? null, tileHash(tx, ty, RUBBLE_SALT));
}

/** Paints the breach (a tier) or plain-gap (null) look at (sx, sy), for the map and the review sheet. */
export function paintGapPiece(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tier: PalisadeTier | null,
  seed: number,
): void {
  const rng = mulberry32(seed);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(sx, sy, ts, ts);
    ctx.clip();
    const cx = sx + ts * 0.5;
    const gy = sy + ts * GROUND_Y;
    // Trampled, bared earth where the wall stood.
    ctx.fillStyle = 'rgba(58,40,24,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, gy - ts * 0.08, ts * 0.46, ts * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    if (tier === null || tier === 'fence') {
      snappedPost(ctx, cx + range(rng, -ts * 0.15, ts * 0.15), gy, ts, rng, 0.22);
      ctx.strokeStyle = LOG.barkLight;
      ctx.lineWidth = Math.max(1, ts * 0.03);
      ctx.lineCap = 'round';
      for (let twig = 0; twig < 4; twig++) {
        const x = sx + ts * range(rng, 0.1, 0.8);
        const y = sy + ts * range(rng, 0.45, 0.9);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + ts * range(rng, 0.1, 0.2), y + ts * range(rng, -0.05, 0.05));
        ctx.stroke();
      }
      return;
    }
    const stones = tier === 'wood' ? 0 : 11;
    for (let stone = 0; stone < stones; stone++) {
      const w = ts * range(rng, 0.15, 0.28);
      const h = w * range(rng, 0.55, 0.8);
      const x = sx + ts * range(rng, 0.05, 0.95) - w / 2;
      const y = gy - ts * range(rng, 0.3, -0.12) - h / 2;
      const tone = rng();
      const face =
        tier === 'fortified'
          ? tone < 0.5
            ? STONE.light
            : STONE.highlight
          : tone < 0.4
            ? STONE.dark
            : STONE.body;
      drawContactShadow(ctx, x + w / 2, y + h, w * 0.55, h * 0.3);
      fillRoundRect(
        ctx,
        Math.max(sx, x),
        y,
        Math.min(w, sx + ts - Math.max(sx, x)),
        h,
        tier === 'fortified' ? ts * 0.015 : h * 0.4,
        face,
      );
      ctx.strokeStyle = INK;
      ctx.lineWidth = ts * INK_WIDTH;
      ctx.strokeRect(Math.max(sx, x), y, Math.min(w, sx + ts - Math.max(sx, x)), h);
    }
    const logs = tier === 'wood' ? 5 : 1;
    for (let log = 0; log < logs; log++) {
      const length = ts * range(rng, 0.45, 0.7);
      const x = sx + ts * range(rng, 0.02, 0.98) - length / 2;
      const clampedX = Math.max(sx, Math.min(sx + ts - length, x));
      drawLogSide(ctx, clampedX, gy - ts * range(rng, -0.08, 0.4), length, ts * 0.08, rng, true);
    }
    snappedPost(
      ctx,
      cx + range(rng, -ts * 0.2, ts * 0.2),
      gy,
      ts,
      rng,
      tier === 'wood' ? 0.32 : 0.24,
    );
  } finally {
    ctx.restore();
  }
}

function snappedPost(
  ctx: CanvasRenderingContext2D,
  x: number,
  footY: number,
  ts: number,
  rng: Rng,
  heightTiles: number,
): void {
  const w = ts * STAKE_WIDTH * 0.8;
  const h = ts * heightTiles;
  drawContactShadow(ctx, x, footY, w * 0.9, w * 0.3);
  ctx.fillStyle = LOG.bark;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, footY);
  ctx.lineTo(x - w / 2, footY - h);
  ctx.lineTo(x - w / 6, footY - h - ts * range(rng, 0.03, 0.08));
  ctx.lineTo(x + w / 8, footY - h + ts * 0.02);
  ctx.lineTo(x + w / 2, footY - h - ts * range(rng, 0.01, 0.05));
  ctx.lineTo(x + w / 2, footY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ts * INK_WIDTH;
  ctx.stroke();
  ctx.fillStyle = LOG.cut;
  ctx.fillRect(x - w / 3, footY - h - ts * 0.01, (w * 2) / 3, ts * 0.025);
}

// ── The gate ──────────────────────────────────────────────────────────────────

/** What the gate is doing this frame: how far open (0–1) and how hard it is shaking, in pixels. */
export interface GateAnimation {
  readonly open: number;
  readonly shakePx: number;
}

const CLOSED_GATE: GateAnimation = { open: 0, shakePx: 0 };
/** Each structure's gates' animation, by wall side. */
const gateAnimations = new WeakMap<TileContent[][], Map<Side, GateAnimation>>();

/**
 * Sets how the gate standing in `side`'s wall of `structure` is drawn this
 * frame. The painter is pure and has no handle on the village, so the gate
 * system hands its state over here, keyed by the grid like the site record is.
 */
export function setGateAnimation(
  structure: TileContent[][],
  side: Side,
  animation: GateAnimation,
): void {
  let bySide = gateAnimations.get(structure);
  if (bySide === undefined) {
    bySide = new Map();
    gateAnimations.set(structure, bySide);
  }
  bySide.set(side, animation);
}

/** The gate whose middle tile is (tx, ty), or null for any other tile. */
function gateMiddleAt(structure: TileContent[][], tx: number, ty: number): GateMiddle | null {
  const middles = layoutFor(structure).gateMiddles;
  // A hand-built test map has no site, and so no recorded gate middle: every
  // `HOLLOW_GATE` tile paints, oriented as the south gate's own wall.
  if (middles.length === 0) return { x: tx, y: ty, side: 'south' };
  return middles.find((middle) => middle.x === tx && middle.y === ty) ?? null;
}

/**
 * How far a gate's middle tile's art reaches. A north or south gate's wall
 * runs east–west, so its posts flank the middle tile left and right, and only
 * its height reaches up. An east or west gate's wall runs north–south, so its
 * posts flank the middle tile up and down instead (the run itself, same as a
 * wall's own end-on column), its height adds to the up reach on the near
 * (north) post, and its doors swing sideways rather than up.
 */
export function hollowGateExtentsPx(
  structure: TileContent[][],
  tx: number,
  ty: number,
  ts: number,
): MapSpriteExtentsPx {
  const middle = gateMiddleAt(structure, tx, ty);
  if (middle === null) return { left: 0, up: 0, right: 0, down: 0 };
  if (middle.side === 'north' || middle.side === 'south') {
    const along = Math.ceil(ts * GATE_REACH_SIDE_TILES);
    const up = Math.ceil(ts * GATE_REACH_UP_TILES);
    return { left: along, up, right: along, down: 0 };
  }
  const across = Math.ceil(ts * GATE_EW_REACH_ACROSS_TILES);
  const alongPost = Math.ceil(ts * (GATE_POST_SPAN_TILES + GATE_POST_TOP_MARGIN_TILES));
  const upPost = Math.ceil(ts * (GATE_POST_HEIGHT_TILES + GATE_POST_TOP_MARGIN_TILES));
  return { left: across, up: alongPost + upPost, right: across, down: alongPost };
}

/**
 * Draws the gate. Only the middle gate tile paints (the whole gate, posts to
 * posts), so the doors are one picture that can swing as one; the outer gate
 * tiles draw only their ground.
 *
 * A north or south gate stands in a wall that runs east–west and faces the
 * camera, so its posts sit left and right of the middle tile and its doors
 * swing up into the village. An east or west gate stands in a wall that runs
 * north–south, seen end-on like the wall's own posts: its posts sit up and
 * down the middle tile along that run, standing tall the same way, and its
 * doors swing sideways to open, so a closed one reads as a thin edge along
 * the wall line and an open one turns its full face toward the camera.
 */
export function drawHollowGateTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const middle = gateMiddleAt(structure, tx, ty);
  if (middle === null) return;
  const animation = gateAnimations.get(structure)?.get(middle.side) ?? CLOSED_GATE;
  const centreX = sx + ts * 0.5;
  if (middle.side === 'north' || middle.side === 'south') {
    paintGate(ctx, centreX, sy, ts, animation);
    return;
  }
  const centreY = sy + ts * GROUND_Y;
  // Swing inward, toward the village's centre, so both walls open the same visual way.
  const swingSign: 1 | -1 = middle.side === 'west' ? 1 : -1;
  paintGateEW(ctx, centreX, centreY, ts, animation, swingSign);
}

interface CachedGate {
  readonly surface: CanvasSurface;
  readonly padSide: number;
  readonly padUp: number;
  readonly width: number;
  readonly height: number;
}

const gatePostCache = new Map<number, CachedGate>();

/** Paints the gate centred on `centreX`, its ground line in the tile starting at `sy`. For the map and the review sheet. */
export function paintGate(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  sy: number,
  ts: number,
  animation: GateAnimation,
): void {
  const groundY = sy + ts * GROUND_Y;
  const postFrame = gatePosts(ts);
  // Posts and beam behind the doors' top, doors in front: an open door swings
  // back behind the beam line, so draw the doors, then the frame over them.
  paintGateLeaves(ctx, centreX + animation.shakePx, groundY, ts, animation.open);
  ctx.drawImage(
    postFrame.surface,
    centreX - postFrame.width / 2,
    sy - postFrame.padUp,
    postFrame.width,
    postFrame.height,
  );
}

function gatePosts(ts: number): CachedGate {
  const hit = gatePostCache.get(ts);
  if (hit !== undefined) return hit;
  const padSide = Math.ceil(ts * GATE_REACH_SIDE_TILES);
  const padUp = Math.ceil(ts * GATE_REACH_UP_TILES);
  const width = padSide * 2;
  const height = padUp + ts;
  const surface = allocCanvas(width * CACHE_DENSITY, height * CACHE_DENSITY);
  const ctx = surfaceContext(surface);
  ctx.scale(CACHE_DENSITY, CACHE_DENSITY);
  const centreX = padSide;
  const groundY = padUp + ts * GROUND_Y;
  const rng = mulberry32(ts);
  for (const side of [-1, 1]) {
    const postCentre =
      centreX + side * (GATE_HALF_SPAN_TILES * ts + (GATE_POST_WIDTH_TILES * ts) / 2 - ts * 0.18);
    const w = GATE_POST_WIDTH_TILES * ts;
    const h = GATE_POST_HEIGHT_TILES * ts;
    drawContactShadow(ctx, postCentre, groundY, w * 0.7, ts * 0.1);
    drawFieldstones(ctx, postCentre - w / 2, groundY - h, w, h, rng, ts * 0.16, 0.1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = ts * INK_WIDTH;
    ctx.strokeRect(postCentre - w / 2, groundY - h, w, h);
    // A capstone a little wider than the post.
    fillRoundRect(
      ctx,
      postCentre - w * 0.6,
      groundY - h - ts * 0.1,
      w * 1.2,
      ts * 0.14,
      ts * 0.03,
      STONE.light,
    );
    ctx.strokeRect(postCentre - w * 0.6, groundY - h - ts * 0.1, w * 1.2, ts * 0.14);
  }
  // The carved crossbeam, with the village's briar knot in the middle.
  const beamLeft = centreX - GATE_HALF_SPAN_TILES * ts;
  const beamTop = groundY - GATE_BEAM_HEIGHT * ts;
  fillRoundRect(
    ctx,
    beamLeft,
    beamTop,
    GATE_HALF_SPAN_TILES * 2 * ts,
    GATE_BEAM_DEPTH * ts,
    ts * 0.04,
    WOOD.body,
  );
  ctx.fillStyle = WOOD.light;
  ctx.fillRect(beamLeft, beamTop, GATE_HALF_SPAN_TILES * 2 * ts, ts * 0.04);
  ctx.strokeStyle = INK;
  ctx.lineWidth = ts * INK_WIDTH;
  ctx.strokeRect(beamLeft, beamTop, GATE_HALF_SPAN_TILES * 2 * ts, GATE_BEAM_DEPTH * ts);
  fillRoundRect(
    ctx,
    centreX - ts * 0.2,
    beamTop - ts * 0.08,
    ts * 0.4,
    GATE_BEAM_DEPTH * ts + ts * 0.16,
    ts * 0.06,
    WOOD.mid,
  );
  drawBriarKnot(
    ctx,
    centreX,
    beamTop + (GATE_BEAM_DEPTH * ts) / 2,
    ts * 0.14,
    WOOD.deep,
    ts * 0.03,
  );
  const entry: CachedGate = { surface, padSide, padUp, width, height };
  gatePostCache.set(ts, entry);
  return entry;
}

function paintGateLeaves(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  groundY: number,
  ts: number,
  open: number,
): void {
  const angle = Math.max(0, Math.min(1, open)) * GATE_OPEN_ANGLE;
  const leafWidth = (GATE_HALF_SPAN_TILES - 0.12) * ts;
  const leafHeight = GATE_DOOR_HEIGHT * ts;
  for (const side of [-1, 1]) {
    const hingeX = centreX + side * (GATE_HALF_SPAN_TILES - 0.12) * ts;
    const freeX = hingeX - side * leafWidth * Math.cos(angle);
    const lift = leafWidth * Math.sin(angle) * GATE_DEPTH_FORESHORTEN;
    const corners = {
      hingeBottom: { x: hingeX, y: groundY },
      freeBottom: { x: freeX, y: groundY - lift },
      freeTop: { x: freeX, y: groundY - lift - leafHeight },
      hingeTop: { x: hingeX, y: groundY - leafHeight },
    };
    const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    ctx.fillStyle = angle > 0.9 ? WOOD.dark : WOOD.body;
    ctx.beginPath();
    ctx.moveTo(corners.hingeBottom.x, corners.hingeBottom.y);
    ctx.lineTo(corners.freeBottom.x, corners.freeBottom.y);
    ctx.lineTo(corners.freeTop.x, corners.freeTop.y);
    ctx.lineTo(corners.hingeTop.x, corners.hingeTop.y);
    ctx.closePath();
    ctx.fill();
    // Vertical planks.
    ctx.strokeStyle = WOOD.deep;
    ctx.lineWidth = Math.max(1, ts * 0.02);
    const planks = 5;
    for (let plank = 1; plank < planks; plank++) {
      const bottom = lerp(corners.hingeBottom, corners.freeBottom, plank / planks);
      const top = lerp(corners.hingeTop, corners.freeTop, plank / planks);
      ctx.beginPath();
      ctx.moveTo(bottom.x, bottom.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }
    // Iron bands across the leaf.
    for (const at of GATE_BAND_AT) {
      const a = lerp(corners.hingeBottom, corners.hingeTop, at);
      const b = lerp(corners.freeBottom, corners.freeTop, at);
      ctx.strokeStyle = IRON.body;
      ctx.lineWidth = ts * 0.07;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = IRON.glint;
      ctx.lineWidth = ts * 0.015;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - ts * 0.025);
      ctx.lineTo(b.x, b.y - ts * 0.025);
      ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = ts * INK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(corners.hingeBottom.x, corners.hingeBottom.y);
    ctx.lineTo(corners.freeBottom.x, corners.freeBottom.y);
    ctx.lineTo(corners.freeTop.x, corners.freeTop.y);
    ctx.lineTo(corners.hingeTop.x, corners.hingeTop.y);
    ctx.closePath();
    ctx.stroke();
    // A ring handle near the meeting edge, only while the doors face the camera.
    if (angle < GATE_OPEN_ANGLE * 0.5) {
      const handle = lerp(
        lerp(corners.hingeBottom, corners.freeBottom, 0.85),
        lerp(corners.hingeTop, corners.freeTop, 0.85),
        0.45,
      );
      ctx.strokeStyle = IRON.light;
      ctx.lineWidth = ts * 0.02;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, ts * 0.05, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ── The east/west gate ───────────────────────────────────────────────────────
//
// A north or south gate's wall runs east–west and faces the camera, so its
// posts flank the doorway left and right, its beam spans left to right, and
// an open door swings up into the village. An east or west gate's wall runs
// north–south instead: it is seen the way the wall painter's own end-on
// columns are, so its posts flank the doorway up and down (the wall's own
// run), its beam runs the same way, and a door swings *sideways* to open. A
// closed door then lies flat along the wall's line and reads as a thin edge;
// an open one has swung square to the camera and reads as a full plank face.

interface CachedGateEW {
  readonly surface: CanvasSurface;
  readonly padAcross: number;
  readonly padAlong: number;
  readonly padUp: number;
  readonly width: number;
  readonly height: number;
}

const gatePostCacheEW = new Map<number, CachedGateEW>();

/** Paints an east/west gate centred on `centreX`, ground line `centreY`. For the map and the review sheet. */
export function paintGateEW(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  ts: number,
  animation: GateAnimation,
  swingSign: 1 | -1,
): void {
  const frame = gatePostsEW(ts);
  // Posts and beam behind the doors' outer edge, doors in front: an open door
  // swings back behind the beam line, so draw the doors, then the frame over them.
  paintGateLeavesEW(ctx, centreX, centreY + animation.shakePx, ts, animation.open, swingSign);
  ctx.drawImage(
    frame.surface,
    centreX - frame.padAcross,
    centreY - frame.padAlong - frame.padUp,
    frame.width,
    frame.height,
  );
}

function gatePostsEW(ts: number): CachedGateEW {
  const hit = gatePostCacheEW.get(ts);
  if (hit !== undefined) return hit;
  const padAcross = Math.ceil(ts * GATE_EW_REACH_ACROSS_TILES);
  const padAlong = Math.ceil(ts * (GATE_POST_SPAN_TILES + GATE_POST_TOP_MARGIN_TILES));
  const padUp = Math.ceil(ts * (GATE_POST_HEIGHT_TILES + GATE_POST_TOP_MARGIN_TILES));
  const width = padAcross * 2;
  const height = padAlong * 2 + padUp;
  const surface = allocCanvas(width * CACHE_DENSITY, height * CACHE_DENSITY);
  const ctx = surfaceContext(surface);
  ctx.scale(CACHE_DENSITY, CACHE_DENSITY);
  const centreX = padAcross;
  const centreY = padUp + padAlong;
  const rng = mulberry32(ts);
  for (const side of [-1, 1]) {
    const postCentre = centreY + side * GATE_POST_SPAN_TILES * ts;
    const w = GATE_POST_WIDTH_TILES * ts;
    const h = GATE_POST_HEIGHT_TILES * ts;
    drawContactShadow(ctx, centreX, postCentre, w * 0.7, ts * 0.1);
    drawFieldstones(ctx, centreX - w / 2, postCentre - h, w, h, rng, ts * 0.16, 0.1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = ts * INK_WIDTH;
    ctx.strokeRect(centreX - w / 2, postCentre - h, w, h);
    // A capstone a little wider than the post.
    fillRoundRect(
      ctx,
      centreX - w * 0.6,
      postCentre - h - ts * 0.1,
      w * 1.2,
      ts * 0.14,
      ts * 0.03,
      STONE.light,
    );
    ctx.strokeRect(centreX - w * 0.6, postCentre - h - ts * 0.1, w * 1.2, ts * 0.14);
  }
  // The carved beam tying the posts, with the village's briar knot in the middle.
  const beamNear = centreY - GATE_HALF_SPAN_TILES * ts - GATE_BEAM_HEIGHT * ts;
  const beamFar = centreY + GATE_HALF_SPAN_TILES * ts - GATE_BEAM_HEIGHT * ts;
  const beamLeft = centreX - (GATE_BEAM_DEPTH * ts) / 2;
  fillRoundRect(
    ctx,
    beamLeft,
    beamNear,
    GATE_BEAM_DEPTH * ts,
    beamFar - beamNear,
    ts * 0.04,
    WOOD.body,
  );
  ctx.fillStyle = WOOD.light;
  ctx.fillRect(beamLeft, beamNear, ts * 0.04, beamFar - beamNear);
  ctx.strokeStyle = INK;
  ctx.lineWidth = ts * INK_WIDTH;
  ctx.strokeRect(beamLeft, beamNear, GATE_BEAM_DEPTH * ts, beamFar - beamNear);
  fillRoundRect(
    ctx,
    beamLeft - ts * 0.08,
    centreY - ts * 0.2,
    GATE_BEAM_DEPTH * ts + ts * 0.16,
    ts * 0.4,
    ts * 0.06,
    WOOD.mid,
  );
  drawBriarKnot(
    ctx,
    beamLeft + (GATE_BEAM_DEPTH * ts) / 2,
    centreY,
    ts * 0.14,
    WOOD.deep,
    ts * 0.03,
  );
  const entry: CachedGateEW = { surface, padAcross, padAlong, padUp, width, height };
  gatePostCacheEW.set(ts, entry);
  return entry;
}

function paintGateLeavesEW(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  ts: number,
  open: number,
  swingSign: 1 | -1,
): void {
  const angle = Math.max(0, Math.min(1, open)) * GATE_OPEN_ANGLE;
  const leafLength = GATE_EW_LEAF_LENGTH_TILES * ts;
  const leafHeight = GATE_DOOR_HEIGHT * ts;
  // Closed, the leaf shows only its thickness (a plank edge along the wall
  // line); open, it swings to its full length turned toward the camera. The
  // swing itself is not foreshortened — sideways is the screen's own axis.
  const minAcross = GATE_EW_DOOR_THICKNESS_TILES * ts;
  for (const side of [-1, 1]) {
    const hingeY = centreY + side * leafLength;
    const freeY = hingeY - side * leafLength * Math.cos(angle);
    const across = swingSign * Math.max(minAcross, leafLength * Math.sin(angle));
    const corners = {
      hingeBottom: { x: centreX, y: hingeY },
      freeBottom: { x: centreX + across, y: freeY },
      freeTop: { x: centreX + across, y: freeY - leafHeight },
      hingeTop: { x: centreX, y: hingeY - leafHeight },
    };
    const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    ctx.fillStyle = angle > 0.9 ? WOOD.dark : WOOD.body;
    ctx.beginPath();
    ctx.moveTo(corners.hingeBottom.x, corners.hingeBottom.y);
    ctx.lineTo(corners.freeBottom.x, corners.freeBottom.y);
    ctx.lineTo(corners.freeTop.x, corners.freeTop.y);
    ctx.lineTo(corners.hingeTop.x, corners.hingeTop.y);
    ctx.closePath();
    ctx.fill();
    // The plank seams, visible as ticks along the top edge when the door is
    // closed, opening out into full boards as it turns to face the camera.
    ctx.strokeStyle = WOOD.deep;
    ctx.lineWidth = Math.max(1, ts * 0.02);
    const planks = 5;
    for (let plank = 1; plank < planks; plank++) {
      const bottom = lerp(corners.hingeBottom, corners.freeBottom, plank / planks);
      const top = lerp(corners.hingeTop, corners.freeTop, plank / planks);
      ctx.beginPath();
      ctx.moveTo(bottom.x, bottom.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }
    // Iron bands across the leaf.
    for (const at of GATE_BAND_AT) {
      const a = lerp(corners.hingeBottom, corners.hingeTop, at);
      const b = lerp(corners.freeBottom, corners.freeTop, at);
      ctx.strokeStyle = IRON.body;
      ctx.lineWidth = ts * 0.07;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = IRON.glint;
      ctx.lineWidth = ts * 0.015;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - ts * 0.025);
      ctx.lineTo(b.x, b.y - ts * 0.025);
      ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = ts * INK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(corners.hingeBottom.x, corners.hingeBottom.y);
    ctx.lineTo(corners.freeBottom.x, corners.freeBottom.y);
    ctx.lineTo(corners.freeTop.x, corners.freeTop.y);
    ctx.lineTo(corners.hingeTop.x, corners.hingeTop.y);
    ctx.closePath();
    ctx.stroke();
    // A ring handle near the meeting edge, only while the doors face the camera.
    if (angle < GATE_OPEN_ANGLE * 0.5) {
      const handle = lerp(
        lerp(corners.hingeBottom, corners.freeBottom, 0.85),
        lerp(corners.hingeTop, corners.freeTop, 0.85),
        0.45,
      );
      ctx.strokeStyle = IRON.light;
      ctx.lineWidth = ts * 0.02;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, ts * 0.05, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
