/**
 * The cellars' walkable floor dressing: a scatter of straw and debris, and a
 * clump of faintly glowing fungus.
 *
 * Both are floor, so both are a quiet tonal shift with a few crisp strands or
 * caps on top — never a field of speckle — and both stay strictly inside
 * their own tile, since the straw is baked into the floor's chunks.
 */

import { mulberry32 } from '../../person/rng';
import type { CellarFixedPainter, CellarPiecePainter, PieceOrigin } from './cellarPiece';
import { HALF, TWO_PI, line, wash, type Ctx } from './cellarPaint';

const VARIANTS = 4;

// ── Straw ───────────────────────────────────────────────────────────────────

const STRAW_SEED = 0x57a3;
const STRAW_STRANDS = 18;
const STRAW_LIGHT = '#c4a868';
const STRAW_DARK = '#7d6a40';
const STRAW_WASH_RGB = '138,114,64';
/** A pale bed under the strands: enough to read as straw at game size, never a bright patch. */
const STRAW_WASH_ALPHA = 0.38;
/** Strands keep this far inside the tile so none is cut by a chunk seam. */
const STRAW_MARGIN = 0.1;
const STRAW_LENGTH = { min: 0.12, spread: 0.14 } as const;
const STRAW_DEBRIS = 3;
const DEBRIS_COLOUR = '#4e4436';

/** The straw's bed: centred somewhere in the middle fifth of the tile. */
const STRAW_BED = { centre: 0.4, centreSpread: 0.2, rx: 0.4, ry: 0.3 } as const;
/** Strands lie roughly one way, turned a little either side per variant. */
const STRAW_LIE = { spread: 1.4, turn: 0.3 } as const;
const STRAND_WIDTH = 2;
const LIGHT_STRAND_CHANCE = 0.6;
/** Dark bits of debris among the straw, kept inside the tile. */
const DEBRIS = { size: 0.04, sizeSpread: 0.04, from: 0.15, spread: 0.65, flatten: 0.7 } as const;

function paintStraw(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const rng = mulberry32(STRAW_SEED + variant);
  const cx = ox + (STRAW_BED.centre + rng() * STRAW_BED.centreSpread) * ts;
  const cy = oy + (STRAW_BED.centre + rng() * STRAW_BED.centreSpread) * ts;
  wash(ctx, cx, cy, STRAW_BED.rx * ts, STRAW_BED.ry * ts, STRAW_WASH_RGB, STRAW_WASH_ALPHA);
  const inner = ts * (1 - 2 * STRAW_MARGIN);
  const turn = variant % 2 === 0 ? STRAW_LIE.turn : -STRAW_LIE.turn;
  for (let strand = 0; strand < STRAW_STRANDS; strand++) {
    const length = (STRAW_LENGTH.min + rng() * STRAW_LENGTH.spread) * ts;
    // Most strands lie roughly one way, as straw kicked along a floor does.
    const angle = (rng() - HALF) * STRAW_LIE.spread + turn;
    const half = length / 2;
    const x = ox + STRAW_MARGIN * ts + half + rng() * (inner - length);
    const y = oy + STRAW_MARGIN * ts + half + rng() * (inner - length);
    line(
      ctx,
      x - Math.cos(angle) * half,
      y - Math.sin(angle) * half,
      x + Math.cos(angle) * half,
      y + Math.sin(angle) * half,
      rng() < LIGHT_STRAND_CHANCE ? STRAW_LIGHT : STRAW_DARK,
      STRAND_WIDTH,
    );
  }
  for (let piece = 0; piece < STRAW_DEBRIS; piece++) {
    ctx.fillStyle = DEBRIS_COLOUR;
    const size = (DEBRIS.size + rng() * DEBRIS.sizeSpread) * ts;
    ctx.fillRect(
      ox + (DEBRIS.from + rng() * DEBRIS.spread) * ts,
      oy + (DEBRIS.from + rng() * DEBRIS.spread) * ts,
      size,
      size * DEBRIS.flatten,
    );
  }
}

export const STRAW_SCATTER_PAINTER: CellarFixedPainter = {
  tilesWide: 1,
  variants: VARIANTS,
  paint: paintStraw,
};

// ── Glowing fungus ──────────────────────────────────────────────────────────

const FUNGUS_SEED = 0xf09a;
const DAMP_RGB = '22,30,26';
const CAP_DARK = '#2f4a44';
const CAP_MID = '#4f7d70';
const CAP_GLOW = '#9df0d8';
const STEM = '#c9d8c4';
const GLOW_RGB = '120,230,200';
const GLOW_ALPHA = 0.4;
const SLIME_RGB = '90,170,150';

/** Where a clump grows and how its caps are sized, in tile fractions. */
const CLUMP = {
  minCaps: 3,
  extraCaps: 3,
  x: 0.4,
  xSpread: 0.2,
  y: 0.5,
  ySpread: 0.15,
  reach: 0.24,
  /** Caps sit on the floor, so the clump is squashed down the tile. */
  flatten: 0.6,
  radius: 0.08,
  radiusSpread: 0.07,
} as const;

/** The damp patch and the glow under a clump, in tile fractions. */
const DAMP_PATCH = { x: 0.5, y: 0.58, rx: 0.38, ry: 0.22, alpha: 0.4 } as const;
const GLOW_PATCH = { x: 0.5, y: 0.52, rx: 0.34, ry: 0.24 } as const;

/** One cap, as shares of its radius. */
const CAP = {
  stemLength: 1.1,
  stemMinWidth: 1.5,
  stemWidth: 0.35,
  domeHeight: 0.6,
  topLift: 0.08,
  topWidth: 0.8,
  topHeight: 0.45,
  gillHalf: 0.8,
  gillHeight: 2,
} as const;

/** What a squashed clump leaves, in tile fractions and shares of each cap's radius. */
const SQUASHED = {
  slime: { x: 0.5, y: 0.58, rx: 0.38, ry: 0.2, alpha: 0.3 },
  drop: 0.6,
  spread: 1.2,
  flatten: 0.35,
} as const;

interface Cap {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

function capsFor(variant: number): Cap[] {
  const rng = mulberry32(FUNGUS_SEED + variant);
  const count = CLUMP.minCaps + Math.floor(rng() * CLUMP.extraCaps);
  const caps: Cap[] = [];
  const cx = CLUMP.x + rng() * CLUMP.xSpread;
  const cy = CLUMP.y + rng() * CLUMP.ySpread;
  for (let index = 0; index < count; index++) {
    const angle = rng() * TWO_PI;
    const reach = rng() * CLUMP.reach;
    caps.push({
      x: cx + Math.cos(angle) * reach,
      y: cy + Math.sin(angle) * reach * CLUMP.flatten,
      r: CLUMP.radius + rng() * CLUMP.radiusSpread,
    });
  }
  return caps.sort((a, b) => a.y - b.y);
}

function paintFungus(ctx: Ctx, at: PieceOrigin, variant: number, damaged: boolean): void {
  const { ox, oy, ts } = at;
  const caps = capsFor(variant);
  const damp = DAMP_PATCH;
  wash(ctx, ox + damp.x * ts, oy + damp.y * ts, damp.rx * ts, damp.ry * ts, DAMP_RGB, damp.alpha);
  // The fungus's own faint light, the one bright thing about it.
  const glow = GLOW_PATCH;
  wash(ctx, ox + glow.x * ts, oy + glow.y * ts, glow.rx * ts, glow.ry * ts, GLOW_RGB, GLOW_ALPHA);
  for (const [index, cap] of caps.entries()) {
    if (damaged && index % 2 === 0) continue;
    const x = ox + cap.x * ts;
    const y = oy + cap.y * ts;
    const r = cap.r * ts;
    line(ctx, x, y, x, y + r * CAP.stemLength, STEM, Math.max(CAP.stemMinWidth, r * CAP.stemWidth));
    ctx.fillStyle = CAP_DARK;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * CAP.domeHeight, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = CAP_MID;
    ctx.beginPath();
    ctx.ellipse(x, y - r * CAP.topLift, r * CAP.topWidth, r * CAP.topHeight, 0, Math.PI, 0);
    ctx.fill();
    // Glowing gills along the cap's rim.
    ctx.fillStyle = CAP_GLOW;
    ctx.fillRect(x - r * CAP.gillHalf, y - 1, r * CAP.gillHalf * 2, CAP.gillHeight);
  }
}

function paintFungusRemains(ctx: Ctx, at: PieceOrigin, variant: number): void {
  const { ox, oy, ts } = at;
  const caps = capsFor(variant);
  const slime = SQUASHED.slime;
  wash(
    ctx,
    ox + slime.x * ts,
    oy + slime.y * ts,
    slime.rx * ts,
    slime.ry * ts,
    SLIME_RGB,
    slime.alpha,
  );
  for (const cap of caps) {
    ctx.fillStyle = CAP_DARK;
    ctx.beginPath();
    ctx.ellipse(
      ox + cap.x * ts,
      oy + (cap.y + cap.r * SQUASHED.drop) * ts,
      cap.r * ts * SQUASHED.spread,
      cap.r * ts * SQUASHED.flatten,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/** Squashed, a fungus bursts in a few soft wet bits, in source pixels. */
const FUNGUS_SHATTER = {
  shardCount: 8,
  shardLength: 5,
  shardWidth: 4,
  spread: 18,
  halfWidth: 8,
  burstHeightTiles: 0.55,
} as const;

export const GLOW_FUNGUS_PAINTER: CellarPiecePainter = {
  tilesWide: 1,
  variants: VARIANTS,
  paint: paintFungus,
  paintRemains: paintFungusRemains,
  shatter: {
    shades: [CAP_MID, CAP_GLOW, CAP_DARK],
    edge: CAP_DARK,
    dustRgb: GLOW_RGB,
    shardCount: FUNGUS_SHATTER.shardCount,
    shardLength: FUNGUS_SHATTER.shardLength,
    shardWidth: FUNGUS_SHATTER.shardWidth,
    spread: FUNGUS_SHATTER.spread,
    halfWidth: FUNGUS_SHATTER.halfWidth,
  },
  burstHeightTiles: FUNGUS_SHATTER.burstHeightTiles,
};
