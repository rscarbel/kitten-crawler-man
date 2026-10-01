/**
 * Fallen limestone from where the vault gave way: a heap filling one tile, and
 * a longer slope across two. Dressed blocks and broken pieces sit on a mound of
 * grit, each block lit on its top, mid-toned on its front and dark on the side
 * turned from the light, so the heap reads as solid stone even on dark cinder.
 * Breaking one knocks it down into a walkable spread of rubble.
 *
 * The mound is shared; the variants seed which blocks sit where on it.
 */

import { mulberry32, type Rng } from '../../person/rng';
import type { CellarPiecePainter, PieceOrigin } from './cellarPiece';
import { HALF, LIMESTONE, contactShadow, crackLine, polygon, wash, type Ctx } from './cellarPaint';

const RUBBLE_SEED = 0x7b61;
const SLOPE_SEED = 0x7b62;
/** The remains draw from their own stream, apart from the standing heap's. */
const REMAINS_SEED_FACTOR = 19;
const VARIANTS = 4;

/** Paler than the cellar's walls: fresh breaks in the stone catch the light. */
const FRESH_BREAK = '#c4baa0';
/** The heap's base sits darker than any floor, so it never melts into cinder. */
const MOUND_FOOT = '#2a251f';

/** The mound, in tile fractions of the piece's own width. */
const MOUND = {
  leftX: 0.02,
  rightX: 0.98,
  /** The peak, across the piece and up the tile; a slope peaks off-centre. */
  peakX: 0.46,
  peakY: 0.02,
  slopePeakX: 0.3,
  slopePeakY: 0.12,
  floorY: 0.92,
  /** The control points that round the mound's two shoulders. */
  leftShoulder: [0.08, 0.36],
  rightShoulder: [0.9, 0.3],
  litStop: 0.45,
} as const;

/** A heap's blocks, back row to front row, in tile fractions of the piece. */
const BLOCKS = {
  perTile: 6,
  backY: 0.18,
  frontY: 0.7,
  /** How far either side of the peak a row may reach, back to front. */
  spreadBack: 0.16,
  spreadFront: 0.36,
  width: 0.2,
  widthSpread: 0.16,
  height: 0.12,
  heightSpread: 0.08,
  depth: 0.09,
  skew: 0.25,
  /** A lit block's top steps back this far, as a share of its depth. */
  topLean: 0.5,
  freshChance: 0.35,
} as const;

const SHADOW = { rx: 0.5, ry: 0.12 } as const;
const DUST_RGB = '120,112,96';
const STRUCK = {
  missingBlock: 2,
  crackFrom: [0.3, 0.36],
  crackTo: [0.52, 0.74],
  wobble: 0.04,
  dust: { x: 0.5, y: 0.84, rx: 0.46, ry: 0.12, alpha: 0.4 },
} as const;

/** What a heap knocked down leaves: a walkable spread of grit and low stones. */
const REMAINS = {
  grit: { y: 0.66, ry: 0.26, alpha: 0.5 },
  stonesPerTile: 9,
  stoneX: 0.1,
  stoneSpreadX: 0.76,
  stoneY: 0.48,
  stoneSpreadY: 0.36,
  stone: 0.08,
  stoneSpread: 0.12,
  stoneFlatten: 0.35,
  stoneDepth: 0.025,
} as const;

/**
 * One block of stone seen from above-front: a lit top face and a mid-tone
 * front face under it, with a darker side turned from the light.
 */
function block(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  rng: Rng,
  top: string,
): void {
  const skew = (rng() - HALF) * w * BLOCKS.skew;
  const lean = depth * BLOCKS.topLean;
  ctx.fillStyle = LIMESTONE.mid;
  polygon(ctx, [
    [x, y],
    [x + w, y + skew],
    [x + w, y + skew + h],
    [x, y + h],
  ]);
  ctx.fill();
  ctx.fillStyle = top;
  polygon(ctx, [
    [x + lean, y - depth],
    [x + w + lean, y + skew - depth],
    [x + w, y + skew],
    [x, y],
  ]);
  ctx.fill();
  ctx.fillStyle = LIMESTONE.deep;
  polygon(ctx, [
    [x + w, y + skew],
    [x + w + lean, y + skew - depth],
    [x + w + lean, y + skew + h - depth],
    [x + w, y + skew + h],
  ]);
  ctx.fill();
  ctx.strokeStyle = LIMESTONE.deep;
  ctx.lineWidth = 1;
  polygon(ctx, [
    [x, y],
    [x + lean, y - depth],
    [x + w + lean, y + skew - depth],
    [x + w + lean, y + skew + h - depth],
    [x + w, y + skew + h],
    [x, y + h],
  ]);
  ctx.stroke();
}

function moundPath(ctx: Ctx, at: PieceOrigin, tilesWide: number, peak: readonly [number, number]) {
  const { ox, oy, ts } = at;
  const width = tilesWide * ts;
  const floor = oy + MOUND.floorY * ts;
  ctx.beginPath();
  ctx.moveTo(ox + MOUND.leftX * width, floor);
  ctx.quadraticCurveTo(
    ox + MOUND.leftShoulder[0] * width,
    oy + MOUND.leftShoulder[1] * ts,
    ox + peak[0] * width,
    oy + peak[1] * ts,
  );
  ctx.quadraticCurveTo(
    ox + MOUND.rightShoulder[0] * width,
    oy + MOUND.rightShoulder[1] * ts,
    ox + MOUND.rightX * width,
    floor,
  );
  ctx.closePath();
}

function paintHeap(
  ctx: Ctx,
  at: PieceOrigin,
  variant: number,
  damaged: boolean,
  tilesWide: number,
  seed: number,
): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(seed + variant);
  const width = tilesWide * ts;
  const peak: readonly [number, number] =
    tilesWide === 1 ? [MOUND.peakX, MOUND.peakY] : [MOUND.slopePeakX, MOUND.slopePeakY];
  contactShadow(ctx, ox + width / 2, oy + MOUND.floorY * ts, SHADOW.rx * width, SHADOW.ry * ts);
  // The grit the blocks rest in: lit across its crown, dark at its foot.
  moundPath(ctx, at, tilesWide, peak);
  const mound = ctx.createLinearGradient(0, oy + peak[1] * ts, 0, oy + MOUND.floorY * ts);
  mound.addColorStop(0, LIMESTONE.lit);
  mound.addColorStop(MOUND.litStop, LIMESTONE.shade);
  mound.addColorStop(1, MOUND_FOOT);
  ctx.fillStyle = mound;
  ctx.fill();
  const count = BLOCKS.perTile * tilesWide;
  // Back row to front row, so nearer blocks overlap the ones behind.
  for (let index = 0; index < count; index++) {
    const t = index / (count - 1);
    const y = oy + (BLOCKS.backY + t * (BLOCKS.frontY - BLOCKS.backY)) * ts;
    const spread = BLOCKS.spreadBack + t * (BLOCKS.spreadFront - BLOCKS.spreadBack);
    const centre = tilesWide === 1 ? peak[0] : HALF;
    const cx = ox + (centre + (rng() - HALF) * 2 * spread) * width;
    const w = (BLOCKS.width + rng() * BLOCKS.widthSpread) * ts;
    const h = (BLOCKS.height + rng() * BLOCKS.heightSpread) * ts;
    const top = rng() < BLOCKS.freshChance ? FRESH_BREAK : LIMESTONE.rim;
    if (damaged && index === count - STRUCK.missingBlock) continue;
    const left = Math.min(
      Math.max(cx - w / 2, ox + MOUND.leftX * width),
      ox + width - w - BLOCKS.depth * ts,
    );
    block(ctx, left, y, w, h, BLOCKS.depth * ts, rng, top);
  }
  if (damaged) {
    crackLine(
      ctx,
      ox + STRUCK.crackFrom[0] * width,
      oy + STRUCK.crackFrom[1] * ts,
      ox + STRUCK.crackTo[0] * width,
      oy + STRUCK.crackTo[1] * ts,
      STRUCK.wobble * ts,
      rng,
    );
    const dust = STRUCK.dust;
    wash(
      ctx,
      ox + dust.x * width,
      oy + dust.y * ts,
      dust.rx * width,
      dust.ry * ts,
      DUST_RGB,
      dust.alpha,
    );
  }
}

function paintHeapRemains(
  ctx: Ctx,
  at: PieceOrigin,
  variant: number,
  tilesWide: number,
  seed: number,
) {
  const { ox, oy, ts } = at;
  const rng = mulberry32(seed * REMAINS_SEED_FACTOR + variant);
  const width = tilesWide * ts;
  const r = REMAINS;
  // Walkable: the heap spread out flat, a wash of grit with low stones in it.
  wash(ctx, ox + width / 2, oy + r.grit.y * ts, width / 2, r.grit.ry * ts, DUST_RGB, r.grit.alpha);
  for (let index = 0; index < r.stonesPerTile * tilesWide; index++) {
    const x = ox + (r.stoneX + rng() * r.stoneSpreadX) * width;
    const y = oy + (r.stoneY + rng() * r.stoneSpreadY) * ts;
    const w = (r.stone + rng() * r.stoneSpread) * ts;
    block(ctx, x, y, w, w * r.stoneFlatten, r.stoneDepth * ts, rng, LIMESTONE.rim);
  }
}

/** How a heap comes down, in source pixels. */
const RUBBLE_SHATTER = {
  shardCount: 14,
  shardLength: 9,
  shardWidth: 7,
  spread: 26,
  halfWidth: 12,
  burstHeightTiles: 0.5,
} as const;
const SLOPE_HALF_WIDTH = 44;

const SHATTER_SHADES = [LIMESTONE.mid, LIMESTONE.lit, LIMESTONE.shade, FRESH_BREAK];

export const RUBBLE_HEAP_PAINTER: CellarPiecePainter = {
  tilesWide: 1,
  variants: VARIANTS,
  paint: (ctx, at, variant, damaged) => paintHeap(ctx, at, variant, damaged, 1, RUBBLE_SEED),
  paintRemains: (ctx, at, variant) => paintHeapRemains(ctx, at, variant, 1, RUBBLE_SEED),
  shatter: {
    shades: SHATTER_SHADES,
    edge: LIMESTONE.deep,
    dustRgb: '150,140,120',
    shardCount: RUBBLE_SHATTER.shardCount,
    shardLength: RUBBLE_SHATTER.shardLength,
    shardWidth: RUBBLE_SHATTER.shardWidth,
    spread: RUBBLE_SHATTER.spread,
    halfWidth: RUBBLE_SHATTER.halfWidth,
  },
  burstHeightTiles: RUBBLE_SHATTER.burstHeightTiles,
};

const SLOPE_TILES_WIDE = 2;

export const RUBBLE_SLOPE_PAINTER: CellarPiecePainter = {
  tilesWide: SLOPE_TILES_WIDE,
  variants: VARIANTS,
  paint: (ctx, at, variant, damaged) =>
    paintHeap(ctx, at, variant, damaged, SLOPE_TILES_WIDE, SLOPE_SEED),
  paintRemains: (ctx, at, variant) =>
    paintHeapRemains(ctx, at, variant, SLOPE_TILES_WIDE, SLOPE_SEED),
  shatter: {
    shades: SHATTER_SHADES,
    edge: LIMESTONE.deep,
    dustRgb: '150,140,120',
    shardCount: RUBBLE_SHATTER.shardCount * SLOPE_TILES_WIDE,
    shardLength: RUBBLE_SHATTER.shardLength,
    shardWidth: RUBBLE_SHATTER.shardWidth,
    spread: RUBBLE_SHATTER.spread,
    halfWidth: SLOPE_HALF_WIDTH,
  },
  burstHeightTiles: RUBBLE_SHATTER.burstHeightTiles,
};
