import { drawSpriteKey, timeFrameIndex } from '../../../core/SpriteRenderer';
import {
  VAT_BUBBLE_FRAMES,
  VAT_BURST_FRAMES,
  VAT_CRACK_FRAMES,
  CONSOLE_SCREEN_FRAMES,
} from '../../../sprites/art/krakarenRoomArt';
import {
  krakarenLabAt,
  labTileKey,
  VAT_BED_RADIUS_TILES,
  type KrakarenLabLayout,
} from '../../../systems/bossRooms/krakarenLabLayout';
import { frameTime } from '../../../utils';
import { mulberry32 } from '../../../sprites/person/rng';
import type { TileContent } from '../../tileTypes';
import { KRAKAREN_CONSOLE, KRAKAREN_TANK, KRAKAREN_WADE, positionHash } from '../../tileTypes';
import { SPRITE_BUILDING_OVERLAY_FPS } from '../overlayAnimation';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import type { TilePoint } from '../../../systems/bossRooms/bossRoomLayout';

type Ctx = CanvasRenderingContext2D;

/**
 * The two tones of the lab's epoxy floor panels, exported because her bake
 * gate measures her lightness against the floor she is seen on and a copied hex
 * goes stale the first time this file is retouched.
 */
export const KRAKAREN_LAIR_STONE_LIGHT = '#1a1e24';
export const KRAKAREN_LAIR_STONE_DARK = '#161a20';

// ── Vat stages ───────────────────────────────────────────────────────────────

/**
 * What a vat tile shows, carried in the tile's `damageStage` because the tile
 * painter is handed a grid and a position and nothing else — the same reason a
 * smashable prop's wear lives there. Written by the room system as the vat
 * cracks and bursts.
 */
export const VAT_STAGE_INTACT = 0;
/** First of the cracking frames; the rest follow it in order. */
export const VAT_STAGE_CRACKING = 1;
/** First of the burst frames. */
export const VAT_STAGE_BURSTING = VAT_STAGE_CRACKING + VAT_CRACK_FRAMES;
export const VAT_STAGE_BROKEN = VAT_STAGE_BURSTING + VAT_BURST_FRAMES;

/**
 * Whether a vat holds a failed specimen. Most do; one in three is only murk,
 * so a row of them reads as a production line of failures rather than one
 * picture repeated. Hashed from position, so it never needs remembering.
 */
const EMPTY_VAT_ONE_IN = 3;
export function vatHoldsSpecimen(tx: number, ty: number): boolean {
  return positionHash(tx, ty) % EMPTY_VAT_ONE_IN !== 0;
}

/**
 * Paints the boss-room tile types of Krakaren Clone's flooded lab. Returns false for any other type.
 *
 * A solid prop is Y-sorted: the chunk bake has already drawn the floor beneath
 * it, so its case paints only the prop. A flat decal is baked into the chunk and
 * paints its own floor.
 */
export function drawKrakarenTile(
  ctx: Ctx,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  switch (type) {
    case KRAKAREN_TANK:
      drawVat(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    case KRAKAREN_CONSOLE: {
      // Each console flickers on its own beat rather than the whole wall at once.
      const offset = positionHash(tx, ty) % CONSOLE_SCREEN_FRAMES;
      const frame =
        (timeFrameIndex(
          frameTime,
          SPRITE_BUILDING_OVERLAY_FPS / CONSOLE_FPS_DIVISOR,
          CONSOLE_SCREEN_FRAMES,
        ) +
          offset) %
        CONSOLE_SCREEN_FRAMES;
      drawSpriteKey(ctx, 'krakaren_console', 'screen', frame, sx, sy, ts);
      return true;
    }
    case KRAKAREN_WADE:
      drawKrakarenLabFloor(ctx, structure, sx, sy, ts, tx, ty);
      drawWadeWater(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    default:
      return false;
  }
}
/** Screens refresh at half the overlay clock; a full-rate flicker reads as a fault in the renderer. */
const CONSOLE_FPS_DIVISOR = 2;

function drawVat(
  ctx: Ctx,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const stage = structure[ty]?.[tx]?.damageStage ?? VAT_STAGE_INTACT;
  const specimen = vatHoldsSpecimen(tx, ty);
  if (stage >= VAT_STAGE_BROKEN) {
    drawSpriteKey(ctx, 'krakaren_vat', specimen ? 'broken' : 'broken_empty', 0, sx, sy, ts);
    return;
  }
  if (stage >= VAT_STAGE_BURSTING) {
    const frame = stage - VAT_STAGE_BURSTING;
    drawSpriteKey(ctx, 'krakaren_vat', specimen ? 'burst' : 'burst_empty', frame, sx, sy, ts);
    return;
  }
  if (stage >= VAT_STAGE_CRACKING) {
    const frame = stage - VAT_STAGE_CRACKING;
    drawSpriteKey(ctx, 'krakaren_vat', specimen ? 'cracking' : 'cracking_empty', frame, sx, sy, ts);
    return;
  }
  const offset = positionHash(tx, ty) % VAT_BUBBLE_FRAMES;
  const frame =
    (timeFrameIndex(frameTime, SPRITE_BUILDING_OVERLAY_FPS / VAT_FPS_DIVISOR, VAT_BUBBLE_FRAMES) +
      offset) %
    VAT_BUBBLE_FRAMES;
  drawSpriteKey(ctx, 'krakaren_vat', specimen ? 'intact' : 'intact_empty', frame, sx, sy, ts);
}
/** Bubbles rise lazily: a quarter of the overlay clock. */
const VAT_FPS_DIVISOR = 4;

// ── The lab floor ────────────────────────────────────────────────────────────

const HAIRLINE = 1;
const PANEL_TILES = 2;
const PANEL_TONE_VARIANTS = 4;
const PANEL_TONE_STEP = 0.025;
const SEAM_DARK = 'rgba(0, 0, 0, 0.55)';
const SEAM_LIGHT = 'rgba(150, 170, 190, 0.12)';
const SPECKLE_COUNT = 5;
const SPECKLE_LIGHT = 'rgba(170, 185, 200, 0.14)';
const SPECKLE_DARK = 'rgba(0, 0, 0, 0.3)';
const SHEEN_ONE_IN = 9;
const SHEEN_COLOR = 'rgba(180, 200, 220, 0.045)';
const SHEEN_RX = 0.38;
const SHEEN_RY = 0.16;
const HALF = 0.5;
const TWO_PI = Math.PI * 2;

/** Dried growth medium tracked across the floor: a few tiles in each room carry a stain. */
const STAIN_ONE_IN = 13;
const STAIN_SALT_X = 31;
const STAIN_SALT_Y = 17;
const STAIN_BLOBS = 3;
const STAIN_COLOR = 'rgba(130, 50, 90, 0.14)';
const STAIN_EDGE = 'rgba(150, 40, 92, 0)';
const STAIN_MIN_R = 0.12;
const STAIN_SPREAD_R = 0.14;
const STAIN_MARGIN = 0.3;

/** A soft, lumpy stain kept inside its own tile so it bakes without seams. */
function drawMediumStain(ctx: Ctx, rng: () => number, sx: number, sy: number, ts: number): void {
  for (let i = 0; i < STAIN_BLOBS; i++) {
    const r = ts * (STAIN_MIN_R + rng() * STAIN_SPREAD_R);
    const cx = sx + ts * (STAIN_MARGIN + rng() * (1 - STAIN_MARGIN * 2));
    const cy = sy + ts * (STAIN_MARGIN + rng() * (1 - STAIN_MARGIN * 2));
    const blob = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    blob.addColorStop(0, STAIN_COLOR);
    blob.addColorStop(1, STAIN_EDGE);
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();
  }
}

/** Which of the few looks a plain floor tile takes; everything about it is hashed from position. */
interface FloorVariant {
  readonly westSeam: boolean;
  readonly northSeam: boolean;
  readonly light: boolean;
  readonly tone: number;
  readonly speckles: number;
  readonly sheen: boolean;
  readonly stain: boolean;
}

/** Distinct speckle scatters; a tile takes one by hash, so no two neighbours need match. */
const SPECKLE_VARIANTS = 4;
const SPECKLE_SEED = 0x5ec;

/**
 * The plain floor's looks, each painted once and blitted after. A lab chunk is
 * almost entirely floor, and painting every tile's seams, speckles and stains
 * from scratch made re-baking it — which every burst does — the dearest thing
 * in the room.
 */
const floorTiles = new Map<string, CanvasSurface>();

function floorVariantAt(tx: number, ty: number): FloorVariant {
  const panelHash = positionHash(Math.floor(tx / PANEL_TILES), Math.floor(ty / PANEL_TILES));
  const tileHash = positionHash(tx, ty);
  return {
    westSeam: tx % PANEL_TILES === 0,
    northSeam: ty % PANEL_TILES === 0,
    light: (tx + ty) % 2 === 0,
    tone: panelHash % PANEL_TONE_VARIANTS,
    speckles: tileHash % SPECKLE_VARIANTS,
    sheen: tileHash % SHEEN_ONE_IN === 0,
    stain: positionHash(tx * STAIN_SALT_X, ty * STAIN_SALT_Y) % STAIN_ONE_IN === 0,
  };
}

/**
 * Paints the lab's cached floor art — its vat bed and every plain-floor look its
 * tiles use — ahead of the first chunk bake that shows them.
 */
export function prewarmKrakarenLabArt(lab: KrakarenLabLayout, ts: number): void {
  vatBedSurface(lab, ts);
  const b = lab.bounds;
  for (let ty = b.y; ty < b.y + b.h; ty++) {
    for (let tx = b.x; tx < b.x + b.w; tx++) labFloorSurface(floorVariantAt(tx, ty), ts);
  }
}

function labFloorSurface(v: FloorVariant, ts: number): CanvasSurface {
  const key = `${ts},${v.westSeam ? 1 : 0}${v.northSeam ? 1 : 0}${v.light ? 1 : 0},${v.tone},${v.speckles},${v.sheen ? 1 : 0}${v.stain ? 1 : 0}`;
  const cached = floorTiles.get(key);
  if (cached !== undefined) return cached;
  const surface = allocCanvas(ts, ts);
  paintLabFloor(surfaceContext(surface), v, ts);
  floorTiles.set(key, surface);
  return surface;
}

function paintLabFloor(ctx: Ctx, v: FloorVariant, ts: number): void {
  ctx.fillStyle = v.light ? KRAKAREN_LAIR_STONE_LIGHT : KRAKAREN_LAIR_STONE_DARK;
  ctx.fillRect(0, 0, ts, ts);
  ctx.fillStyle = `rgba(120, 140, 160, ${v.tone * PANEL_TONE_STEP})`;
  ctx.fillRect(0, 0, ts, ts);

  // Panel seams on the panel's own edges only, so a panel reads as two tiles square.
  ctx.fillStyle = SEAM_DARK;
  if (v.westSeam) ctx.fillRect(0, 0, HAIRLINE, ts);
  if (v.northSeam) ctx.fillRect(0, 0, ts, HAIRLINE);
  ctx.fillStyle = SEAM_LIGHT;
  if (v.westSeam) ctx.fillRect(HAIRLINE, 0, HAIRLINE, ts);
  if (v.northSeam) ctx.fillRect(0, HAIRLINE, ts, HAIRLINE);

  const rng = mulberry32(SPECKLE_SEED + v.speckles);
  for (let i = 0; i < SPECKLE_COUNT; i++) {
    ctx.fillStyle = i % 2 === 0 ? SPECKLE_LIGHT : SPECKLE_DARK;
    ctx.fillRect(Math.floor(rng() * ts), Math.floor(rng() * ts), HAIRLINE, HAIRLINE);
  }
  if (v.sheen) {
    ctx.fillStyle = SHEEN_COLOR;
    ctx.beginPath();
    ctx.ellipse(ts * HALF, ts * HALF, ts * SHEEN_RX, ts * SHEEN_RY, rng() * Math.PI, 0, TWO_PI);
    ctx.fill();
  }
  if (v.stain) drawMediumStain(ctx, rng, 0, 0, ts);
}

/** Warning stripes along the foot of every wall, a hand-width deep. */
const STRIPE_DEPTH = 0.16;
const STRIPE_STEP = 0.18;
const STRIPE_YELLOW = 'rgba(206, 170, 56, 0.75)';
const STRIPE_BLACK = 'rgba(20, 18, 14, 0.85)';

/**
 * Paints the lab's floor at one tile: dark epoxy panels with seams, the
 * warning stripe at the wall's foot, and — where the layout puts them — the
 * broken vat bed, drain grates and cable runs.
 */
export function drawKrakarenLabFloor(
  ctx: Ctx,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  ctx.drawImage(labFloorSurface(floorVariantAt(tx, ty), ts), sx, sy, ts, ts);

  const lab = krakarenLabAt(structure, tx, ty);
  if (lab === null) return;
  drawWallStripes(ctx, lab, sx, sy, ts, tx, ty);
  drawVatBed(ctx, lab, sx, sy, ts, tx, ty);
  const key = labTileKey(tx, ty);
  if (lab.drains.some((d) => labTileKey(d.x, d.y) === key)) drawDrain(ctx, sx, sy, ts, tx, ty);
  for (const puddle of lab.livePuddles) {
    const index = puddle.cable.findIndex((c) => labTileKey(c.x, c.y) === key);
    if (index >= 0) drawCable(ctx, sx, sy, ts, puddle.inward, index === 0, tx, ty);
  }
}

function drawWallStripes(
  ctx: Ctx,
  lab: KrakarenLabLayout,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const b = lab.bounds;
  const depth = ts * STRIPE_DEPTH;
  const onDoorway = lab.doorways.some((d) => d.tiles.some((t) => t.x === tx && t.y === ty));
  if (onDoorway) return;
  const edges: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (ty === b.y) edges.push({ x: sx, y: sy, w: ts, h: depth });
  if (ty === b.y + b.h - 1) edges.push({ x: sx, y: sy + ts - depth, w: ts, h: depth });
  if (tx === b.x) edges.push({ x: sx, y: sy, w: depth, h: ts });
  if (tx === b.x + b.w - 1) edges.push({ x: sx + ts - depth, y: sy, w: depth, h: ts });
  if (edges.length === 0) return;
  // Diagonals in world space, so the stripe runs unbroken from tile to tile.
  const step = ts * STRIPE_STEP;
  const phase = ((tx + ty) * ts) % (step * 2);
  for (const e of edges) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(e.x, e.y, e.w, e.h);
    ctx.clip();
    ctx.fillStyle = STRIPE_BLACK;
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.fillStyle = STRIPE_YELLOW;
    for (let d = -ts - phase; d < ts * 2; d += step * 2) {
      ctx.beginPath();
      ctx.moveTo(sx + d, sy + ts);
      ctx.lineTo(sx + d + step, sy + ts);
      ctx.lineTo(sx + d + step + ts, sy);
      ctx.lineTo(sx + d + ts, sy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// ── The broken vat bed under her ─────────────────────────────────────────────

const BED_PLATE = '#252b33';
const BED_RIM_LIGHT = '#5e6873';
const BED_RIM_DARK = '#10141a';
const BED_RIM_WIDTH = 0.22;
const BED_RESIDUE = 'rgba(214, 90, 150, 0.32)';
const BED_RESIDUE_RADIUS = 1.9;
const BED_RESIDUE_WIDTH = 0.34;
const BED_STAIN = 'rgba(120, 30, 70, 0.35)';
const BED_STAIN_RADIUS = 1.2;
const BED_CRACKS = 9;
const BED_CRACK_COLOR = 'rgba(0, 0, 0, 0.6)';
const BED_CRACK_WIDTH = 1.4;
const BED_SHARDS = 26;
const BED_SHARD_COLOR = 'rgba(190, 230, 250, 0.75)';
const BED_SHARD_EDGE = 'rgba(255, 255, 255, 0.9)';
const BED_SHARD_MIN = 0.06;
const BED_SHARD_SPREAD = 0.1;
const BED_SHARD_REACH = 3;
const BED_SEED = 0xbed;
const BED_BOLTS = 12;
const BED_BOLT_RADIUS = 0.05;
const BED_BOLT_COLOR = '#7b8791';
/** Tiles this far out still carry scattered shards thrown clear of the bed. */
export const BED_PAINT_REACH = BED_SHARD_REACH + 1;

/**
 * The circular plinth the original tank stood on, painted across every tile
 * it touches in world space so the circle is continuous. Glass from the tank
 * that failed is still lying where it fell, and the pink residue ring marks
 * where the medium drained.
 */
function drawVatBed(
  ctx: Ctx,
  lab: KrakarenLabLayout,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const dist = Math.hypot(tx - lab.centre.x, ty - lab.centre.y);
  if (dist > BED_PAINT_REACH) return;
  const bed = vatBedSurface(lab, ts);
  const scale = bed.width / (BED_SPAN_TILES * ts);
  const slice = ts * scale;
  const col = tx - (lab.centre.x - BED_PAINT_REACH);
  const row = ty - (lab.centre.y - BED_PAINT_REACH);
  ctx.drawImage(bed, col * slice, row * slice, slice, slice, sx, sy, ts, ts);
}

/** Tiles across the square the bed is painted into: its reach either side of her tile, and her tile. */
const BED_SPAN_TILES = BED_PAINT_REACH * 2 + 1;
/** At the chunk's own resolution, like the water, so each slice is a straight blit. */
const BED_SUPERSAMPLE = 1;
/**
 * Each lab's bed, painted once into a square surface and then blitted a tile's
 * slice at a time. A chunk bake then costs one `drawImage` per bed tile — the
 * bed's chunk is re-baked every time a vat's flood touches it, and repainting
 * every crack, bolt and shard under a clip for each of its tiles made that
 * re-bake several times dearer than any other chunk in the room.
 */
const vatBeds = new Map<string, CanvasSurface>();
/** A floor has at most one lab, so a handful covers every floor visited in a session. */
const MAX_CACHED_VAT_BEDS = 4;

/** The lab's bed surface, painting it the first time it is asked for; `prewarmKrakarenLabArt` asks ahead of need. */
export function vatBedSurface(lab: KrakarenLabLayout, ts: number): CanvasSurface {
  const key = `${lab.centre.x},${lab.centre.y},${ts}`;
  const cached = vatBeds.get(key);
  if (cached !== undefined) return cached;
  if (vatBeds.size >= MAX_CACHED_VAT_BEDS) vatBeds.clear();
  const size = Math.round(BED_SPAN_TILES * ts * BED_SUPERSAMPLE);
  const surface = allocCanvas(size, size);
  const bedCtx = surfaceContext(surface);
  const scale = size / (BED_SPAN_TILES * ts);
  bedCtx.scale(scale, scale);
  const middle = (BED_PAINT_REACH + HALF) * ts;
  paintVatBed(bedCtx, middle, middle, ts);
  vatBeds.set(key, surface);
  return surface;
}

/** The whole bed, centred on `(cx, cy)`. */
function paintVatBed(ctx: Ctx, cx: number, cy: number, ts: number): void {
  const r = VAT_BED_RADIUS_TILES * ts;
  ctx.save();

  ctx.fillStyle = BED_PLATE;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = BED_STAIN;
  ctx.beginPath();
  ctx.arc(cx, cy, BED_STAIN_RADIUS * ts, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = BED_RESIDUE;
  ctx.lineWidth = BED_RESIDUE_WIDTH * ts;
  ctx.beginPath();
  ctx.arc(cx, cy, BED_RESIDUE_RADIUS * ts, 0, TWO_PI);
  ctx.stroke();

  const rng = mulberry32(BED_SEED);
  ctx.strokeStyle = BED_CRACK_COLOR;
  ctx.lineWidth = BED_CRACK_WIDTH;
  for (let i = 0; i < BED_CRACKS; i++) {
    const a = rng() * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    let px = cx;
    let py = cy;
    for (let s = 1; s <= BED_CRACK_SEGMENTS; s++) {
      const wander = a + (rng() - HALF) * BED_CRACK_WANDER;
      px += (Math.cos(wander) * r) / BED_CRACK_SEGMENTS;
      py += (Math.sin(wander) * r) / BED_CRACK_SEGMENTS;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // The rim: a raised steel ring, lit on its upper-left arc.
  ctx.lineWidth = BED_RIM_WIDTH * ts;
  ctx.strokeStyle = BED_RIM_DARK;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = BED_RIM_LIGHT;
  ctx.lineWidth = BED_RIM_WIDTH * ts * HALF;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI * RIM_LIT_END);
  ctx.stroke();
  ctx.fillStyle = BED_BOLT_COLOR;
  for (let i = 0; i < BED_BOLTS; i++) {
    const a = (i / BED_BOLTS) * TWO_PI;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, BED_BOLT_RADIUS * ts, 0, TWO_PI);
    ctx.fill();
  }

  // Shards, mostly on the bed, a few thrown clear.
  for (let i = 0; i < BED_SHARDS; i++) {
    const a = rng() * TWO_PI;
    const d = Math.sqrt(rng()) * BED_SHARD_REACH * ts;
    const size = (BED_SHARD_MIN + rng() * BED_SHARD_SPREAD) * ts;
    const spin = rng() * TWO_PI;
    const px = cx + Math.cos(a) * d;
    const py = cy + Math.sin(a) * d;
    ctx.fillStyle = BED_SHARD_COLOR;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(spin) * size, py + Math.sin(spin) * size);
    ctx.lineTo(
      px + Math.cos(spin + SHARD_CORNER_B) * size * SHARD_NARROW,
      py + Math.sin(spin + SHARD_CORNER_B) * size * SHARD_NARROW,
    );
    ctx.lineTo(
      px + Math.cos(spin + SHARD_CORNER_C) * size * SHARD_NARROW,
      py + Math.sin(spin + SHARD_CORNER_C) * size * SHARD_NARROW,
    );
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = BED_SHARD_EDGE;
    ctx.lineWidth = HAIRLINE;
    ctx.stroke();
  }
  ctx.restore();
}
const BED_CRACK_SEGMENTS = 4;
const BED_CRACK_WANDER = 0.7;
const RIM_LIT_END = 1.6;
const SHARD_CORNER_B = 2.4;
const SHARD_CORNER_C = 3.9;
const SHARD_NARROW = 0.6;

// ── Drains ───────────────────────────────────────────────────────────────────

const DRAIN_INSET = 0.18;
const DRAIN_RIM = '#59636d';
const DRAIN_PIT = '#07090b';
const DRAIN_BAR = '#3b434c';
const DRAIN_BARS = 4;
const DRAIN_RESIDUE = 'rgba(184, 70, 126, 0.4)';

function drawDrain(ctx: Ctx, sx: number, sy: number, ts: number, tx: number, ty: number): void {
  const inset = ts * DRAIN_INSET;
  const x = sx + inset;
  const y = sy + inset;
  const w = ts - inset * 2;
  ctx.fillStyle = DRAIN_RIM;
  ctx.fillRect(x - HAIRLINE, y - HAIRLINE, w + HAIRLINE * 2, w + HAIRLINE * 2);
  ctx.fillStyle = DRAIN_PIT;
  ctx.fillRect(x + HAIRLINE, y + HAIRLINE, w - HAIRLINE * 2, w - HAIRLINE * 2);
  ctx.fillStyle = DRAIN_BAR;
  for (let i = 1; i < DRAIN_BARS; i++) {
    ctx.fillRect(x + (w * i) / DRAIN_BARS - HAIRLINE, y + HAIRLINE, HAIRLINE * 2, w - HAIRLINE * 2);
  }
  // Pink crust where the medium drains, heavier on one side.
  ctx.fillStyle = DRAIN_RESIDUE;
  const side = positionHash(tx, ty) % 2 === 0;
  ctx.fillRect(side ? x - HAIRLINE : x + w - HAIRLINE * 2, y, HAIRLINE * 3, w);
}

// ── Cable runs ───────────────────────────────────────────────────────────────

const CABLE_OFFSET = 0.2;
const CABLE_WIDTH = 0.2;
const CABLE_DARK = '#101010';
const CABLE_SHEATH = '#c9a43a';
const CABLE_CLAMP = '#8a939b';
const CABLE_SCORCH = 'rgba(10, 8, 6, 0.45)';

/**
 * A heavy power cable lying along the foot of the wall. `inward` points away
 * from the wall it hugs; the tile nearest the puddle is scorched, since that
 * is where it has been arcing.
 */
function drawCable(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  inward: { x: number; y: number },
  nearPuddle: boolean,
  tx: number,
  ty: number,
): void {
  const alongX = inward.x === 0;
  const offset = ts * CABLE_OFFSET;
  const width = ts * CABLE_WIDTH;
  const wallEdgeX = inward.x > 0 ? sx : sx + ts;
  const wallEdgeY = inward.y > 0 ? sy : sy + ts;
  const lineX = wallEdgeX + inward.x * offset;
  const lineY = wallEdgeY + inward.y * offset;
  if (nearPuddle) {
    ctx.fillStyle = CABLE_SCORCH;
    ctx.beginPath();
    ctx.ellipse(
      alongX ? sx + ts * HALF : lineX,
      alongX ? lineY : sy + ts * HALF,
      ts * HALF,
      ts * SCORCH_DEPTH,
      alongX ? 0 : Math.PI * HALF,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  const sag = ((positionHash(tx, ty) % CABLE_SAG_STEPS) - 1) * HAIRLINE;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = CABLE_DARK;
  ctx.lineWidth = width;
  ctx.beginPath();
  if (alongX) {
    ctx.moveTo(sx, lineY);
    ctx.quadraticCurveTo(sx + ts * HALF, lineY + sag, sx + ts, lineY);
  } else {
    ctx.moveTo(lineX, sy);
    ctx.quadraticCurveTo(lineX + sag, sy + ts * HALF, lineX, sy + ts);
  }
  ctx.stroke();
  ctx.strokeStyle = CABLE_SHEATH;
  ctx.lineWidth = HAIRLINE;
  ctx.stroke();
  ctx.fillStyle = CABLE_CLAMP;
  const clamp = ts * CLAMP_SIZE;
  if (alongX) ctx.fillRect(sx + ts * HALF - HAIRLINE, lineY - clamp * HALF, HAIRLINE * 2, clamp);
  else ctx.fillRect(lineX - clamp * HALF, sy + ts * HALF - HAIRLINE, clamp, HAIRLINE * 2);
}
const SCORCH_DEPTH = 0.3;
const CABLE_SAG_STEPS = 3;
const CLAMP_SIZE = 0.24;

// ── Flood water ──────────────────────────────────────────────────────────────

/**
 * The water is painted at the tile's own resolution: chunks are baked at one
 * pixel per tile pixel, so anything painted finer is only resampled back down,
 * and a resampling blit costs several times a straight one.
 */
const WATER_SUPERSAMPLE = 1;
const RGBA = 4;
const ALPHA_MAX = 255;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;

/** How far the shoreline sits in from dry ground, in tiles, before its wander. */
const SHORE_BASE_TILES = 0.16;
/** How far the shoreline wanders either side of that, in tiles. */
const SHORE_WANDER_TILES = 0.15;
const FOAM_TILES = 0.05;
/** A damp halo on the floor just outside the water. */
const DAMP_TILES = 0.12;
const DAMP = { r: 30, g: 8, b: 22, a: 0.35 } as const;
const FOAM = { r: 214, g: 176, b: 196, a: 0.42 } as const;
const SHALLOW = { r: 132, g: 72, b: 104 } as const;
const DEEP = { r: 78, g: 36, b: 60 } as const;
const CAUSTIC = { r: 206, g: 150, b: 180 } as const;
const WATER_ALPHA = 0.74;
/** Water reaches its deepest colour this far from the shore, in tiles. */
const FULL_DEPTH_TILES = 0.9;
/** Caustic ridges: two crossed sine fields in world space, lit where they cancel. */
const CAUSTIC_FREQ_A = 5.1;
const CAUSTIC_FREQ_B = 4.3;
const CAUSTIC_WARP = 1.4;
const CAUSTIC_WARP_FREQ = 2.7;
const CAUSTIC_RIDGE = 0.22;
const CAUSTIC_STRENGTH = 0.16;
const SHORE_FREQ_A = 1.9;
const SHORE_FREQ_B = 2.6;
const SHORE_MIX_A = 1.1;
const SHORE_MIX_B = 1.7;
/** A wired puddle carries a faint cold cast before it ever arcs. */
const LIVE_COLD = { r: 120, g: 190, b: 255, a: 0.16 } as const;

/**
 * Painted water tiles, kept so a chunk re-baked after a burst floods part of it
 * blits the tiles it already had instead of repainting them pixel by pixel. A
 * tile's water depends only on its position, which neighbours are dry and
 * whether it is wired, so those are the key. The room system prewarms every
 * variant its fight can produce while the floor loads.
 */
const waterTiles = new Map<string, CanvasSurface>();
/**
 * Dropped wholesale past this many, which only a floor change reaches: one lab
 * with every flood state it can pass through needs a few hundred.
 */
const MAX_CACHED_WATER_TILES = 640;

/** Whether the tile at `(x, y)` is flood water, for the painter's shoreline. */
export type WetTest = (x: number, y: number) => boolean;

/** The cache key of a water tile: its position, whether it is wired, and which neighbours are dry. */
function waterKey(tx: number, ty: number, size: number, live: boolean, isWet: WetTest): string {
  let dryMask = 0;
  let bit = 1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!isWet(tx + dx, ty + dy)) dryMask |= bit;
      bit <<= 1;
    }
  }
  return `${tx},${ty},${size},${live ? 1 : 0},${dryMask}`;
}

/** Whether a water tile at this position is already painted for this neighbourhood. */
export function isWadeWaterCached(
  tx: number,
  ty: number,
  ts: number,
  live: boolean,
  isWet: WetTest,
): boolean {
  return waterTiles.has(waterKey(tx, ty, waterSurfaceSize(ts), live, isWet));
}

function waterSurfaceSize(ts: number): number {
  return Math.round(ts * WATER_SUPERSAMPLE);
}

/**
 * Paints (or fetches) one tile of flood water for a neighbourhood. Exported so
 * the room can paint the variants a fight will need ahead of time, spread over
 * frames, rather than inside the chunk bake that first shows them.
 */
export function wadeWaterSurface(
  tx: number,
  ty: number,
  ts: number,
  live: boolean,
  isWet: WetTest,
): CanvasSurface {
  const size = waterSurfaceSize(ts);
  const cacheKey = waterKey(tx, ty, size, live, isWet);
  const cached = waterTiles.get(cacheKey);
  if (cached !== undefined) return cached;
  if (waterTiles.size >= MAX_CACHED_WATER_TILES) waterTiles.clear();
  const surface = allocCanvas(size, size);
  waterTiles.set(cacheKey, surface);
  paintWater(surface, size, tx, ty, live, isWet);
  return surface;
}

function drawWadeWater(
  ctx: Ctx,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const isWet: WetTest = (x, y) => structure[y]?.[x]?.type === KRAKAREN_WADE;
  const lab = krakarenLabAt(structure, tx, ty);
  const live = lab !== null && isLivePuddleTile(lab, tx, ty);
  ctx.drawImage(wadeWaterSurface(tx, ty, ts, live, isWet), sx, sy, ts, ts);
}

/** Whether a tile is one of the lab's wired puddles. */
export function isLivePuddleTile(lab: KrakarenLabLayout, tx: number, ty: number): boolean {
  const key = labTileKey(tx, ty);
  return lab.livePuddles.some((p) => p.tiles.some((t) => labTileKey(t.x, t.y) === key));
}

/**
 * Shallow pink flood over the floor, painted per pixel so the shore can meander
 * and round its corners the way pooled water does. Everything is a function of
 * world position and of which neighbours are dry, so a tile that floods mid-fight
 * joins its neighbours without a seam.
 *
 * The sine terms are separable, so each is worked out once per row or column
 * rather than once per pixel.
 */
function paintWater(
  surface: CanvasSurface,
  size: number,
  tx: number,
  ty: number,
  live: boolean,
  isWet: WetTest,
): void {
  const dryCells: TilePoint[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!isWet(tx + dx, ty + dy)) dryCells.push({ x: tx + dx, y: ty + dy });
    }
  }
  const world = (p: number, origin: number): number => origin + (p + HALF) / size;
  const colW: number[] = [];
  const rowW: number[] = [];
  for (let p = 0; p < size; p++) {
    colW.push(world(p, tx));
    rowW.push(world(p, ty));
  }
  const colWarp = colW.map((wx) => CAUSTIC_WARP * Math.sin(wx * CAUSTIC_WARP_FREQ));
  const rowWarp = rowW.map((wy) => CAUSTIC_WARP * Math.sin(wy * CAUSTIC_WARP_FREQ));
  const colSinA = colW.map((wx) => Math.sin(wx * SHORE_FREQ_A));
  const colCosA = colW.map((wx) => Math.cos(wx * SHORE_FREQ_A));
  const rowSinA = rowW.map((wy) => Math.sin(wy * SHORE_MIX_A));
  const rowCosA = rowW.map((wy) => Math.cos(wy * SHORE_MIX_A));
  const rowSinB = rowW.map((wy) => Math.sin(wy * SHORE_FREQ_B));
  const rowCosB = rowW.map((wy) => Math.cos(wy * SHORE_FREQ_B));
  const colSinB = colW.map((wx) => Math.sin(wx * SHORE_MIX_B));
  const colCosB = colW.map((wx) => Math.cos(wx * SHORE_MIX_B));

  const sctx = surfaceContext(surface);
  const image = sctx.createImageData(size, size);
  const data = image.data;
  for (let py = 0; py < size; py++) {
    const wy = rowW[py];
    for (let px = 0; px < size; px++) {
      const wx = colW[px];
      let dist2 = Infinity;
      for (const c of dryCells) {
        const ex = Math.max(c.x - wx, 0, wx - (c.x + 1));
        const ey = Math.max(c.y - wy, 0, wy - (c.y + 1));
        dist2 = Math.min(dist2, ex * ex + ey * ey);
      }
      const dist = Math.sqrt(dist2);
      // sin(a + b) and sin(b - a), expanded so both halves come from the tables.
      const wander =
        HALF * (colSinA[px] * rowCosA[py] + colCosA[px] * rowSinA[py]) +
        HALF * (rowSinB[py] * colCosB[px] - rowCosB[py] * colSinB[px]);
      const shore = SHORE_BASE_TILES + SHORE_WANDER_TILES * wander;
      const i = (py * size + px) * RGBA;
      if (dist < shore - DAMP_TILES) continue;
      if (dist < shore) {
        writePixel(data, i, DAMP, DAMP.a * (1 - (shore - dist) / DAMP_TILES));
        continue;
      }
      if (dist < shore + FOAM_TILES) {
        writePixel(data, i, FOAM, FOAM.a);
        continue;
      }
      const depth = Math.min(1, (dist - shore) / FULL_DEPTH_TILES);
      let r = SHALLOW.r + (DEEP.r - SHALLOW.r) * depth;
      let g = SHALLOW.g + (DEEP.g - SHALLOW.g) * depth;
      let b = SHALLOW.b + (DEEP.b - SHALLOW.b) * depth;
      const ridge = Math.abs(
        Math.sin(wx * CAUSTIC_FREQ_A + rowWarp[py]) + Math.sin(wy * CAUSTIC_FREQ_B + colWarp[px]),
      );
      if (ridge < CAUSTIC_RIDGE) {
        const lift = CAUSTIC_STRENGTH * (1 - ridge / CAUSTIC_RIDGE);
        r += (CAUSTIC.r - r) * lift;
        g += (CAUSTIC.g - g) * lift;
        b += (CAUSTIC.b - b) * lift;
      }
      if (live) {
        r += (LIVE_COLD.r - r) * LIVE_COLD.a;
        g += (LIVE_COLD.g - g) * LIVE_COLD.a;
        b += (LIVE_COLD.b - b) * LIVE_COLD.a;
      }
      writePixel(data, i, { r, g, b }, WATER_ALPHA);
    }
  }
  sctx.putImageData(image, 0, 0);
}

function writePixel(
  data: Uint8ClampedArray,
  index: number,
  color: { readonly r: number; readonly g: number; readonly b: number },
  alpha: number,
): void {
  data[index] = color.r;
  data[index + GREEN] = color.g;
  data[index + BLUE] = color.b;
  data[index + ALPHA] = Math.round(alpha * ALPHA_MAX);
}
