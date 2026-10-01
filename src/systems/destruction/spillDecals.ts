/**
 * What a broken prop leaves spread round its wreckage: grain, wine, wax, dust,
 * slime, oil, paper, clutter, glass, mop water, supply boxes, books, coals and
 * bone dust.
 *
 * Every spill is a quiet tonal decal, never speckle: liquids are one flat
 * pool with a single ragged outline, powders a
 * soft wash, and the few solid things (sheets, books, shards, coal lumps) are
 * a handful of big crisp shapes that still read at 32 px a tile. Each look is
 * painted once into a small cached surface and drawn live under the wreckage,
 * so a floor of spills costs one `drawImage` each.
 */

import { TILE_SIZE } from '../../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { mulberry32 } from '../../sprites/person/rng';
import { tileHash } from '../../map/tiles/hollowTileHash';
import type { CellarSpill } from './cellarPropKinds';
import type { RemainsPropKindDef } from './remainsPropKinds';
import type { ServiceSpill } from './serviceLevelPropKinds';
import type { ThemedPropSpill } from './themedPropMaterials';

/** Every spill a break can leave. */
export type SpillKind = CellarSpill | ServiceSpill | ThemedPropSpill | RemainsPropKindDef['spill'];

/** How a spill is drawn: as it fell, or charred black by the fire that burnt it off. */
export type SpillLook = 'fresh' | 'burnt';

/** Seeded looks per spill kind, so two broken urns side by side do not spill alike. */
const SPILL_VARIANTS = 3;
const VARIANT_SALT = 0x5b11;
/** A spill spreads past its own tile: the decal is this many tiles square, centred on it. */
const SPAN_TILES = 2;
const SPAN_PX = SPAN_TILES * TILE_SIZE;
const CENTRE_PX = SPAN_PX / 2;
const TWO_PI = Math.PI * 2;
const HALF = 0.5;

type Rng = () => number;
type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, CanvasSurface>();

/** Which of a spill's looks lies at this tile. */
export function spillVariant(tileX: number, tileY: number): number {
  return tileHash(tileX, tileY, VARIANT_SALT) % SPILL_VARIANTS;
}

/** How far a spill reaches from its tile's centre, in pixels, for anything that touches it. */
const SPILL_REACH_TILES = 0.6;
export const SPILL_REACH_PX = TILE_SIZE * SPILL_REACH_TILES;

/**
 * Draws a spill centred on world-space `(centreX, centreY)` already shifted
 * into screen space by the caller.
 */
export function drawSpill(
  ctx: Ctx,
  kind: SpillKind,
  look: SpillLook,
  variant: number,
  screenX: number,
  screenY: number,
  alpha = 1,
): void {
  const key = `${kind}:${look}:${variant}`;
  let surface = cache.get(key);
  if (surface === undefined) {
    surface = allocCanvas(SPAN_PX, SPAN_PX);
    // Seeded by kind and variant alone, never by look: a pool that burns off
    // chars in the very outline it lay in.
    const shapeSeed = hashKey(`${kind}:${variant}`);
    paintSpill(surfaceContext(surface), kind, look, variant, mulberry32(shapeSeed));
    cache.set(key, surface);
  }
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = previousAlpha * alpha;
  ctx.drawImage(surface, screenX - CENTRE_PX, screenY - CENTRE_PX);
  ctx.globalAlpha = previousAlpha;
}

const HASH_SEED = 0x811c9dc5;
const HASH_PRIME = 0x01000193;

function hashKey(key: string): number {
  let h = HASH_SEED;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), HASH_PRIME);
  return h >>> 0;
}

// ── Painters ────────────────────────────────────────────────────────────────

/** Tile fractions for the size of each kind of spill. */
const POOL_RADIUS = 0.5;
const SMALL_POOL_RADIUS = 0.32;
const WASH_RADIUS = 0.75;
/** Points round a pool's outline: enough that the curve through them never shows a corner. */
const POOL_OUTLINE_POINTS = 24;
/**
 * The rim ripples a pool's outline is bent by, from three swells round up.
 * Two swells are left out: strong, they pinch a pool into a dog bone.
 */
const POOL_FIRST_RIPPLE = 3;
const POOL_RIPPLES = 4;
/** The largest ripple's swell as a share of the radius; each higher one swells less. */
const POOL_RIPPLE_SWELL = 0.13;
const POOL_RIPPLE_FALLOFF = 0.75;
/** Each ripple's swell is scaled by a share drawn from this up to one. */
const POOL_RIPPLE_MIN_SHARE = 0.4;
/** Pools are seen from above and in front: flatter than they are wide. */
const POOL_SQUASH = 0.7;

function paintSpill(ctx: Ctx, kind: SpillKind, look: SpillLook, variant: number, rng: Rng): void {
  if (look === 'burnt') {
    paintBurnt(ctx, rng);
    return;
  }
  switch (kind) {
    case 'grain':
      return paintGrain(ctx, rng);
    case 'wine':
      return paintPoolWithSheen(ctx, rng, WINE);
    case 'water':
      return paintPoolWithSheen(ctx, rng, MOP_WATER);
    case 'oil':
      return paintPoolWithSheen(ctx, rng, OIL);
    case 'slime':
      return paintPoolWithSheen(ctx, rng, SLIME);
    case 'wax':
      return paintWax(ctx, rng);
    case 'dust':
      return paintWash(ctx, DUST_RGB, DUST_ALPHA);
    case 'bone_dust':
      return paintBoneDust(ctx, rng);
    case 'paper':
      return paintSheets(ctx, rng, PAPER_SHEETS_MIN, PAPER_SHEETS_MAX);
    case 'supply_boxes':
      return paintSupplyBoxes(ctx, rng);
    case 'books':
      return paintBooks(ctx, rng);
    case 'clutter':
      return paintClutter(ctx, rng);
    case 'glass':
      return paintGlass(ctx, rng);
    case 'coals':
      return paintCoals(ctx, variant);
  }
}

/**
 * One flat pool: a single closed outline bent by a few seeded ripples and
 * smoothed through its points' midpoints, so it reads as liquid that ran,
 * never as overlapping discs.
 */
function poolPath(ctx: Ctx, rng: Rng, cx: number, cy: number, radius: number): void {
  const ripples: Array<{ frequency: number; swell: number; phase: number }> = [];
  for (let i = 0; i < POOL_RIPPLES; i++) {
    const largest = POOL_RIPPLE_SWELL * POOL_RIPPLE_FALLOFF ** i;
    ripples.push({
      frequency: POOL_FIRST_RIPPLE + i,
      swell: largest * (POOL_RIPPLE_MIN_SHARE + rng() * (1 - POOL_RIPPLE_MIN_SHARE)),
      phase: rng() * TWO_PI,
    });
  }
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < POOL_OUTLINE_POINTS; i++) {
    const angle = (i / POOL_OUTLINE_POINTS) * TWO_PI;
    let reach = 1;
    for (const ripple of ripples) {
      reach += Math.sin(angle * ripple.frequency + ripple.phase) * ripple.swell;
    }
    points.push({
      x: cx + Math.cos(angle) * radius * reach,
      y: cy + Math.sin(angle) * radius * reach * POOL_SQUASH,
    });
  }
  ctx.beginPath();
  const last = points[points.length - 1];
  ctx.moveTo((last.x + points[0].x) * HALF, (last.y + points[0].y) * HALF);
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const next = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) * HALF, (point.y + next.y) * HALF);
  }
  ctx.closePath();
}

interface PoolStyle {
  readonly body: string;
  readonly bodyAlpha: number;
  /** A faint sheen on the surface, off to the light. */
  readonly sheen: string;
  readonly sheenAlpha: number;
  readonly radius: number;
}

/** Plum, not red: a red pool on a dungeon floor reads as blood. */
const WINE: PoolStyle = {
  body: '#2c1027',
  bodyAlpha: 0.72,
  sheen: '#6a3e60',
  sheenAlpha: 0.35,
  radius: POOL_RADIUS,
};
const MOP_WATER: PoolStyle = {
  body: '#33505e',
  bodyAlpha: 0.38,
  sheen: '#9ab8c4',
  sheenAlpha: 0.22,
  radius: POOL_RADIUS,
};
const OIL: PoolStyle = {
  body: '#0c0b0a',
  bodyAlpha: 0.8,
  sheen: '#4d4a63',
  sheenAlpha: 0.3,
  radius: POOL_RADIUS,
};
const SLIME: PoolStyle = {
  body: '#2b5a50',
  bodyAlpha: 0.4,
  sheen: '#8fe0c8',
  sheenAlpha: 0.25,
  radius: SMALL_POOL_RADIUS,
};

/** The sheen sits up and to the left, towards the key light. */
const SHEEN_OFFSET = 0.25;
const SHEEN_SCALE = 0.4;

function paintPoolWithSheen(ctx: Ctx, rng: Rng, style: PoolStyle): void {
  const radius = style.radius * TILE_SIZE;
  ctx.globalAlpha = style.bodyAlpha;
  ctx.fillStyle = style.body;
  poolPath(ctx, rng, CENTRE_PX, CENTRE_PX, radius);
  ctx.fill();
  ctx.globalAlpha = style.sheenAlpha;
  ctx.fillStyle = style.sheen;
  ctx.beginPath();
  ctx.ellipse(
    CENTRE_PX - radius * SHEEN_OFFSET,
    CENTRE_PX - radius * SHEEN_OFFSET * POOL_SQUASH,
    radius * SHEEN_SCALE,
    radius * SHEEN_SCALE * POOL_SQUASH * HALF,
    -HALF,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A soft, wide powder wash with no edge at all. */
function paintWash(ctx: Ctx, rgb: string, alpha: number, radiusTiles = WASH_RADIUS): void {
  const radius = radiusTiles * TILE_SIZE;
  const gradient = ctx.createRadialGradient(CENTRE_PX, CENTRE_PX, 0, CENTRE_PX, CENTRE_PX, radius);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(HALF, `rgba(${rgb},${alpha * HALF})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(CENTRE_PX, CENTRE_PX, radius, radius * POOL_SQUASH, 0, 0, TWO_PI);
  ctx.fill();
}

const DUST_RGB = '120,108,90';
const DUST_ALPHA = 0.4;

const GRAIN_WASH_RGB = '176,150,96';
const GRAIN_WASH_ALPHA = 0.3;
const GRAIN_PILE = '#b89c62';
const GRAIN_PILE_ALPHA = 0.7;
const GRAIN_CREST = '#c9b37c';
const GRAIN_CREST_ALPHA = 0.55;
/** The poured heap is off to one side of the broken vessel, where the split faced. */
const GRAIN_PILE_OFFSET = 0.22;

function paintGrain(ctx: Ctx, rng: Rng): void {
  paintWash(ctx, GRAIN_WASH_RGB, GRAIN_WASH_ALPHA);
  const side = rng() < HALF ? -1 : 1;
  const px = CENTRE_PX + side * GRAIN_PILE_OFFSET * TILE_SIZE;
  const py = CENTRE_PX + GRAIN_PILE_OFFSET * TILE_SIZE * HALF;
  ctx.globalAlpha = GRAIN_PILE_ALPHA;
  ctx.fillStyle = GRAIN_PILE;
  poolPath(ctx, rng, px, py, SMALL_POOL_RADIUS * TILE_SIZE);
  ctx.fill();
  ctx.globalAlpha = GRAIN_CREST_ALPHA;
  ctx.fillStyle = GRAIN_CREST;
  poolPath(ctx, rng, px, py - 2, SMALL_POOL_RADIUS * TILE_SIZE * HALF);
  ctx.fill();
  ctx.globalAlpha = 1;
}

const WAX = '#d8c892';
const WAX_SHADOW = '#9c8c5c';
const WAX_DRIPS_MIN = 3;
const WAX_DRIPS_MAX = 5;
const WAX_DRIP_MIN_PX = 2;
const WAX_DRIP_MAX_PX = 4;
const WAX_POOL_RADIUS = 0.18;

function paintWax(ctx: Ctx, rng: Rng): void {
  ctx.fillStyle = WAX;
  poolPath(ctx, rng, CENTRE_PX, CENTRE_PX + 2, WAX_POOL_RADIUS * TILE_SIZE);
  ctx.fill();
  const drips = WAX_DRIPS_MIN + Math.floor(rng() * (WAX_DRIPS_MAX - WAX_DRIPS_MIN + 1));
  for (let i = 0; i < drips; i++) {
    const angle = rng() * TWO_PI;
    const reach = (POOL_RADIUS * HALF + rng() * POOL_RADIUS * HALF) * TILE_SIZE;
    const r = WAX_DRIP_MIN_PX + rng() * (WAX_DRIP_MAX_PX - WAX_DRIP_MIN_PX);
    const x = CENTRE_PX + Math.cos(angle) * reach;
    const y = CENTRE_PX + Math.sin(angle) * reach * POOL_SQUASH;
    ctx.fillStyle = WAX_SHADOW;
    ctx.beginPath();
    ctx.ellipse(x, y + 1, r, r * POOL_SQUASH, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = WAX;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * POOL_SQUASH, 0, 0, TWO_PI);
    ctx.fill();
  }
}

const BONE_DUST_RGB = '168,156,128';
const BONE_DUST_ALPHA = 0.28;

function paintBoneDust(ctx: Ctx, rng: Rng): void {
  paintWash(ctx, BONE_DUST_RGB, BONE_DUST_ALPHA);
  // A couple of loose fragments past the heap's own picture, nothing finer.
  for (let i = 0; i < 2; i++) {
    const angle = rng() * TWO_PI;
    const reach = POOL_RADIUS * TILE_SIZE;
    flatRect(
      ctx,
      CENTRE_PX + Math.cos(angle) * reach,
      CENTRE_PX + Math.sin(angle) * reach * POOL_SQUASH,
      BONE_CHIP_LENGTH_PX,
      BONE_CHIP_WIDTH_PX,
      rng() * Math.PI,
      BONE_CHIP,
      BONE_CHIP_SHADOW,
    );
  }
}

const BONE_CHIP = '#c4b894';
const BONE_CHIP_SHADOW = '#6a604a';
const BONE_CHIP_LENGTH_PX = 6;
const BONE_CHIP_WIDTH_PX = 2;

/** A flat thing lying on the floor: a shadowed rectangle, turned. */
function flatRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  angle: number,
  fill: string,
  shadow: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = shadow;
  ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

const PAPER = '#cbc4ae';
const PAPER_SHADOW = 'rgba(20,16,10,0.35)';
const PAPER_RULE = '#a39b86';
const SHEET_W_PX = 7;
const SHEET_H_PX = 9;
const PAPER_SHEETS_MIN = 4;
const PAPER_SHEETS_MAX = 6;
/** Sheets lie this far out from the break, at most, as a share of a tile. */
const SHEET_SCATTER = 0.62;

/** Loose sheets: big flat shapes with a single printed rule, never a confetti of dots. */
function paintSheets(ctx: Ctx, rng: Rng, min: number, max: number): void {
  const count = min + Math.floor(rng() * (max - min + 1));
  for (let i = 0; i < count; i++) {
    const angle = rng() * TWO_PI;
    const reach = (HALF * rng() + HALF) * SHEET_SCATTER * TILE_SIZE;
    const x = CENTRE_PX + Math.cos(angle) * reach;
    const y = CENTRE_PX + Math.sin(angle) * reach * POOL_SQUASH;
    const turn = rng() * Math.PI;
    flatRect(ctx, x, y, SHEET_W_PX, SHEET_H_PX, turn, PAPER, PAPER_SHADOW);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(turn);
    ctx.fillStyle = PAPER_RULE;
    ctx.fillRect(-SHEET_W_PX / 2 + 1, -1, SHEET_W_PX - 2, 1);
    ctx.restore();
  }
}

const CARDBOARD = '#987c5a';
const CARDBOARD_EDGE = '#5e4a34';
const BOX_W_PX = 11;
const BOX_H_PX = 8;
const BOXES_MIN = 2;
const BOXES_MAX = 3;
const BOX_SCATTER = 0.45;
/** A few loose sheets out of the burst boxes. */
const BOX_SHEETS_MIN = 2;
const BOX_SHEETS_MAX = 3;

function paintSupplyBoxes(ctx: Ctx, rng: Rng): void {
  const boxes = BOXES_MIN + Math.floor(rng() * (BOXES_MAX - BOXES_MIN + 1));
  for (let i = 0; i < boxes; i++) {
    const angle = rng() * TWO_PI;
    const reach = rng() * BOX_SCATTER * TILE_SIZE;
    flatRect(
      ctx,
      CENTRE_PX + Math.cos(angle) * reach,
      CENTRE_PX + Math.sin(angle) * reach * POOL_SQUASH,
      BOX_W_PX,
      BOX_H_PX,
      rng() * Math.PI,
      CARDBOARD,
      CARDBOARD_EDGE,
    );
  }
  paintSheets(ctx, rng, BOX_SHEETS_MIN, BOX_SHEETS_MAX);
}

const BOOK_COVERS = ['#5a2a22', '#2f3e52', '#4a3a22', '#3c4a2c'] as const;
const BOOK_SHADOW = '#1e1810';
const BOOK_PAGES = '#cfc6aa';
const BOOK_W_PX = 6;
const BOOK_H_PX = 9;
const BOOKS_MIN = 3;
const BOOKS_MAX = 4;
const BOOK_SCATTER = 0.5;

function paintBooks(ctx: Ctx, rng: Rng): void {
  const books = BOOKS_MIN + Math.floor(rng() * (BOOKS_MAX - BOOKS_MIN + 1));
  for (let i = 0; i < books; i++) {
    const angle = rng() * TWO_PI;
    const reach = (HALF + rng() * HALF) * BOOK_SCATTER * TILE_SIZE;
    const x = CENTRE_PX + Math.cos(angle) * reach;
    const y = CENTRE_PX + Math.sin(angle) * reach * POOL_SQUASH;
    const turn = rng() * Math.PI;
    const cover = BOOK_COVERS[Math.floor(rng() * BOOK_COVERS.length)] ?? BOOK_COVERS[0];
    flatRect(ctx, x, y, BOOK_W_PX, BOOK_H_PX, turn, cover, BOOK_SHADOW);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(turn);
    ctx.fillStyle = BOOK_PAGES;
    ctx.fillRect(BOOK_W_PX / 2 - 1, -BOOK_H_PX / 2 + 1, 1, BOOK_H_PX - 2);
    ctx.restore();
  }
  paintSheets(ctx, rng, 1, 2);
}

const CLUTTER_COLOURS = ['#7a3a30', '#4f5a62', '#8a7a52', '#5c5446'] as const;
const CLUTTER_SHADOW = '#1c1a18';
const CLUTTER_MIN = 3;
const CLUTTER_MAX = 5;
const CLUTTER_SIZE_MIN_PX = 3;
const CLUTTER_SIZE_MAX_PX = 6;
const CLUTTER_SCATTER = 0.55;

/** A locker's leavings: a can, a rag, a boot — a few muted blocks. */
function paintClutter(ctx: Ctx, rng: Rng): void {
  const count = CLUTTER_MIN + Math.floor(rng() * (CLUTTER_MAX - CLUTTER_MIN + 1));
  for (let i = 0; i < count; i++) {
    const angle = rng() * TWO_PI;
    const reach = rng() * CLUTTER_SCATTER * TILE_SIZE;
    const w = CLUTTER_SIZE_MIN_PX + rng() * (CLUTTER_SIZE_MAX_PX - CLUTTER_SIZE_MIN_PX);
    const h = CLUTTER_SIZE_MIN_PX + rng() * (CLUTTER_SIZE_MAX_PX - CLUTTER_SIZE_MIN_PX);
    const colour = CLUTTER_COLOURS[Math.floor(rng() * CLUTTER_COLOURS.length)] ?? CLUTTER_SHADOW;
    flatRect(
      ctx,
      CENTRE_PX + Math.cos(angle) * reach,
      CENTRE_PX + Math.sin(angle) * reach * POOL_SQUASH,
      w,
      h,
      rng() * Math.PI,
      colour,
      CLUTTER_SHADOW,
    );
  }
  paintSheets(ctx, rng, 1, 1);
}

const GLASS_WASH_RGB = '190,214,224';
/** Dull, dusty shards: on bare concrete a bright one reads as a sparkle, not as glass. */
const GLASS_WASH_ALPHA = 0.12;
const GLASS_SHARD = 'rgba(150,170,176,0.75)';
const GLASS_SHARD_SHADOW = 'rgba(10,20,26,0.4)';
const SHARDS_MIN = 5;
const SHARDS_MAX = 7;
const SHARD_SIZE_MIN_PX = 3;
const SHARD_SIZE_MAX_PX = 5;
const SHARD_SCATTER = 0.6;

function paintGlass(ctx: Ctx, rng: Rng): void {
  paintWash(ctx, GLASS_WASH_RGB, GLASS_WASH_ALPHA, POOL_RADIUS);
  const shards = SHARDS_MIN + Math.floor(rng() * (SHARDS_MAX - SHARDS_MIN + 1));
  for (let i = 0; i < shards; i++) {
    const angle = rng() * TWO_PI;
    const reach = rng() * SHARD_SCATTER * TILE_SIZE;
    const x = CENTRE_PX + Math.cos(angle) * reach;
    const y = CENTRE_PX + Math.sin(angle) * reach * POOL_SQUASH;
    const size = SHARD_SIZE_MIN_PX + rng() * (SHARD_SIZE_MAX_PX - SHARD_SIZE_MIN_PX);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * TWO_PI);
    for (const [fill, offset] of [
      [GLASS_SHARD_SHADOW, 1],
      [GLASS_SHARD, 0],
    ] as const) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(-size / 2 + offset, offset);
      ctx.lineTo(size / 2 + offset, -size / 2 + offset);
      ctx.lineTo(offset, size / 2 + offset);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

const ASH_RGB = '58,52,48';
const ASH_ALPHA = 0.5;
const COAL = '#1b1715';
const COAL_SHADOW = '#0a0908';
const COALS_MIN = 6;
const COALS_MAX = 9;
const COAL_SIZE_MIN_PX = 2;
const COAL_SIZE_MAX_PX = 4;
const COAL_SCATTER = 0.32;
const COALS_WASH_RADIUS = 0.55;

interface CoalLump {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Asked for every glowing spill every frame, so worked out once per look. */
const coalLumpsByVariant = new Map<number, ReadonlyArray<CoalLump>>();

/** Where each lump of a coal spill lies, so the live embers sit on the lumps. */
export function coalLumps(variant: number): ReadonlyArray<CoalLump> {
  const cached = coalLumpsByVariant.get(variant);
  if (cached !== undefined) return cached;
  const rng = mulberry32(hashKey(`coal-lumps:${variant}`));
  const count = COALS_MIN + Math.floor(rng() * (COALS_MAX - COALS_MIN + 1));
  const lumps: CoalLump[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * TWO_PI;
    const reach = rng() * COAL_SCATTER * TILE_SIZE;
    lumps.push({
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach * POOL_SQUASH,
      size: COAL_SIZE_MIN_PX + rng() * (COAL_SIZE_MAX_PX - COAL_SIZE_MIN_PX),
    });
  }
  coalLumpsByVariant.set(variant, lumps);
  return lumps;
}

function paintCoals(ctx: Ctx, variant: number): void {
  paintWash(ctx, ASH_RGB, ASH_ALPHA, COALS_WASH_RADIUS);
  for (const lump of coalLumps(variant)) {
    flatRect(
      ctx,
      CENTRE_PX + lump.x,
      CENTRE_PX + lump.y,
      lump.size,
      lump.size,
      0,
      COAL,
      COAL_SHADOW,
    );
  }
}

const CHAR = '#14110f';
const CHAR_ALPHA = 0.82;
const CHAR_RIM_RGB = '110,100,90';
const CHAR_RIM_ALPHA = 0.3;
const CHAR_RIM_WIDTH_PX = 2;

/** A pool burnt off: a charred stain, its edge ringed with pale ash. */
function paintBurnt(ctx: Ctx, rng: Rng): void {
  const radius = POOL_RADIUS * TILE_SIZE;
  poolPath(ctx, rng, CENTRE_PX, CENTRE_PX, radius);
  ctx.strokeStyle = `rgba(${CHAR_RIM_RGB},${CHAR_RIM_ALPHA})`;
  ctx.lineWidth = CHAR_RIM_WIDTH_PX;
  ctx.stroke();
  ctx.globalAlpha = CHAR_ALPHA;
  ctx.fillStyle = CHAR;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Live coals ──────────────────────────────────────────────────────────────

const EMBER_RGB = '214,82,30';
const EMBER_HOT_RGB = '255,150,60';
/** Embers glow on only some lumps, and never at full strength: a dull bed of coals, not a spray of sparks. */
const EMBER_EVERY_NTH_LUMP = 2;
const EMBER_MAX_ALPHA = 0.75;
const EMBER_FLICKER_RATE = 0.21;
const EMBER_FLICKER_DEPTH = 0.35;
/** Embers sit on top of their lump, a pixel in from its edge. */
const EMBER_INSET_PX = 1;

/**
 * The live glow of spilled coals over their decal: each lump's top glows,
 * flickering, as bright as `glow` (1 just spilled, 0 dead).
 */
export function drawCoalEmbers(
  ctx: Ctx,
  variant: number,
  screenX: number,
  screenY: number,
  glow: number,
  frame: number,
): void {
  if (glow <= 0) return;
  const lumps = coalLumps(variant);
  ctx.save();
  lumps.forEach((lump, index) => {
    if (index % EMBER_EVERY_NTH_LUMP !== 0) return;
    const flicker =
      1 - EMBER_FLICKER_DEPTH * HALF * (1 + Math.sin(frame * EMBER_FLICKER_RATE + index));
    const size = Math.max(1, lump.size - EMBER_INSET_PX);
    const hot = index % (EMBER_EVERY_NTH_LUMP * 2) === 0;
    ctx.fillStyle = `rgba(${hot ? EMBER_HOT_RGB : EMBER_RGB},${glow * flicker * EMBER_MAX_ALPHA})`;
    ctx.fillRect(screenX + lump.x - size / 2, screenY + lump.y - size / 2, size, size);
  });
  ctx.restore();
}
