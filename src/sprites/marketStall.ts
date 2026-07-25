/**
 * Market-cart art for the Over City square: a canopied stall two tiles wide,
 * drawn in three named layers so `MarketSystem` can sandwich its stationed
 * vendor between them — back, then the person, then the counter, then the canopy
 * over everything. A single Y-sort key can't place one figure both behind a
 * counter and in front of a back wall, so the stall owns the ordering itself.
 *
 * Every measure is a fraction of the tile size `s`, taken from the footprint's
 * north edge (`sy`) with negative fractions reaching above it — the cart rises
 * well past its own tile, the way the notice board does. All the vertical
 * fractions are pinned to the 1.4-tile-tall vendor `drawPerson` renders: the
 * counter crosses their hips, the frame beam clears their head, and the canopy
 * hem sits above that again.
 *
 * These are game-world figures, so raw canvas calls are appropriate here — the
 * `src/ui/*` helpers are for interface chrome, not sprites.
 */

import { drawSpriteKey } from '../core/SpriteRenderer';
import { WOOD, WOOD_DARK, WOOD_LIGHT } from './townPalette';
import type { GoodsMotif, StallStyle } from '../systems/market/vendorDefs';

/** Footprint width. A one-tile cart is too small to read as a market stall. */
export const STALL_WIDTH_TILES = 2;

const TWO_PI = Math.PI * 2;

interface StallPalette {
  canopy: string;
  canopyShade: string;
  wood: string;
  woodDark: string;
  accent: string;
}

const STALL_PALETTES: Record<StallStyle, StallPalette> = {
  produce_cart: {
    canopy: '#3f8f4f',
    canopyShade: '#2b6437',
    wood: WOOD,
    woodDark: WOOD_DARK,
    accent: '#f0e8d0',
  },
  tinker_bench: {
    canopy: '#b2402f',
    canopyShade: '#7d2a1e',
    wood: WOOD,
    woodDark: WOOD_DARK,
    accent: '#f0e8d0',
  },
  butcher_block: {
    canopy: '#8a3550',
    canopyShade: '#5f2338',
    wood: '#5d4433',
    woodDark: '#3d2a1e',
    accent: '#efe0d6',
  },
  cloth_awning: {
    canopy: '#3f6f9f',
    canopyShade: '#2a4d72',
    wood: WOOD,
    woodDark: WOOD_DARK,
    accent: '#f2ecd8',
  },
};

// Vertical layout, as fractions of a tile from the footprint's north edge.
// Negative reaches above the footprint; the vendor's feet stand on 0.
const GROUND_Y = 0.9;
const CANOPY_RIDGE_Y = -2;
const CANOPY_HEM_Y = -1.52;
const FRAME_BEAM_Y = -1.44;
const STRAP_Y = -1.16;
const SIGN_CORD_TOP_Y = -1.38;
const COUNTER_TOP_Y = -0.5;
const COUNTER_LEG_TOP_Y = 0.34;
const APRON_BOTTOM_Y = 0.62;

// Contact shadow, so the cart sits on the ground instead of floating over it.
const SHADOW_RX_FRACTION = 0.46; // of the full stall width
const SHADOW_RY_FRACTION = 0.15;
const SHADOW_FILL = 'rgba(0, 0, 0, 0.3)';

// Canopy frame: two posts at the outer edges plus the beam they carry.
const POST_WIDTH_FRACTION = 0.09;
const POST_INSET_FRACTION = 0.05; // of the full stall width
const BEAM_THICKNESS_FRACTION = 0.08;

// The rolled-up spare awning strapped to the west post — market clutter that
// explains where the canopy came from.
const STRAP_BULGE_FRACTION = 0.05;
const STRAP_HEIGHT_FRACTION = 0.16;
const STRAP_BAND_HEIGHT_FRACTION = 0.04;

// Hanging sign: two cords off the beam and a plaque carrying the motif glyph.
// Hung well off-centre so it never lands behind the vendor's head.
const SIGN_CENTER_FRACTION = 0.16; // of the full stall width, from the west edge
const SIGN_WIDTH_FRACTION = 0.52;
const SIGN_HEIGHT_FRACTION = 0.34;
const SIGN_CORD_LENGTH_FRACTION = 0.12;
const SIGN_CORD_WIDTH_FRACTION = 0.02;
const SIGN_FRAME_FRACTION = 0.035;
const SIGN_GLYPH_FRACTION = 0.2;

// Wares strung from the beam on the east half, clear of the vendor.
const HANGING_WARE_COUNT = 3;
const HANGING_WARE_START_FRACTION = 0.66; // of the full stall width, from the west edge
const HANGING_WARE_STRIDE_FRACTION = 0.11;
const HANGING_WARE_CORD_FRACTION = 0.1;
const HANGING_WARE_SIZE_FRACTION = 0.13;
/** Every other ware hangs lower, so the row isn't a straight line. */
const HANGING_WARE_ODD_DROP_FACTOR = 1.5;

// Counter: a lit top slab in false perspective over a planked front face. The
// slab alone is what turns a flat rectangle into a box.
const COUNTER_TOP_DEPTH_FRACTION = 0.17;
const COUNTER_BACK_SKEW_FRACTION = 0.07; // how far the slab's back edge pulls in per side
const COUNTER_LIP_FRACTION = 0.05;
const COUNTER_SIDE_OVERHANG_FRACTION = 0.03;
const COUNTER_PLANK_COUNT = 5;
const COUNTER_PLANK_WIDTH_FRACTION = 0.02;

// Cloth apron pinned under the counter, with a wavy hem.
const APRON_INSET_FRACTION = 0.07; // of the full stall width
const APRON_WAVE_SEGMENTS = 6;
const APRON_WAVE_DEPTH_FRACTION = 0.07;

const COUNTER_LEG_WIDTH_FRACTION = 0.1;
const COUNTER_LEG_INSET_FRACTION = 0.04; // of the full stall width

// Canopy fabric: a trapezoid — narrower at the ridge than the hem — so the
// stripes fan out along the slope instead of reading as a flat repeating band.
const CANOPY_RIDGE_INSET_FRACTION = 0.11; // of the full stall width
const CANOPY_OVERHANG_FRACTION = 0.05; // of the full stall width, past each side
const CANOPY_STRIPE_COUNT = 8;
const CANOPY_UNDERSIDE_FRACTION = 0.09;
const CANOPY_RIDGE_CAP_FRACTION = 0.04;
const CANOPY_CAST_SHADOW_FILL = 'rgba(0, 0, 0, 0.22)';

// One idle motion, and only one: the hem breathes. More starts to look busy.
const HEM_RIPPLE_SPEED = 0.045;
const HEM_RIPPLE_STRIDE = 0.8; // phase offset per scallop, so the ripple travels
const HEM_RIPPLE_FRACTION = 0.025;

// Goods on the counter. An odd count in a deliberately uneven arrangement —
// perfectly even spacing is what makes three squares read as programmer art.
const GOODS_COUNT = 7;
const GOODS_SPAN_FRACTION = 0.6; // of the full stall width, centred
const GOOD_SIZE_FRACTION = 0.1;
const GOOD_JITTER_X_FRACTIONS = [0, 0.03, -0.02, 0.015, -0.035, 0.008, 0.025] as const;
const GOOD_JITTER_Y_FRACTIONS = [0, -0.02, 0.012, -0.035, 0.004, -0.016, 0.022] as const;

// Produce: round fruit with a leaf nub and a specular dot, in a shallow crate.
const PRODUCE_CRATE_HEIGHT_FRACTION = 0.12; // of a tile
const PRODUCE_COLORS = ['#d2452f', '#e2a038'] as const;
const PRODUCE_LEAF = '#4f9a3f';
const FRUIT_LEAF_WIDTH_FRACTION = 0.24; // fruit measures are fractions of the good size
const FRUIT_LEAF_HEIGHT_FRACTION = 0.26;
const FRUIT_HIGHLIGHT_RADIUS_FRACTION = 0.07;
const FRUIT_HIGHLIGHT_DX_FRACTION = 0.17;
const FRUIT_HIGHLIGHT_DY_FRACTION = 0.65;

// Bottles: corked silhouettes with a glass highlight stripe.
const BOTTLE_GLASS = '#5f8f6a';
const BOTTLE_CORK = '#c9a061';
const BOTTLE_BODY_WIDTH_FRACTION = 0.6;
const BOTTLE_NECK_WIDTH_FRACTION = 0.2;
const BOTTLE_NECK_HEIGHT_FRACTION = 0.35;
const BOTTLE_CORK_HEIGHT_FRACTION = 0.08;
const BOTTLE_SHEEN_WIDTH_FRACTION = 0.07;
const BOTTLE_SHEEN_HEIGHT_FRACTION = 0.6;
const BOTTLE_SHEEN_DX_FRACTION = 0.15;
const BOTTLE_SHEEN_TOP_FRACTION = 0.85;

// Meat: flat cuts, wider than tall, rimmed with fat.
const MEAT = '#a53a4a';
const MEAT_FAT = '#e8c7c0';
const CUT_WIDTH_FRACTION = 1.1;
const CUT_HEIGHT_FRACTION = 0.55;
const CUT_FAT_WIDTH_FRACTION = 0.5; // of the cut's width
const CUT_FAT_HEIGHT_FRACTION = 0.22; // of the cut's height

// Trinkets: a rotating trio of small shapes laid out on a cloth.
const TRINKET_CLOTH = '#6f5a8a';
const TRINKET_CLOTH_HEIGHT_FRACTION = 0.5; // of the good size
const TRINKET_COLORS = ['#d6b24a', '#8fb6d6', '#c96a86'] as const;
const TRINKET_SHAPE_COUNT = 3;

const HIGHLIGHT = 'rgba(255, 255, 255, 0.5)';

// Reused town clutter: the same crate and barrel PNGs the map decorations use,
// so the market reads as the same settlement rather than a bespoke prop.
const CLUTTER_SIZE_FRACTION = 0.62;
const CLUTTER_STACK_SIZE_FRACTION = 0.42;
const CLUTTER_INSET_FRACTION = 0.02; // of the full stall width

/** Screen Y for a layout fraction measured from the footprint's north edge. */
function yAt(sy: number, s: number, fraction: number): number {
  return sy + s * fraction;
}

/**
 * Canopy posts, the frame beam they carry, the hanging sign and strung wares.
 * Drawn before the vendor so the person stands in front of the back frame.
 */
export function drawStallBack(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  style: StallStyle,
  motif: GoodsMotif,
): void {
  const palette = STALL_PALETTES[style];
  const width = s * STALL_WIDTH_TILES;
  const centerX = sx + width / 2;
  const groundY = yAt(sy, s, GROUND_Y);

  ctx.fillStyle = SHADOW_FILL;
  ctx.beginPath();
  ctx.ellipse(centerX, groundY, width * SHADOW_RX_FRACTION, s * SHADOW_RY_FRACTION, 0, 0, TWO_PI);
  ctx.fill();

  const postWidth = s * POST_WIDTH_FRACTION;
  const westPostX = sx + width * POST_INSET_FRACTION;
  const eastPostX = sx + width - width * POST_INSET_FRACTION - postWidth;
  const postTopY = yAt(sy, s, CANOPY_HEM_Y);
  ctx.fillStyle = palette.woodDark;
  ctx.fillRect(westPostX, postTopY, postWidth, groundY - postTopY);
  ctx.fillRect(eastPostX, postTopY, postWidth, groundY - postTopY);

  const beamY = yAt(sy, s, FRAME_BEAM_Y);
  ctx.fillStyle = palette.wood;
  ctx.fillRect(westPostX, beamY, eastPostX + postWidth - westPostX, s * BEAM_THICKNESS_FRACTION);

  drawRolledAwning(ctx, sy, s, westPostX, postWidth, palette);
  drawHangingSign(ctx, sx, sy, s, width, palette, motif);
  drawHangingWares(ctx, sx, sy, s, width, motif, palette);
}

/**
 * The counter, its goods, the apron and the crate clutter. Drawn after the
 * vendor so the counter cuts across their hips and the goods sit in front.
 */
export function drawStallFront(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  style: StallStyle,
  motif: GoodsMotif,
): void {
  const palette = STALL_PALETTES[style];
  const width = s * STALL_WIDTH_TILES;
  const overhang = s * COUNTER_SIDE_OVERHANG_FRACTION;
  const left = sx - overhang;
  const right = sx + width + overhang;
  const topY = yAt(sy, s, COUNTER_TOP_Y);
  const slabBottomY = topY + s * COUNTER_TOP_DEPTH_FRACTION;
  const legTopY = yAt(sy, s, COUNTER_LEG_TOP_Y);
  const groundY = yAt(sy, s, GROUND_Y);

  const legWidth = s * COUNTER_LEG_WIDTH_FRACTION;
  const legInset = width * COUNTER_LEG_INSET_FRACTION;
  ctx.fillStyle = palette.woodDark;
  ctx.fillRect(sx + legInset, legTopY, legWidth, groundY - legTopY);
  ctx.fillRect(sx + width - legInset - legWidth, legTopY, legWidth, groundY - legTopY);

  const skew = s * COUNTER_BACK_SKEW_FRACTION;
  ctx.fillStyle = WOOD_LIGHT;
  ctx.beginPath();
  ctx.moveTo(left + skew, topY);
  ctx.lineTo(right - skew, topY);
  ctx.lineTo(right, slabBottomY);
  ctx.lineTo(left, slabBottomY);
  ctx.closePath();
  ctx.fill();

  const lipHeight = s * COUNTER_LIP_FRACTION;
  ctx.fillStyle = palette.woodDark;
  ctx.fillRect(left, slabBottomY, right - left, lipHeight);

  const faceTopY = slabBottomY + lipHeight;
  ctx.fillStyle = palette.wood;
  ctx.fillRect(left, faceTopY, right - left, legTopY - faceTopY);
  ctx.fillStyle = palette.woodDark;
  const plankWidth = s * COUNTER_PLANK_WIDTH_FRACTION;
  const plankStride = (right - left) / COUNTER_PLANK_COUNT;
  for (let plank = 1; plank < COUNTER_PLANK_COUNT; plank++) {
    ctx.fillRect(left + plank * plankStride, faceTopY, plankWidth, legTopY - faceTopY);
  }

  drawApron(ctx, sx, sy, s, width, palette);
  drawCounterGoods(ctx, sx, sy, s, width, motif, palette);
  drawClutter(ctx, sx, s, width, groundY, motif);
}

/**
 * The canopy fabric, over everything — including the vendor, who is standing
 * under it. Also lays the canopy's cast shadow across the counter slab.
 */
export function drawStallCanopy(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  style: StallStyle,
  phase: number,
): void {
  const palette = STALL_PALETTES[style];
  const width = s * STALL_WIDTH_TILES;
  const ridgeY = yAt(sy, s, CANOPY_RIDGE_Y);
  const hemY = yAt(sy, s, CANOPY_HEM_Y);
  const ridgeLeft = sx + width * CANOPY_RIDGE_INSET_FRACTION;
  const ridgeRight = sx + width - width * CANOPY_RIDGE_INSET_FRACTION;
  const hemLeft = sx - width * CANOPY_OVERHANG_FRACTION;
  const hemRight = sx + width + width * CANOPY_OVERHANG_FRACTION;

  const counterTopY = yAt(sy, s, COUNTER_TOP_Y);
  ctx.fillStyle = CANOPY_CAST_SHADOW_FILL;
  ctx.fillRect(sx, counterTopY, width, s * COUNTER_TOP_DEPTH_FRACTION);

  const ridgeStride = (ridgeRight - ridgeLeft) / CANOPY_STRIPE_COUNT;
  const hemStride = (hemRight - hemLeft) / CANOPY_STRIPE_COUNT;
  const undersideDepth = s * CANOPY_UNDERSIDE_FRACTION;
  for (let stripe = 0; stripe < CANOPY_STRIPE_COUNT; stripe++) {
    ctx.fillStyle = stripe % 2 === 0 ? palette.canopy : palette.accent;
    ctx.beginPath();
    ctx.moveTo(ridgeLeft + stripe * ridgeStride, ridgeY);
    ctx.lineTo(ridgeLeft + (stripe + 1) * ridgeStride, ridgeY);
    ctx.lineTo(hemLeft + (stripe + 1) * hemStride, hemY);
    ctx.lineTo(hemLeft + stripe * hemStride, hemY);
    ctx.closePath();
    ctx.fill();
  }

  // The underside band plus a scalloped bulge below it: fabric hanging over a
  // frame, rather than a rectangle that stops dead.
  ctx.fillStyle = palette.canopyShade;
  ctx.fillRect(hemLeft, hemY, hemRight - hemLeft, undersideDepth);
  const scallopRadius = hemStride / 2;
  for (let stripe = 0; stripe < CANOPY_STRIPE_COUNT; stripe++) {
    const ripple =
      Math.sin(phase * HEM_RIPPLE_SPEED + stripe * HEM_RIPPLE_STRIDE) * s * HEM_RIPPLE_FRACTION;
    ctx.beginPath();
    ctx.arc(
      hemLeft + (stripe + 0.5) * hemStride,
      hemY + undersideDepth + ripple,
      scallopRadius,
      0,
      Math.PI,
    );
    ctx.fill();
  }

  ctx.fillStyle = palette.accent;
  ctx.fillRect(ridgeLeft, ridgeY, ridgeRight - ridgeLeft, s * CANOPY_RIDGE_CAP_FRACTION);
}

function drawRolledAwning(
  ctx: CanvasRenderingContext2D,
  sy: number,
  s: number,
  postX: number,
  postWidth: number,
  palette: StallPalette,
): void {
  const bulge = s * STRAP_BULGE_FRACTION;
  const rollY = yAt(sy, s, STRAP_Y);
  const rollHeight = s * STRAP_HEIGHT_FRACTION;
  ctx.fillStyle = palette.canopyShade;
  ctx.fillRect(postX - bulge, rollY, postWidth + bulge * 2, rollHeight);
  ctx.fillStyle = palette.woodDark;
  ctx.fillRect(
    postX - bulge,
    rollY + rollHeight / 2,
    postWidth + bulge * 2,
    s * STRAP_BAND_HEIGHT_FRACTION,
  );
}

function drawHangingSign(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  width: number,
  palette: StallPalette,
  motif: GoodsMotif,
): void {
  const centerX = sx + width * SIGN_CENTER_FRACTION;
  const signWidth = s * SIGN_WIDTH_FRACTION;
  const signHeight = s * SIGN_HEIGHT_FRACTION;
  const cordTopY = yAt(sy, s, SIGN_CORD_TOP_Y);
  const cordLength = s * SIGN_CORD_LENGTH_FRACTION;
  const cordWidth = s * SIGN_CORD_WIDTH_FRACTION;
  const plaqueY = cordTopY + cordLength;

  ctx.fillStyle = palette.woodDark;
  ctx.fillRect(centerX - signWidth / 2, cordTopY, cordWidth, cordLength);
  ctx.fillRect(centerX + signWidth / 2 - cordWidth, cordTopY, cordWidth, cordLength);
  ctx.fillRect(centerX - signWidth / 2, plaqueY, signWidth, signHeight);

  const frame = s * SIGN_FRAME_FRACTION;
  ctx.fillStyle = palette.wood;
  ctx.fillRect(
    centerX - signWidth / 2 + frame,
    plaqueY + frame,
    signWidth - frame * 2,
    signHeight - frame * 2,
  );

  drawMotifGlyph(ctx, motif, centerX, plaqueY + signHeight / 2, s * SIGN_GLYPH_FRACTION);
}

function drawHangingWares(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  width: number,
  motif: GoodsMotif,
  palette: StallPalette,
): void {
  const cordTopY = yAt(sy, s, FRAME_BEAM_Y) + s * BEAM_THICKNESS_FRACTION;
  const cordLength = s * HANGING_WARE_CORD_FRACTION;
  const cordWidth = s * SIGN_CORD_WIDTH_FRACTION;
  const size = s * HANGING_WARE_SIZE_FRACTION;
  for (let ware = 0; ware < HANGING_WARE_COUNT; ware++) {
    const wareX = sx + width * (HANGING_WARE_START_FRACTION + ware * HANGING_WARE_STRIDE_FRACTION);
    const dangle = ware % 2 === 0 ? cordLength : cordLength * HANGING_WARE_ODD_DROP_FACTOR;
    ctx.fillStyle = palette.woodDark;
    ctx.fillRect(wareX - cordWidth / 2, cordTopY, cordWidth, dangle);
    drawMotifGlyph(ctx, motif, wareX, cordTopY + dangle + size / 2, size);
  }
}

function drawApron(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  width: number,
  palette: StallPalette,
): void {
  const left = sx + width * APRON_INSET_FRACTION;
  const right = sx + width - width * APRON_INSET_FRACTION;
  const topY = yAt(sy, s, COUNTER_LEG_TOP_Y);
  const hemY = yAt(sy, s, APRON_BOTTOM_Y);
  const waveDepth = s * APRON_WAVE_DEPTH_FRACTION;
  const segmentWidth = (right - left) / APRON_WAVE_SEGMENTS;

  ctx.fillStyle = palette.canopy;
  ctx.beginPath();
  ctx.moveTo(left, topY);
  ctx.lineTo(right, topY);
  ctx.lineTo(right, hemY);
  for (let segment = APRON_WAVE_SEGMENTS; segment > 0; segment--) {
    const midX = left + (segment - 0.5) * segmentWidth;
    const endX = left + (segment - 1) * segmentWidth;
    ctx.quadraticCurveTo(midX, hemY + waveDepth, endX, hemY);
  }
  ctx.closePath();
  ctx.fill();
}

function drawCounterGoods(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  width: number,
  motif: GoodsMotif,
  palette: StallPalette,
): void {
  const restY = yAt(sy, s, COUNTER_TOP_Y);
  const span = width * GOODS_SPAN_FRACTION;
  const startX = sx + width / 2 - span / 2;
  const stride = span / (GOODS_COUNT - 1);
  const size = s * GOOD_SIZE_FRACTION;

  if (motif === 'produce') {
    const crateHeight = s * PRODUCE_CRATE_HEIGHT_FRACTION;
    ctx.fillStyle = palette.woodDark;
    ctx.fillRect(startX - size, restY - crateHeight, span + size * 2, crateHeight);
  }
  if (motif === 'trinkets') {
    const clothHeight = size * TRINKET_CLOTH_HEIGHT_FRACTION;
    ctx.fillStyle = TRINKET_CLOTH;
    ctx.fillRect(startX - size, restY - clothHeight, span + size * 2, clothHeight);
  }

  for (let good = 0; good < GOODS_COUNT; good++) {
    const jitterX = s * GOOD_JITTER_X_FRACTIONS[good % GOOD_JITTER_X_FRACTIONS.length];
    const jitterY = s * GOOD_JITTER_Y_FRACTIONS[good % GOOD_JITTER_Y_FRACTIONS.length];
    const goodX = startX + good * stride + jitterX;
    const goodY = restY + jitterY;
    drawGood(ctx, motif, good, goodX, goodY, size);
  }
}

/** One item of stock, resting with its base on `baseY`. */
function drawGood(
  ctx: CanvasRenderingContext2D,
  motif: GoodsMotif,
  index: number,
  cx: number,
  baseY: number,
  size: number,
): void {
  switch (motif) {
    case 'produce': {
      const radius = size / 2;
      const leafWidth = size * FRUIT_LEAF_WIDTH_FRACTION;
      ctx.fillStyle = PRODUCE_COLORS[index % PRODUCE_COLORS.length];
      ctx.beginPath();
      ctx.arc(cx, baseY - radius, radius, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = PRODUCE_LEAF;
      ctx.fillRect(cx - leafWidth / 2, baseY - size, leafWidth, size * FRUIT_LEAF_HEIGHT_FRACTION);
      ctx.fillStyle = HIGHLIGHT;
      ctx.beginPath();
      ctx.arc(
        cx - size * FRUIT_HIGHLIGHT_DX_FRACTION,
        baseY - size * FRUIT_HIGHLIGHT_DY_FRACTION,
        size * FRUIT_HIGHLIGHT_RADIUS_FRACTION,
        0,
        TWO_PI,
      );
      ctx.fill();
      return;
    }
    case 'bottles': {
      const bodyWidth = size * BOTTLE_BODY_WIDTH_FRACTION;
      const neckWidth = size * BOTTLE_NECK_WIDTH_FRACTION;
      const neckHeight = size * BOTTLE_NECK_HEIGHT_FRACTION;
      const corkHeight = size * BOTTLE_CORK_HEIGHT_FRACTION;
      ctx.fillStyle = BOTTLE_GLASS;
      ctx.fillRect(cx - bodyWidth / 2, baseY - size, bodyWidth, size);
      ctx.fillRect(cx - neckWidth / 2, baseY - size - neckHeight, neckWidth, neckHeight);
      ctx.fillStyle = BOTTLE_CORK;
      ctx.fillRect(
        cx - neckWidth / 2,
        baseY - size - neckHeight - corkHeight,
        neckWidth,
        corkHeight,
      );
      ctx.fillStyle = HIGHLIGHT;
      ctx.fillRect(
        cx - size * BOTTLE_SHEEN_DX_FRACTION,
        baseY - size * BOTTLE_SHEEN_TOP_FRACTION,
        size * BOTTLE_SHEEN_WIDTH_FRACTION,
        size * BOTTLE_SHEEN_HEIGHT_FRACTION,
      );
      return;
    }
    case 'meat': {
      const cutWidth = size * CUT_WIDTH_FRACTION;
      const cutHeight = size * CUT_HEIGHT_FRACTION;
      const fatWidth = cutWidth * CUT_FAT_WIDTH_FRACTION;
      ctx.fillStyle = MEAT;
      ctx.beginPath();
      ctx.ellipse(cx, baseY - cutHeight / 2, cutWidth / 2, cutHeight / 2, 0, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = MEAT_FAT;
      ctx.fillRect(
        cx - fatWidth / 2,
        baseY - cutHeight,
        fatWidth,
        cutHeight * CUT_FAT_HEIGHT_FRACTION,
      );
      return;
    }
    case 'trinkets': {
      ctx.fillStyle = TRINKET_COLORS[index % TRINKET_COLORS.length];
      const shape = index % TRINKET_SHAPE_COUNT;
      if (shape === 0) {
        ctx.beginPath();
        ctx.arc(cx, baseY - size / 2, size / 2, 0, TWO_PI);
        ctx.fill();
      } else if (shape === 1) {
        ctx.fillRect(cx - size / 2, baseY - size, size, size);
      } else {
        ctx.beginPath();
        ctx.moveTo(cx, baseY - size);
        ctx.lineTo(cx + size / 2, baseY - size / 2);
        ctx.lineTo(cx, baseY);
        ctx.lineTo(cx - size / 2, baseY - size / 2);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
  }
}

/** A tiny emblem of what the stall sells — used on the sign and the strung wares. */
function drawMotifGlyph(
  ctx: CanvasRenderingContext2D,
  motif: GoodsMotif,
  cx: number,
  cy: number,
  size: number,
): void {
  drawGood(ctx, motif, 0, cx, cy + size / 2, size);
}

function drawClutter(
  ctx: CanvasRenderingContext2D,
  sx: number,
  s: number,
  width: number,
  groundY: number,
  motif: GoodsMotif,
): void {
  const crateSize = s * CLUTTER_SIZE_FRACTION;
  const crateX = sx + width - width * CLUTTER_INSET_FRACTION - crateSize;
  drawSpriteKey(ctx, 'crate', 'idle', 0, crateX, groundY - crateSize, crateSize);

  const stackSize = s * CLUTTER_STACK_SIZE_FRACTION;
  const stackKey = motif === 'bottles' ? 'barrel' : 'crate';
  drawSpriteKey(
    ctx,
    stackKey,
    'idle',
    0,
    crateX + (crateSize - stackSize) / 2,
    groundY - crateSize - stackSize,
    stackSize,
  );
}
